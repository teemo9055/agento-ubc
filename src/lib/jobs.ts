import type { AgentId } from "./types";

/**
 * The job catalog the agent homes show: ready-made jobs that are known to work, grouped the way
 * people think about them. Shared by the server (which builds each job from live data) and the
 * homes (which show the cards). Kept to what really runs; nothing here books or buys for you.
 */
export type JobSection = "research" | "plan" | "verify" | "weather" | "sports" | "commodities";

export const SECTIONS: Record<JobSection, { agent: AgentId; title: string; blurb: string }> = {
  research: { agent: "worko", title: "Researching", blurb: "Answers with sources, paid per search." },
  plan: { agent: "worko", title: "Planning", blurb: "Trips laid out day by day." },
  verify: { agent: "worko", title: "Verifying", blurb: "Check before you pay or trust." },
  weather: { agent: "inso", title: "Weather", blurb: "Get paid if the day turns too hot or too cold." },
  sports: { agent: "inso", title: "Sports", blurb: "Cover what you lose if your team does." },
  commodities: { agent: "inso", title: "Commodities", blurb: "Hedge a cost before it jumps." },
};

export interface JobCardInfo {
  id: string;
  agent: AgentId;
  section: JobSection;
  /** The worry, in the person's words. */
  title: string;
  /** What the job does, one line. */
  does: string;
  /** Pixel glyph name. */
  glyph: string;
  /** "real" when its checks are paid in real USDC on Arc mainnet. */
  money: "real" | "any";
}

/** What a card shows live: for a cover, the market and its odds; for a check, its price. */
export interface JobPreview {
  id: string;
  /** "Highest temperature in Chicago on Nov 21" */
  market?: string;
  /** "45°F or below" */
  line?: string;
  /** Chance the market gives it, 0-1. */
  chance?: number;
  /** For a cover: what it costs and what it pays. */
  pay?: number;
  get?: number;
  /** For a check: the most its paid steps cost, in USD. */
  cost?: number;
  steps?: number;
  closes?: string;
  /** Where its order would go: practice, test exchange or real. */
  venue?: "paper" | "gemini-sandbox" | "gemini";
  /** Why it can't be started right now, in plain words. */
  unavailable?: string;
}

export const JOBS: JobCardInfo[] = [
  // ---------- Worko ----------
  { id: "company-brief", agent: "worko", section: "research", title: "What's going on with this company?", does: "Top search results and the latest news, summed up", glyph: "case", money: "real" },
  { id: "fair-price", agent: "worko", section: "research", title: "Is this a fair price?", does: "What stores charge for the same thing right now", glyph: "tag", money: "real" },
  { id: "place-reviews", agent: "worko", section: "research", title: "Is this place any good?", does: "Its Google reviews and star ratings, read for you", glyph: "food", money: "real" },
  { id: "road-trip", agent: "worko", section: "plan", title: "Plan my drive so no day is too long", does: "The route split into days, with places to sleep", glyph: "map", money: "any" },
  { id: "ev-trip", agent: "worko", section: "plan", title: "Will I find chargers on my EV trip?", does: "The route split into days, with chargers at each stop", glyph: "car", money: "any" },
  { id: "trip-gas", agent: "worko", section: "plan", title: "Road trip, and cover the gas", does: "Worko plans the drive, Inso covers an oil price jump", glyph: "map", money: "any" },
  { id: "seller-check", agent: "worko", section: "verify", title: "Is this seller real?", does: "Phone line check and a reverse image search of the photo", glyph: "shield", money: "real" },
  { id: "business-check", agent: "worko", section: "verify", title: "Can I trust this contractor?", does: "Recent reviews plus any news about the business", glyph: "tool", money: "real" },
  // ---------- Inso ----------
  { id: "wedding-cold", agent: "inso", section: "weather", title: "Outdoor wedding, and it might be cold", does: "Pays out if the day stays chilly", glyph: "cold", money: "any" },
  { id: "rides-cold", agent: "inso", section: "weather", title: "Rides cost more when it's freezing", does: "Covers the extra fares on a cold day", glyph: "car", money: "any" },
  { id: "heat-bill", agent: "inso", section: "weather", title: "A heatwave would spike my power bill", does: "Pays out if it's hotter than a line you pick", glyph: "sun", money: "any" },
  { id: "tickets-loss", agent: "inso", section: "sports", title: "My team losing would ruin my night", does: "Get your ticket money back if they lose", glyph: "ticket", money: "any" },
  { id: "bar-night", agent: "inso", section: "sports", title: "My sports bar is slow when the home team loses", does: "Covers a slow night if they lose", glyph: "shop", money: "any" },
  { id: "heating-gas", agent: "inso", section: "commodities", title: "My heating bill jumps if gas spikes", does: "Pays out if natural gas rises past a line", glyph: "cold", money: "any" },
  { id: "ring-gold", agent: "inso", section: "commodities", title: "Buying a gold ring soon", does: "Covers a gold price jump before you buy", glyph: "coin", money: "any" },
  { id: "copper-quote", agent: "inso", section: "commodities", title: "I quoted a job at a fixed price", does: "Covers a copper price jump that eats your margin", glyph: "tool", money: "any" },
  { id: "fuel-costs", agent: "inso", section: "commodities", title: "Fuel is my biggest cost", does: "Pays out if oil rises past a line", glyph: "chart", money: "any" },
];

export const jobById = (id: string) => JOBS.find((j) => j.id === id);
