/**
 * Circle Agent Marketplace catalog: x402 services other agents sell.
 * Browsing is free; each service lists its price and the networks it accepts.
 */
const DISCOVERY = process.env.MARKETPLACE_URL ?? "https://api.circle.com/v2/x402/discovery/resources";
export const ARC_TESTNET = "eip155:5042002";
export const ARC_MAINNET = "eip155:5042";

export interface Service {
  name: string;
  provider: string;
  category: string;
  description: string;
  resource: string;
  /** Cheapest listed price in USDC. */
  priceUsd: number | null;
  networks: string[];
  /** Accepts Arc testnet, the network this app's vaults run on. */
  payableHere: boolean;
}

const NET_NAMES: Record<string, string> = { [ARC_TESTNET]: "Arc testnet", [ARC_MAINNET]: "Arc", "eip155:8453": "Base", "eip155:84532": "Base Sepolia" };
export const networkName = (n: string) => NET_NAMES[n] ?? n;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toService = (i: any): Service => {
  const accepts = (i.accepts ?? []) as { network: string; amount?: string; maxAmountRequired?: string }[];
  const prices = accepts.map((a) => Number(a.amount ?? a.maxAmountRequired ?? NaN) / 1e6).filter((x) => Number.isFinite(x));
  const networks = [...new Set(accepts.map((a) => a.network))];
  const m = i.metadata ?? {};
  return {
    name: m.name ?? m.provider?.name ?? i.resource,
    provider: m.provider?.name ?? "",
    category: m.provider?.category ?? "",
    description: String(m.description ?? "").slice(0, 160),
    resource: i.resource,
    priceUsd: prices.length ? Math.min(...prices) : null,
    networks,
    payableHere: networks.includes(ARC_TESTNET),
  };
};

export async function searchServices(query: string, category?: string, limit = 6): Promise<Service[]> {
  const q = new URLSearchParams({ limit: String(Math.min(25, limit * 2)) });
  if (query) q.set("query", query);
  if (category) q.set("category", category);
  const r = await fetch(`${DISCOVERY}?${q}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`marketplace ${r.status}`);
  const body = (await r.json()) as { items?: unknown[] };
  return (body.items ?? []).map(toService).slice(0, limit);
}

export const CATEGORIES = ["FINANCIAL_ANALYSIS", "WEB_SEARCH_RESEARCH", "TRAVEL_SHOPPING", "DATA_ENRICHMENT", "SOCIAL_INTELLIGENCE", "INFERENCE", "COMMUNICATION", "CREATIVE", "INFRASTRUCTURE"] as const;
