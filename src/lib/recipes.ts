import type { AgentId } from "./types";

/**
 * The recipe book: combinations that solve a practical problem, written the way people feel the
 * problem ("Plan my drive so no day is too long"), not the way the tools are named. A recipe is a tested starting
 * point: picking one opens a job where the agent shapes it with you (adds, drops or swaps steps),
 * and it then goes through the same review, graph and receipt as any other job.
 *
 * Only recipes whose every step runs today are listed. Each step says who does it:
 * - kind: pays (Agento pays per request from the job's vault) · free (a free lookup) ·
 *   agent (handed to another agent in the same project).
 */
export type StepKind = "pays" | "free" | "agent";
export type StepWhere = "now";

export interface RecipeStep {
  label: string;
  /** Who provides it: a seller, a site, or one of the agents. */
  by: string;
  /** USDC per request, when it costs anything. */
  cost?: number;
  kind: StepKind;
  where: StepWhere;
}

export type Moment = "travel" | "money" | "protect" | "events" | "work";

export const MOMENTS: Record<Moment, { label: string; blurb: string }> = {
  travel: { label: "Travelling", blurb: "Getting there, and when plans go sideways." },
  money: { label: "Money & crypto", blurb: "What could hit what you hold." },
  protect: { label: "Protecting a plan", blurb: "Pay a little now, get paid if the bad thing happens." },
  events: { label: "Nights out & events", blurb: "Plans that depend on the weather or a game." },
  work: { label: "Work", blurb: "Costs that hit your business." },
};

export interface Recipe {
  id: string;
  agent: AgentId;
  moment: Moment;
  /** The problem, in the person's words. */
  worry: string;
  /** What the recipe does, in a few words. */
  title: string;
  /** What comes back. */
  gets: string;
  /** The first message, which opens the job. */
  say: string;
  /** Words that suggest this recipe fits a request. */
  words: string[];
  steps: RecipeStep[];
  /** Recipes worth offering once this one is done. */
  next?: string[];
}


export const RECIPES: Recipe[] = [
  // ---------- Worko ----------
  {
    id: "road-trip",
    agent: "worko",
    moment: "travel",
    worry: "Plan my drive so no day is too long.",
    title: "A road trip split into easy days",
    gets: "A route map, driving days that fit your hours, and places to sleep.",
    say: "Plan a drive from Vancouver to San Francisco in 3 days, with places to sleep.",
    words: ["road trip", "drive", "driving", "route", "itinerary", "days", "stops", "where to sleep"],
    steps: [
      { label: "Driving route with hours per leg", by: "Agento routes", cost: 0.03, kind: "pays", where: "now" },
      { label: "Places to sleep where each day ends", by: "OpenStreetMap", kind: "free", where: "now" },
    ],
  },
  {
    id: "ev-trip",
    agent: "worko",
    moment: "travel",
    worry: "Will I find chargers on my EV road trip?",
    title: "A drive with charging at each stop",
    gets: "The route split into days, and EV chargers near where each day ends.",
    say: "Plan an EV drive from Seattle to Portland and find chargers near each stop.",
    words: ["ev", "electric", "charger", "chargers", "charging", "tesla", "supercharger"],
    steps: [
      { label: "Driving route with hours per leg", by: "Agento routes", cost: 0.03, kind: "pays", where: "now" },
      { label: "Chargers near each stop", by: "OpenStreetMap", kind: "free", where: "now" },
    ],
  },
  {
    id: "stay-nearby",
    agent: "worko",
    moment: "travel",
    worry: "I need somewhere to sleep near where I'm stopping.",
    title: "Places to stay near a stop",
    gets: "A shortlist of places to stay, closest first. You book the one you like yourself.",
    say: "Find places to stay near Bend, Oregon.",
    words: ["hotel", "motel", "stay", "sleep", "tonight", "lodging", "place to stay"],
    steps: [{ label: "Places to stay near the stop", by: "OpenStreetMap", kind: "free", where: "now" }],
  },
  // ---------- Trado ----------
  {
    id: "coin-check",
    agent: "trado",
    moment: "money",
    worry: "Should I buy now or wait?",
    title: "Check a coin before you buy it",
    gets: "The trend, the price confirmed by Chainlink, and a limit order at your price.",
    say: "I want to buy $20 of ETH. Check the trend and confirm the price with Chainlink first.",
    words: ["buy", "should i buy", "dip", "entry", "limit", "eth", "sol", "btc"],
    steps: [
      { label: "Price trend", by: "Agento feed", cost: 0.02, kind: "pays", where: "now" },
      { label: "Confirm the price with Chainlink", by: "Quicknode (Chainlink)", cost: 0.0001, kind: "pays", where: "now" },
      { label: "Buy at your limit", by: "Gemini", kind: "free", where: "now" },
    ],
  },
  {
    id: "gas-check",
    agent: "trado",
    moment: "money",
    worry: "Is now a cheap time to send?",
    title: "Gas price before you send",
    gets: "The live gas price on the chain you pick, and what a transfer costs right now.",
    say: "What's the gas price on Base right now?",
    words: ["gas", "fee", "fees", "gwei", "send", "transfer", "base", "arbitrum", "optimism", "polygon"],
    steps: [{ label: "Live gas price", by: "Quicknode", cost: 0.0001, kind: "pays", where: "now" }],
  },
  {
    id: "wallet-check",
    agent: "trado",
    moment: "money",
    worry: "How much USDC is in this wallet?",
    title: "A wallet's USDC balance",
    gets: "The wallet's USDC balance on the chain you pick, read live.",
    say: "What's the USDC balance of 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC on Ethereum?",
    words: ["wallet", "balance", "usdc", "address", "holds", "0x"],
    steps: [{ label: "USDC balance", by: "Quicknode", cost: 0.0001, kind: "pays", where: "now" }],
  },
  {
    id: "whats-coming",
    agent: "trado",
    moment: "money",
    worry: "Is something big coming for what I hold?",
    title: "What's ahead for your coins",
    gets: "Upcoming decisions the market is pricing, and a protect-it move ready.",
    say: "I hold BTC. What's coming up that could move it, and how worried should I be?",
    words: ["coming up", "event", "fed", "decision", "news", "what's ahead", "worried", "hold"],
    steps: [
      { label: "Price trend", by: "Agento feed", cost: 0.02, kind: "pays", where: "now" },
      { label: "What the odds say about the next big decision", by: "Gemini markets", kind: "free", where: "now" },
      { label: "Protect it if you want", by: "Inso", kind: "agent", where: "now" },
    ],
    next: ["crash-cover"],
  },
  {
    id: "ticket-cover",
    agent: "inso",
    moment: "events",
    worry: "I paid for tickets. What if the game doesn't happen?",
    title: "Get your ticket money back if the match falls through",
    gets: "Cover that pays out if your team doesn't play or loses.",
    say: "I bought a ticket to a game. Cover my ticket money if the match doesn't happen or my team doesn't play.",
    words: ["ticket", "game", "match", "concert", "cancelled", "playoffs", "team", "festival"],
    steps: [
      { label: "Find the market on that game", by: "Gemini markets", kind: "free", where: "now" },
      { label: "How the odds have moved", by: "Agento feed", cost: 0.02, kind: "pays", where: "now" },
      { label: "Place the cover at your price", by: "Gemini", kind: "free", where: "now" },
    ],
  },
  {
    id: "event-weather",
    agent: "inso",
    moment: "events",
    worry: "A heatwave or a cold snap would ruin my outdoor plan.",
    title: "Cover a wedding, BBQ or trip against the temperature",
    gets: "A payout if it's hotter or colder than a line you pick on the day, sized to what you'd lose.",
    say: "I'm planning something outdoors this weekend. Cover me if it's too cold.",
    words: ["weather", "outdoor", "wedding", "bbq", "picnic", "patio", "cold", "heat", "heatwave", "freezing", "temperature"],
    steps: [
      { label: "Temperature markets for the day and city", by: "Gemini markets", kind: "free", where: "now" },
      { label: "How the odds moved", by: "Agento feed", cost: 0.02, kind: "pays", where: "now" },
      { label: "Place the cover at your price", by: "Gemini", kind: "free", where: "now" },
    ],
  },
  {
    id: "rate-hike",
    agent: "inso",
    moment: "protect",
    worry: "My mortgage or loan payment could go up.",
    title: "Cover a rate hike",
    gets: "A payout if the central bank raises rates at its next meeting.",
    say: "My variable-rate mortgage goes up if the Fed raises rates. Cover me for the next meeting.",
    words: ["mortgage", "loan", "rate", "rates", "fed", "interest", "hike", "variable"],
    steps: [
      { label: "What the market expects from the next meeting", by: "Gemini markets", kind: "free", where: "now" },
      { label: "Size the cover to your extra payment", by: "Inso", kind: "free", where: "now" },
      { label: "Place the cover", by: "Gemini", kind: "free", where: "now" },
    ],
  },
  {
    id: "crash-cover",
    agent: "inso",
    moment: "protect",
    worry: "A crash would wipe out my savings.",
    title: "Protect your crypto from a big drop",
    gets: "A payout if BTC or ETH falls below a line you pick.",
    say: "Protect my crypto savings: cover me if BTC crashes this month.",
    words: ["crash", "drop", "fall", "savings", "protect", "btc", "eth", "bitcoin", "portfolio"],
    steps: [
      { label: "Contracts below today's price", by: "Gemini markets", kind: "free", where: "now" },
      { label: "Confirm the price with Chainlink", by: "Quicknode (Chainlink)", cost: 0.0001, kind: "pays", where: "now" },
      { label: "Place the cover", by: "Gemini", kind: "free", where: "now" },
    ],
  },
  {
    id: "ride-weather",
    agent: "inso",
    moment: "travel",
    worry: "Rides cost double when the weather turns.",
    title: "Cover your ride fares in bad weather",
    gets: "A payout on the days it's cold enough to surge.",
    say: "Cover my ride fares if it's freezing in New York tomorrow.",
    words: ["uber", "ride", "fare", "surge", "commute", "taxi", "weather", "cold snap"],
    steps: [
      { label: "Temperature markets for your city", by: "Gemini markets", kind: "free", where: "now" },
      { label: "Size it to the extra fares", by: "Inso", kind: "free", where: "now" },
      { label: "Place the cover", by: "Gemini", kind: "free", where: "now" },
    ],
  },
  {
    id: "business-costs",
    agent: "inso",
    moment: "work",
    worry: "My business costs keep jumping.",
    title: "Hedge a running cost: fuel, power, supplies",
    gets: "A payout when the cost you're exposed to spikes.",
    say: "I run a small business and fuel costs keep jumping. Help me hedge them.",
    words: ["business", "fuel", "gas", "oil", "diesel", "costs", "supplies", "power", "shop"],
    steps: [
      { label: "Markets that track that cost", by: "Gemini markets", kind: "free", where: "now" },
      { label: "Size it to your monthly exposure", by: "Inso", kind: "free", where: "now" },
      { label: "Place the cover", by: "Gemini", kind: "free", where: "now" },
    ],
  },
];

export const recipeById = (id: string) => RECIPES.find((r) => r.id === id);

/** The most a recipe's paid steps cost per run, in USDC. */
export const recipeCost = (r: Recipe) => r.steps.reduce((a, s) => a + (s.cost ?? 0), 0);

export const KIND_TEXT: Record<StepKind, string> = { pays: "Agento pays", free: "Free", agent: "Another agent" };

const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9$' -]/g, " ");

/**
 * The recipes closest to what someone asked, best first, with the words that matched. Plain
 * scoring by code, no model: a phrase that appears scores by its length, so "rug pull" beats "coin".
 */
export function matchRecipes(text: string, opts: { agent?: AgentId; limit?: number } = {}): { recipe: Recipe; score: number; because: string[] }[] {
  const t = ` ${words(text)} `;
  if (t.trim().length < 3) return [];
  const out = RECIPES.filter((r) => !opts.agent || r.agent === opts.agent)
    .map((recipe) => {
      const because = recipe.words.filter((w) => t.includes(` ${w} `) || t.includes(` ${w}s `) || (w.includes(" ") && t.includes(w)));
      const score = because.reduce((a, w) => a + 1 + w.length / 6, 0);
      return { recipe, score, because };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
  return out.slice(0, opts.limit ?? 2);
}
