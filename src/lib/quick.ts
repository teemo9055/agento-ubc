import type { AgentId, ChatMsg, Plan, Proposal, Run } from "./types";
import { adjustmentsFor, type AdjustKind } from "./adjust";

/**
 * The quick options above the chat box: the decisions a person most often makes next, one tap
 * each. The first is the likeliest. Each either says something to the agent or changes the plan
 * on the board directly. Approving a draft is the review card's button, not one of these.
 */
export type QuickDo = { say: string } | { act: "start-plan" | "stop-plan" | "review" } | { adjust: AdjustKind } | { add: { agent: AgentId | "auto"; brief: string } } | { fill: string };

export interface Quick {
  label: string;
  /** The likeliest next step, drawn filled. At most one. */
  primary?: boolean;
  /** Adds something to the work, drawn with a plus. */
  adds?: boolean;
  do: QuickDo;
}

const accept = (s: string) => /^(yes|yep|ok|set it up|build|do it|start)\b/i.test(s);
const decline = (s: string) => /^not now$/i.test(s);
const adds = (s: string) => /^(only if|check|add|also|include|who'?s)\b/i.test(s);
const say = (s: string): Quick => ({ label: s, adds: adds(s), do: { say: s } });
// The agent's own chips repeat what the instant changes already cover (a size, a price).
const sized = (s: string) => /^(make it|only \$?\d|sell only|ask \d|lower limit|raise|\d+ (more|fewer)|max \d+ hours|up to \d+ hours)/i.test(s);

/** Ways to perfect the move on screen: instant changes first, then one thing only the agent can add. */
function detail(p: Proposal, fromAgent: string[], max: number): Quick[] {
  const instant = adjustmentsFor(p).map((a): Quick => ({ label: a.label, do: { adjust: a.kind } }));
  const extra = fromAgent.filter((s) => !accept(s) && !decline(s) && !sized(s)).slice(0, 1).map(say);
  return [...instant.slice(0, extra.length ? max - 1 : max), ...extra];
}

/** Steps people add to a plan most often, offered only when the plan doesn't have one already. */
const BLOCKS: { label: string; agent: AgentId; brief: string; has: RegExp }[] = [
  { label: "Price check", agent: "trado", brief: "Read the Chainlink prices of BTC and ETH", has: /oracle_price/ },
  { label: "Gas check", agent: "trado", brief: "Check gas on Ethereum and Base", has: /gas_price/ },
];

export function quickFor(run: Pick<Run, "status" | "chat" | "proposal" | "thinking">, plan?: Plan): Quick[] {
  const chat: ChatMsg[] = run.chat ?? [];
  const last = chat[chat.length - 1];
  if (run.thinking) return [];

  if (run.status === "draft") {
    // Approving is the review card's own button; these perfect the details before it.
    const from = [...chat].reverse().find((m) => m.proposal && m.proposal.id === run.proposal?.id);
    return run.proposal ? detail(run.proposal, from?.suggestions ?? [], 4) : [];
  }
  if (run.status !== "exploring" || last?.role !== "agent") return [];
  // A question is answered with its own options, not with these.
  if (last.options?.length) return [];

  if (plan && plan.status === "proposed") {
    const tools = plan.steps.flatMap((s) => s.proposal.research.map((r) => r.tool)).join(" ");
    const room = plan.steps.length < 12;
    return [
      { label: `Start all ${plan.steps.length} steps`, primary: true, do: { act: "start-plan" } },
      ...(room ? BLOCKS.filter((b) => !b.has.test(tools)).map((b): Quick => ({ label: b.label, adds: true, do: { add: { agent: b.agent, brief: b.brief } } })) : []),
      ...(room ? [{ label: "Your own step", adds: true, do: { fill: "Add a step: " } } satisfies Quick] : []),
      ...(last.plan ? (last.suggestions ?? []).filter((s) => !accept(s) && !decline(s)).slice(0, 1).map(say) : []),
    ];
  }
  // While it runs, the one decision left is to stop it; steps already running finish.
  if (plan?.status === "running") return [{ label: "Stop the plan", do: { act: "stop-plan" } }];
  if (plan) return [];

  const rest = (last.suggestions ?? []).filter((s) => !accept(s) && !decline(s));
  // With a move on screen: the step forward first, then the ways to perfect it.
  if (last.proposal) return [{ label: "Review this", primary: true, do: { act: "review" } }, ...detail(last.proposal, last.suggestions ?? [], 3)];
  return rest.slice(0, 3).map((s, i) => ({ ...say(s), primary: i === 0 }));
}

/** "Add a step: check gas on Base" typed into the chat goes straight onto the board. */
export function stepFromText(text: string): string | null {
  const m = text.trim().match(/^\+?\s*add (?:a |another )?step\s*[:\-]?\s+(.{4,260})$/i);
  return m ? m[1].trim() : null;
}
