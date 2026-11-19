import type { Hex } from "viem";
import { allLearned, learnedById, recipePrice } from "./learn";
import { recipeInputs, runRecipe } from "./recipeRun";
import { chainOf, send, usdcAbi } from "./chain";
import { NETWORKS, type Net } from "@/lib/networks";
import { SELLERS } from "./sellers";
import * as gemini from "./gemini";
import * as geo from "./geo";
import { TEST_LABEL, type DeliveryPromise } from "./delivery";
import type { Sale } from "./sales";
import { createItem, depositPaid, HALL_DEPOSIT, HallInput, KINDS } from "./town/hall";

/** The network the catalog leads with. Each 402 lists every network this seller can settle on. */
export const NETWORK = NETWORKS.testnet.caip;
export const netOfCaip = (caip: string): Net | undefined => (Object.values(NETWORKS).find((n) => n.caip === caip)?.net);
/** Our own seller settles on a network once it has a wallet there (and, on mainnet, a little USDC for gas). */
export const sellsOn = (net: Net) => Boolean(chainOf(net).addresses.seller) && (net === "testnet" || process.env.MAINNET_SELLING !== "false");
/** Who is paid on each network: the testnet seller may be a Circle wallet; mainnet uses its own key. */
export const payToOn = (net: Net, fallback: Hex) => (net === "testnet" ? fallback : (chainOf("mainnet").addresses.seller ?? fallback));
/** Our own seller, whichever network's address it is paid at; undefined for anyone else. */
export const ownSellerAt = (payee: string) => Object.values(SELLERS).find((s) => [s.address, payToOn("mainnet", s.address)].some((a) => a.toLowerCase() === payee.toLowerCase()));

/** Thrown by a product when the buyer's own request is wrong: answered 400, and nothing is charged. */
export class BadInput extends Error {}

export interface Product {
  id: string;
  description: string;
  price: bigint; // USDC base units
  /** Query parameters, with what each one is, for the catalog and the OpenAPI spec. */
  params: Record<string, string>;
  /** A query that works, so a buyer can try it as is. */
  example: string;
  /** What every answer is promised to contain; a paid answer that breaks it is refunded. */
  promise: DeliveryPromise;
  run: (q: URLSearchParams) => Promise<unknown>;
  /** Called once the payment settled and the sale was recorded. */
  settled?: (sale: Sale, data: unknown) => void;
  /**
   * Costs money to answer (it buys from other sellers): the buyer's payment is settled first, and
   * refunded in full if the answer can't be delivered. Checked before anything is charged: `validate`.
   */
  payFirst?: boolean;
  validate?: (q: URLSearchParams) => void;
  /** Networks it is sold on, when not every one the seller settles on. */
  nets?: Net[];
  /** Answer that failed after payment: says so, so the route refunds. */
  failed?: (data: unknown) => string | null;
}

// ---------- learned recipes for sale: recipe.<id> ----------

const salesToday = new Map<string, number>();
const today = () => new Date().toISOString().slice(0, 10);
/** USDC spent today running recipes for buyers; the day's cap stops sales before more is spent. */
export const recipeSpendToday = () => salesToday.get(today()) ?? 0;
const DAILY_CAP = () => Number(process.env.RECIPE_SALES_DAILY_CAP_USD ?? 5);

/** A promoted learned recipe as a product other agents can buy. */
export function recipeProduct(id: string): Product | undefined {
  const r = learnedById(id);
  if (!r || r.status !== "promoted") return undefined;
  const price = recipePrice(r);
  return {
    id: `recipe.${r.id}`,
    description: `${r.title}: ${r.gets}. Worked ${r.successes} of ${r.runs} times; runs ${r.steps.length} paid checks from Circle's Agent Marketplace and returns a report with the evidence`.slice(0, 300),
    price,
    params: Object.fromEntries(r.needs.map((n) => [n.name, `${n.type.replace(/_/g, " ")} (required)`])),
    example: r.needs.map((n) => `${n.name}=${encodeURIComponent(n.type === "phone" ? "+16045550199" : n.type.includes("url") ? "https://example.com/item/1" : n.type === "email" ? "someone@example.com" : n.type === "domain" ? "example.com" : "example")}`).join("&"),
    promise: { fields: ["report", "receipt"] },
    payFirst: true,
    nets: [r.network],
    validate: (q) => {
      recipeInputs(r, (k) => q.get(k));
      if (recipeSpendToday() + r.avgCostUsd > DAILY_CAP()) throw new BadInput(`Sold out for today: recipe runs are capped at $${DAILY_CAP()} a day`);
    },
    run: async (q) => {
      const out = await runRecipe(r, recipeInputs(r, (k) => q.get(k)));
      salesToday.set(today(), recipeSpendToday() + out.receipt.spentUsd);
      return out;
    },
    failed: (d) => ((d as { ok?: boolean } | null)?.ok === false ? "A must-know check didn't deliver" : null),
  };
}

/** Everything on sale: the fixed products and every promoted learned recipe. */
export function forSale(): Product[] {
  const recipes = allLearned()
    .filter((r) => r.status === "promoted")
    .map((r) => recipeProduct(r.id))
    .filter((p): p is Product => Boolean(p));
  return [...Object.values(PRODUCTS), ...recipes];
}

/** A fixed product, or a learned recipe for sale. */
export const productFor = (id: string): Product | undefined => PRODUCTS[id] ?? (id.startsWith("recipe.") ? recipeProduct(id.slice(7)) : undefined);

/** How long after a sale a refund can be claimed. */
export const REFUND_WINDOW_MIN = 10;

/** The refund rules, published with every listing so a buyer knows them before paying. */
export const refundPolicy = (origin: string, p: Product) => ({
  claim: `${origin}/api/x402/refund`,
  redeliver: `${origin}/api/x402/redeliver`,
  windowMinutes: REFUND_WINDOW_MIN,
  checks: Object.values(TEST_LABEL),
  promise: p.promise,
  rules: [
    "Send the settlement transaction, the paying address and the answer you got. If its fingerprint matches what we sent and it fails a check, the full price goes back to the paying address on Arc.",
    "One claim per sale. A lost answer can be fetched again for free instead.",
    "A valid answer stays paid, whether or not it was useful.",
  ],
});

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
    promise: { list: true, fields: ["ticker", "contracts"] },
    run: (q) => gemini.searchEvents(q.get("q") ?? "", Number(q.get("limit") ?? 5)),
  },
  "markets.event": {
    id: "markets.event",
    description: "One prediction-market event with its contracts",
    price: 10_000n,
    params: { ticker: "Event ticker, e.g. BTC2611152200" },
    example: "ticker=BTC2611152200",
    promise: { fields: ["ticker", "title", "contracts"] },
    run: (q) => gemini.getEvent(q.get("ticker") ?? ""),
  },
  "markets.history": {
    id: "markets.history",
    description: "YES-odds history for one contract",
    price: 20_000n,
    params: { symbol: "Contract symbol", tf: "1m, 5m, 15m or 1hr" },
    example: "symbol=GEMI-BTC2611152200-HI65000&tf=15m",
    promise: { list: true },
    run: (q) => gemini.oddsHistory(q.get("symbol") ?? "", (q.get("tf") as "15m") ?? "15m"),
  },
  "markets.tape": {
    id: "markets.tape",
    description: "Recent trade tape for one contract",
    price: 100_000n,
    params: { symbol: "Contract symbol" },
    example: "symbol=GEMI-BTC2611152200-HI65000",
    promise: { list: true },
    run: (q) => gemini.recentTrades(q.get("symbol") ?? "", 100),
  },
  "spot.candles": {
    id: "spot.candles",
    description: "Spot price candles",
    price: 20_000n,
    params: { symbol: "Spot symbol, e.g. btcusd", tf: "15m, 1hr, 6hr or 1day" },
    example: "symbol=btcusd&tf=1hr",
    promise: { list: true },
    run: (q) => gemini.spotCandles(q.get("symbol") ?? "btcusd", (q.get("tf") as "1hr") ?? "1hr"),
  },
  "places.geocode": {
    id: "places.geocode",
    description: "Find a place by name",
    price: 5_000n,
    params: { q: "Place name" },
    example: "q=Austin, TX",
    promise: { nullable: true, fields: ["name", "lat", "lon"] },
    run: (q) => geo.geocode(q.get("q") ?? ""),
  },
  "routes.drive": {
    id: "routes.drive",
    description: "Driving route through stops",
    price: 30_000n,
    params: { stops: "JSON array of places with coordinates" },
    example: "stops=[]",
    promise: { fields: ["distanceKm", "hours", "legs"] },
    run: (q) => geo.drive(JSON.parse(q.get("stops") ?? "[]")),
  },
  "cover.quote": {
    id: "cover.quote",
    description: "Price cover against 2-6 things happening together: each leg's own price, the fair combined price, and the premium for the cover you want",
    price: 5_000n,
    params: { legs: "EVENT:SYMBOL:yes|no, comma-separated, 2 to 6 of them", cover: "Dollars of cover wanted (default 10)" },
    example: "legs=BTC2611152200:GEMI-BTC2611152200-HI65000:yes,ETH2611152200:GEMI-ETH2611152200-HI1800:yes&cover=20",
    promise: { fields: ["legs"] },
    run: coverQuote,
  },
  "markets.new": {
    id: "markets.new",
    description: "Prediction markets that were just listed, are opening soon, or just settled (with how each resolved)",
    price: 5_000n,
    params: { list: "new, upcoming or settled", limit: "How many, 1-20" },
    example: "list=new&limit=5",
    promise: { list: true },
    run: (q) => gemini.listEvents((["new", "upcoming", "settled"].includes(q.get("list") ?? "") ? q.get("list") : "new") as gemini.Listing, Number(q.get("limit") ?? 8)),
  },
  "hall.request": {
    id: "hall.request",
    description: "Send Agento's Town Hall a request, feedback, a need or a feature offer. The 1 USDC is a deposit against spam: refunded when an admin finds it isn't spam",
    price: HALL_DEPOSIT,
    params: { kind: KINDS.join(", "), text: "What you want to say, 5 to 1000 characters", from: "Your name or your agent's (optional)", contact: "How to reach you (optional)" },
    example: "kind=feedback&text=Please%20list%20more%20Arc%20testnet%20services&from=my-agent",
    promise: { fields: ["id", "status", "statusUrl"] },
    run: async (q) => {
      const v = HallInput.safeParse({ kind: q.get("kind") ?? "", text: q.get("text") ?? "", from: q.get("from") ?? undefined, contact: q.get("contact") ?? undefined });
      if (!v.success) throw new BadInput(v.error.issues[0]?.message ?? "Check kind and text");
      const item = createItem(v.data, "agent", "live");
      return { id: item.id, status: "received", statusUrl: `/town/hall/${item.id}`, deposit: "1 USDC, refunded if it isn't spam" };
    },
    settled: (sale, data) => {
      const id = (data as { id?: unknown } | null)?.id;
      if (typeof id === "string") depositPaid(id, sale);
    },
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

export function requirements(p: Product, resource: string, payTo: Hex, price = p.price, net: Net = "testnet"): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORKS[net].caip,
    maxAmountRequired: price.toString(),
    resource,
    description: p.description,
    mimeType: "application/json",
    payTo,
    maxTimeoutSeconds: 60,
    asset: chainOf(net).usdc,
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
  const net = netOfCaip(req.network);
  if (!net) throw new Error("wrong network or scheme");
  const { publicClient, usdc: USDC, addresses } = chainOf(net);
  if (a.to.toLowerCase() !== req.payTo.toLowerCase()) throw new Error("wrong payee");
  if (BigInt(a.value) < BigInt(req.maxAmountRequired)) throw new Error("underpaid");
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(a.validBefore) <= now) throw new Error("authorization expired");
  const used = await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "authorizationState", args: [a.from, a.nonce] });
  if (used) throw new Error("authorization already used");
  if (!addresses.seller) throw new Error("settler wallet missing");
  return send(
    "seller",
    {
      address: USDC,
      abi: usdcAbi,
      functionName: "transferWithAuthorization",
      args: [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, pay.payload.signature],
    },
    net,
  );
}
