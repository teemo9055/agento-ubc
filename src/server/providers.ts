/**
 * What the agents know about data and service providers, so a request like "use BlockRun"
 * gets a straight answer: what that provider sells, whether it fits, and whether we can pay it today.
 * Curated from Circle's Agent Marketplace catalogue (search_services finds the rest live).
 */
export interface Provider {
  name: string;
  /** Other names people use for it. */
  aliases?: string[];
  sells: string;
  /** Research tools in our harness that buy from this provider. */
  tools?: string[];
  /** How we can pay it from this app today. */
  payable: "now" | "mainnet" | "other-network";
  networks: string;
}

export const PROVIDERS: Provider[] = [
  { name: "Gemini", sells: "prediction-market odds history and trade flow, spot price candles (our x402 data seller), and order placement on the Gemini exchange", tools: ["odds_history", "trade_tape", "spot_candles"], payable: "now", networks: "Arc testnet (x402 from your vault)" },
  {
    name: "Quicknode",
    sells: "pay-per-call access to 130+ blockchains. Through it we read Chainlink prices (coins, gold, silver, euro, pound, yen), gas prices on Ethereum, Base, Arbitrum, Optimism and Polygon, Bitcoin fees and mempool, and any wallet's USDC balance; any other read is possible with a `service` step",
    tools: ["oracle_price", "gas_price", "btc_network", "wallet_balance", "service"],
    payable: "now",
    networks: "Arc testnet via Circle Gateway, also Arc, Base, Polygon",
  },
  { name: "Chainlink", aliases: ["oracle"], sells: "oracle prices for BTC, ETH, SOL, LINK, AVAX, BNB, USDC, gold, silver, EUR, GBP and JPY (read through Quicknode)", tools: ["oracle_price"], payable: "now", networks: "Arc testnet via Circle Gateway" },
  { name: "BotPay", sells: "paid access receipts and verification codes (a payments utility, mostly useful to test that paying a new vendor works)", tools: ["service"], payable: "now", networks: "Arc testnet via Circle Gateway, also Base and Solana" },
  { name: "OpenStreetMap", aliases: ["osm", "osrm"], sells: "places and driving routes", tools: ["drive_route"], payable: "now", networks: "Arc testnet (x402 from your vault)" },
  { name: "BlockRun", aliases: ["blockrun.ai"], sells: "prediction-market data across Polymarket, Kalshi, Limitless, Opinion and Predict.Fun (search, order books, smart-money positions), plus AI models for chat, images, music and speech", payable: "mainnet", networks: "Arc mainnet" },
  { name: "Arkham", sells: "onchain wallet intelligence and Polymarket positions, prices and wallet profit-and-loss", payable: "other-network", networks: "Base and other mainnets" },
  { name: "Exa", sells: "search that finds pages by meaning, limited by date, with the key sentences from each; and the clean text of any article", tools: ["deep_search", "read_article"], payable: "mainnet", networks: "Arc mainnet via Circle Gateway" },
  { name: "Coresignal", sells: "a company's staff count month by month for 3 years, senior people who joined, open jobs and their trend, and its last funding round (through Orthogonal)", tools: ["headcount_history"], payable: "mainnet", networks: "Arc mainnet via Circle Gateway" },
  { name: "PredictLeads", sells: "a company's funding rounds with dates, amounts and investors, and its dated events (hires, layoffs, launches, acquisitions) with the article behind each (through Orthogonal)", tools: ["funding_events", "company_events"], payable: "mainnet", networks: "Arc mainnet via Circle Gateway" },
  { name: "Otto AI", aliases: ["otto"], sells: "crypto news with sentiment, funding rates, DeFi analytics", payable: "other-network", networks: "Base and other mainnets" },
  { name: "Arrays", sells: "crypto market metrics, fear and greed index, funding rates", payable: "other-network", networks: "Base and other mainnets via Circle Gateway" },
  { name: "Messari", sells: "crypto asset research, funding rounds, AI research chat", payable: "other-network", networks: "Base and other mainnets" },
  { name: "LoneStarOracle", sells: "macro, commodity and geopolitical risk data", payable: "mainnet", networks: "Arc mainnet" },
  { name: "Goldsky", sells: "blockchain nodes across EVM chains", payable: "mainnet", networks: "Arc mainnet via Circle Gateway" },
  { name: "Agentic Reservations", aliases: ["resy"], sells: "restaurant availability and real bookings", payable: "other-network", networks: "Base" },
  { name: "BRIJ", sells: "live flight search and escrow-backed flight booking", payable: "other-network", networks: "Base" },
  { name: "StableTravel", aliases: ["flightaware"], sells: "flight status, airport delays and schedules (FlightAware)", payable: "other-network", networks: "Base" },
  { name: "AgentMail", sells: "email inboxes and sending for agents", payable: "other-network", networks: "Base" },
  { name: "anchor-x402", aliases: ["anchor"], sells: "anchoring a decision record or receipt hash onchain", payable: "mainnet", networks: "Arc mainnet" },
  { name: "Parallel", sells: "web search and async deep research", payable: "other-network", networks: "Base" },
];

const PAYABLE: Record<Provider["payable"], string> = {
  now: "usable now",
  mainnet: "needs Arc mainnet USDC (not on testnet yet)",
  "other-network": "needs USDC on another network (not wired up yet)",
};

/** One line per provider for prompts. */
export const providerDirectory = () =>
  PROVIDERS.map((p) => `- ${p.name}: ${p.sells}. ${PAYABLE[p.payable]}${p.tools ? `; our tools: ${p.tools.join(", ")}` : ""}.`).join("\n");

/** Providers mentioned in a piece of text (by name or alias). */
export function providersIn(text: string): Provider[] {
  const t = text.toLowerCase();
  return PROVIDERS.filter((p) => [p.name, ...(p.aliases ?? [])].some((n) => t.includes(n.toLowerCase())));
}
