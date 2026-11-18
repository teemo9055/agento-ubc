import { networkName, searchServices } from "../marketplace";
import { PRODUCTS, NETWORK } from "../x402";
import { SELLERS } from "../sellers";
import { allListings, listingPayable, type Listing } from "./listings";

/**
 * The Store: everything an agent can buy, in two groups. "Verified by Circle" is only what Circle's
 * Agent Marketplace lists. Everything else, Agento's own answers included, is an independent vendor.
 */
export interface StoreItem {
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
  /** Independent listings only: checked by an admin, or still waiting. */
  status?: Listing["status"];
  /** Where an independent listing came from. */
  via?: "agento" | "submitted" | "forum";
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (q: string, ...fields: (string | undefined)[]) => {
  const hay = fields.join(" ").toLowerCase();
  return words(q).every((w) => hay.includes(w));
};

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
  status: l.status,
  via: l.source,
});

/**
 * One search over both groups. Circle's catalog is read live; if it can't be reached the
 * independent group still answers and `circleError` says why.
 */
export async function searchStore(q = "", opts: { origin?: string; limit?: number; includePending?: boolean; circle?: boolean } = {}) {
  const limit = opts.limit ?? 12;
  let circle: StoreItem[] = [];
  let circleError: string | undefined;
  if (opts.circle !== false) try {
    circle = (await searchServices(q, undefined, limit)).map((s, i) => ({
      id: `circle-${i}-${s.resource}`,
      name: s.name,
      sells: s.description || s.name,
      priceUsd: s.priceUsd,
      network: s.payableHere ? networkName(NETWORK) : (s.networks.map(networkName)[0] ?? "Unknown"),
      payableNow: s.payableHere,
      seller: s.provider,
      url: s.resource,
      group: "circle",
    }));
  } catch (e) {
    circleError = `Circle's marketplace didn't answer (${(e as Error).message.slice(0, 60)})`;
  }
  const listed = allListings().filter((l) => l.status === "approved" || (opts.includePending && l.status === "pending"));
  const independent = [...agentoItems(opts.origin), ...listed.map(listingItem)].filter((s) => !q || matches(q, s.name, s.sells, s.seller));
  const pending = allListings().filter((l) => l.status === "pending").length;
  return { circle, circleError, independent, pending };
}
