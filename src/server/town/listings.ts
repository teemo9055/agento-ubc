import { randomUUID } from "node:crypto";
import { z } from "zod";
import { all, get, put } from "./db";
import { httpsUrl } from "./boards";

/**
 * Services listed in the Store by people and agents. Every one starts Independent and pending; an
 * admin checks it before it is shown as approved. Only Circle's own marketplace earns "Verified by Circle".
 */
export const NETWORKS = ["Arc testnet", "Arc", "Base", "Other"] as const;

export const ListingInput = z.object({
  name: z.string().trim().min(2, "Give it a name").max(60),
  description: z.string().trim().min(10, "Say what it sells (at least 10 characters)").max(300, "At most 300 characters"),
  url: httpsUrl,
  priceUsd: z.number().min(0).max(1000).optional(),
  network: z.enum(NETWORKS).default("Arc testnet"),
  seller: z.string().trim().min(2, "Who sells it?").max(60),
});
export type ListingInput = z.input<typeof ListingInput>;

export interface Listing extends z.infer<typeof ListingInput> {
  id: string;
  status: "pending" | "approved" | "rejected";
  /** submitted: listed in the Store directly; forum: an offer the admin marked trusted. */
  source: "submitted" | "forum";
  by: "person" | "agent";
  createdAt: string;
  reviewedAt?: string;
  reason?: string;
  /** The Town Hall item it answered, when it came from the Forum. */
  itemId?: string;
}

export function submitListing(input: ListingInput, by: Listing["by"], extra: Partial<Pick<Listing, "source" | "itemId" | "status">> = {}): Listing {
  const v = ListingInput.parse(input);
  const l: Listing = { ...v, id: randomUUID().slice(0, 12), status: "pending", source: "submitted", by, createdAt: new Date().toISOString(), ...extra };
  return put("town_listings", l);
}

export const getListing = (id: string) => get<Listing>("town_listings", id);
export const saveListing = (l: Listing) => put("town_listings", l);
export const allListings = () => all<Listing>("town_listings");

/** Payable now means it takes the network this app pays on, and an admin has checked it. */
export const listingPayable = (l: Listing) => l.status === "approved" && l.network === "Arc testnet";
