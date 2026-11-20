import { z } from "zod";
import type { AgentId, Proposal } from "@/lib/types";
import { aiJson, FAST_MODEL, type AiUsage } from "./ai";
import { ComposedEditInput, isComposed, ProposalInput, RESEARCH, researchMenu, TOOLKIT, toComposedInput, toProposalInput, validateProposal } from "./tools";
import { providerDirectory, providersIn } from "./providers";
import { diffMoves, guardEdit, readersOf } from "./move-diff";
import { brokenLinks, explainBroken } from "./step-links";

const replyOf = <T extends z.ZodTypeAny>(move: T) =>
  z.object({
    understood: z.boolean().describe("false if the request can't be done by changing this move"),
    message: z.string().max(140).describe("One short line for the user: what changed, or why not"),
    alternatives: z.array(z.string().max(40)).max(3).describe("If not understood: 1-3 edits that would work, phrased as the user would type them"),
    move: move.nullable().describe("The full updated move, or null if nothing changes"),
  });
const Reply = replyOf(ProposalInput);
// A move whose steps pass answers to each other is edited with those links (ids, bind, when) visible.
const ComposedReply = replyOf(ComposedEditInput);

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
  const composed = isComposed(current);
  const shown = composed ? (({ givens, compose, tier, gaps, ...rest }) => (void compose, void tier, void gaps, { ...rest, ...(givens ? { givensTheUserGave: givens } : {}) }))(toComposedInput(current)) : toProposalInput(current);
  const r = await aiJson((composed ? ComposedReply : Reply) as typeof Reply, {
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
    user: `The user is editing ${target}.${readerNote(current, step)}\nCURRENT MOVE: ${JSON.stringify(shown)}\nEDIT (from the user): ${prompt}${named(prompt, agent)}`,
  });
  if (!r) return null;
  const { understood, message, alternatives } = r.value;
  if (!understood || !r.value.move) return { ok: false, message, alternatives: alternatives.length ? alternatives : undefined, usage: r.usage };
  // What the user gave and how the move was put together aren't the editor's to change.
  const move = composed ? { ...r.value.move, givens: current.givens, compose: current.compose, tier: current.tier, gaps: current.gaps } : r.value.move;
  const research = move.research as { id?: string }[];
  // A step left reading from one that was removed gets a plain reason, not a validator message.
  const early = composed && research.every((x) => x.id) ? brokenLinks(move as unknown as Proposal) : [];
  if (early.some((b) => b.why === "gone")) return { ok: false, ...explainBroken(early), usage: r.usage };
  const v = await validateProposal(agent, move, current.id, { composed });
  if ("error" in v) return { ok: false, message: v.error.slice(0, 160), alternatives: alternatives.length ? alternatives : undefined, usage: r.usage };
  // Only the part being edited may change (and the steps that use its answer); anything else the model touched is put back.
  const { move: guarded, undone } = guardEdit(current, v.proposal, step);
  // Every step that uses another's answer must still find it, or the job would stop halfway.
  const broken = brokenLinks(guarded);
  if (broken.length) return { ok: false, ...explainBroken(broken), usage: r.usage };
  let proposal = guarded;
  if (undone.length || JSON.stringify(guarded.research) !== JSON.stringify(v.proposal.research)) {
    const again = await validateProposal(agent, composed ? toComposedInput(guarded) : toProposalInput(guarded), current.id, { composed });
    if ("error" in again) return { ok: false, message: again.error.slice(0, 160), usage: r.usage };
    proposal = again.proposal;
  }
  const changes = diffMoves(current, proposal);
  if (!changes.length) return { ok: false, message: undone.length ? `That would change ${undone.join(" and ")}, which this step doesn't control. Ask in the chat.` : "Nothing to change.", alternatives: alternatives.length ? alternatives : undefined, usage: r.usage };
  proposal = { ...proposal, changes };
  return { ok: true, message: `${changes.join(" · ")}${undone.length ? ` (kept ${undone.join(" and ")} as is)` : ""}`, proposal, usage: r.usage };
}

/** Tells the model which steps use the edited one's answer, so it can keep them reading something real. */
function readerNote(current: Proposal, step?: string): string {
  if (!step) return "";
  const readers = readersOf(current.research, step).map((id) => current.research.find((r) => r.id === id)!);
  if (!readers.length) return "";
  return `\nSTEPS THAT USE ITS ANSWER: ${readers.map((r) => `${r.id} "${r.label}" reads ${JSON.stringify({ ...(r.bind ?? {}), ...(r.when ? { when: r.when.ref } : {}) })}`).join("; ")}. Keep their ids. If the edit changes what ${step} returns, update those steps so they read a field it still returns, or drop them if they no longer make sense. Change nothing else.`;
}
