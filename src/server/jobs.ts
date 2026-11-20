import type { Plan, Proposal, Venue } from "@/lib/types";
import { jobById, JOBS, type JobCardInfo, type JobPreview } from "@/lib/jobs";
import * as gemini from "./gemini";
import { PROD_BASE, SANDBOX_BASE, type MarketContract, type MarketEvent } from "./gemini";
import { WEB_PRICES } from "./web-tools";
import { PRODUCTS } from "./x402";
import type { ProposalInput } from "./tools";

/**
 * Builds each catalog job from live data, without the model, so a card always opens a real,
 * checked move: the market and line are picked by code from Gemini's open markets, and the
 * example inputs of a check are real enough to run. The person changes any of it in the chat.
 */

const usd = (units: bigint) => Number(units) / 1e6;
const HOUR = 3_600_000;

// ---------- picking markets ----------

/** The YES price to buy at now: the ask, or the last trade when nobody is selling. */
const yesPrice = (c: MarketContract) => c.ask ?? c.last ?? null;
const closesIn = (e: MarketEvent) => (e.expiry ? Date.parse(e.expiry) - Date.now() : Infinity);

/** Open events whose ticker starts with `prefix`, soonest first, still open for at least `minHours`. */
async function eventsOf(prefix: string, base: string, minHours = 1): Promise<MarketEvent[]> {
  const all = await gemini.activeEvents(base);
  return all.filter((e) => e.ticker.startsWith(prefix) && closesIn(e) > minHours * HOUR).sort((a, b) => closesIn(a) - closesIn(b));
}

/** A line worth buying as cover: unlikely but possible (between `lo` and `hi`), closest to `aim`. Cheap cover reads as insurance. */
function coverLine(cs: MarketContract[], ok: (c: MarketContract) => boolean, aim = 0.15, lo = 0.05, hi = 0.35): MarketContract | undefined {
  const priced = cs.filter((c) => ok(c) && c.open !== false && (yesPrice(c) ?? 0) >= lo && (yesPrice(c) ?? 1) <= hi);
  return priced.sort((a, b) => Math.abs(yesPrice(a)! - aim) - Math.abs(yesPrice(b)! - aim))[0];
}

type Cover = { event: MarketEvent; contract: MarketContract; price: number; venue: Venue; note?: string };

/** Weather: the next open day for one of `cities`, with a cold ("or below") or hot ("or above") line. */
async function weatherCover(cities: string[], kind: "cold" | "hot", skip: Set<string> = new Set()): Promise<Cover | { error: string }> {
  for (const city of cities) {
    for (const event of await eventsOf(`WXHIGH-${city}-`, PROD_BASE, 2)) {
      // The cold end is the "… or below" line, the hot end the "… or above" one: unlikely, so cheap.
      const end = event.contracts.find((x) => !skip.has(x.symbol) && (kind === "cold" ? /or below|or less/i.test(x.label) : /or above|or more/i.test(x.label)));
      const c = end && (yesPrice(end) ?? 0) >= 0.02 && (yesPrice(end) ?? 1) <= 0.4 ? end : undefined;
      if (c) return { event, contract: c, price: yesPrice(c)!, venue: "gemini" };
    }
  }
  return { error: "No temperature market with a sensible cold or hot line is open right now. Try again later today." };
}

/** Sports: the soonest open game in a league; the cover is YES on the visiting team (your home team losing). */
async function sportsCover(prefix: string, skip: Set<string> = new Set()): Promise<Cover | { error: string }> {
  for (const event of await eventsOf(prefix, PROD_BASE, 2)) {
    if (!/-M$/.test(event.ticker) || event.contracts.length !== 2) continue;
    // Tickers read LEAGUE-WHEN-AWAY-HOME-M: the second team plays at home.
    const away = event.ticker.split("-").slice(-3, -2)[0];
    const c = event.contracts.find((x) => x.symbol.endsWith(`-${away}`)) ?? event.contracts[0];
    if (skip.has(c.symbol)) continue;
    const p = yesPrice(c);
    if (p != null && p >= 0.08 && p <= 0.45) return { event, contract: c, price: p, venue: "gemini" };
  }
  return { error: "No game with open odds right now. Try again closer to game day." };
}

/** Commodities: the month-end line a jump would cross. On the test exchange, the nearest test line, priced from the live market. */
async function commodityCover(prefixes: string[], venue: Venue, skip: Set<string> = new Set()): Promise<Cover | { error: string }> {
  for (const prefix of prefixes) {
    const live = (await eventsOf(prefix, PROD_BASE, 24)).reverse();
    for (const listed of live) {
      // Read the market fresh: lines open and close through the day, and the list above can be a minute old.
      const event = await gemini.getEvent(listed.ticker, PROD_BASE).catch(() => listed);
      // Only lines whose book is open; cheap ones first, then a little dearer if that's all there is.
      const above = (x: MarketContract) => /above/i.test(x.label) && x.open === true && !skip.has(x.symbol);
      const c = coverLine(event.contracts, above) ?? coverLine(event.contracts, above, 0.25, 0.03, 0.42);
      if (!c) continue;
      if (venue !== "gemini-sandbox") return { event, contract: c, price: yesPrice(c)!, venue };
      // The test exchange lists its own lines: take the one nearest the live pick, at the live market's odds for it.
      const test = await gemini.getEvent(event.ticker, SANDBOX_BASE).catch(() => null);
      const nearest = test?.contracts.filter((x) => x.strike != null && /above/i.test(x.label) && !skip.has(x.symbol)).sort((a, b) => Math.abs(a.strike! - (c.strike ?? 0)) - Math.abs(b.strike! - (c.strike ?? 0)))[0];
      if (!test || !nearest) return { event, contract: c, price: yesPrice(c)!, venue: "paper", note: "This market isn't on Gemini's test exchange, so this one is practice." };
      const ref = event.contracts.filter((x) => x.strike != null && yesPrice(x) != null).sort((a, b) => Math.abs(a.strike! - nearest.strike!) - Math.abs(b.strike! - nearest.strike!))[0];
      const p = Math.min(0.9, Math.max(0.03, ref ? yesPrice(ref)! : yesPrice(c)!));
      return { event: test, contract: nearest, price: p, venue: "gemini-sandbox", note: "Priced from Gemini's live market; the order goes to Gemini's test exchange, where it waits for a seller." };
    }
  }
  return { error: "No month-end price line is open for that right now." };
}

// ---------- cards ----------

type Built = { input: ProposalInput; intro: string; venue: Venue } | { plan: (id: string) => Promise<Plan | { error: string }>; intro: string; venue: Venue };

interface CardDef {
  /** How it reads as a request in the job's chat. */
  ask: (c?: Cover) => string;
  /** The live market a cover is built on. */
  cover?: (venue: Venue, skip?: Set<string>) => Promise<Cover | { error: string }>;
  /** What a cover protects and roughly what's at stake, in dollars. */
  loss?: { protects: string; usd: number };
  build: (venue: Venue, skip?: Set<string>) => Promise<Built | { error: string }>;
  /** For checks: their total listed price and how many paid steps. */
  cost?: () => { usd: number; steps: number };
}

const day = (e: MarketEvent) => (e.expiry ? new Date(Date.parse(e.expiry) - 5 * HOUR).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : "soon");
const cents = (p: number) => `${Math.round(p * 100)}¢`;

/** A cover move on a picked line: the order is sized by code to what's at stake. */
function coverInput(c: Cover, loss: { protects: string; usd: number }, title: string): ProposalInput {
  const traded = c.contract.last != null;
  return {
    title,
    why: `${c.event.title.replace(/\?$/, "")} · ${c.contract.label} is at ${cents(c.price)} now, so a payout costs about that per dollar.`,
    ask: `Cover ${loss.protects} if “${c.contract.label}” happens?`,
    research: traded && c.venue !== "gemini-sandbox" ? [{ tool: "odds_history", args: { symbol: c.contract.symbol }, label: "How the odds moved", why: "Whether the price is calm or jumping before you buy" }] : [],
    action: {
      kind: "prediction_order",
      eventTicker: c.event.ticker,
      symbol: c.contract.symbol,
      label: c.contract.label,
      side: "yes",
      trade: "buy",
      orderType: "limit",
      maxPrice: Math.min(0.95, Math.round((c.price + 0.02) * 100) / 100),
      stopPrice: null,
      quantity: 1,
      combo: null,
    },
    condition: null,
    alsoRequire: null,
    budgetUsd: null,
    hedge: { protects: loss.protects, lossUsd: loss.usd },
  } as ProposalInput;
}

const check = (title: string, why: string, ask: string, research: ProposalInput["research"]): ProposalInput => ({ title, why, ask, research, action: null, condition: null, alsoRequire: null, budgetUsd: null, hedge: null }) as ProposalInput;

const driveInput = (stops: string[], hoursPerDay: number, lookFor: "hotel" | "charging"): ProposalInput =>
  ({
    title: `Drive ${stops[0].split(",")[0]} → ${stops[stops.length - 1].split(",")[0]}`,
    why: `${stops.length} stops. I'll price the route, split it into days of at most ${hoursPerDay} hours, and list ${lookFor === "charging" ? "EV chargers" : "places to sleep"} where each day ends.`,
    ask: `Plan the drive ${stops.map((s) => s.split(",")[0]).join(" → ")} at up to ${hoursPerDay} hours a day?`,
    research: [{ tool: "drive_route", args: { stops: stops.join("|") }, label: "Driving route", why: "Distance and hours for each leg" }],
    action: { kind: "itinerary", stops, hoursPerDay, lookFor },
    condition: null,
    alsoRequire: null,
    budgetUsd: null,
    hedge: null,
  }) as ProposalInput;

const coverCard = (title: string, loss: { protects: string; usd: number }, pick: (venue: Venue, skip?: Set<string>) => Promise<Cover | { error: string }>, ask: (c: Cover) => string): CardDef => ({
  cover: pick,
  loss,
  ask: (c) => (c ? ask(c) : title),
  build: async (venue, skip) => {
    const c = await pick(venue, skip);
    if ("error" in c) return c;
    return { input: coverInput(c, loss, title), intro: `${c.event.title.replace(/\?$/, "")}: “${c.contract.label}” is at ${cents(c.price)}. Buying YES pays $1 a contract if it happens, so I sized it to cover about $${loss.usd} of ${loss.protects}.${c.note ? ` ${c.note}` : ""}`, venue: c.venue };
  },
});

const ROUTE = PRODUCTS["routes.drive"]?.price ?? 30_000n;

const CARDS: Record<string, CardDef> = {
  // Worko: researching (real USDC on Arc mainnet)
  "company-brief": {
    ask: () => "What's going on with Circle lately? Give me the top results and the latest news.",
    cost: () => ({ usd: usd(WEB_PRICES.search + WEB_PRICES.news), steps: 2 }),
    build: async () => ({
      input: check("Brief: Circle", "Top search results and the latest news, so you can see what the company is doing now.", "Search the web and the news about Circle for $0.004?", [
        { tool: "web_search", args: { query: "Circle Internet Group" }, label: "Top search results", why: "What the company is and does" },
        { tool: "news_search", args: { query: "Circle Internet Group" }, label: "Latest news", why: "What changed recently" },
      ]),
      intro: "I'll read the top search results and the latest news about Circle, then sum them up. Change the company in the chat.",
      venue: "paper",
    }),
  },
  "fair-price": {
    ask: () => "Someone's selling an iPhone 15 128GB for $500. Is that a fair price?",
    cost: () => ({ usd: usd(WEB_PRICES.shopping), steps: 1 }),
    build: async () => ({
      input: check("Fair price: iPhone 15 128GB", "What stores charge right now, to compare with the $500 you were offered.", "Check store prices for an iPhone 15 128GB for $0.004?", [{ tool: "shopping_prices", args: { product: "iPhone 15 128GB unlocked" }, label: "Store prices now", why: "Lowest, typical and highest price" }]),
      intro: "I'll pull what stores charge for an iPhone 15 128GB right now, so you can compare it with $500. Change the product in the chat.",
      venue: "paper",
    }),
  },
  "place-reviews": {
    ask: () => "Is Blue Bottle Coffee in Oakland any good?",
    cost: () => ({ usd: usd(WEB_PRICES.places + WEB_PRICES.reviews), steps: 1 }),
    build: async () => ({
      input: check("Reviews: Blue Bottle Coffee", "Its recent Google reviews and ratings, read for you.", "Read the recent Google reviews of Blue Bottle Coffee in Oakland for $0.004?", [{ tool: "place_reviews", args: { place: "Blue Bottle Coffee Oakland" }, label: "Recent Google reviews", why: "What people say and how they rate it" }]),
      intro: "I'll find Blue Bottle Coffee in Oakland on Google and read its recent reviews. Change the place in the chat.",
      venue: "paper",
    }),
  },
  // Worko: planning (works on test money)
  "road-trip": {
    ask: () => "Plan a drive from Austin to Denver, no more than 6 hours a day, with places to sleep.",
    cost: () => ({ usd: usd(ROUTE), steps: 1 }),
    build: async () => ({ input: driveInput(["Austin, Texas", "Lubbock, Texas", "Denver, Colorado"], 6, "hotel"), intro: "Austin to Denver through Lubbock, at most 6 hours a day. If a day runs long I'll add a night in a town on the way.", venue: "paper" }),
  },
  "ev-trip": {
    ask: () => "Plan an EV drive from Seattle to San Francisco with chargers at each stop.",
    cost: () => ({ usd: usd(ROUTE), steps: 1 }),
    build: async () => ({ input: driveInput(["Seattle, Washington", "Medford, Oregon", "San Francisco, California"], 6, "charging"), intro: "Seattle to San Francisco, at most 6 hours a day, with EV chargers listed where each day ends.", venue: "paper" }),
  },
  "trip-gas": {
    ask: () => "I'm driving Austin to Denver next week. Plan it, and cover me if oil prices jump before month end.",
    cost: () => ({ usd: usd(ROUTE), steps: 2 }),
    build: async (venue) => ({
      intro: "Two parts that run side by side: Worko plans the drive, and Inso covers about $25 of extra gas if oil jumps by month end.",
      venue,
      plan: async (id) => {
        const { validateProposal } = await import("./tools");
        const drive = await validateProposal("worko", driveInput(["Austin, Texas", "Lubbock, Texas", "Denver, Colorado"], 6, "hotel"), `${id}-s1`);
        if ("error" in drive) return { error: drive.error };
        // A line can close between picking and checking: try the next one.
        const skip = new Set<string>();
        let gas: Awaited<ReturnType<typeof validateProposal>> = { error: "No oil line is open right now" };
        for (let i = 0; i < 3 && "error" in gas; i++) {
          const c = await commodityCover(["WTI", "BRENT"], venue, skip);
          if ("error" in c) return { error: c.error };
          gas = await validateProposal("inso", coverInput(c, { protects: "pricier gas on the trip", usd: 25 }, "Cover: gas price jump"), `${id}-s2`);
          skip.add(c.contract.symbol);
        }
        if ("error" in gas) return { error: gas.error };
        return {
          id,
          title: "Road trip, gas covered",
          why: "The drive and the cover run side by side.",
          unavailable: [],
          status: "proposed",
          steps: [
            { id: "s1", agent: "worko", proposal: drive.proposal, after: [], gate: "done", brief: "Plan Austin → Denver, at most 6 hours a day", status: "waiting" },
            { id: "s2", agent: "inso", proposal: gas.proposal, after: [], gate: "done", brief: "Cover about $25 of extra gas if oil jumps by month end", status: "waiting" },
          ],
        } satisfies Plan;
      },
    }),
  },
  // Worko: verifying (real USDC on Arc mainnet)
  "seller-check": {
    ask: () => "I'm about to pay a stranger $400 for a bike. Their number is +1 415 555 0134 and here's the listing photo.",
    cost: () => ({ usd: usd(WEB_PRICES.phone + WEB_PRICES.lens), steps: 2 }),
    build: async () => ({
      input: check("Check the seller", "A real seller's number is usually a mobile line, and their photo shouldn't appear on other sites.", "Check the seller's phone and photo for $0.016?", [
        { tool: "phone_check", args: { phone: "+1 415 555 0134" }, label: "Seller's phone line", why: "Internet-only numbers are common in scams" },
        { tool: "image_check", args: { imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Left_side_of_Flying_Pigeon.jpg/640px-Left_side_of_Flying_Pigeon.jpg" }, label: "Is the photo copied?", why: "A stolen photo shows up on other sites" },
      ]),
      intro: "I'll check whether the seller's number is a real mobile line, and whether the listing photo appears elsewhere online. Paste their number and the photo link in the chat to check yours.",
      venue: "paper",
    }),
  },
  "business-check": {
    ask: () => "Can I trust Bay Area Plumbing in San Francisco before I hire them?",
    cost: () => ({ usd: usd(WEB_PRICES.places + WEB_PRICES.reviews + WEB_PRICES.news), steps: 2 }),
    build: async () => ({
      input: check("Check: Bay Area Plumbing", "Recent reviews and any news, before you hire them.", "Read their reviews and any news for $0.006?", [
        { tool: "place_reviews", args: { place: "Bay Area Plumbing San Francisco" }, label: "Recent Google reviews", why: "How recent customers rate them" },
        { tool: "news_search", args: { query: "Bay Area Plumbing San Francisco" }, label: "Any news about them", why: "Complaints, lawsuits or closures" },
      ]),
      intro: "I'll read their recent Google reviews and look for any news about them. Change the business in the chat.",
      venue: "paper",
    }),
  },
  // Inso: weather (the order goes to Gemini's real exchange; practice without it)
  "wedding-cold": coverCard("Cover: a cold wedding day", { protects: "a cold wedding day", usd: 40 }, (_, k) => weatherCover(["CHI", "BOS", "DEN", "PHL"], "cold", k), (c) => `My outdoor wedding is ${day(c.event)}. ${c.event.title.replace(/\?$/, "")}: cover me if it's cold.`),
  "rides-cold": coverCard("Cover: rides on a freezing day", { protects: "pricey rides on a freezing day", usd: 20 }, (_, k) => weatherCover(["BOS", "PHL", "DCA", "CHI"], "cold", k), (c) => `Rides cost me about $20 more on a cold day. ${c.event.title.replace(/\?$/, "")}: cover me if it's cold.`),
  "heat-bill": coverCard("Cover: a heatwave power bill", { protects: "a heatwave power bill", usd: 30 }, (_, k) => weatherCover(["AUS", "DFW", "LA", "ATL"], "hot", k), (c) => `A hot day spikes my power bill. ${c.event.title.replace(/\?$/, "")}: cover me if it's hot.`),
  // Inso: sports
  "tickets-loss": coverCard("Cover: my team loses", { protects: "your team losing", usd: 30 }, (_, k) => sportsCover("NBA-", k), (c) => `I have tickets for ${c.event.title}. Cover me if the home team loses.`),
  "bar-night": coverCard("Cover: a slow night at the bar", { protects: "a slow night at the bar", usd: 30 }, (_, k) => sportsCover("NFL-", k), (c) => `My bar is slow when the home team loses. ${c.event.title}: cover me.`),
  // Inso: commodities (real orders on Gemini's test exchange)
  "heating-gas": coverCard("Cover: a natural gas spike", { protects: "a higher heating bill", usd: 20 }, (v, k) => commodityCover(["NGAS"], v, k), () => "My heating bill jumps if natural gas spikes. Cover me through month end."),
  "ring-gold": coverCard("Cover: a gold price jump", { protects: "a pricier gold ring", usd: 25 }, (v, k) => commodityCover(["XAU"], v, k), () => "I'm buying a gold ring at month end. Cover me if gold jumps."),
  "copper-quote": coverCard("Cover: a copper price jump", { protects: "a thinner margin on the job", usd: 25 }, (v, k) => commodityCover(["COPPER"], v, k), () => "I quoted a wiring job at a fixed price. Cover me if copper jumps by month end."),
  "fuel-costs": coverCard("Cover: an oil price jump", { protects: "higher fuel costs", usd: 30 }, (v, k) => commodityCover(["WTI", "BRENT"], v, k), () => "Fuel is my biggest cost. Cover me if oil jumps by month end."),
};

/** Where a card's order goes, given where the person wants orders to go and what the market allows. */
export function venueFor(card: JobCardInfo, want: Venue): Venue {
  // Weather and sports trade only on Gemini's real exchange: anywhere else they're practice.
  if (card.section === "weather" || card.section === "sports") return want === "gemini" ? "gemini" : "paper";
  return want;
}

/** The request text a card opens with. */
export const askOf = async (id: string, venue: Venue) => {
  const def = CARDS[id];
  if (!def?.cover) return def?.ask();
  const c = await def.cover(venue).catch(() => null);
  return def.ask(c && !("error" in c) ? c : undefined);
};

/** Builds a card's job: one checked move, or a plan of two. */
export async function buildJob(id: string, want: Venue, skip?: Set<string>): Promise<Built | { error: string }> {
  const card = jobById(id);
  const def = CARDS[id];
  if (!card || !def) return { error: "That job isn't in the catalog" };
  return def.build(venueFor(card, want), skip);
}

/** A card's single move, built and checked; a line that closed in between is skipped and the next one tried. */
export async function buildChecked(id: string, want: Venue, check: (input: ProposalInput) => Promise<{ proposal: Proposal } | { error: string }>): Promise<{ proposal: Proposal; intro: string; venue: Venue } | { plan: Extract<Built, { plan: unknown }> } | { error: string }> {
  const skip = new Set<string>();
  let last = "That job couldn't be built right now";
  for (let i = 0; i < 3; i++) {
    const b = await buildJob(id, want, skip);
    if ("error" in b) return { error: i ? last : b.error };
    if ("plan" in b) return { plan: b };
    const v = await check(b.input);
    if ("proposal" in v) return { proposal: v.proposal, intro: b.intro, venue: b.venue };
    last = v.error;
    const sym = b.input.action?.kind === "prediction_order" ? b.input.action.symbol : undefined;
    if (!sym || !/isn't open|not found|closes|too close/i.test(v.error)) return { error: v.error };
    skip.add(sym);
  }
  return { error: last };
}

/** What each card shows live, built in parallel and cached briefly. */
let cache: { at: number; want: Venue; list: JobPreview[] } | null = null;
export async function previews(want: Venue): Promise<JobPreview[]> {
  if (cache && cache.want === want && Date.now() - cache.at < 45_000) return cache.list;
  const list = await Promise.all(
    JOBS.map(async (card): Promise<JobPreview> => {
      const def = CARDS[card.id];
      const venue = venueFor(card, want);
      if (!def.cover) {
        const c = def.cost?.();
        return { id: card.id, cost: c?.usd, steps: c?.steps, venue };
      }
      const c = await Promise.race([def.cover(venue), new Promise<{ error: string }>((r) => setTimeout(() => r({ error: "Gemini didn't answer in time" }), 6000))]).catch((e: Error) => ({ error: e.message }));
      if ("error" in c) return { id: card.id, unavailable: c.error, venue };
      // Sized the way the order will be: enough contracts that the payout, less what they cost, covers what's at stake.
      const get = Math.max(1, Math.ceil(def.loss!.usd / Math.max(0.05, 1 - c.price)));
      return { id: card.id, market: c.event.title.replace(/\?$/, ""), line: c.contract.label, chance: c.price, get, pay: Math.round(get * c.price * 100) / 100, closes: c.event.expiry, venue: c.venue === "gemini" ? venue : c.venue };
    }),
  );
  cache = { at: Date.now(), want, list };
  return list;
}

export type { Proposal };
