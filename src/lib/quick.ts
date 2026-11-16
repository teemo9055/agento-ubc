import type { AgentId, ChatMsg, Plan, Run } from "./types";

/**
 * The quick options above the chat box: the decisions a person most often makes next, one tap
 * each. The first is the likeliest. Each either says something to the agent, changes the plan
 * on the board directly, or presses the button for the stage the job is at.
 */
export type QuickDo = { say: string } | { act: "start-plan" | "stop-plan" | "approve" } | { add: { agent: AgentId | "auto"; brief: string } } | { fill: string };

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
    // The chips offered with the move that became this draft are still the likeliest changes.
    const from = [...chat].reverse().find((m) => m.proposal && m.proposal.id === run.proposal?.id);
    const tweaks = (from?.suggestions ?? []).filter((s) => !accept(s) && !decline(s)).slice(0, 3);
    return [{ label: "Approve and start", primary: true, do: { act: "approve" } }, ...tweaks.map(say)];
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
  // With a move on screen its own button is the next step; these are the ways to change it.
  if (last.proposal) return rest.slice(0, 4).map(say);
  return rest.slice(0, 3).map((s, i) => ({ ...say(s), primary: i === 0 }));
}

/** "Add a step: check gas on Base" typed into the chat goes straight onto the board. */
export function stepFromText(text: string): string | null {
  const m = text.trim().match(/^\+?\s*add (?:a |another )?step\s*[:\-]?\s+(.{4,260})$/i);
  return m ? m[1].trim() : null;
}
