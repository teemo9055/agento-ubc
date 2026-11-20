import { liveReady } from "./chain";
import { venueReady } from "./exchange";
import type { Plan, Proposal, Venue } from "@/lib/types";
import { jobById, JOBS, type JobCardInfo, type JobPreview } from "@/lib/jobs";
import * as gemini from "./gemini";
import { PROD_BASE, SANDBOX_BASE, type MarketContract, type MarketEvent } from "./gemini";
import { WEB_PRICES } from "./web-tools";
import { VENDOR_TOOLS } from "./vendor-tools";
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
async function eventsOf(prefix: string, base: string, minHours = 1, search?: string): Promise<MarketEvent[]> {
  const fits = (e: MarketEvent) => e.ticker.startsWith(prefix) && closesIn(e) > minHours * HOUR;
  // A market with a name is one small search away; the full list is ~1,000 markets in six big pages.
  const named = search ? (await gemini.namedEvents(search, base).catch(() => [])).filter(fits) : [];
  const all = named.length ? named : await gemini.activeEvents(base);
  return all.filter((e) => e.ticker.startsWith(prefix) && closesIn(e) > minHours * HOUR).sort((a, b) => closesIn(a) - closesIn(b));
}

/** A line worth buying as cover: unlikely but possible (between `lo` and `hi`), closest to `aim`. Cheap cover reads as insurance. */
function coverLine(cs: MarketContract[], ok: (c: MarketContract) => boolean, aim = 0.15, lo = 0.05, hi = 0.35): MarketContract | undefined {
  const priced = cs.filter((c) => ok(c) && c.open !== false && (yesPrice(c) ?? 0) >= lo && (yesPrice(c) ?? 1) <= hi);
  return priced.sort((a, b) => Math.abs(yesPrice(a)! - aim) - Math.abs(yesPrice(b)! - aim))[0];
}

/** One way to build a cover: the market, the line to buy YES on, and how it reads in a picker. */
type Cover = { key: string; label: string; event: MarketEvent; contract: MarketContract; price: number; venue: Venue; note?: string };
/** Everything a card can be built on right now, and the one picked when the person doesn't choose. */
type Options = { pick: string; options: Cover[]; def?: string };

const cityOf = (title: string) => /temperature in (.+?) on /i.exec(title)?.[1] ?? title;
const rank = (prefer: string[], key: string) => (prefer.includes(key) ? prefer.indexOf(key) : prefer.length);

/** Weather: every city with an open day, each on its cold ("… or below") or hot ("… or above") end. */
async function weatherOptions(prefer: string[], kind: "cold" | "hot"): Promise<Options> {
  const soonest = new Map<string, MarketEvent>();
  for (const e of await eventsOf("WXHIGH-", PROD_BASE, 2)) {
    const city = e.ticker.split("-")[1];
    if (!soonest.has(city)) soonest.set(city, e);
  }
  const options: Cover[] = [];
  for (const [city, event] of soonest) {
    const end = event.contracts.find((x) => (kind === "cold" ? /or below|or less/i.test(x.label) : /or above|or more/i.test(x.label)));
    const p = end ? yesPrice(end) : null;
    if (!end || p == null || p < 0.01 || p > 0.6) continue;
    options.push({ key: city, label: cityOf(event.title), event, contract: end, price: p, venue: "gemini" });
  }
  options.sort((a, b) => rank(prefer, a.key) - rank(prefer, b.key) || a.label.localeCompare(b.label));
  return { pick: "City", options };
}

/** Sports: every open game in a league, once for each team as "your team"; the cover buys the other side. */
async function sportsOptions(prefix: string): Promise<Options> {
  const options: Cover[] = [];
  const games = (await eventsOf(prefix, PROD_BASE, 2)).filter((e) => /-M$/.test(e.ticker) && e.contracts.length === 2).slice(0, 12);
  for (const event of games) {
    // Tickers read LEAGUE-WHEN-AWAY-HOME-M: the home team first, as the one people usually back.
    const home = event.ticker.split("-").slice(-2, -1)[0];
    const order = [...event.contracts].sort((a) => (a.symbol.endsWith(`-${home}`) ? -1 : 1));
    for (const mine of order) {
      const other = event.contracts.find((x) => x !== mine)!;
      const p = yesPrice(other);
      if (p == null || p < 0.05 || p > 0.8) continue;
      options.push({ key: `${event.ticker}:${mine.symbol.split("-").pop()}`, label: `${mine.label} (vs ${other.label})`, event, contract: other, price: p, venue: "gemini" });
    }
  }
  return { pick: "Your team", options };
}

/** Commodities and coins: the month-end lines a jump would cross, read fresh; the default is a cheap one. */
async function lineOptions(prefixes: string[], search?: string): Promise<Options> {
  for (const prefix of prefixes) {
    for (const listed of (await eventsOf(prefix, PROD_BASE, 24, search)).reverse()) {
      // Read fresh: lines open and close through the day, and the list above can be a minute old.
      const event = await gemini.getEvent(listed.ticker, PROD_BASE).catch(() => listed);
      const lines = event.contracts.filter((x) => /above/i.test(x.label) && x.open === true && (yesPrice(x) ?? 0) >= 0.03 && (yesPrice(x) ?? 1) <= 0.6).sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0));
      if (!lines.length) continue;
      const def = coverLine(lines, () => true) ?? coverLine(lines, () => true, 0.25, 0.03, 0.42) ?? lines[0];
      return { pick: "Price line", def: def.symbol, options: lines.map((c) => ({ key: c.symbol, label: c.label, event, contract: c, price: yesPrice(c)!, venue: "paper" as Venue })) };
    }
  }
  return { pick: "Price line", options: [] };
}

/** Fed: each outcome of the next decision; the default is the costly surprise, a bigger hike. */
async function fedOptions(): Promise<Options> {
  const event = (await eventsOf("FED", PROD_BASE, 24, "Fed decision")).find((e) => /^FED\d/.test(e.ticker));
  if (!event) return { pick: "Outcome", options: [] };
  const options = event.contracts.filter((c) => c.open !== false && (yesPrice(c) ?? 0) >= 0.02 && (yesPrice(c) ?? 1) <= 0.8).map((c) => ({ key: c.symbol, label: c.label, event, contract: c, price: yesPrice(c)!, venue: "gemini" as Venue }));
  return { pick: "Outcome", options, def: options.find((o) => />\s*25|bigger|50/i.test(o.label))?.key };
}

/** The picked option (or the default), skipping lines that turned out closed; on the test exchange, its nearest test line. */
async function choose(o: Options, venue: Venue, skip: Set<string>, choice?: string): Promise<Cover | { error: string }> {
  const open = o.options.filter((x) => !skip.has(x.contract.symbol));
  const c = open.find((x) => x.key === choice) ?? open.find((x) => x.key === o.def) ?? open[0];
  if (!c) return { error: "Nothing is open for that right now. Try again later." };
  if (venue !== "gemini-sandbox") return { ...c, venue };
  // The test exchange lists its own lines: take the one nearest the pick, at the live market's odds for it.
  const test = await gemini.getEvent(c.event.ticker, SANDBOX_BASE).catch(() => null);
  const lines = test?.contracts.filter((x) => x.strike != null && /above/i.test(x.label) && !skip.has(x.symbol)) ?? [];
  const byDistance = (a: MarketContract, b: MarketContract) => Math.abs(a.strike! - (c.contract.strike ?? 0)) - Math.abs(b.strike! - (c.contract.strike ?? 0));
  const nearest = [...lines].sort(byDistance)[0];
  if (!test || !nearest) {
    if (!venueReady("paper")) return { error: "This market isn't on Gemini's test exchange. Pick another line, or connect the real exchange in Settings." };
    return { ...c, venue: "paper", note: "This market isn't on Gemini's test exchange, so this one is practice." };
  }
  // The test exchange has few traders: a buy only fills if someone there is selling. When a line has a
  // seller, use it at the seller's price so the order fills now; otherwise say plainly it will wait.
  const selling = lines.filter((x) => x.ask != null && x.ask > 0 && x.ask <= 0.9).sort(byDistance)[0];
  if (selling) {
    const moved = selling.symbol !== nearest.symbol;
    return { ...c, event: test, contract: selling, price: selling.ask!, venue: "gemini-sandbox", note: `On Gemini's test exchange${moved ? `, “${selling.label}” is the line with a seller right now, so I used it` : ""}: buying at the seller's ${Math.round(selling.ask! * 100)}¢ fills straight away (test money).` };
  }
  const ref = c.event.contracts.filter((x) => x.strike != null && yesPrice(x) != null).sort((a, b) => Math.abs(a.strike! - nearest.strike!) - Math.abs(b.strike! - nearest.strike!))[0];
  const p = Math.min(0.9, Math.max(0.03, ref ? yesPrice(ref)! : c.price));
  return { ...c, event: test, contract: nearest, price: p, venue: "gemini-sandbox", note: "Heads up: nobody is selling this on Gemini's test exchange right now (few people trade there), so the order is priced from the live market and will wait until a seller shows up. On the real exchange, market makers sell all day." };
}

// ---------- cards ----------

type Built = { input: ProposalInput; intro: string; venue: Venue } | { plan: (id: string) => Promise<Plan | { error: string }>; intro: string; venue: Venue };

interface CardDef {
  /** How it reads as a request in the job's chat. */
  ask: (c?: Cover) => string;
  /** What the card can be built on right now (cities, teams, price lines). */
  options?: () => Promise<Options>;
  /** What a cover protects and roughly what's at stake, in dollars. */
  loss?: { protects: string; usd: number };
  build: (venue: Venue, skip?: Set<string>, choice?: string) => Promise<Built | { error: string }>;
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

/** A cover card: built on the picked option, sized by code to what's at stake; news cards read the headlines first. */
/**
 * What a cover checks before it buys, from other sellers: the price from Chainlink (Quicknode),
 * today's headlines (Serper), and what Polymarket and Kalshi price for the same thing (BlockRun).
 * With a price feed, the order only goes in if the price is within 10% of the line picked.
 */
type Before = { oracle?: string; news?: string; odds?: string };
const beforeSteps = (b: Before): ProposalInput["research"] => [
  ...(b.oracle ? [{ tool: "oracle_price", args: { symbol: b.oracle }, label: "Price right now (Chainlink)", why: "How far the price is from the line" }] : []),
  ...(b.news ? [{ tool: "news_search", args: { query: b.news }, label: "Today's headlines", why: "What the news says before you buy" }] : []),
  ...(b.odds ? [{ tool: "market_odds", args: { query: b.odds }, label: "Polymarket and Kalshi odds", why: "Whether other markets price it the same" }] : []),
];
const beforeCost = (b: Before) => {
  const steps = beforeSteps(b);
  return steps.length ? { usd: usd(steps.reduce((a, s) => a + VENDOR_TOOLS[s.tool].price(s.args), 0n)), steps: steps.length } : undefined;
};

const coverCard = (title: string, loss: { protects: string; usd: number }, options: () => Promise<Options>, ask: (c: Cover) => string, before: Before = {}): CardDef => ({
  options,
  loss,
  cost: beforeCost(before) ? () => beforeCost(before)! : undefined,
  ask: (c) => (c ? ask(c) : title),
  build: async (venue, skip, choice) => {
    const c = await choose(await options(), venue, skip ?? new Set(), choice);
    if ("error" in c) return c;
    const input = coverInput(c, loss, title);
    input.research = [...beforeSteps(before), ...input.research];
    // Don't pay for a long shot: the price must be within 10% of the line when the order goes in.
    const gate = before.oracle && c.contract.strike ? Math.round(c.contract.strike * 0.9) : undefined;
    if (gate) input.condition = { metric: "oracle_price", symbol: before.oracle!, op: ">=", value: gate };
    const checks = [before.oracle && "the price from Chainlink", before.news && "today's headlines", before.odds && "what Polymarket and Kalshi price"].filter(Boolean).join(", ");
    return {
      input,
      intro: `${checks ? `First I'll check ${checks}. ` : ""}${c.event.title.replace(/\?$/, "")}: “${c.contract.label}” is at ${cents(c.price)}. Buying YES pays $1 a contract if it happens, so I sized it to cover about $${loss.usd} of ${loss.protects}.${gate ? ` The order only goes in if the price is at least $${gate.toLocaleString()} (within 10% of the line) right before buying.` : ""}${c.note ? ` ${c.note}` : ""} Pick another option on the card, or change it here.`,
      venue: c.venue,
    };
  },
});

const ROUTE = PRODUCTS["routes.drive"]?.price ?? 30_000n;

/** One stage of a chained job: fixed inputs, or inputs taken from an earlier stage's answer. */
type Stage = { id: string; tool: string; args?: Record<string, string>; bind?: Record<string, string>; label: string; why: string };
const priceOf = (steps: Stage[]) => steps.reduce((a, s) => a + VENDOR_TOOLS[s.tool].price(s.args ?? {}), 0n);
const cash = (units: bigint) => `$${usd(units) < 0.01 ? usd(units).toFixed(3) : usd(units).toFixed(2)}`;
/** A job whose stages feed each other; its price is worked out from its stages. */
const chainCard = (c: { ask: string; title: string; why: string; question: string; intro: string; steps: Stage[] }): CardDef => ({
  ask: () => c.ask,
  cost: () => ({ usd: usd(priceOf(c.steps)), steps: c.steps.length }),
  build: async () => ({ input: check(c.title, c.why, `${c.question} for up to ${cash(priceOf(c.steps))}?`, c.steps.map((s) => ({ args: {}, ...s })) as ProposalInput["research"]), intro: c.intro, venue: "paper" }),
});

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
          const c = await choose(await lineOptions(["WTI", "BRENT"], "Oil"), venue, skip);
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
  // Worko: chains. Each stage uses what the one before found, across several sellers.
  "company-deep": chainCard({
    ask: "I'm thinking of investing in Rivian. Give me the full picture first.",
    title: "Brief: Rivian",
    why: "Find its real website, read what it says, check the company record behind it, then the news and the risks.",
    question: "Build the Rivian brief in 6 stages",
    intro: "Six stages, each using the last: find Rivian's official site, read it, look up the company record behind that site (age, official phones, location), then the latest news, complaints and money health, and a written analysis at the end. Change the company in the chat.",
    steps: [
      { id: "s1", tool: "web_search", args: { query: "Rivian official website" }, label: "Find the official site", why: "Everything after starts from the real website" },
      { id: "s2", tool: "read_page", bind: { url: "$s1.results[0].link" }, label: "Read the site", why: "What the company says about itself right now" },
      { id: "s3", tool: "company_record", bind: { site: "$s1.results[0].link" }, label: "Company record", why: "Who is behind that site: age, official phones, location" },
      { id: "s4", tool: "news_search", args: { query: "Rivian" }, label: "Latest news", why: "What changed recently" },
      { id: "s5", tool: "web_search", args: { query: "Rivian complaints lawsuit recall" }, label: "Complaints and lawsuits", why: "What goes wrong, from outside the company" },
      { id: "s6", tool: "web_search", args: { query: "Rivian earnings cash burn layoffs" }, label: "Money health", why: "Earnings, cash and layoffs" },
    ],
  }),
  "big-buy": chainCard({
    ask: "I want to buy Sony WH-1000XM5 headphones. Is it the right pick, at the right price, right now?",
    title: "Buy check: Sony WH-1000XM5",
    why: "Store prices, then the best review read in full, recalls, and whether a newer model is about to replace it.",
    question: "Check the Sony WH-1000XM5 in 5 stages",
    intro: "Five stages: store prices, find the most cited review and read it in full, check recalls, and whether a new model is coming, then a written verdict. Change the product in the chat.",
    steps: [
      { id: "s1", tool: "shopping_prices", args: { product: "Sony WH-1000XM5" }, label: "Store prices", why: "What stores charge right now" },
      { id: "s2", tool: "web_search", args: { query: "Sony WH-1000XM5 review" }, label: "Find the top review", why: "The review most people read" },
      { id: "s3", tool: "read_page", bind: { url: "$s2.results[0].link" }, label: "Read that review", why: "The full verdict, not a snippet" },
      { id: "s4", tool: "news_search", args: { query: "Sony WH-1000XM5 recall problem" }, label: "Recalls and problems", why: "Known faults" },
      { id: "s5", tool: "web_search", args: { query: "Sony WH-1000XM6 release" }, label: "Is a new model coming?", why: "Whether to wait" },
    ],
  }),
  "place-reviews": chainCard({
    ask: "Is Blue Bottle Coffee in Oakland any good?",
    title: "Check: Blue Bottle Coffee, Oakland",
    why: "Find it on Google with its reviews, then read its own site and any news.",
    question: "Check Blue Bottle Coffee in 3 stages",
    intro: "Three stages: find it on Google and read its recent reviews, then read the website Google lists for it, and look for news. Change the place in the chat.",
    steps: [
      { id: "s1", tool: "place_reviews", args: { place: "Blue Bottle Coffee Oakland" }, label: "Google reviews", why: "How people rate it lately" },
      { id: "s2", tool: "read_page", bind: { url: "$s1.found.website" }, label: "Read its website", why: "Menu, hours and what it offers" },
      { id: "s3", tool: "news_search", args: { query: "Blue Bottle Coffee Oakland" }, label: "In the news", why: "Openings, closures, changes" },
    ],
  }),
  "city-weekend": chainCard({
    ask: "I'm spending this weekend in Portland, Oregon. What's on, and where should I eat?",
    title: "Weekend: Portland",
    why: "Find this weekend's guide and read it, check the news, then reviews of where to eat.",
    question: "Plan the Portland weekend in 5 stages",
    intro: "Five stages: find this weekend's events guide and read it in full, check the news for closures or crowds, then real reviews of a breakfast and a dinner spot, and a plan at the end. Change the city or the places in the chat.",
    steps: [
      { id: "s1", tool: "web_search", args: { query: "things to do in Portland Oregon this weekend" }, label: "Find the weekend guide", why: "Where the events are listed" },
      { id: "s2", tool: "read_page", bind: { url: "$s1.results[0].link" }, label: "Read the guide", why: "The actual events, dates and places" },
      { id: "s3", tool: "news_search", args: { query: "Portland Oregon this weekend" }, label: "In the news", why: "Closures, weather or crowds to plan around" },
      { id: "s4", tool: "place_reviews", args: { place: "Pine State Biscuits Portland" }, label: "Breakfast: reviews", why: "Is it worth the line" },
      { id: "s5", tool: "place_reviews", args: { place: "Ox Restaurant Portland" }, label: "Dinner: reviews", why: "Recent ratings" },
    ],
  }),
  "used-car": chainCard({
    ask: "I'm buying a 2018 Honda Civic for $14,000 from a private seller. Their number is +1 415 555 0134. Check everything first.",
    title: "Check: 2018 Honda Civic sale",
    why: "The seller's phone, what the car really sells for, recalls, the common faults read in full, and known scams.",
    question: "Check the sale in 6 stages before you pay $14,000",
    intro: "Six stages: the seller's phone line, what the car really sells for, recalls, find the best guide to its common faults and read it, and known scams, then a verdict. Paste their number in the chat to check yours.",
    steps: [
      { id: "s1", tool: "phone_check", args: { phone: "+1 415 555 0134" }, label: "Seller's phone line", why: "Internet-only numbers are common in scams" },
      { id: "s2", tool: "shopping_prices", args: { product: "2018 Honda Civic used" }, label: "What it sells for", why: "Whether $14,000 is fair" },
      { id: "s3", tool: "news_search", args: { query: "2018 Honda Civic recall" }, label: "Recalls", why: "Faults to ask the seller about" },
      { id: "s4", tool: "web_search", args: { query: "2018 Honda Civic common problems" }, label: "Find a faults guide", why: "What to check on the test drive" },
      { id: "s5", tool: "read_page", bind: { url: "$s4.results[0].link" }, label: "Read the faults guide", why: "The full list, not a snippet" },
      { id: "s6", tool: "web_search", args: { query: "private seller used car scam deposit" }, label: "Known scams", why: "The tricks to watch for" },
    ],
  }),
  "rental-check": chainCard({
    ask: "I found an apartment managed by Greystar in Austin. The landlord's number is +1 512 555 0199. Is the listing real?",
    title: "Check: Austin apartment listing",
    why: "The landlord's phone, the manager's reviews and the company behind their website, what rent usually is, and how rental scams work.",
    question: "Check the listing in 5 stages before you send a deposit",
    intro: "Five stages: the landlord's phone, find the manager on Google with its reviews, then check the company behind the website Google lists, what rent usually is there, and how rental scams work. Paste the real number in the chat.",
    steps: [
      { id: "s1", tool: "phone_check", args: { phone: "+1 512 555 0199" }, label: "Landlord's phone line", why: "Internet-only numbers are common in rental scams" },
      { id: "s2", tool: "place_reviews", args: { place: "Greystar Austin" }, label: "Manager's reviews", why: "How tenants rate them" },
      { id: "s3", tool: "company_record", bind: { site: "$s2.found.website" }, label: "Company behind the site", why: "Official phones to compare with the landlord's" },
      { id: "s4", tool: "web_search", args: { query: "average rent 1 bedroom apartment Austin" }, label: "What rent usually is", why: "A price far below it is a warning sign" },
      { id: "s5", tool: "web_search", args: { query: "rental listing scam deposit wire" }, label: "How rental scams work", why: "The signs to watch for" },
    ],
  }),
  "business-check": chainCard({
    ask: "Can I trust Bay Area Plumbing in San Francisco before I hire them?",
    title: "Check: Bay Area Plumbing",
    why: "Find them on Google, then check the phone and the website Google lists, the company behind it, and any complaints.",
    question: "Check Bay Area Plumbing in 6 stages",
    intro: "Six stages, each using the last: find them on Google with their reviews, check the phone number Google lists, read their website, look up the company behind it, then news and complaints, and a verdict at the end. Change the business in the chat.",
    steps: [
      { id: "s1", tool: "place_reviews", args: { place: "Bay Area Plumbing San Francisco" }, label: "Find them on Google", why: "Their listing, phone, website and reviews" },
      { id: "s2", tool: "phone_check", bind: { phone: "$s1.found.phone" }, label: "Check their phone", why: "A real business line, or an internet number" },
      { id: "s3", tool: "read_page", bind: { url: "$s1.found.website" }, label: "Read their website", why: "Licence, services and address they claim" },
      { id: "s4", tool: "company_record", bind: { site: "$s1.found.website" }, label: "Company behind the site", why: "How old the site is and its official contacts" },
      { id: "s5", tool: "news_search", args: { query: "Bay Area Plumbing San Francisco" }, label: "In the news", why: "Complaints, lawsuits or closures" },
      { id: "s6", tool: "web_search", args: { query: "Bay Area Plumbing San Francisco complaints license BBB" }, label: "Complaints and licence", why: "Licence status and complaint records" },
    ],
  }),
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
  // Inso: news + markets (headlines bought in real USDC on Arc mainnet, then the market)
  "news-crypto": coverCard("Bet: Bitcoin moves up", { protects: "missing a Bitcoin rally", usd: 15 }, () => lineOptions(["BTC2"], "BTC price"), (c) => `Bitcoin's in the news. Read the headlines, then bet on “${c.contract.label}” by ${day(c.event)}.`, { oracle: "btcusd", news: "Bitcoin price", odds: "bitcoin" }),
  "news-oil": coverCard("Cover: oil jumps on the news", { protects: "a higher fuel bill", usd: 25 }, () => lineOptions(["WTI", "BRENT"], "Oil"), (c) => `Oil supply is in the news. Read it, then cover me if oil reaches ${c.contract.label} by ${day(c.event)}.`, { news: "OPEC oil supply", odds: "oil price" }),
  "news-fed": coverCard("Cover: a bigger rate hike", { protects: "a bigger mortgage payment", usd: 40 }, fedOptions, (c) => `Rate news could raise my mortgage. Read it, then cover me if the Fed says “${c.contract.label}”.`, { news: "Federal Reserve rate decision", odds: "fed decision" }),
  // Inso: weather (the order goes to Gemini's real exchange; practice without it)
  "wedding-cold": coverCard("Cover: a cold wedding day", { protects: "a cold wedding day", usd: 40 }, () => weatherOptions(["CHI", "BOS", "DEN", "PHL"], "cold"), (c) => `My outdoor wedding in ${cityOf(c.event.title)} is ${day(c.event)}. Cover me if it's cold.`),
  "rides-cold": coverCard("Cover: rides on a freezing day", { protects: "pricey rides on a freezing day", usd: 20 }, () => weatherOptions(["BOS", "PHL", "DCA", "CHI"], "cold"), (c) => `Rides in ${cityOf(c.event.title)} cost me about $20 more on a cold day. Cover me if it's cold ${day(c.event)}.`),
  "heat-bill": coverCard("Cover: a heatwave power bill", { protects: "a heatwave power bill", usd: 30 }, () => weatherOptions(["AUS", "DFW", "LA", "ATL"], "hot"), (c) => `A hot day in ${cityOf(c.event.title)} spikes my power bill. Cover me if it's hot ${day(c.event)}.`),
  // Inso: sports
  "tickets-loss": coverCard("Cover: my team loses", { protects: "your team losing", usd: 30 }, () => sportsOptions("NBA-"), (c) => `I have tickets for ${c.event.title}. Cover me if my team loses.`),
  "bar-night": coverCard("Cover: a slow night at the bar", { protects: "a slow night at the bar", usd: 30 }, () => sportsOptions("NFL-"), (c) => `My bar is slow when the home team loses. ${c.event.title}: cover me.`),
  // Inso: commodities (real orders on Gemini's test exchange)
  "heating-gas": coverCard("Cover: a natural gas spike", { protects: "a higher heating bill", usd: 20 }, () => lineOptions(["NGAS"], "Natural Gas"), (c) => `My heating bill jumps if natural gas spikes. Cover me if it reaches ${c.contract.label}.`),
  "ring-gold": coverCard("Cover: a gold price jump", { protects: "a pricier gold ring", usd: 25 }, () => lineOptions(["XAU"], "Gold"), (c) => `I'm buying a gold ring soon. Cover me if gold reaches ${c.contract.label}.`, { oracle: "xauusd" }),
  "copper-quote": coverCard("Cover: a copper price jump", { protects: "a thinner margin on the job", usd: 25 }, () => lineOptions(["COPPER"], "Copper"), (c) => `I quoted a wiring job at a fixed price. Cover me if copper reaches ${c.contract.label}.`),
  "fuel-costs": coverCard("Cover: an oil price jump", { protects: "higher fuel costs", usd: 30 }, () => lineOptions(["WTI", "BRENT"], "Oil"), (c) => `Fuel is my biggest cost. Cover me if oil reaches ${c.contract.label}.`),
};

/** Where a card's order goes, given where the person wants orders to go and what the market allows. */
export function venueFor(card: JobCardInfo, want: Venue): Venue {
  // Weather, sports and the Fed trade only on Gemini's real exchange, so they go there when it's
  // connected (the card says "Real money"). Practice is only left when no Gemini account is.
  if (realOnly(card)) return venueReady("gemini") ? "gemini" : "paper";
  if (want === "paper" && !venueReady("paper")) return venueReady("gemini-sandbox") ? "gemini-sandbox" : "gemini";
  return want;
}

/** Markets Gemini lists only on its real exchange, not the test one. */
export const realOnly = (card: JobCardInfo) => card.section === "weather" || card.section === "sports" || card.id === "news-fed";

/** The request text a card opens with, naming the option it's built on. */
export const askOf = async (id: string, venue: Venue, choice?: string) => {
  const def = CARDS[id];
  if (!def?.options) return def?.ask();
  const c = await choose(await def.options(), venue, new Set(), choice).catch(() => null);
  return def.ask(c && !("error" in c) ? c : undefined);
};

/** Builds a card's job: one checked move, or a plan of two. */
export async function buildJob(id: string, want: Venue, skip?: Set<string>, choice?: string): Promise<Built | { error: string }> {
  const card = jobById(id);
  const def = CARDS[id];
  if (!card || !def) return { error: "That job isn't in the catalog" };
  return def.build(venueFor(card, want), skip, choice);
}

/** A card's single move, built and checked; a line that closed in between is skipped and the next one tried. */
export async function buildChecked(id: string, want: Venue, check: (input: ProposalInput) => Promise<{ proposal: Proposal } | { error: string }>, choice?: string): Promise<{ proposal: Proposal; intro: string; venue: Venue } | { plan: Extract<Built, { plan: unknown }> } | { error: string }> {
  const skip = new Set<string>();
  let last = "That job couldn't be built right now";
  for (let i = 0; i < 3; i++) {
    const b = await buildJob(id, want, skip, choice);
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

/** Sized the way the order will be: enough contracts that the payout, less what they cost, covers what's at stake. */
function sized(loss: number, price: number) {
  const get = Math.max(1, Math.ceil(loss / Math.max(0.05, 1 - price)));
  return { get, pay: Math.round(get * price * 100) / 100 };
}

/** What each card shows live, with every option it can be built on, built in parallel and cached briefly. */
let cache: { at: number; want: Venue; mainnet: boolean; list: JobPreview[] } | null = null;
export async function previews(want: Venue): Promise<JobPreview[]> {
  const mainnet = liveReady("mainnet");
  if (cache && cache.want === want && cache.mainnet === mainnet && Date.now() - cache.at < 45_000) return cache.list;
  const list = await Promise.all(
    JOBS.map(async (card): Promise<JobPreview> => {
      const def = CARDS[card.id];
      const venue = venueFor(card, want);
      // Checks paid in real USDC need Arc mainnet on this server: say so on the card, not after a click.
      if (card.money === "real" && !mainnet) return { id: card.id, venue, needsMainnet: true, unavailable: "Needs Arc mainnet. Set it up in Settings → Paying, then this runs for real USDC." };
      // A real-exchange-only market with no real exchange connected (and practice off): say what's missing.
      if (venue === "paper" && !venueReady("paper")) return { id: card.id, venue: "gemini", needsVenue: true, unavailable: "Gemini lists this market only on its real exchange, which isn't connected yet. Settings → Exchange shows how." };
      const cost = def.cost?.();
      if (!def.options) return { id: card.id, cost: cost?.usd, steps: cost?.steps, venue };
      const o = await Promise.race([def.options(), new Promise<null>((r) => setTimeout(() => r(null), 15_000))]).catch(() => null);
      if (!o) return { id: card.id, unavailable: "Gemini didn't answer in time. Try again in a moment.", venue };
      if (!o.options.length) return { id: card.id, unavailable: "Nothing is open for this right now. Try again later.", venue };
      const choices = o.options.map((c) => ({ id: c.key, label: c.label, market: c.event.title.replace(/\?$/, ""), line: c.contract.label, chance: c.price, closes: c.event.expiry, ...sized(def.loss!.usd, c.price) }));
      const first = choices.find((c) => c.id === o.def) ?? choices[0];
      const shown = venue === "gemini-sandbox" && (card.section === "commodities" || card.section === "news") ? "gemini-sandbox" : venue;
      const { id: choice, label: _label, ...nums } = first;
      return { ...nums, id: card.id, choices, choice, pick: o.pick, cost: cost?.usd, steps: cost?.steps, venue: shown };
    }),
  );
  // A card Gemini was slow for is tried again on the next look, not kept for the whole 45 s.
  const slow = list.some((p) => p.unavailable?.startsWith("Gemini didn't answer"));
  cache = { at: slow ? Date.now() - 40_000 : Date.now(), want, mainnet, list };
  return list;
}

export type { Proposal };
