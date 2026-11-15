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
  /** What it never does. */
  never: string;
  /** One line on the result you get. */
  result: string;
}

export const KITS: Record<AgentId, AgentKit> = {
  inso: {
    free: ["Search markets", "Market details", "Live spot price", "Search Circle's marketplace"],
    paid: [
      { label: "Odds history", price: "0.02" },
      { label: "Trade tape", price: "0.10" },
      { label: "Chainlink price (Circle marketplace)", price: "0.0001" },
    ],
    acts: "Place a YES/NO order on a prediction market",
    never: "Bet more than the limit you approve, or trade anything else",
    result: "A chart of how the odds moved, and whether your order was placed",
  },
  trado: {
    free: ["Live spot price", "Search markets", "Search Circle's marketplace"],
    paid: [
      { label: "Price candles", price: "0.02" },
      { label: "Chainlink price (Circle marketplace)", price: "0.0001" },
      { label: "Odds history", price: "0.02" },
    ],
    acts: "Place a limit order on a coin, or a YES/NO order",
    never: "Spend more than the amount you approve, or trade another coin",
    result: "A price chart with the trend call, and whether your order was placed",
  },
  travo: {
    free: ["Look up places", "Search Circle's marketplace"],
    paid: [{ label: "Driving route", price: "0.03" }],
    acts: "Plan the route and split it into days",
    never: "Book, buy or reserve anything",
    result: "A route map and a day-by-day plan",
  },
};
