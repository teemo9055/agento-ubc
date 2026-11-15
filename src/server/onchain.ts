import { decodeFunctionResult, encodeFunctionData, formatUnits, isAddress, parseAbi, type Hex } from "viem";
import { payRequest } from "./nanopay";

/**
 * Onchain data bought per call from Quicknode on Circle's Agent Marketplace: one vendor, 130+ chains,
 * 0.0001 USDC a request, paid with Gateway nanopayments from Arc. Every function here is a typed,
 * read-only question, so an agent never writes raw RPC and can't send a transaction through it.
 */
/** Where Quicknode is paid on Arc, per its marketplace listings. A request asking for any other payee is refused. */
export const QUICKNODE_PAYEE: Hex = "0xF46394adDdA95A3d5bCC1124605E3d15D204623C";
const node = (chain: string) => `${process.env.QUICKNODE_X402_BASE ?? "https://x402.quicknode.com"}/${chain}/`;

export interface Paid {
  amountUsdc: number;
  payTo: Hex;
  via: string;
  at: string;
}

/** One paid JSON-RPC request. */
async function rpc<T>(chain: string, method: string, params: unknown[]): Promise<{ result: T; paid: Paid }> {
  const r = await payRequest<{ result?: T; error?: { message: string } }>(node(chain), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }, undefined, process.env.QUICKNODE_X402_BASE ? undefined : QUICKNODE_PAYEE);
  if (r.data.result === undefined || r.data.result === null) throw new Error(`Quicknode ${chain}: ${r.data.error?.message ?? "no result"}`);
  return { result: r.data.result, paid: { amountUsdc: Number(r.amount) / 1e6, payTo: r.payTo, via: "Quicknode x402 · Circle Gateway nanopayment", at: r.at } };
}

const total = (a: Paid, b: Paid): Paid => ({ ...b, amountUsdc: Number((a.amountUsdc + b.amountUsdc).toFixed(6)) });

/** Multicall3 (same address on every EVM chain): several reads in one eth_call, so one payment. */
const MULTICALL3: Hex = "0xcA11bde05977b3631167028862bE2a173976CA11";
const mc = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) view returns (Result[] returnData)",
  "function getEthBalance(address addr) view returns (uint256 balance)",
]);
async function multicall(chain: string, calls: { target: Hex; callData: Hex }[]) {
  const { result, paid } = await rpc<Hex>(chain, "eth_call", [{ to: MULTICALL3, data: encodeFunctionData({ abi: mc, functionName: "aggregate3", args: [calls.map((c) => ({ ...c, allowFailure: true }))] }) }, "latest"]);
  return { results: decodeFunctionResult({ abi: mc, functionName: "aggregate3", data: result }) as readonly { success: boolean; returnData: Hex }[], paid };
}

// ---------- Chainlink price feeds (Ethereum mainnet, data.chain.link) ----------

export const FEEDS: Record<string, { feed: Hex; name: string }> = {
  btcusd: { feed: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c", name: "Bitcoin" },
  ethusd: { feed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", name: "Ether" },
  solusd: { feed: "0x4ffC43a60e009B551865A93d232E33Fce9f01507", name: "Solana" },
  linkusd: { feed: "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c", name: "Chainlink" },
  avaxusd: { feed: "0xFF3EEb22B5E3dE6e705b44749C2559d704923FD7", name: "Avalanche" },
  bnbusd: { feed: "0x14e613AC84a31f709eadbdF89C6CC390fDc9540A", name: "BNB" },
  usdcusd: { feed: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", name: "USDC" },
  xauusd: { feed: "0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6", name: "Gold (oz)" },
  xagusd: { feed: "0x379589227b15F1a12195D3f2d90bBc9F31f95235", name: "Silver (oz)" },
  eurusd: { feed: "0xb49f677943BC038e9857d61E7d053CaA2C1734C1", name: "Euro" },
  gbpusd: { feed: "0x5c0Ab2d9b5a7ed9f470386e82BB36A3613cDd4b5", name: "British pound" },
  jpyusd: { feed: "0xBcE206caE7f0ec07b545EddE332A47C2F75bbeb3", name: "Japanese yen" },
};

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
]);

export interface OraclePrice {
  symbol: string;
  feed: Hex;
  description: string;
  price: number;
  updatedAt: string;
  ageMinutes: number;
  round: string;
  /** What it cost and who was paid, for the receipt. */
  paid: Paid;
}

/** Several feeds read at the same block for one payment. */
export async function oraclePrices(symbols: string[]): Promise<OraclePrice[]> {
  const syms = symbols.map((s) => s.toLowerCase());
  for (const s of syms) if (!FEEDS[s]) throw new Error(`No Chainlink feed for ${s}`);
  const { results, paid } = await multicall(
    "ethereum-mainnet",
    syms.flatMap((s) => (["description", "decimals", "latestRoundData"] as const).map((functionName) => ({ target: FEEDS[s].feed, callData: encodeFunctionData({ abi: feedAbi, functionName }) }))),
  );
  return syms.map((symbol, i) => {
    const [d, dec, round] = [results[i * 3], results[i * 3 + 1], results[i * 3 + 2]];
    if (!d.success || !dec.success || !round.success || round.returnData === "0x") throw new Error(`Chainlink feed for ${symbol} didn't answer`);
    const decimals = Number(decodeFunctionResult({ abi: feedAbi, functionName: "decimals", data: dec.returnData }));
    const [roundId, answer, , updatedAt] = decodeFunctionResult({ abi: feedAbi, functionName: "latestRoundData", data: round.returnData }) as readonly [bigint, bigint, bigint, bigint, bigint];
    const updated = Number(updatedAt) * 1000;
    return {
      symbol,
      feed: FEEDS[symbol].feed,
      description: decodeFunctionResult({ abi: feedAbi, functionName: "description", data: d.returnData }) as string,
      price: Number(answer) / 10 ** decimals,
      updatedAt: new Date(updated).toISOString(),
      ageMinutes: Math.round((Date.now() - updated) / 60_000),
      round: roundId.toString(),
      paid,
    };
  });
}

export const chainlinkPrice = async (symbol: string): Promise<OraclePrice> => (await oraclePrices([symbol]))[0];

// ---------- network conditions ----------

export const EVM_CHAINS: Record<string, { slug: string; name: string; coin: string; usdc: Hex }> = {
  ethereum: { slug: "ethereum-mainnet", name: "Ethereum", coin: "ETH", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  base: { slug: "base-mainnet", name: "Base", coin: "ETH", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  arbitrum: { slug: "arbitrum-mainnet", name: "Arbitrum", coin: "ETH", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
  optimism: { slug: "optimism-mainnet", name: "Optimism", coin: "ETH", usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
  polygon: { slug: "matic-mainnet", name: "Polygon", coin: "POL", usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
};

export interface GasPrice {
  chain: string;
  gwei: number;
  /** What a plain transfer (21,000 gas) costs in the chain's own coin. */
  transferCost: number;
  coin: string;
  paid: Paid;
}

export async function gasPrice(chain: string): Promise<GasPrice> {
  const c = EVM_CHAINS[chain.toLowerCase()];
  if (!c) throw new Error(`Unknown chain ${chain}. Known: ${Object.keys(EVM_CHAINS).join(", ")}`);
  const { result, paid } = await rpc<Hex>(c.slug, "eth_gasPrice", []);
  const wei = BigInt(result);
  return { chain: c.name, gwei: Number(formatUnits(wei, 9)), transferCost: Number(formatUnits(wei * 21_000n, 18)), coin: c.coin, paid };
}

export interface BitcoinNetwork {
  /** Fee to confirm within about 3 blocks, in sats per virtual byte. */
  feeSatVb: number;
  /** What a typical 140-vbyte payment costs at that rate, in BTC. */
  typicalFeeBtc: number;
  mempoolTxs: number;
  mempoolMb: number;
  paid: Paid;
}

/** Two paid requests: the fee estimate and the size of the waiting room. */
export async function bitcoinNetwork(): Promise<BitcoinNetwork> {
  const fee = await rpc<{ feerate?: number }>("btc-mainnet", "estimatesmartfee", [3]);
  const pool = await rpc<{ size: number; bytes: number }>("btc-mainnet", "getmempoolinfo", []);
  const btcPerKvb = fee.result.feerate ?? 0.00001;
  return {
    feeSatVb: Number(((btcPerKvb * 1e8) / 1000).toFixed(2)),
    typicalFeeBtc: Number(((btcPerKvb / 1000) * 140).toFixed(8)),
    mempoolTxs: pool.result.size,
    mempoolMb: Number((pool.result.bytes / 1e6).toFixed(1)),
    paid: total(fee.paid, pool.paid),
  };
}

// ---------- balances ----------

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export interface WalletBalance {
  chain: string;
  address: Hex;
  usdc: number;
  native: number;
  coin: string;
  paid: Paid;
}

/** USDC and native-coin balance of any address, read in one paid call. */
export async function walletBalance(chain: string, address: string): Promise<WalletBalance> {
  const c = EVM_CHAINS[chain.toLowerCase()];
  if (!c) throw new Error(`Unknown chain ${chain}. Known: ${Object.keys(EVM_CHAINS).join(", ")}`);
  if (!isAddress(address)) throw new Error("That isn't a wallet address (0x followed by 40 hex characters)");
  const { results, paid } = await multicall(c.slug, [
    { target: c.usdc, callData: encodeFunctionData({ abi: erc20, functionName: "balanceOf", args: [address] }) },
    { target: MULTICALL3, callData: encodeFunctionData({ abi: mc, functionName: "getEthBalance", args: [address] }) },
  ]);
  if (!results[0].success || !results[1].success) throw new Error(`Couldn't read ${address} on ${c.name}`);
  return {
    chain: c.name,
    address,
    usdc: Number(formatUnits(decodeFunctionResult({ abi: erc20, functionName: "balanceOf", data: results[0].returnData }) as bigint, 6)),
    native: Number(Number(formatUnits(decodeFunctionResult({ abi: mc, functionName: "getEthBalance", data: results[1].returnData }) as bigint, 18)).toFixed(6)),
    coin: c.coin,
    paid,
  };
}
