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
    tagline: "Reads the odds so you don't have to.",
    copy: {
      draft: "Here's the plan. Poke any card.",
      funding: "Filling the vault…",
      running: "Reading the room.",
      done: "Odds read. Receipt's below.",
      cancelled: "Stopped. Your change is back.",
    },
  },
  trado: {
    name: "Trado",
    domain: "Trading",
    tagline: "Charts first, feelings later.",
    copy: {
      draft: "Plan's ready. Tweak before we buy candles.",
      funding: "Funding the vault…",
      running: "Drawing lines on charts.",
      done: "Trend called. Receipt's below.",
      cancelled: "Stopped. Unspent USDC returned.",
    },
  },
  travo: {
    name: "Travo",
    domain: "Travel",
    tagline: "Gets you there, snacks not included.",
    copy: {
      draft: "Route plan ready. Add a stop?",
      funding: "Fueling the vault…",
      running: "Plotting the route.",
      done: "Trip mapped. Receipt's below.",
      cancelled: "Trip cancelled. Funds returned.",
    },
  },
};
