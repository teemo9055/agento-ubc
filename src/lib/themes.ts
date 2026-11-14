import type { AgentId, RunStatus } from "./types";

export interface AgentTheme {
  name: string;
  domain: string;
  tagline: string;
  copy: Record<RunStatus, string>;
}

export const THEMES: Record<AgentId, AgentTheme> = {
  inso: {
    name: "Inso",
    domain: "Prediction markets",
    tagline: "Reads the odds, then asks before it bets.",
    copy: {
      exploring: "Ask me anything about the odds.",
      draft: "Here's the move, priced. Poke any card.",
      funding: "Filling the vault…",
      running: "Reading the room.",
      done: "Odds read. Receipt's below.",
      cancelled: "Stopped. Your change is back.",
    },
  },
  trado: {
    name: "Trado",
    domain: "Trading",
    tagline: "Spot trends, with a trade only if you say so.",
    copy: {
      exploring: "What are we watching?",
      draft: "Move's priced. Tweak before we trade.",
      funding: "Funding the vault…",
      running: "Drawing lines on charts.",
      done: "Trend called. Receipt's below.",
      cancelled: "Stopped. Unspent USDC returned.",
    },
  },
  travo: {
    name: "Travo",
    domain: "Travel",
    tagline: "Plans the drive, you take the wheel.",
    copy: {
      exploring: "Where to?",
      draft: "Route plan priced. Add a stop?",
      funding: "Fueling the vault…",
      running: "Plotting the route.",
      done: "Trip mapped. Receipt's below.",
      cancelled: "Trip cancelled. Funds returned.",
    },
  },
};
