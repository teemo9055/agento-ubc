import type { Hex } from "viem";
import { addresses, publicClient, send, USDC, usdcAbi } from "./chain";
import * as gemini from "./gemini";
import * as geo from "./geo";

export const NETWORK = "eip155:5042002";

export interface Product {
  id: string;
  description: string;
  price: bigint; // USDC base units
  /** Query parameters, with what each one is, for the catalog and the OpenAPI spec. */
  params: Record<string, string>;
  /** A query that works, so a buyer can try it as is. */
  example: string;
  run: (q: URLSearchParams) => Promise<unknown>;
}

/** `EVENT:SYMBOL:yes,EVENT:SYMBOL:no` → the legs of a combination. */
export function parseLegs(text: string): gemini.LegAsk[] {
  return text
    .split(",")
    .map((x) => x.trim().split(":"))
    .filter((p) => p.length >= 2)
    .map(([eventTicker, symbol, side]) => ({ eventTicker, symbol, side: side?.toLowerCase() === "no" ? ("no" as const) : ("yes" as const) }));
}

/** What cover against several things happening together costs: the answer Agento sells to other agents. */
export async function coverQuote(q: URLSearchParams) {
  const r = await gemini.comboLegs(parseLegs(q.get("legs") ?? ""));
  if ("error" in r) throw new Error(r.error);
  const cover = Math.max(1, Math.min(500, Number(q.get("cover") ?? 10) || 10));
  return {
    pays: "$1 per contract only if every leg resolves as named",
    legs: r.legs.map((l) => ({ event: l.event, contract: l.label, needs: l.side, priceAlone: l.price, eventTicker: l.eventTicker, symbol: l.symbol })),
    fairPrice: r.fair,
    legsBoughtSeparately: r.apart,
    forCoverOf: cover,
    premium: r.fair != null ? Math.round(r.fair * cover * 100) / 100 : null,
    closes: r.closesAt,
    note: "fairPrice multiplies the legs' prices, which assumes they are independent.",
  };
}

export const PRODUCTS: Record<string, Product> = {
  "markets.search": {
    id: "markets.search",
    description: "Active prediction markets matching a query",
    price: 10_000n,
    params: { q: "Keyword, asset or team", limit: "How many, 1-6" },
    example: "q=BTC&limit=3",
    run: (q) => gemini.searchEvents(q.get("q") ?? "", Number(q.get("limit") ?? 5)),
  },
  "markets.event": {
    id: "markets.event",
    description: "One prediction-market event with its contracts",
    price: 10_000n,
    params: { ticker: "Event ticker, e.g. BTC2611152200" },
    example: "ticker=BTC2611152200",
    run: (q) => gemini.getEvent(q.get("ticker") ?? ""),
  },
  "markets.history": {
    id: "markets.history",
    description: "YES-odds history for one contract",
    price: 20_000n,
    params: { symbol: "Contract symbol", tf: "1m, 5m, 15m or 1hr" },
    example: "symbol=GEMI-BTC2611152200-HI65000&tf=15m",
    run: (q) => gemini.oddsHistory(q.get("symbol") ?? "", (q.get("tf") as "15m") ?? "15m"),
  },
  "markets.tape": {
    id: "markets.tape",
    description: "Recent trade tape for one contract",
    price: 100_000n,
    params: { symbol: "Contract symbol" },
    example: "symbol=GEMI-BTC2611152200-HI65000",
    run: (q) => gemini.recentTrades(q.get("symbol") ?? "", 100),
  },
  "spot.candles": {
    id: "spot.candles",
    description: "Spot price candles",
    price: 20_000n,
    params: { symbol: "Spot symbol, e.g. btcusd", tf: "15m, 1hr, 6hr or 1day" },
    example: "symbol=btcusd&tf=1hr",
    run: (q) => gemini.spotCandles(q.get("symbol") ?? "btcusd", (q.get("tf") as "1hr") ?? "1hr"),
  },
  "places.geocode": {
    id: "places.geocode",
    description: "Find a place by name",
    price: 5_000n,
    params: { q: "Place name" },
    example: "q=Austin, TX",
    run: (q) => geo.geocode(q.get("q") ?? ""),
  },
  "routes.drive": {
    id: "routes.drive",
    description: "Driving route through stops",
    price: 30_000n,
    params: { stops: "JSON array of places with coordinates" },
    example: "stops=[]",
    run: (q) => geo.drive(JSON.parse(q.get("stops") ?? "[]")),
  },
  "cover.quote": {
    id: "cover.quote",
    description: "Price cover against 2-6 things happening together: each leg's own price, the fair combined price, and the premium for the cover you want",
    price: 5_000n,
    params: { legs: "EVENT:SYMBOL:yes|no, comma-separated, 2 to 6 of them", cover: "Dollars of cover wanted (default 10)" },
    example: "legs=BTC2611152200:GEMI-BTC2611152200-HI65000:yes,ETH2611152200:GEMI-ETH2611152200-HI1800:yes&cover=20",
    run: coverQuote,
  },
  "markets.new": {
    id: "markets.new",
    description: "Prediction markets that were just listed, are opening soon, or just settled (with how each resolved)",
    price: 5_000n,
    params: { list: "new, upcoming or settled", limit: "How many, 1-20" },
    example: "list=new&limit=5",
    run: (q) => gemini.listEvents((["new", "upcoming", "settled"].includes(q.get("list") ?? "") ? q.get("list") : "new") as gemini.Listing, Number(q.get("limit") ?? 8)),
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
