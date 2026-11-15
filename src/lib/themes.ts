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
    tagline: "Reads prediction-market odds and asks before it places an order.",
    copy: {
      exploring: "Ask about any market. Lookups are free.",
      draft: "Here's the plan, priced. Change anything before you approve.",
      funding: "Funding the vault…",
      running: "Reading market data.",
      done: "Done. Your receipt is below.",
      cancelled: "Stopped. Unspent USDC returned.",
    },
  },
  trado: {
    name: "Trado",
    domain: "Trading",
    tagline: "Spots price trends and trades only when you approve.",
    copy: {
      exploring: "Ask about any coin. Lookups are free.",
      draft: "Here's the plan, priced. Change anything before you approve.",
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
      exploring: "Where are you going? Lookups are free.",
      draft: "Here's the route plan, priced. Change anything before you approve.",
      funding: "Funding the vault…",
      running: "Working out the route.",
      done: "Done. Your receipt is below.",
      cancelled: "Trip cancelled. Unspent USDC returned.",
    },
  },
};
