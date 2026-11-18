import { addresses, liveReady, publicClient, USDC, usdcAbi } from "../chain";
import { allEntries } from "./library";
import { listItems, waiting } from "./hall";
import { board } from "./boards";
import { allListings } from "./listings";
import { agentoItems } from "./market";

/** Live when the app's wallets are set up on Arc; practice otherwise (nothing moves). */
export const townMode = (): "live" | "practice" => (liveReady() ? "live" : "practice");

/** The app wallet's USDC on Arc, live only; null when it can't be read quickly. */
async function walletBalance(): Promise<string | null> {
  if (!addresses.client) return null;
  try {
    const read = publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [addresses.client] }) as Promise<bigint>;
    const v = await Promise.race([read, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
    return v == null ? null : v.toString();
  } catch {
    return null;
  }
}

/** Counts for the map and the overlay, all from what is stored. */
export async function townSummary() {
  const mode = townMode();
  const items = listItems();
  const listings = allListings();
  return {
    mode,
    balance: mode === "live" ? await walletBalance() : null,
    hall: { inbox: items.filter(waiting).length, total: items.length },
    library: { entries: allEntries().length },
    store: { independent: agentoItems().length + listings.filter((l) => l.status === "approved").length, pending: listings.filter((l) => l.status === "pending").length },
    lab: { open: board("lab").filter((b) => b.item.status !== "answered").length },
    forum: { open: board("forum").filter((b) => b.item.status !== "answered").length },
  };
}
export type TownSummary = Awaited<ReturnType<typeof townSummary>>;
