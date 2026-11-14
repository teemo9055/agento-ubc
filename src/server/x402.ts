import type { Hex } from "viem";
import { addresses, publicClient, send, USDC, usdcAbi } from "./chain";
import * as gemini from "./gemini";
import * as geo from "./geo";

export const NETWORK = "eip155:5042002";

export interface Product {
  id: string;
  description: string;
  price: bigint; // USDC base units
  run: (q: URLSearchParams) => Promise<unknown>;
}

export const PRODUCTS: Record<string, Product> = {
  "markets.search": {
    id: "markets.search",
    description: "Active prediction markets matching a query",
    price: 10_000n,
    run: (q) => gemini.searchEvents(q.get("q") ?? "", Number(q.get("limit") ?? 5)),
  },
  "markets.event": {
    id: "markets.event",
    description: "One prediction-market event with its contracts",
    price: 10_000n,
    run: (q) => gemini.getEvent(q.get("ticker") ?? ""),
  },
  "markets.history": {
    id: "markets.history",
    description: "YES-odds history for one contract",
    price: 20_000n,
    run: (q) => gemini.oddsHistory(q.get("symbol") ?? "", (q.get("tf") as "15m") ?? "15m"),
  },
  "markets.tape": {
    id: "markets.tape",
    description: "Recent trade tape for one contract",
    price: 100_000n,
    run: (q) => gemini.recentTrades(q.get("symbol") ?? "", 100),
  },
  "spot.candles": {
    id: "spot.candles",
    description: "Spot price candles",
    price: 20_000n,
    run: (q) => gemini.spotCandles(q.get("symbol") ?? "btcusd", (q.get("tf") as "1hr") ?? "1hr"),
  },
  "places.geocode": {
    id: "places.geocode",
    description: "Find a place by name",
    price: 5_000n,
    run: (q) => geo.geocode(q.get("q") ?? ""),
  },
  "routes.drive": {
    id: "routes.drive",
    description: "Driving route through stops",
    price: 30_000n,
    run: (q) => geo.drive(JSON.parse(q.get("stops") ?? "[]")),
  },
};

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Hex;
  maxTimeoutSeconds: number;
  asset: Hex;
  extra: { name: string; version: string };
}

export interface PaymentPayload {
  x402Version: 1;
  scheme: "exact";
  network: string;
  payload: {
    signature: Hex;
    authorization: { from: Hex; to: Hex; value: string; validAfter: string; validBefore: string; nonce: Hex };
  };
}

export const encodeHeader = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
export const decodeHeader = <T>(v: string): T => JSON.parse(Buffer.from(v, "base64").toString("utf8")) as T;

export function requirements(p: Product, resource: string, payTo: Hex, price = p.price): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    maxAmountRequired: price.toString(),
    resource,
    description: p.description,
    mimeType: "application/json",
    payTo,
    maxTimeoutSeconds: 60,
    asset: USDC,
    extra: { name: "USDC", version: "2" },
  };
}

/**
 * Facilitator role, self-hosted: checks the authorization matches what was asked
 * and settles it on Arc. `from` may be a contract (the work order vault); USDC
 * validates it through ERC-1271.
 */
export async function verifyAndSettle(pay: PaymentPayload, req: PaymentRequirements) {
  const a = pay.payload.authorization;
  if (pay.network !== req.network || pay.scheme !== "exact") throw new Error("wrong network or scheme");
  if (a.to.toLowerCase() !== req.payTo.toLowerCase()) throw new Error("wrong payee");
  if (BigInt(a.value) < BigInt(req.maxAmountRequired)) throw new Error("underpaid");
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(a.validBefore) <= now) throw new Error("authorization expired");
  const used = await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "authorizationState", args: [a.from, a.nonce] });
  if (used) throw new Error("authorization already used");
  if (!addresses.seller) throw new Error("settler wallet missing");
  return send("seller", {
    address: USDC,
    abi: usdcAbi,
    functionName: "transferWithAuthorization",
    args: [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, pay.payload.signature],
  });
}
