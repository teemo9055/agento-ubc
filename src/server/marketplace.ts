import type { Hex } from "viem";
import { payRequest, quote } from "./nanopay";

/**
 * Circle Agent Marketplace: x402 services other agents sell. Browsing is free; each listing says
 * what it costs, who gets paid, how to call it and which networks it takes. Anything that takes
 * our network can be bought by an agent through one generic path (callService).
 */
const DISCOVERY = process.env.MARKETPLACE_URL ?? "https://api.circle.com/v2/x402/discovery/resources";
export const ARC_TESTNET = "eip155:5042002";
export const ARC_MAINNET = "eip155:5042";
/** The network this app pays on. */
export const PAY_NETWORK = process.env.MARKETPLACE_NETWORK ?? ARC_TESTNET;

export interface Service {
  name: string;
  provider: string;
  category: string;
  description: string;
  resource: string;
  method: "GET" | "POST";
  /** Cheapest listed price in USDC. */
  priceUsd: number | null;
  networks: string[];
  /** Accepts the network this app pays on, through Circle Gateway. */
  payableHere: boolean;
  /** Who is paid on our network, and the price there (USDC base units). */
  payTo?: Hex;
  amount?: string;
  /** What the request should carry, in a few words, from the listing's own schema. */
  input?: string;
}

const NET_NAMES: Record<string, string> = { [ARC_TESTNET]: "Arc testnet", [ARC_MAINNET]: "Arc", "eip155:8453": "Base", "eip155:84532": "Base Sepolia", "eip155:1": "Ethereum", "eip155:137": "Polygon" };
export const networkName = (n: string) => NET_NAMES[n] ?? n;

/** "query: q (string), limit (integer)" from a JSON schema, short enough for a prompt. */
function inputHint(input: unknown): string | undefined {
  type Props = Record<string, { type?: string | string[] }>;
  const i = input as { body?: { properties?: Props }; queryParams?: { properties?: Props } } | undefined;
  const filled = (p?: Props) => (p && Object.keys(p).length ? p : undefined);
  const props = filled(i?.queryParams?.properties) ?? filled(i?.body?.properties);
  if (!props || typeof props !== "object") return undefined;
  const fields = Object.entries(props)
    .slice(0, 8)
    .map(([k, v]) => `${k}${v?.type ? ` (${[v.type].flat().join("|")})` : ""}`);
  return fields.length ? fields.join(", ") : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toService = (i: any): Service => {
  const accepts = (i.accepts ?? []) as { network: string; amount?: string; maxAmountRequired?: string; payTo?: string; extra?: { name?: string } }[];
  const prices = accepts.map((a) => Number(a.amount ?? a.maxAmountRequired ?? NaN) / 1e6).filter((x) => Number.isFinite(x));
  const networks = [...new Set(accepts.map((a) => a.network))];
  const ours = accepts.find((a) => a.network === PAY_NETWORK && a.extra?.name === "GatewayWalletBatched");
  const m = i.metadata ?? {};
  const host = (() => {
    try {
      return new URL(i.resource).host;
    } catch {
      return String(i.resource);
    }
  })();
  return {
    name: m.name ?? `${m.provider?.name ?? host}${m.path && m.path !== "/" ? ` ${m.path}` : ""}`,
    provider: m.provider?.name ?? host,
    category: m.provider?.category ?? "",
    description: String(m.description ?? m.provider?.description ?? "").slice(0, 160),
    resource: i.resource,
    method: String(m.method ?? "GET").toUpperCase() === "POST" ? "POST" : "GET",
    priceUsd: ours ? Number(ours.amount ?? 0) / 1e6 : prices.length ? Math.min(...prices) : null,
    networks,
    payableHere: Boolean(ours),
    payTo: ours?.payTo as Hex | undefined,
    amount: ours?.amount,
    input: inputHint(m.input),
  };
};

async function page(params: Record<string, string>): Promise<{ items: Service[]; total: number }> {
  const r = await fetch(`${DISCOVERY}?${new URLSearchParams(params)}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`marketplace ${r.status}`);
  const body = (await r.json()) as { items?: unknown[]; pagination?: { total?: number } };
  return { items: (body.items ?? []).map(toService), total: body.pagination?.total ?? 0 };
}

/** Search the catalog. With `payableOnly`, only services this app can pay right now. */
export async function searchServices(query: string, category?: string, limit = 6, payableOnly = false): Promise<Service[]> {
  const params: Record<string, string> = { limit: String(Math.min(50, limit * 2)) };
  if (query) params.query = query;
  if (category) params.category = category;
  if (payableOnly) params.network = PAY_NETWORK;
  const found = (await page(params)).items;
  // Payable ones first: they are what the user can act on today.
  return found.sort((a, b) => Number(b.payableHere) - Number(a.payableHere)).slice(0, limit);
}

let payableCache: { at: number; list: Service[] } | undefined;
/** Every listing payable on our network (a couple of hundred at most), cached for ten minutes. */
export async function payableServices(): Promise<Service[]> {
  if (payableCache && Date.now() - payableCache.at < 600_000) return payableCache.list;
  const first = await page({ limit: "100", network: PAY_NETWORK });
  const rest = first.total > 100 ? await Promise.all(Array.from({ length: Math.min(4, Math.ceil(first.total / 100) - 1) }, (_, i) => page({ limit: "100", offset: String((i + 1) * 100), network: PAY_NETWORK }))) : [];
  const list = [...first.items, ...rest.flatMap((p) => p.items)].filter((s) => s.payableHere);
  payableCache = { at: Date.now(), list };
  return list;
}

export const findService = async (resource: string): Promise<Service | undefined> => (await payableServices()).find((s) => s.resource === resource || s.resource === `${resource}/` || `${s.resource}/` === resource);

let statsCache: { at: number; value: CatalogStats } | undefined;
export interface CatalogStats {
  total: number;
  payableNow: number;
  onArcMainnet: number;
  network: string;
  /** Vendors payable now, with how many endpoints each sells. */
  vendors: { provider: string; endpoints: number; from: number | null; example: string }[];
}

/** The size of the market, for showing what's reachable today and what opens up on mainnet. */
export async function catalogStats(): Promise<CatalogStats> {
  if (statsCache && Date.now() - statsCache.at < 600_000) return statsCache.value;
  const [all, mainnet, payable] = await Promise.all([page({ limit: "1" }), page({ limit: "1", network: ARC_MAINNET }), payableServices()]);
  const by = new Map<string, Service[]>();
  for (const s of payable) by.set(s.provider, [...(by.get(s.provider) ?? []), s]);
  const value: CatalogStats = {
    total: all.total,
    payableNow: payable.length,
    onArcMainnet: mainnet.total,
    network: networkName(PAY_NETWORK),
    vendors: [...by.entries()].map(([provider, list]) => ({ provider, endpoints: list.length, from: Math.min(...list.map((s) => s.priceUsd ?? Infinity)), example: list[0].description })).sort((a, b) => b.endpoints - a.endpoints),
  };
  statsCache = { at: Date.now(), value };
  return value;
}

/** Requests that could change something rather than read it are never sent through a paid node. */
const WRITES = /send|submit|broadcast|sign|unlock|import|personal_|admin_|miner_|debug_set|wallet/i;

/** Builds the request a listing expects from plain input: query string for GET, JSON for POST. */
export function serviceRequest(s: Pick<Service, "resource" | "method">, input: Record<string, unknown>): { url: string; init: RequestInit } {
  if (s.method === "GET") {
    const u = new URL(s.resource);
    for (const [k, v] of Object.entries(input)) if (v != null) u.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    return { url: u.toString(), init: { method: "GET" } };
  }
  const rpcMethod = typeof input.method === "string" ? input.method : "";
  if (rpcMethod && WRITES.test(rpcMethod)) throw new Error(`${rpcMethod} would send or sign something; only reads are allowed through a paid node`);
  // JSON-RPC nodes want the envelope; add it when the input is just { method, params }.
  const body = rpcMethod && !("jsonrpc" in input) ? { jsonrpc: "2.0", id: 1, params: [], ...input } : input;
  return { url: s.resource, init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } };
}

export interface ServiceQuote {
  amount: bigint;
  payTo: Hex;
}

/** What the seller asks for this exact request, without paying. Must match its listing. */
export async function quoteService(s: Service, input: Record<string, unknown>): Promise<ServiceQuote> {
  const { url, init } = serviceRequest(s, input);
  const q = await quote(url, init);
  const payTo = q.option.payTo as Hex;
  if (s.payTo && payTo.toLowerCase() !== s.payTo.toLowerCase()) throw new Error(`${s.provider} asks to be paid at a different address than its marketplace listing`);
  return { amount: q.amount, payTo };
}

export interface ServiceResult {
  provider: string;
  resource: string;
  data: unknown;
  paid: { amountUsdc: number; payTo: Hex; via: string; at: string };
}

/** Pays one request to a marketplace service and returns what it answered. */
export async function callService(s: Service, input: Record<string, unknown>, maxAmount?: bigint, payTo?: string): Promise<ServiceResult> {
  const { url, init } = serviceRequest(s, input);
  const r = await payRequest<unknown>(url, init, maxAmount, payTo ?? s.payTo);
  return { provider: s.provider, resource: s.resource, data: r.data, paid: { amountUsdc: Number(r.amount) / 1e6, payTo: r.payTo, via: `${s.provider} x402 · Circle Gateway nanopayment`, at: r.at } };
}

export const CATEGORIES = ["FINANCIAL_ANALYSIS", "WEB_SEARCH_RESEARCH", "TRAVEL_SHOPPING", "DATA_ENRICHMENT", "SOCIAL_INTELLIGENCE", "INFERENCE", "COMMUNICATION", "CREATIVE", "INFRASTRUCTURE"] as const;
