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
    tagline: "Tracks prediction-market odds and explains what moved.",
    copy: {
      draft: "Here's the plan. Edit any card before you approve.",
      funding: "Funding the vault…",
      running: "Reading market data.",
      done: "Done. Your receipt is below.",
      cancelled: "Stopped. Unspent USDC returned.",
    },
  },
  trado: {
    name: "Trado",
    domain: "Trading",
    tagline: "Reads price charts and calls the trend.",
    copy: {
      draft: "Here's the plan. Edit any card before you approve.",
      funding: "Funding the vault…",
      running: "Reading price candles.",
      done: "Done. Your receipt is below.",
      cancelled: "Stopped. Unspent USDC returned.",
    },
  },
  travo: {
    name: "Travo",
    domain: "Travel",
    tagline: "Plans driving routes and day trips.",
    copy: {
      draft: "Here's the route plan. Edit any card before you approve.",
      funding: "Funding the vault…",
      running: "Working out the route.",
      done: "Done. Your receipt is below.",
      cancelled: "Trip cancelled. Unspent USDC returned.",
    },
  },
};
