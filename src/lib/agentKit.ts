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
      { label: "How the odds moved", price: "0.02" },
      { label: "Recent trades", price: "0.10" },
      { label: "Chainlink price: coins, gold, FX (Circle marketplace)", price: "0.0001" },
      { label: "Any marketplace service payable now", price: "seller's price" },
    ],
    can: ["Read the odds on any Gemini market", "Bet YES or NO with a price limit", "Hedge a cost: pay a little now, get paid if the bad thing happens", "Sell positions you hold", "Double-check a price with Chainlink first (coins, gold, silver, euro, pound, yen)"],
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
      { label: "How the odds moved", price: "0.02" },
      { label: "Gas price on 5 chains (Circle marketplace)", price: "0.0001" },
      { label: "Bitcoin fees and mempool (Circle marketplace)", price: "0.0002" },
      { label: "Any wallet's USDC balance (Circle marketplace)", price: "0.0001" },
      { label: "Any marketplace service payable now", price: "seller's price" },
    ],
    can: ["Check a coin's price and trend", "Buy or sell a coin with a limit price", "Trade only if a condition holds (e.g. only if it dips 2%)", "Double-check a price with Chainlink first", "Check network fees: Ethereum, Base, Arbitrum, Optimism, Polygon, Bitcoin", "Look up any wallet's USDC balance"],
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
  worko: {
    free: ["Look up places", "Hotels, chargers, fuel or food near a stop"],
    paid: [
      { label: "Driving route", price: "0.03" },
      { label: "Exchange rate: euro, pound, yen (Chainlink)", price: "0.0001" },
    ],
    can: ["Plan a drive and split it into days that fit your hours on the road", "List places to stay, eat, charge or fuel near any stop", "Check the euro, pound or yen rate for a trip budget"],
    cant: ["Book flights, hotels, rides or tables", "Search the web or read reviews"],
    acts: "Plan the route, split it into days and find places along it",
    never: "Book anything, sign in to your accounts or pay a merchant",
    result: "A day-by-day drive with places to sleep, charge or eat",
    title: "Road Trip Planner",
    headline: "Trips · Drives split into easy days, with places along the way",
    about:
      "Worko plans drives. It prices the route, splits it into days that fit the hours you want on the road, and finds places to sleep, charge, fuel or eat where each day ends. It doesn't book anything: you book the places you like yourself.",
    quirk: "Writes the to-do list before you've finished your sentence.",
  },
};
