import type { AgentId } from "./types";

/**
 * The job catalog the agent homes show: ready-made jobs that are known to work, grouped the way
 * people think about them. Shared by the server (which builds each job from live data) and the
 * homes (which show the cards). Kept to what really runs; nothing here books or buys for you.
 */
export type JobSection = "research" | "plan" | "verify" | "news" | "weather" | "sports" | "commodities";

export const SECTIONS: Record<JobSection, { agent: AgentId; title: string; blurb: string }> = {
  research: { agent: "worko", title: "Researching", blurb: "Answers with sources, paid per search." },
  plan: { agent: "worko", title: "Planning", blurb: "Trips laid out day by day." },
  verify: { agent: "worko", title: "Verifying", blurb: "Check before you pay or trust." },
  news: { agent: "inso", title: "News + markets", blurb: "Read today's headlines, see what the market prices, then act." },
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

/** One thing a person can pick on a card (a city, their team, a price line), with its live numbers. */
export interface JobChoice {
  id: string;
  label: string;
  market?: string;
  line?: string;
  chance?: number;
  pay?: number;
  get?: number;
  closes?: string;
}

/** What a card shows live: for a cover, the market and its odds; for a check, its price. */
export interface JobPreview {
  /** What can be picked on the card, and which is picked by default. */
  choices?: JobChoice[];
  choice?: string;
  /** What the picker is for: "City", "Your team", "Price line". */
  pick?: string;
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
  /** It runs on Arc mainnet, which this server isn't set up for. */
  needsMainnet?: boolean;
  /** Its market is only on Gemini's real exchange, which isn't connected here. */
  needsVenue?: boolean;
}

export const JOBS: JobCardInfo[] = [
  // ---------- Worko ----------
  { id: "company-brief", agent: "worko", section: "research", title: "What's going on with this company?", does: "Top search results and the latest news, summed up", glyph: "case", money: "real" },
  { id: "fair-price", agent: "worko", section: "research", title: "Is this a fair price?", does: "What stores charge for the same thing right now", glyph: "tag", money: "real" },
  { id: "company-deep", agent: "worko", section: "research", title: "Before I invest in or partner with a company", does: "Search results, news, complaints and rivals: five lookups, summed up", glyph: "case", money: "real" },
  { id: "big-buy", agent: "worko", section: "research", title: "Buying something big. Right one, right price?", does: "Store prices, reviews, recalls and whether a new model is coming", glyph: "tag", money: "real" },
  { id: "place-reviews", agent: "worko", section: "research", title: "Is this place any good?", does: "Its Google reviews and star ratings, read for you", glyph: "food", money: "real" },
  { id: "city-weekend", agent: "worko", section: "plan", title: "Plan a weekend in a city I don't know", does: "What's on, what's in the news, and reviews of where to eat", glyph: "food", money: "real" },
  { id: "road-trip", agent: "worko", section: "plan", title: "Plan my drive so no day is too long", does: "The route split into days, with places to sleep", glyph: "map", money: "any" },
  { id: "ev-trip", agent: "worko", section: "plan", title: "Will I find chargers on my EV trip?", does: "The route split into days, with chargers at each stop", glyph: "car", money: "any" },
  { id: "trip-gas", agent: "worko", section: "plan", title: "Road trip, and cover the gas", does: "Worko plans the drive, Inso covers an oil price jump", glyph: "map", money: "any" },
  { id: "seller-check", agent: "worko", section: "verify", title: "Is this seller real?", does: "Phone line check and a reverse image search of the photo", glyph: "shield", money: "real" },
  { id: "used-car", agent: "worko", section: "verify", title: "Buying a used car from a stranger", does: "Seller's phone, a fair price, recalls, common faults and scams", glyph: "car", money: "real" },
  { id: "rental-check", agent: "worko", section: "verify", title: "Is this apartment listing real?", does: "Landlord's phone, the manager's reviews, usual rent and scams", glyph: "house", money: "real" },
  { id: "business-check", agent: "worko", section: "verify", title: "Can I trust this contractor?", does: "Recent reviews plus any news about the business", glyph: "tool", money: "real" },
  // ---------- Inso ----------
  { id: "news-crypto", agent: "inso", section: "news", title: "Bitcoin's in the headlines. Is it priced in?", does: "Reads today's Bitcoin news, then bets on a price line", glyph: "chart", money: "real" },
  { id: "news-oil", agent: "inso", section: "news", title: "Oil supply news could raise my fuel bill", does: "Reads the oil news, then covers a price jump", glyph: "coin", money: "real" },
  { id: "news-fed", agent: "inso", section: "news", title: "Rate news could raise my mortgage", does: "Reads the Fed news, then covers a bigger hike", glyph: "bank", money: "real" },
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
