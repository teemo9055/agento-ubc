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
  /** What the person fills in before it's built: their own link, business, phone or place. */
  inputs?: JobInput[];
}

/** One thing a card asks for, typed so the server can check it before building anything. */
export interface JobInput {
  name: string;
  type: "listing_url" | "company_name" | "place" | "phone" | "product_name" | "domain";
  label: string;
  example: string;
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
  /** Gemini lists it only on its live exchange, and the account there can't trade yet. */
  needsVerified?: boolean;
  /** Its market is only on Gemini's real exchange, which isn't connected here. */
  needsVenue?: boolean;
}

export const JOBS: JobCardInfo[] = [
  // ---------- Worko ----------
  { id: "company-brief", agent: "worko", section: "research", title: "Is this company healthy? Staff, money, news", does: "Its staff count over 3 years, every funding round, what changed since, then reads the stories that matter", glyph: "case", money: "real", inputs: [{ name: "company", type: "company_name", label: "Company", example: "Ramp" }, { name: "website", type: "domain", label: "Its website", example: "ramp.com" }] },
  { id: "company-deep", agent: "worko", section: "research", title: "Before I invest in or work with a company", does: "Finds its real site, reads it, checks who's behind it, then news and complaints", glyph: "case", money: "real", inputs: [{ name: "company", type: "company_name", label: "Company", example: "Rivian" }] },
  { id: "place-reviews", agent: "worko", section: "research", title: "Is this place any good?", does: "Its Google reviews, then its own site and any news", glyph: "food", money: "real", inputs: [{ name: "place", type: "place", label: "Place and city", example: "Blue Bottle Coffee, Oakland" }] },
  { id: "road-trip", agent: "worko", section: "plan", title: "Plan my drive so no day is too long", does: "The route split into days, with places to sleep", glyph: "map", money: "any" },
  { id: "ev-trip", agent: "worko", section: "plan", title: "Will I find chargers on my EV trip?", does: "The route split into days, with chargers at each stop", glyph: "car", money: "any" },
  { id: "trip-gas", agent: "worko", section: "plan", title: "Road trip, and cover the gas", does: "Worko plans the drive, Inso covers an oil price jump", glyph: "map", money: "any" },
  { id: "listing-check", agent: "worko", section: "verify", title: "Is this listing a fair deal?", does: "Reads the listing, prices that exact item in stores, checks the photo and seller", glyph: "tag", money: "real", inputs: [{ name: "listing", type: "listing_url", label: "Listing link", example: "https://www.ebay.com/itm/147285431158" }] },
  { id: "seller-check", agent: "worko", section: "verify", title: "Is this seller real?", does: "Their phone line, the listing's photo and price, checked against each other", glyph: "shield", money: "real", inputs: [{ name: "listing", type: "listing_url", label: "Listing link", example: "https://www.ebay.com/itm/147285431158" }, { name: "phone", type: "phone", label: "Seller's phone", example: "+1 415 668 8000" }] },
  { id: "business-check", agent: "worko", section: "verify", title: "Can I trust this contractor?", does: "Finds them on Google, checks the phone and site it lists, then news and complaints", glyph: "tool", money: "real", inputs: [{ name: "business", type: "company_name", label: "Business and city", example: "Bay Area Plumbing, San Francisco" }] },
  // ---------- Inso ----------
  { id: "news-crypto", agent: "inso", section: "news", title: "Bitcoin's in the headlines. Is it priced in?", does: "Reads today's Bitcoin news, then bets on a price line", glyph: "chart", money: "real" },
  { id: "btc-today", agent: "inso", section: "news", title: "Where does Bitcoin end today?", does: "Checks the live price and today's news, then bets on a line for this afternoon", glyph: "chart", money: "real" },
  { id: "news-eth", agent: "inso", section: "news", title: "Ether's moving. Is it priced in?", does: "Reads the Ether news and other markets, then bets on a price line", glyph: "chart", money: "real" },
  { id: "news-sol", agent: "inso", section: "news", title: "Solana's in the headlines", does: "Reads the Solana news and other markets, then bets on a price line", glyph: "chart", money: "real" },
  { id: "news-oil", agent: "inso", section: "news", title: "Oil supply news could raise my fuel bill", does: "Reads the oil news, then covers a price jump", glyph: "coin", money: "real" },
  { id: "news-fed", agent: "inso", section: "news", title: "Rate news could raise my mortgage", does: "Reads the Fed news, then covers a bigger hike", glyph: "bank", money: "real" },
  { id: "wedding-cold", agent: "inso", section: "weather", title: "Outdoor wedding, and it might be cold", does: "Pays out if the day stays chilly", glyph: "cold", money: "any" },
  { id: "rides-cold", agent: "inso", section: "weather", title: "Rides cost more when it's freezing", does: "Covers the extra fares on a cold day", glyph: "car", money: "any" },
  { id: "heat-bill", agent: "inso", section: "weather", title: "A heatwave would spike my power bill", does: "Pays out if it's hotter than a line you pick", glyph: "sun", money: "any" },
  { id: "tickets-loss", agent: "inso", section: "sports", title: "My team losing would ruin my night", does: "Get your ticket money back if they lose", glyph: "ticket", money: "any" },
  { id: "bar-night", agent: "inso", section: "sports", title: "My sports bar is slow when the home team loses", does: "Covers a slow night if they lose", glyph: "shop", money: "any" },
  { id: "heating-gas", agent: "inso", section: "commodities", title: "My heating bill jumps if gas spikes", does: "Pays out if natural gas rises past a line", glyph: "cold", money: "any" },
  { id: "ring-gold", agent: "inso", section: "commodities", title: "Buying a gold ring soon", does: "Covers a gold price jump before you buy", glyph: "coin", money: "any" },
  { id: "silver-jump", agent: "inso", section: "commodities", title: "I buy silver for my jewellery", does: "Checks the live silver price, then covers a jump past a line", glyph: "coin", money: "any" },
  { id: "copper-quote", agent: "inso", section: "commodities", title: "I quoted a job at a fixed price", does: "Covers a copper price jump that eats your margin", glyph: "tool", money: "any" },
  { id: "fuel-costs", agent: "inso", section: "commodities", title: "Fuel is my biggest cost", does: "Pays out if oil rises past a line", glyph: "chart", money: "any" },
];

export const jobById = (id: string) => JOBS.find((j) => j.id === id);
