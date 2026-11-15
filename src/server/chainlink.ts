import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";
import { payRequest, type PaidResponse } from "./nanopay";

/**
 * Chainlink price feeds on Ethereum mainnet, read through Quicknode's x402 node
 * (bought per call with a Gateway nanopayment from Arc testnet USDC).
 * An independent oracle price to check Gemini's spot price against before trading.
 */
const NODE = process.env.QUICKNODE_X402_URL ?? "https://x402.quicknode.com/ethereum-mainnet/";

/** Chainlink USD feeds on Ethereum mainnet (data.chain.link). */
export const FEEDS: Record<string, Hex> = {
  btcusd: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
  ethusd: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  solusd: "0x4ffC43a60e009B551865A93d232E33Fce9f01507",
  linkusd: "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c",
};

const abi = parseAbi([
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
  paid: { amountUsdc: number; payTo: Hex; via: string; at: string };
}

/** Multicall3 (same address on every EVM chain): several reads in one eth_call, so one payment. */
const MULTICALL3: Hex = "0xcA11bde05977b3631167028862bE2a173976CA11";
const multicallAbi = parseAbi(["struct Call3 { address target; bool allowFailure; bytes callData; }", "struct Result { bool success; bytes returnData; }", "function aggregate3(Call3[] calls) view returns (Result[] returnData)"]);

/** One paid eth_call: description, decimals and the latest round, read at the same block. */
export async function chainlinkPrice(symbol: string): Promise<OraclePrice> {
  const feed = FEEDS[symbol.toLowerCase()];
  if (!feed) throw new Error(`No Chainlink feed for ${symbol}`);
  const calls = (["description", "decimals", "latestRoundData"] as const).map((functionName) => ({ target: feed, allowFailure: false, callData: encodeFunctionData({ abi, functionName }) }));
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: MULTICALL3, data: encodeFunctionData({ abi: multicallAbi, functionName: "aggregate3", args: [calls] }) }, "latest"] });
  const paid: PaidResponse<{ result?: Hex; error?: { message: string } }> = await payRequest(NODE, { method: "POST", headers: { "content-type": "application/json" }, body });
  if (!paid.data.result) throw new Error(`Node returned no result (${paid.data.error?.message ?? "empty"})`);
  const results = decodeFunctionResult({ abi: multicallAbi, functionName: "aggregate3", data: paid.data.result }) as readonly { success: boolean; returnData: Hex }[];
  const get = (i: number) => results[i].returnData;
  const description = decodeFunctionResult({ abi, functionName: "description", data: get(0) }) as string;
  const decimals = Number(decodeFunctionResult({ abi, functionName: "decimals", data: get(1) }));
  const [round, answer, , updatedAt] = decodeFunctionResult({ abi, functionName: "latestRoundData", data: get(2) }) as readonly [bigint, bigint, bigint, bigint, bigint];
  const updated = Number(updatedAt) * 1000;
  return {
    symbol: symbol.toLowerCase(),
    feed,
    description,
    price: Number(answer) / 10 ** decimals,
    updatedAt: new Date(updated).toISOString(),
    ageMinutes: Math.round((Date.now() - updated) / 60_000),
    round: round.toString(),
    paid: { amountUsdc: Number(paid.amount) / 1e6, payTo: paid.payTo, via: "Quicknode x402 · Circle Gateway nanopayment", at: paid.at },
  };
}
