import type { AgentId } from "./types";

/**
 * What each agent can actually do, in plain words, matching the server's tools
 * (FREE_TOOLS, RESEARCH and ACTIONS in src/server/tools.ts).
 */
export interface AgentKit {
  /** Lookups it does while you chat. Free. */
  free: string[];
  /** Data it buys once you approve (from the vault, or from Circle's marketplace), with the unit price in USDC. */
  paid: { label: string; price: string }[];
  /** The one kind of thing it can do at the end. */
  acts: string;
  /** What you can ask it for, in the user's words. */
  can: string[];
  /** What it can't do here, with the honest reason. */
  cant: string[];
  /** What it never does. */
  never: string;
  /** One line on the result you get. */
  result: string;
  /** Directory profile: a straight-faced job title, a headline and an About paragraph. */
  title: string;
  headline: string;
  about: string;
  /** The one joke on the profile. */
  quirk: string;
}

export const KITS: Record<AgentId, AgentKit> = {
  inso: {
    free: ["Search markets", "Market details", "Live spot price", "Search Circle's marketplace"],
    paid: [
      { label: "Odds history", price: "0.02" },
      { label: "Trade tape", price: "0.10" },
      { label: "Chainlink price (Circle marketplace)", price: "0.0001" },
    ],
    can: ["Read the odds on any Gemini market", "Bet YES or NO with a price limit", "Hedge a cost: pay a little now, get paid if the bad thing happens", "Sell positions you hold", "Double-check a crypto price with Chainlink first"],
    cant: ["Markets Gemini doesn't list (e.g. rain; it has daily temperature, crypto, rates, sports)", "Marketplace services that only take Arc mainnet payments"],
    acts: "Place a YES/NO order on a prediction market",
    never: "Bet more than the limit you approve, or trade anything else",
    result: "A chart of how the odds moved, and whether your order was placed",
    title: "Senior Odds Analyst",
    headline: "Prediction markets · Reads the odds, then asks before it places an order",
    about:
      "Inso searches live prediction markets while you chat, for free. When there's a move worth making, it prices the research it needs (odds history, the trade tape, a Chainlink price bought from Circle's Agent Marketplace), checks the price again right before acting, and only then places a YES/NO order up to the limit you approved.",
    quirk: "Has never once said “trust me”.",
  },
  trado: {
    free: ["Live spot price", "Search markets", "Search Circle's marketplace"],
    paid: [
      { label: "Price candles", price: "0.02" },
      { label: "Chainlink price (Circle marketplace)", price: "0.0001" },
      { label: "Odds history", price: "0.02" },
    ],
    can: ["Check a coin's price and trend", "Buy or sell a coin with a limit price", "Trade only if a condition holds (e.g. only if it dips 2%)", "Double-check a price with Chainlink first"],
    cant: ["Market orders at any price (limit orders only)", "Coins Gemini doesn't list"],
    acts: "Place a limit order on a coin, or a YES/NO order",
    never: "Spend more than the amount you approve, or trade another coin",
    result: "A price chart with the trend call, and whether your order was placed",
    title: "Trend Analyst & Limit-Order Specialist",
    headline: "Trading · Charts first, then a limit order only if you say yes",
    about:
      "Trado looks up live spot prices while you chat, for free. When a trade makes sense, it buys the candles it needs to read the trend, can confirm the price against Chainlink (bought from Circle's Agent Marketplace), checks again on fresh data, and places a limit order no bigger than the amount you approved.",
    quirk: "Calls it a “position”. It's ten dollars.",
  },
  travo: {
    free: ["Look up places", "Search Circle's marketplace"],
    paid: [{ label: "Driving route", price: "0.03" }],
    can: ["Plan a drive between places", "Split it into days that fit your hours on the road", "Show the route on a map with distance and time per leg"],
    cant: ["Book hotels or flights (booking services on Circle's marketplace take Arc mainnet only)", "Transit, walking or flying routes"],
    acts: "Plan the route and split it into days",
    never: "Book, buy or reserve anything",
    result: "A route map and a day-by-day plan",
    title: "Road-Trip Planner (Non-Booking)",
    headline: "Travel · Routes and day plans, never reservations",
    about:
      "Travo finds your places while you chat, for free. Once you agree on the trip, it buys the driving route, splits it into days that fit your hours on the road, and hands you a map and a plan. It never books anything.",
    quirk: "Has strong opinions about rest stops. Keeps them to itself.",
  },
};
