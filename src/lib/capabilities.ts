import type { AgentId } from "./types";
import { mainnetOn } from "./network";

/**
 * What this app can really do, and where. One list, used by the ask screen, the docs and the
 * showcase, so nothing is offered that can't actually run.
 *
 * - now: executes on Arc testnet today with real (testnet) payments.
 * - exchange: executes for real once Gemini test-exchange keys are connected; a practice order without them.
 * - mainnet: exists, but needs mainnet or real money and isn't wired up.
 * - never: not something any connected service offers.
 */
export type Where = "now" | "exchange" | "mainnet" | "never";

export interface Capability {
  what: string;
  where: Where;
  /** What one use costs, in USDC, when it costs anything. */
  cost?: string;
  who?: AgentId[];
  /** Who is paid, or why it isn't available. */
  note?: string;
}

export const CAPABILITIES: Capability[] = [
  // Paid per request, working today.
  { what: "Chainlink prices: BTC, ETH, SOL, LINK, AVAX, BNB, USDC, gold, silver, euro, pound, yen", where: "now", cost: "0.0001", who: ["inso", "trado", "worko"], note: "Quicknode, via Circle Gateway" },
  { what: "Gas price on Ethereum, Base, Arbitrum, Optimism, Polygon", where: "now", cost: "0.0001", who: ["trado"], note: "Quicknode, via Circle Gateway" },
  { what: "Bitcoin fees and how busy the network is", where: "now", cost: "0.0002", who: ["trado"], note: "Quicknode, via Circle Gateway" },
  { what: "Any wallet's USDC balance on five chains", where: "now", cost: "0.0001", who: ["trado"], note: "Quicknode, via Circle Gateway" },
  { what: "Any other read from 130+ blockchains", where: "now", cost: "0.0001", who: ["inso", "trado", "worko"], note: "Quicknode, via Circle Gateway" },
  { what: "A paid receipt from a second marketplace vendor", where: "now", cost: "0.01", who: ["inso", "trado", "worko"], note: "BotPay, via Circle Gateway" },
  { what: "How a prediction market's odds moved", where: "now", cost: "0.02", who: ["inso", "trado"], note: "Agento data feed, x402 from the job's vault" },
  { what: "Who's buying and selling in a prediction market", where: "now", cost: "0.10", who: ["inso"], note: "Agento data feed, x402 from the job's vault" },
  { what: "Price candles for a coin", where: "now", cost: "0.02", who: ["trado"], note: "Agento data feed, x402 from the job's vault" },
  { what: "A driving route, split into days, with places to stay", where: "now", cost: "0.03", who: ["worko"], note: "Agento data feed, x402 from the job's vault" },
  // Free.
  { what: "Live odds on every Gemini market (crypto, weather, rates, sports, commodities)", where: "now", who: ["inso", "trado"] },
  { what: "Live coin prices", where: "now", who: ["inso", "trado"] },
  { what: "Hotels, chargers, fuel and food near any stop", where: "now", who: ["worko"] },
  { what: "A ride, flight, hotel or table, ready to book in your own app (Uber, Google Flights, Booking.com, OpenTable)", where: "now", who: ["worko"], note: "You finish it there; Agento never books or pays the merchant" },
  { what: "Checks before you pay someone: reverse image search, reviews, phone-number fraud signals", where: "mainnet", who: ["worko"], note: "Orthogonal and BlockRun on Circle's marketplace take Arc mainnet" },
  { what: "An AI phone call that books or asks for you", where: "never", who: ["worko"], note: "StablePhone is listed but doesn't take payment on Arc yet" },
  { what: "What's new, opening soon or just settled on Gemini, and how each market resolved", where: "now", who: ["inso", "trado"] },
  { what: "Live prices on any contract, and how far the real price is from its line", where: "now", who: ["inso", "trado"] },
  { what: "Price cover against several things happening together (a combination)", where: "now", who: ["inso"] },
  // Composed from the whole marketplace.
  { what: "A check built from the whole marketplace catalog: Quick, Thorough or Most certain, one answer feeding the next, key answers cross-checked", where: "mainnet", who: ["worko", "inso", "trado"], note: "Plans are built here; most of their services take Arc mainnet (about 130 are payable on testnet)" },
  { what: "Recipes learned from jobs that worked, sold to other agents per request", where: "now", who: ["worko"], note: "x402 at /api/x402/recipe.<id>, refunded if a must-know check fails" },
  // Orders.
  { what: "One order on a combination of 2-6 outcomes that pays only if all happen", where: "exchange", who: ["inso"], note: "Gemini's test exchange; not yet on its real one" },
  { what: "Buy or sell prediction contracts on crypto and commodity markets: limits, stop-limits, conditions, hedges, positions", where: "exchange", who: ["inso", "trado"], note: "Gemini's test exchange lists only these markets" },
  { what: "Buy or sell coins with a limit price", where: "exchange", who: ["trado"] },
  // Not yet.
  { what: "Orders on weather, sports and rates markets", where: "mainnet", note: "Gemini lists them only on its real exchange, with real money" },
  { what: "Web search, flight and hotel booking, wallet intelligence, AI models and about 2,000 other marketplace services", where: "mainnet", note: "They take Arc mainnet or Base, not testnet" },
  { what: "A market on rain", where: "never", note: "Gemini has daily temperature markets, not precipitation" },
];

export const WHERE_LABEL: Record<Where, string> = {
  now: "Works today",
  exchange: mainnetOn() ? "With Gemini connected" : "With a test exchange connected",
  // The same list reads as available once the app is switched to mainnet.
  mainnet: mainnetOn() ? "On mainnet (now on)" : "Needs mainnet",
  never: "Not available",
};
