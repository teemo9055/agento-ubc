import type { AgentId } from "./types";

export type Outfit = "sports" | "health" | "crypto" | "commodities" | "weather" | "politics" | "travel" | "finance" | "none";
export type Mood = "idle" | "working" | "alert" | "happy" | "sad";

const RULES: [Outfit, RegExp][] = [
  ["sports", /\b(nba|nfl|nhl|mlb|ncaa|soccer|football|basketball|baseball|hockey|tennis|golf|ufc|match|game|games|team|vs\.?|league|cup|playoff|super bowl|world series|spread)\b/i],
  ["health", /\b(health|hospital|doctor|medical|medicine|drug|fda|vaccine|covid|flu|disease|pharma|clinic)\b/i],
  ["politics", /\b(election|elections|president|presidential|senate|congress|vote|voting|poll|governor|mayor|parliament|prime minister|policy|tariff)\b/i],
  ["weather", /\b(weather|rain|snow|temperature|storm|hurricane|heat|climate|forecast|degrees)\b/i],
  ["commodities", /\b(gold|silver|oil|copper|gas|commodit(y|ies)|wheat|corn|metal|metals)\b/i],
  ["crypto", /\b(btc|bitcoin|eth|ethereum|sol|solana|crypto|coin|token|doge|hype|xrp|defi|stablecoin|usdc)\b/i],
  ["finance", /\b(stock|stocks|s&p|nasdaq|fed|rates|inflation|cpi|earnings|economy|gdp)\b/i],
];

/** Picks the mascot's outfit from what the job is about. */
export function outfitFor(agent: AgentId, text: string): Outfit {
  for (const [o, re] of RULES) if (re.test(text)) return o;
  if (agent === "travo") return "travel";
  if (agent === "trado") return "crypto";
  return "none";
}

export const OUTFIT_LABEL: Record<Outfit, string> = {
  sports: "Sports jersey",
  health: "Stethoscope",
  crypto: "Coin badge",
  commodities: "Hard hat",
  weather: "Rain hat",
  politics: "Rosette",
  travel: "Backpack",
  finance: "Tie",
  none: "",
};

/** The mascot acts out the job's state; every motion has a cause. */
export function moodFor(status: string, needsYou: number): Mood {
  if (needsYou > 0) return "alert";
  if (status === "running" || status === "funding") return "working";
  if (status === "done") return "happy";
  if (status === "cancelled") return "sad";
  return "idle";
}
