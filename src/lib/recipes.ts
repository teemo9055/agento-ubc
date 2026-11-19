import type { AgentId } from "./types";

/**
 * The recipe book: combinations that solve a practical problem, written the way people feel the
 * problem ("Is this deal real?"), not the way the tools are named. A recipe is a tested starting
 * point: picking one opens a job where the agent shapes it with you (adds, drops or swaps steps),
 * and it then goes through the same review, graph and receipt as any other job.
 *
 * Each step says who does it and whether it can run here today, so nothing is promised that can't:
 * - kind: pays (Agento pays per request from the job's vault) · free (a free lookup) ·
 *   yours (you finish it in your own app, from a ready link) · account (needs an account you link;
 *   none can be linked yet) · agent (handed to another agent in the same project).
 * - where: now (works on Arc testnet today) · mainnet (the seller takes payment on Arc mainnet
 *   only) · later (listed on Circle's marketplace, but not payable on Arc yet).
 */
export type StepKind = "pays" | "free" | "yours" | "account" | "agent";
export type StepWhere = "now" | "mainnet" | "later";

export interface RecipeStep {
  label: string;
  /** Who provides it: a seller, a site, or one of the agents. */
  by: string;
  /** USDC per request, when it costs anything. */
  cost?: number;
  kind: StepKind;
  where: StepWhere;
}

export type Moment = "buying" | "moving" | "travel" | "money" | "protect" | "events" | "work";

export const MOMENTS: Record<Moment, { label: string; blurb: string }> = {
  buying: { label: "Buying something", blurb: "Before you hand money to a stranger." },
  moving: { label: "Moving", blurb: "Finding a place without getting burned." },
  travel: { label: "Travelling", blurb: "Getting there, and when plans go sideways." },
  money: { label: "Money & crypto", blurb: "What your money is doing, and what could hit it." },
  protect: { label: "Protecting a plan", blurb: "Pay a little now, get paid if the bad thing happens." },
  events: { label: "Nights out & events", blurb: "Plans that depend on the weather or a game." },
  work: { label: "Work & study", blurb: "Leads, research and the boring admin." },
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

const ORTH = "Orthogonal (Google data)";

export const RECIPES: Recipe[] = [
  // ---------- Worko ----------
  {
    id: "scam-shield",
    agent: "worko",
    moment: "buying",
    worry: "Is this deal real?",
    title: "Check a listing, seller or wallet before you pay",
    gets: "A plain verdict with the evidence behind it.",
    say: "Is this deal real? I want to check a listing and its seller before I pay.",
    words: ["scam", "real", "legit", "fake", "listing", "marketplace", "craigslist", "seller", "kijiji", "deal", "before i pay", "phone number"],
    steps: [
      { label: "Is the photo stolen from elsewhere?", by: ORTH, cost: 0.006, kind: "pays", where: "mainnet" },
      { label: "Seller's phone: internet-only, new SIM, forwarded?", by: "BlockRun (Twilio)", cost: 0.05, kind: "pays", where: "mainnet" },
      { label: "Reviews and mentions of the seller", by: ORTH, cost: 0.004, kind: "pays", where: "mainnet" },
      { label: "Verdict, with what each check found", by: "Worko", kind: "free", where: "now" },
    ],
    next: ["big-purchase", "money-back"],
  },
  {
    id: "big-purchase",
    agent: "worko",
    moment: "buying",
    worry: "Am I paying too much for this used car, bike or laptop?",
    title: "Price check a second-hand buy",
    gets: "What it sells for new and used, and whether the listing looks right.",
    say: "I'm buying something second-hand. Is the price fair and does the listing look right?",
    words: ["used", "second-hand", "secondhand", "car", "bike", "laptop", "phone", "fair price", "too much", "overpriced"],
    steps: [
      { label: "What the photo actually shows", by: ORTH, cost: 0.006, kind: "pays", where: "mainnet" },
      { label: "Prices for the same thing in stores", by: ORTH, cost: 0.004, kind: "pays", where: "mainnet" },
      { label: "Seller's phone check", by: "BlockRun (Twilio)", cost: 0.05, kind: "pays", where: "mainnet" },
      { label: "Fair price range and red flags", by: "Worko", kind: "free", where: "now" },
    ],
    next: ["scam-shield"],
  },
  {
    id: "apartment-hunt",
    agent: "worko",
    moment: "moving",
    worry: "I need a place near campus and don't want to overpay.",
    title: "Find a place, flag the overpriced ones, book viewings",
    gets: "A shortlist with fair rent next to each, and viewings lined up.",
    say: "Find me a 1-bedroom under $1,800 near campus, tell me which are overpriced, and help me book viewings.",
    words: ["apartment", "rent", "rental", "room", "lease", "landlord", "campus", "moving", "place to live", "sublet"],
    steps: [
      { label: "Rental listings in the area", by: "Sponge (rental data)", cost: 0.01, kind: "pays", where: "later" },
      { label: "Fair rent for each unit", by: "Sponge (rent estimates)", cost: 0.01, kind: "pays", where: "later" },
      { label: "Reviews of each building", by: ORTH, cost: 0.002, kind: "pays", where: "mainnet" },
      { label: "Call the top 3 landlords to book viewings", by: "StablePhone (AI calls)", cost: 0.54, kind: "pays", where: "later" },
    ],
    next: ["scam-shield"],
  },
  {
    id: "contractor-check",
    agent: "worko",
    moment: "work",
    worry: "Can I trust this contractor with my home?",
    title: "Check a contractor before you hire",
    gets: "Reviews, news and any safety record, in one page.",
    say: "Check this contractor before I hire them: reviews, news and anything worrying.",
    words: ["contractor", "plumber", "electrician", "roofer", "renovation", "hire", "handyman", "builder", "trust"],
    steps: [
      { label: "Reviews of the business", by: ORTH, cost: 0.002, kind: "pays", where: "mainnet" },
      { label: "News and web mentions", by: ORTH, cost: 0.004, kind: "pays", where: "mainnet" },
      { label: "Workplace-safety record (OSHA)", by: "x402 Gateway (public records)", cost: 0.001, kind: "pays", where: "later" },
      { label: "What to ask them before you sign", by: "Worko", kind: "free", where: "now" },
    ],
  },
  {
    id: "airport-ride",
    agent: "worko",
    moment: "travel",
    worry: "Get me from the airport to my hotel when I land.",
    title: "Airport to hotel, ready when you land",
    gets: "The drive time, and a ride ready to book in your own app.",
    say: "I land at SEA airport tonight. Get me a ride to my hotel downtown.",
    words: ["airport", "land", "landing", "arrive", "ride", "uber", "lyft", "taxi", "pickup", "hotel"],
    steps: [
      { label: "Delays at the arrival airport", by: "StableTravel (FlightAware)", cost: 0.02, kind: "pays", where: "later" },
      { label: "Drive time to the hotel", by: "Agento routes", cost: 0.03, kind: "pays", where: "now" },
      { label: "Book the ride", by: "Uber", kind: "yours", where: "now" },
    ],
    next: ["dinner-plan", "ride-weather"],
  },
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
      { label: "Book the stays", by: "Booking.com", kind: "yours", where: "now" },
      { label: "Cover a rained-out day", by: "Inso", kind: "agent", where: "now" },
    ],
    next: ["event-weather"],
  },
  {
    id: "dinner-plan",
    agent: "worko",
    moment: "events",
    worry: "Sort out dinner tonight near where I'm staying.",
    title: "A dinner plan, table ready to book",
    gets: "A few places nearby with reviews, and a table link ready.",
    say: "Find a good place for dinner tonight near my hotel and get a table ready to book.",
    words: ["dinner", "restaurant", "table", "reservation", "date night", "eat", "lunch", "brunch", "birthday"],
    steps: [
      { label: "Restaurants nearby", by: "OpenStreetMap", kind: "free", where: "now" },
      { label: "What people say about them", by: ORTH, cost: 0.002, kind: "pays", where: "mainnet" },
      { label: "Book the table", by: "OpenTable", kind: "yours", where: "now" },
      { label: "Patio plan? Cover the rain", by: "Inso", kind: "agent", where: "now" },
    ],
    next: ["event-weather"],
  },
  {
    id: "money-back",
    agent: "worko",
    moment: "buying",
    worry: "Did the price drop after I bought it?",
    title: "Get money back on something you already bought",
    gets: "Whether it's cheaper now, and the price-match claim written for you.",
    say: "I bought a TV last week. Check if it's cheaper now so I can ask for a price match.",
    words: ["price drop", "price match", "refund", "cheaper", "receipt", "bought", "price adjustment"],
    steps: [
      { label: "Today's price across stores", by: ORTH, cost: 0.004, kind: "pays", where: "mainnet" },
      { label: "Price history", by: "Syntalic", cost: 0.01, kind: "pays", where: "later" },
      { label: "Send the price-match claim", by: "Your email", kind: "yours", where: "now" },
    ],
  },
  {
    id: "job-hunt",
    agent: "worko",
    moment: "work",
    worry: "I'm applying for jobs and want to walk in prepared.",
    title: "A one-page brief on each company you apply to",
    gets: "Openings, recent news and what to ask, per company.",
    say: "I'm applying to software jobs in Vancouver. Find openings and give me a brief on each company.",
    words: ["job", "jobs", "apply", "applying", "interview", "internship", "co-op", "hiring", "career", "company research"],
    steps: [
      { label: "Openings that match", by: ORTH, cost: 0.002, kind: "pays", where: "mainnet" },
      { label: "Recent news on each company", by: ORTH, cost: 0.002, kind: "pays", where: "mainnet" },
      { label: "Filings and funding (public companies)", by: "x402 Gateway (SEC)", cost: 0.001, kind: "pays", where: "later" },
    ],
  },

  // ---------- Trado ----------
  {
    id: "rug-check",
    agent: "trado",
    moment: "money",
    worry: "I saw a coin online. Is it a rug pull?",
    title: "Check a coin before you buy it",
    gets: "Who holds it, whether you could sell it, and its real price trend.",
    say: "I saw a coin hyped online. Check whether it's safe before I buy any.",
    words: ["rug", "rug pull", "memecoin", "meme coin", "token", "hyped", "shill", "safe coin", "new coin", "presale"],
    steps: [
      { label: "Can it be sold? Taxes, owner controls", by: "KushBitx", cost: 0.001, kind: "pays", where: "later" },
      { label: "How concentrated the holders are", by: "EMC2 AI (Bitquery)", cost: 0.35, kind: "pays", where: "later" },
      { label: "Price trend", by: "Agento feed", cost: 0.02, kind: "pays", where: "now" },
      { label: "Verdict: buy at your limit, wait, or stay away", by: "Trado", kind: "free", where: "now" },
    ],
  },
  {
    id: "fx-tuition",
    agent: "trado",
    moment: "money",
    worry: "I'm paying tuition or rent in another currency.",
    title: "Watch an exchange rate for a big payment",
    gets: "Today's rate from Chainlink, and when it's a good day to convert.",
    say: "I'm paying tuition in euros soon. Watch the euro rate and tell me when it's a good day to convert.",
    words: ["tuition", "exchange rate", "currency", "convert", "euro", "pound", "yen", "fx", "abroad", "international"],
    steps: [
      { label: "Today's rate (euro, pound, yen)", by: "Quicknode (Chainlink)", cost: 0.0001, kind: "pays", where: "now" },
      { label: "Rate history and other currencies", by: "Blocksize", cost: 0.005, kind: "pays", where: "later" },
      { label: "Convert on the day", by: "Your bank", kind: "yours", where: "now" },
    ],
  },
  {
    id: "idle-cash",
    agent: "trado",
    moment: "money",
    worry: "My money is just sitting there.",
    title: "Find what your idle money could earn",
    gets: "What you hold, and a few options with their risks spelled out.",
    say: "I have USDC sitting in a wallet doing nothing. What could it earn, and what's the risk?",
    words: ["idle", "sitting", "earn", "yield", "interest", "savings", "apy", "doing nothing", "stablecoin"],
    steps: [
      { label: "What the wallet holds", by: "Quicknode", cost: 0.0001, kind: "pays", where: "now" },
      { label: "Idle funds and where they could go", by: "vaults.fyi", cost: 0.2, kind: "pays", where: "later" },
      { label: "Is the stablecoin healthy?", by: "Quicknode (Chainlink)", cost: 0.0001, kind: "pays", where: "now" },
    ],
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
    id: "report-card",
    agent: "trado",
    moment: "money",
    worry: "Did my trading actually make money?",
    title: "An honest report card on your trading",
    gets: "What you made after fees, and whether bots skimmed your trades.",
    say: "Did my trading actually make money after fees? Give me an honest report card.",
    words: ["profit", "pnl", "made money", "lost money", "report card", "fees", "how am i doing", "performance"],
    steps: [
      { label: "Your positions and fills", by: "Gemini", kind: "free", where: "now" },
      { label: "Profit after fees, across chains", by: "LoneStarOracle", cost: 0.2, kind: "pays", where: "later" },
      { label: "Were your trades front-run by bots?", by: "EMC2 AI (Bitquery)", cost: 0.45, kind: "pays", where: "later" },
    ],
  },

  // ---------- Inso ----------
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
    worry: "Rain would ruin my outdoor plan.",
    title: "Cover a wedding, BBQ or trip against the weather",
    gets: "A payout if it rains or freezes on the day, sized to what you'd lose.",
    say: "I'm planning something outdoors this weekend. Cover me if the weather ruins it.",
    words: ["rain", "weather", "outdoor", "wedding", "bbq", "picnic", "patio", "snow", "storm", "cold", "heat"],
    steps: [
      { label: "Weather markets for the day and city", by: "Gemini markets", kind: "free", where: "now" },
      { label: "How the odds moved", by: "Agento feed", cost: 0.02, kind: "pays", where: "now" },
      { label: "Place the cover at your price", by: "Gemini", kind: "free", where: "now" },
    ],
  },
  {
    id: "trip-cover",
    agent: "inso",
    moment: "travel",
    worry: "What if something ruins the trip I've paid for?",
    title: "Insure your flight and hotel against the unexpected",
    gets: "A payout if a storm, a cold snap or an event you name hits your dates.",
    say: "Insure my flight and hotel bookings in case something unexpected happens on the trip.",
    words: ["flight", "hotel", "trip", "vacation", "holiday", "booking", "travel insurance", "cancel"],
    steps: [
      { label: "Markets on what could ruin it", by: "Gemini markets", kind: "free", where: "now" },
      { label: "How the odds moved", by: "Agento feed", cost: 0.02, kind: "pays", where: "now" },
      { label: "Place the cover, sized to the bookings", by: "Gemini", kind: "free", where: "now" },
    ],
    next: ["airport-ride"],
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
    gets: "A payout on the days it's cold or stormy enough to surge.",
    say: "Cover my ride fares if the weather turns bad tomorrow in my city.",
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

/** Whether every step can run here today, some only on Arc mainnet, or some not yet. */
export function recipeReady(r: Recipe): StepWhere {
  if (r.steps.some((s) => s.where === "later")) return "later";
  if (r.steps.some((s) => s.where === "mainnet")) return "mainnet";
  return "now";
}

export const WHERE_TEXT: Record<StepWhere, string> = { now: "Works today", mainnet: "On Arc mainnet", later: "Not payable here yet" };
export const KIND_TEXT: Record<StepKind, string> = { pays: "Agento pays", free: "Free", yours: "You finish it", account: "Your account", agent: "Another agent" };

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
