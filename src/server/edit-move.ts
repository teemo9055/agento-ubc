import { z } from "zod";
import type { AgentId, Proposal } from "@/lib/types";
import { aiJson, FAST_MODEL, type AiUsage } from "./ai";
import { ProposalInput, RESEARCH, researchMenu, TOOLKIT, toProposalInput, validateProposal } from "./tools";
import { providerDirectory, providersIn } from "./providers";

const Reply = z.object({
  understood: z.boolean().describe("false if the request can't be done by changing this move"),
  message: z.string().max(140).describe("One short line for the user: what changed, or why not"),
  alternatives: z.array(z.string().max(40)).max(3).describe("If not understood: 1-3 edits that would work, phrased as the user would type them"),
  move: ProposalInput.nullable().describe("The full updated move, or null if nothing changes"),
});

/** A note on providers the user named, so the model can't confuse a data seller with a market. */
function named(prompt: string, agent: AgentId) {
  const ps = providersIn(prompt);
  if (!ps.length) return "";
  return `\nPROVIDERS NAMED: ${ps
    .map((p) => {
      const usable = (p.tools ?? []).filter((t) => TOOLKIT[agent].research.includes(t) && RESEARCH[t]);
      return `${p.name} sells ${p.sells}; ${p.payable === "now" ? (usable.length ? `usable now via ${usable.join(", ")}` : "usable now but not by this agent") : p.payable === "mainnet" ? "only payable with Arc mainnet USDC, not available on testnet yet" : "only payable on another network, not wired up yet"}`;
    })
    .join(" | ")}`;
}

const STEP: Record<string, string> = { check: "the price check (condition)", act: "the order/action itself" };

/**
 * Applies a plain-language edit ("make it 30 dollars", "only if BTC is above 64k", "drop the chart")
 * with the fast model, then runs the result through the same validator as a new move, so the
 * cheap model can never produce something unsafe or unpriced.
 */
export async function aiEditMove(agent: AgentId, current: Proposal, prompt: string, step?: string): Promise<{ ok: boolean; message: string; alternatives?: string[]; proposal?: Proposal; usage: AiUsage } | null> {
  const target = step ? (STEP[step] ?? `the paid lookup with id ${step} (research step ${current.research.findIndex((r) => r.id === step) + 1})`) : "any part of the move";
  const r = await aiJson(Reply, {
    name: "edit_move",
    model: FAST_MODEL,
    maxTokens: 1500,
    system: [
      "You edit a trading/travel move the user is about to approve. Apply exactly what the user asked, change nothing else, and return the full updated move.",
      "Amounts: '30 dollars', '$30', '30 bucks' all mean 30 USD. For a spot_order that's amountUsd. For a prediction_order, a dollar amount means: set budgetUsd to it and quantity = floor(amount / maxPrice). 'N contracts' sets quantity. Cents or % set maxPrice (0-1).",
      "Keep symbols, tickers and event names exactly as they are; never invent new ones. Keep `ask` and `title` consistent with the new numbers (update the cost and payout in `ask`).",
      "Vague requests get a sensible concrete value; say what you picked in `message`: 'a bit cheaper' = about 1-2% lower price (1-2¢ for contracts), 'smaller'/'bigger' = about half/double the size, 'safer' = smaller size and a lower limit.",
      "A different coin, contract or market can't be done here because it needs fresh prices: set understood=false, move=null, message 'Switching markets needs fresh prices, so ask me in the chat.' and alternatives = [the user's request phrased for the chat, e.g. 'Buy $30 of ETH instead'].",
      "Data and providers: you may add, swap or drop paid lookups (`research`) using ONLY this agent's tools listed below, with real symbols from the current move (for crypto lookups, a symbol like solusd). A lookup can back a condition (e.g. oracle_price for metric oracle_price).",
      "If the user names a provider, use the directory below. If its data is one of this agent's tools, apply it. If it sells something else, or can't be paid yet (mainnet only / another network), set understood=false and say in one line what it actually sells and why it can't be used here; then offer the closest edits that DO work, using this agent's tools (e.g. 'Add a Chainlink SOL check', 'Add hourly SOL candles').",
      "A provider is never a market or an exchange: never suggest 'buy on <provider>'.",
      "Anything else the move can't express: understood=false, move=null, and 1-3 alternatives that would work on this move, using real numbers from it.",
      `THIS AGENT'S PAID LOOKUPS:\n${researchMenu(agent)}`,
      `PROVIDER DIRECTORY:\n${providerDirectory()}`,
    ].join("\n"),
    user: `The user is editing ${target}.\nCURRENT MOVE: ${JSON.stringify(toProposalInput(current))}\nEDIT (from the user): ${prompt}${named(prompt, agent)}`,
  });
  if (!r) return null;
  const { understood, message, alternatives, move } = r.value;
  if (!understood || !move) return { ok: false, message, alternatives: alternatives.length ? alternatives : undefined, usage: r.usage };
  const v = await validateProposal(agent, move, current.id);
  if ("error" in v) return { ok: false, message: v.error.slice(0, 160), alternatives: alternatives.length ? alternatives : undefined, usage: r.usage };
  return { ok: true, message, proposal: v.proposal, usage: r.usage };
}
