import { createHash } from "node:crypto";
import { networkName, payableServices, searchServices, type Service } from "../marketplace";
import { PRODUCTS, NETWORK } from "../x402";
import { SELLERS } from "../sellers";
import { RESEARCH, TOOLKIT } from "../tools";
import { isVendorTool } from "../vendor-tools";
import { allListings, getListing, listingPayable, type Listing } from "./listings";

/**
 * The Store: everything an agent can buy, in two groups. "Verified by Circle" is only what Circle's
 * Agent Marketplace lists. Everything else, Agento's own answers included, is an independent vendor.
 */
export interface StoreItem {
  /** Stable: agento-{product}, listing-{id} or circle-{hash of its address}. */
  id: string;
  name: string;
  /** What it sells, in a line. */
  sells: string;
  priceUsd: number | null;
  network: string;
  payableNow: boolean;
  seller: string;
  url: string;
  group: "circle" | "independent";
  /** A plain category for filters and the card's picture. */
  category: string;
  /** Independent listings only: checked by an admin, or still waiting. */
  status?: Listing["status"];
  /** Where an independent listing came from. */
  via?: "agento" | "submitted" | "forum";
  /** When it was listed or last checked, for listings people and agents added. */
  updatedAt?: string;
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (q: string, ...fields: (string | undefined)[]) => {
  const hay = fields.join(" ").toLowerCase();
  return words(q).every((w) => hay.includes(w));
};

/** Agento's own products, by what they are about. */
export const productCategory = (id: string) =>
  id.startsWith("markets.") ? "Prediction markets" : id.startsWith("spot.") ? "Prices" : id.startsWith("places.") || id.startsWith("routes.") ? "Travel" : id.startsWith("cover.") ? "Cover" : id.startsWith("hall.") ? "Town Hall" : "Data";

/** FINANCIAL_ANALYSIS → Financial analysis. */
const circleCategory = (c: string) => (c ? c[0] + c.slice(1).toLowerCase().replace(/_/g, " ") : "Other");

export function agentoItems(origin = ""): StoreItem[] {
  return Object.values(PRODUCTS).map((p) => ({
    id: `agento-${p.id}`,
    name: p.id,
    sells: p.description,
    priceUsd: Number(p.price) / 1e6,
    network: networkName(NETWORK),
    payableNow: true,
    seller: `Agento (${SELLERS.primary.name})`,
    url: `${origin}/api/x402/${p.id}`,
    group: "independent",
    category: productCategory(p.id),
    status: "approved",
    via: "agento",
  }));
}

export const listingItem = (l: Listing): StoreItem => ({
  id: `listing-${l.id}`,
  name: l.name,
  sells: l.description,
  priceUsd: l.priceUsd ?? null,
  network: l.network,
  payableNow: listingPayable(l),
  seller: l.seller,
  url: l.url,
  group: "independent",
  category: "Listed by the community",
  status: l.status,
  via: l.source,
  updatedAt: l.reviewedAt ?? l.createdAt,
});

export const circleId = (resource: string) => `circle-${createHash("sha256").update(resource).digest("hex").slice(0, 12)}`;

// Circle items seen lately, so a product page can open one without reading the whole catalog again.
const seen = ((globalThis as unknown as { __agentoCircleSeen?: Map<string, StoreItem> }).__agentoCircleSeen ??= new Map());

export function circleItem(s: Service): StoreItem {
  const item: StoreItem = {
    id: circleId(s.resource),
    name: s.name,
    sells: s.description || s.name,
    priceUsd: s.priceUsd,
    network: s.payableHere ? networkName(NETWORK) : (s.networks.map(networkName)[0] ?? "Unknown"),
    payableNow: s.payableHere,
    seller: s.provider,
    url: s.resource,
    group: "circle",
    category: circleCategory(s.category),
  };
  if (seen.size > 2000) seen.clear();
  seen.set(item.id, item);
  return item;
}

/**
 * One search over both groups. Circle's catalog is read live; if it can't be reached the
 * independent group still answers and `circleError` says why.
 */
export async function searchStore(q = "", opts: { origin?: string; limit?: number; includePending?: boolean; circle?: boolean } = {}) {
  const limit = opts.limit ?? 12;
  let circle: StoreItem[] = [];
  let circleError: string | undefined;
  if (opts.circle !== false)
    try {
      circle = (await searchServices(q, undefined, limit)).map(circleItem);
    } catch (e) {
      circleError = `Circle's marketplace didn't answer (${(e as Error).message.slice(0, 60)})`;
    }
  const listed = allListings().filter((l) => l.status === "approved" || (opts.includePending && l.status === "pending"));
  const independent = [...agentoItems(opts.origin), ...listed.map(listingItem)].filter((s) => !q || matches(q, s.name, s.sells, s.seller, s.category));
  const pending = allListings().filter((l) => l.status === "pending").length;
  return { circle, circleError, independent, pending, readAt: new Date().toISOString() };
}

/** One item by its stable id. Circle items are found among those seen lately, then among everything payable now. */
export async function findStoreItem(id: string, origin = ""): Promise<StoreItem | undefined> {
  if (id.startsWith("agento-")) return agentoItems(origin).find((i) => i.id === id);
  if (id.startsWith("listing-")) {
    const l = getListing(id.slice(8));
    return l && l.status !== "rejected" ? listingItem(l) : undefined;
  }
  if (id.startsWith("circle-")) {
    if (seen.has(id)) return seen.get(id);
    try {
      return (await payableServices()).map(circleItem).find((i) => i.id === id);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** For Agento's own products: which agents buy it in a job, through which paid lookup. */
export function usedInJobs(productId: string) {
  return Object.entries(RESEARCH)
    .filter(([name, r]) => !isVendorTool(name) && r.product === productId)
    .map(([name]) => ({ tool: name, agents: (Object.keys(TOOLKIT) as (keyof typeof TOOLKIT)[]).filter((a) => TOOLKIT[a].research.includes(name)) }));
}
