import { BatchEvmScheme, CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";
import { MaybeChargedError } from "./delivery";
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { circleExecute, circleSignTypedData, circleWallets } from "./circle";
import { chainOf, send, usdcAbi } from "./chain";
import { currentNet } from "./netContext";
import { NETWORKS, type Net } from "@/lib/networks";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Buying from Circle's Agent Marketplace with Gateway nanopayments.
 * The agent wallet keeps a small USDC balance in Circle Gateway on Arc testnet and signs one
 * EIP-3009 authorization per request; Gateway batches them into a single onchain settlement.
 * Follows developers.circle.com/gateway-nanopayments/quickstarts/buyer.
 */
// Per network: Gateway's chain config, its API, and the network id sellers quote. Testnet signs with
// the Circle agent wallet; mainnet signs with the mainnet agent key (Circle wallets here are testnet ones).
const CONF = { testnet: CHAIN_CONFIGS.arcTestnet, mainnet: CHAIN_CONFIGS.arc };
const gatewayApi = (net: Net) => (net === "testnet" ? (process.env.GATEWAY_API_URL ?? NETWORKS.testnet.gateway.api) : NETWORKS.mainnet.gateway.api);
const ARC_DOMAIN = 26;
const arcNetwork = (net: Net) => NETWORKS[net].caip;
/** Most the agent will pay for one marketplace request, in USDC base units. */
const MAX_PER_REQUEST = BigInt(process.env.MARKETPLACE_MAX_PER_REQUEST ?? 10_000); // 0.01 USDC

export interface PaidResponse<T> {
  data: T;
  amount: bigint; // USDC base units
  payTo: Hex;
  resource: string;
  /** Settlement reference from the seller's PAYMENT-RESPONSE header, when given. */
  settlement?: unknown;
  at: string;
}

/** The agent that pays marketplace sellers on a network: a Circle wallet on testnet, the mainnet key on mainnet. */
function agentWallet(net: Net = currentNet()): { address: Hex; id?: string } {
  if (net === "testnet") {
    const w = circleWallets.agent;
    if (!w) throw new Error("Marketplace purchases need the Circle agent wallet");
    return w;
  }
  const a = chainOf("mainnet").accounts.agent;
  if (!a) throw new Error("Marketplace purchases on Arc mainnet need MAINNET_AGENT_PRIVATE_KEY");
  return { address: a.address };
}

export async function gatewayBalance(depositor?: Hex, net: Net = currentNet()): Promise<number> {
  depositor ??= agentWallet(net).address;
  const r = await fetch(`${gatewayApi(net)}/v1/balances`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "USDC", sources: [{ domain: ARC_DOMAIN, depositor }] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Gateway balance ${r.status}`);
  const j = (await r.json()) as { balances: { domain: number; balance: string }[] };
  return Number(j.balances.find((b) => b.domain === ARC_DOMAIN)?.balance ?? 0);
}

const erc20 = parseAbi(["function approve(address,uint256) returns (bool)"]);
const gatewayAbi = parseAbi(["function deposit(address token, uint256 value)"]);

/** Tops up the agent's Gateway balance from its Arc wallet: approve + deposit, two onchain transactions. */
export async function depositToGateway(usdc: number, net: Net = currentNet()): Promise<{ approveTx: Hex; depositTx: Hex }> {
  const w = agentWallet(net);
  const value = BigInt(Math.round(usdc * 1e6));
  const USDC = chainOf(net).usdc;
  const gw = CONF[net].gatewayWallet as Hex;
  if (w.id) {
    const approveTx = await circleExecute(w.id, USDC, encodeFunctionData({ abi: erc20, functionName: "approve", args: [gw, value] }));
    const depositTx = await circleExecute(w.id, gw, encodeFunctionData({ abi: gatewayAbi, functionName: "deposit", args: [USDC, value] }));
    return { approveTx, depositTx };
  }
  const approveTx = (await send("agent", { address: USDC, abi: erc20, functionName: "approve", args: [gw, value] }, net)).hash;
  const depositTx = (await send("agent", { address: gw, abi: gatewayAbi, functionName: "deposit", args: [USDC, value] }, net)).hash;
  return { approveTx, depositTx };
}

// ---------- automatic top-ups, with a daily cap ----------

const MIN_BALANCE = () => Number(process.env.GATEWAY_MIN_BALANCE ?? 0.05);
// Real money moves in smaller steps: a mainnet top-up and daily cap default lower.
const TOP_UP = (net: Net = currentNet()) => Number(net === "mainnet" ? (process.env.GATEWAY_TOPUP_MAINNET ?? 0.5) : (process.env.GATEWAY_TOPUP ?? 1));
/** Most the agent may move into Gateway on its own in 24 hours. */
const DAILY_CAP = (net: Net = currentNet()) => Number(net === "mainnet" ? (process.env.GATEWAY_DAILY_CAP_MAINNET ?? 2) : (process.env.GATEWAY_DAILY_CAP ?? 3));

interface Deposit {
  at: number;
  usdc: number;
  tx: string;
  /** Missing on older entries, which were all testnet. */
  net?: Net;
}
const ledgerFile = () => path.join(process.env.DATA_DIR ?? path.join(process.cwd(), ".data"), "gateway-deposits.json");
let ledger: Deposit[] | undefined;
function deposits(): Deposit[] {
  if (ledger) return ledger;
  const persist = process.env.PERSIST !== "false" && !process.env.VITEST;
  ledger = persist && existsSync(ledgerFile()) ? (JSON.parse(readFileSync(ledgerFile(), "utf8")) as Deposit[]) : [];
  return ledger;
}
function logDeposit(d: Deposit) {
  const day = Date.now() - 7 * 86_400_000;
  ledger = [...deposits().filter((x) => x.at > day), d];
  if (process.env.PERSIST === "false" || process.env.VITEST) return;
  mkdirSync(path.dirname(ledgerFile()), { recursive: true });
  writeFileSync(ledgerFile(), JSON.stringify(ledger));
}
export const depositedToday = (net: Net = currentNet()) => deposits().filter((d) => (d.net ?? "testnet") === net && d.at > Date.now() - 86_400_000).reduce((s, d) => s + d.usdc, 0);

export class GatewayFundsError extends Error {}

export interface GatewayStatus {
  balance: number;
  wallet: number;
  depositedToday: number;
  dailyCap: number;
  /** Plain warning for the user, if purchases are about to stop. */
  warning?: string;
}

async function walletUsdc(address: Hex, net: Net = currentNet()) {
  const { publicClient, usdc } = chainOf(net);
  const raw = (await publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [address] })) as bigint;
  return Number(raw) / 1e6;
}

export async function gatewayStatus(net: Net = currentNet()): Promise<GatewayStatus> {
  const w = agentWallet(net);
  const [balance, wallet] = await Promise.all([gatewayBalance(w.address, net).catch(() => 0), walletUsdc(w.address, net).catch(() => 0)]);
  const today = depositedToday(net);
  const s: GatewayStatus = { balance, wallet, depositedToday: today, dailyCap: DAILY_CAP(net) };
  if (balance < MIN_BALANCE()) {
    if (wallet < TOP_UP(net)) s.warning = `Marketplace purchases are low on funds: Gateway holds ${balance.toFixed(4)} USDC and the agent wallet ${wallet.toFixed(2)}. Send USDC on ${NETWORKS[net].name} to ${w.address}.`;
    else if (today + TOP_UP(net) > DAILY_CAP(net)) s.warning = `The agent hit its ${DAILY_CAP(net)} USDC daily top-up limit on ${NETWORKS[net].name}; marketplace purchases resume tomorrow or when the cap is raised.`;
  }
  return s;
}

const topping = new Map<Net, Promise<void>>();
/**
 * Keeps a little USDC in Gateway for nanopayments. One top-up at a time, never past the daily cap,
 * and a clear error instead of a silent stall when the wallet is empty or the deposit isn't credited.
 */
export function ensureGatewayFunds(net: Net = currentNet()): Promise<void> {
  const running = topping.get(net);
  if (running) return running;
  const job = (async () => {
    const w = agentWallet(net);
    const min = MIN_BALANCE();
    if ((await gatewayBalance(w.address, net).catch(() => 0)) >= min) return;
    const amount = TOP_UP(net);
    if (depositedToday(net) + amount > DAILY_CAP(net)) throw new GatewayFundsError(`Daily top-up limit reached on ${NETWORKS[net].name} (${DAILY_CAP(net)} USDC). Raise the cap or try tomorrow.`);
    const have = await walletUsdc(w.address, net).catch(() => Infinity);
    if (have < amount) throw new GatewayFundsError(`The agent wallet has ${have.toFixed(2)} USDC, not enough to top up Gateway by ${amount}. Send USDC on ${NETWORKS[net].name} to ${w.address}.`);
    const { depositTx } = await depositToGateway(amount, net);
    logDeposit({ at: Date.now(), usdc: amount, tx: depositTx, net });
    for (let i = 0; i < 40; i++) {
      if ((await gatewayBalance(w.address, net).catch(() => 0)) >= min) return;
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new GatewayFundsError(`Deposited ${amount} USDC (tx ${depositTx.slice(0, 10)}…) but Gateway hasn't credited it yet. Retry in a minute; it won't deposit again.`);
  })().finally(() => topping.delete(net));
  topping.set(net, job);
  return job;
}

const schemes = new Map<Net, BatchEvmScheme>();
function batchScheme(net: Net = currentNet()) {
  const have = schemes.get(net);
  if (have) return have;
  const w = agentWallet(net);
  if (!w.id) {
    // Mainnet: the agent's own key signs the authorization locally.
    const account = chainOf("mainnet").accounts.agent!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = new BatchEvmScheme({ address: account.address, signTypedData: (params) => account.signTypedData(params as any) });
    schemes.set(net, s);
    return s;
  }
  const scheme = new BatchEvmScheme({
    address: w.address,
    signTypedData: async (params) =>
      circleSignTypedData(w.id!, {
        domain: { ...params.domain, chainId: params.domain.chainId.toString() },
        primaryType: params.primaryType,
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          ...params.types,
        },
        message: params.message,
      }),
  });
  schemes.set(net, scheme);
  return scheme;
}

type Accept = { scheme: string; network: string; asset: string; amount: string; payTo: string; maxTimeoutSeconds: number; extra?: Record<string, unknown> };

/** Requirements a seller asks for, without paying. */
export async function quote(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (res.status !== 402) throw new Error(`Expected 402 from ${new URL(url).host}, got ${res.status}`);
  const header = res.headers.get("payment-required");
  if (!header) throw new Error("Seller sent no PAYMENT-REQUIRED header");
  const req = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as { x402Version: number; accepts: Accept[]; resource?: unknown };
  const net = currentNet();
  const option = req.accepts.find((a) => a.extra?.name === "GatewayWalletBatched" && a.network === arcNetwork(net));
  if (!option) throw new Error(`${new URL(url).host} doesn't accept Gateway nanopayments on ${NETWORKS[net].name}`);
  return { req, option, amount: BigInt(option.amount) };
}

/** Pays one request with a Gateway nanopayment and returns the seller's response. */
export async function payRequest<T>(url: string, init: RequestInit = {}, maxAmount = MAX_PER_REQUEST, expectPayTo?: string): Promise<PaidResponse<T>> {
  const { req, option, amount } = await quote(url, init);
  // Checked before anything is signed: never more than approved, never to someone else.
  if (amount > maxAmount) throw new Error(`Seller asks ${Number(amount) / 1e6} USDC, above the ${Number(maxAmount) / 1e6} USDC limit`);
  if (expectPayTo && option.payTo.toLowerCase() !== expectPayTo.toLowerCase()) throw new Error(`${new URL(url).host} now asks to be paid at a different address than was approved`);
  if (!req.resource) throw new Error("Seller sent no resource metadata");
  const payload = await batchScheme().createPaymentPayload(req.x402Version, option as never);
  const sig = Buffer.from(JSON.stringify({ ...payload, accepted: option, resource: req.resource })).toString("base64");
  // From here a signed payment exists. If the answer is lost, Gateway may still settle it in its next
  // batch, so this is reported as "may have been charged", never as "not charged".
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), "PAYMENT-SIGNATURE": sig }, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new MaybeChargedError(`No answer from ${new URL(url).host} after paying (${(e as Error).message.slice(0, 80)})`);
  }
  if (res.status === 402) throw new Error(`Payment to ${new URL(url).host} was refused: ${(await res.text()).slice(0, 160)}`);
  if (!res.ok) {
    const why = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 140);
    throw new MaybeChargedError(`${new URL(url).host} answered ${res.status} after payment${why ? `: ${why}` : ""}`);
  }
  const settleHeader = res.headers.get("payment-response");
  const data = (await res.json().catch(() => undefined)) as T | undefined;
  if (data === undefined) throw new MaybeChargedError(`${new URL(url).host} sent an unreadable answer after payment`);
  return {
    data,
    amount,
    payTo: option.payTo as Hex,
    resource: url,
    settlement: settleHeader ? JSON.parse(Buffer.from(settleHeader, "base64").toString("utf8")) : undefined,
    at: new Date().toISOString(),
  };
}
