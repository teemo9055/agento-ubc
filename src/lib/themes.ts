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
  worko: {
    name: "Worko",
    domain: "Errands",
    tagline: "Gets real-world things done: checks before you commit, drives planned, bookings ready.",
    copy: {
      exploring: "What needs doing? Lookups are free.",
      draft: "Here's the plan, priced. Change anything before you approve.",
      funding: "Funding the vault…",
      running: "On it.",
      done: "Done. Your receipt is below.",
      cancelled: "Stopped. Unspent USDC returned.",
    },
  },
};
