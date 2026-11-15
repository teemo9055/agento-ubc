import { BatchEvmScheme, CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { circleExecute, circleSignTypedData, circleWallets } from "./circle";
import { USDC } from "./chain";

/**
 * Buying from Circle's Agent Marketplace with Gateway nanopayments.
 * The agent wallet keeps a small USDC balance in Circle Gateway on Arc testnet and signs one
 * EIP-3009 authorization per request; Gateway batches them into a single onchain settlement.
 * Follows developers.circle.com/gateway-nanopayments/quickstarts/buyer.
 */
const chain = CHAIN_CONFIGS.arcTestnet;
const GATEWAY_API = process.env.GATEWAY_API_URL ?? "https://gateway-api-testnet.circle.com";
const ARC_DOMAIN = 26;
const ARC_NETWORK = `eip155:${chain.chain.id}`;
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

function agentWallet() {
  const w = circleWallets.agent;
  if (!w) throw new Error("Marketplace purchases need the Circle agent wallet");
  return w;
}

export async function gatewayBalance(depositor: Hex = agentWallet().address): Promise<number> {
  const r = await fetch(`${GATEWAY_API}/v1/balances`, {
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
export async function depositToGateway(usdc: number): Promise<{ approveTx: Hex; depositTx: Hex }> {
  const w = agentWallet();
  const value = BigInt(Math.round(usdc * 1e6));
  const approveTx = await circleExecute(w.id, USDC, encodeFunctionData({ abi: erc20, functionName: "approve", args: [chain.gatewayWallet as Hex, value] }));
  const depositTx = await circleExecute(w.id, chain.gatewayWallet as Hex, encodeFunctionData({ abi: gatewayAbi, functionName: "deposit", args: [USDC, value] }));
  return { approveTx, depositTx };
}

let scheme: BatchEvmScheme | null = null;
function batchScheme() {
  const w = agentWallet();
  scheme ??= new BatchEvmScheme({
    address: w.address,
    signTypedData: async (params) =>
      circleSignTypedData(w.id, {
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
  const option = req.accepts.find((a) => a.extra?.name === "GatewayWalletBatched" && a.network === ARC_NETWORK);
  if (!option) throw new Error(`${new URL(url).host} doesn't accept Gateway nanopayments on Arc testnet`);
  return { req, option, amount: BigInt(option.amount) };
}

/** Pays one request with a Gateway nanopayment and returns the seller's response. */
export async function payRequest<T>(url: string, init: RequestInit = {}, maxAmount = MAX_PER_REQUEST): Promise<PaidResponse<T>> {
  const { req, option, amount } = await quote(url, init);
  if (amount > maxAmount) throw new Error(`Seller asks ${Number(amount) / 1e6} USDC, above the ${Number(maxAmount) / 1e6} USDC limit`);
  if (!req.resource) throw new Error("Seller sent no resource metadata");
  const payload = await batchScheme().createPaymentPayload(req.x402Version, option as never);
  const sig = Buffer.from(JSON.stringify({ ...payload, accepted: option, resource: req.resource })).toString("base64");
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), "PAYMENT-SIGNATURE": sig }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Payment to ${new URL(url).host} failed: ${res.status} ${(await res.text()).slice(0, 160)}`);
  const settleHeader = res.headers.get("payment-response");
  return {
    data: (await res.json()) as T,
    amount,
    payTo: option.payTo as Hex,
    resource: url,
    settlement: settleHeader ? JSON.parse(Buffer.from(settleHeader, "base64").toString("utf8")) : undefined,
    at: new Date().toISOString(),
  };
}
