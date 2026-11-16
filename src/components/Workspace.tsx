"use client";
import { Fragment, useState } from "react";
import type { Plan, Run } from "@/lib/types";
import { KINDS, blueprintOf, captionOf, kindOf, outline, type Block, type LaneKey, type WorkKind } from "@/lib/shape";
import { usdc } from "@/lib/move";
import { Assemble } from "./Assemble";
import { Icon } from "./Icon";
import { Spinner } from "./ui";

const STAGES = ["Shape it", "Review", "Run", "Done"] as const;

/** Where the job is on its way from an idea to a result. */
export function Stages({ run, plan }: { run: Run; plan?: Plan }) {
  // A plan runs as its own jobs while the conversation that made it stays open, so its progress is the plan's.
  const at = plan && plan.status !== "proposed" ? (plan.status === "running" ? 2 : 3) : run.status === "exploring" ? 0 : run.status === "draft" || run.status === "funding" ? 1 : run.status === "done" || run.status === "cancelled" ? 3 : 2;
  return (
    <ol className="flex items-center gap-1 text-[12px] font-medium" aria-label="Progress" data-testid="stages">
      {STAGES.map((s, i) => (
        <li key={s} className="flex items-center gap-1" aria-current={i === at ? "step" : undefined}>
          {i > 0 && <span className={`h-px w-3 ${i <= at ? "bg-ink" : "bg-line"}`} aria-hidden />}
          <span className={`inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 ${i === at ? "bg-ink text-white" : i < at ? "text-ink-2" : "text-ink-3"}`}>
            {i < at ? <Icon name="check" size={11} stroke={2.8} /> : <span className="num text-[11px] opacity-70">{i + 1}</span>}
            {s}
          </span>
        </li>
      ))}
    </ol>
  );
}

const LANE_DOT: Record<LaneKey, string> = { reads: "bg-ink-3", checks: "bg-warn", does: "bg-agent", gets: "bg-good" };

function BlockBox({ b, lane }: { b: Block; lane: LaneKey }) {
  const real = lane === "does" ? "border-ink bg-panel shadow-[3px_3px_0_0_var(--agent)]" : "border-ink/70 bg-panel";
  return (
    <div data-block data-ghost={b.ghost ? "" : undefined} className={`rounded-xl border-[1.5px] px-3 py-2.5 ${b.ghost ? "border-dashed border-line bg-transparent" : real}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-[13.5px] font-semibold leading-snug ${b.ghost ? "text-ink-3" : ""}`}>{b.label}</span>
        {b.cost != null && b.cost > 0 && <span className="num shrink-0 text-[12px] text-ink-2">${usdc(b.cost)}</span>}
      </div>
      {b.detail && <div className="mt-0.5 text-[12px] leading-snug text-ink-3">{b.detail}</div>}
    </div>
  );
}

const TABS: WorkKind[] = ["lookup", "order", "conditional", "hedge", "trip", "plan"];

/**
 * The left side while a job is taking shape: a drawing of the work, not a transcript of it.
 * Before the agent proposes anything it shows the outline of the kind of work being asked for;
 * once there is a move, the same outline filled in with the real steps, checks and costs.
 */
export function Workspace({ run, onExample }: { run: Run; onExample?: (text: string) => void }) {
  const chat = run.chat ?? [];
  const move = [...chat].reverse().find((m) => m.proposal)?.proposal;
  const [pick, setPick] = useState<WorkKind | null>(null);
  const guessed = kindOf(run.task);
  const bp = move ? blueprintOf(move) : outline(pick ?? guessed);
  const kind = KINDS[bp.kind];
  // What the agent has already read, so the sketch isn't empty while the talking happens.
  const found = [...new Map(chat.flatMap((m) => m.tools ?? []).filter((t) => t.ok).map((t) => [t.summary, t])).values()].slice(-5);

  return (
    <section className="rounded-2xl border border-line bg-panel" aria-label="Workspace" data-testid="workspace" data-kind={bp.kind} data-filled={move ? "" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f1f0ec] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            {move ? "Proposed" : "Sketch"}
            {run.thinking && (
              <span className="inline-flex items-center gap-1 normal-case tracking-normal text-agent-ink">
                <Spinner /> working on it
              </span>
            )}
          </div>
          <h2 className="mt-0.5 truncate text-[17px] font-semibold leading-tight" data-testid="workspace-title">
            {move ? move.title : kind.name}
          </h2>
        </div>
        <Stages run={run} />
      </div>

      {!move && (
        <div role="tablist" aria-label="Kind of work" className="flex flex-wrap gap-1 border-b border-[#f1f0ec] px-3 py-2">
          {TABS.map((k) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={bp.kind === k}
              onClick={() => setPick(k)}
              className={`pressable h-8 rounded-lg px-2.5 text-[12.5px] font-medium ${bp.kind === k ? "bg-ink text-white" : "text-ink-2 hover:bg-ink/5"}`}
              data-testid={`kind-${k}`}
            >
              {KINDS[k].name}
            </button>
          ))}
        </div>
      )}

      <div className="p-4">
        <Assemble play={move ? `move-${move.id}` : `outline-${bp.kind}`}>
          <div className="flex flex-col gap-3 md:flex-row md:items-stretch" data-testid="blueprint">
            {bp.lanes.map((l, i) => (
              <Fragment key={l.key}>
                {i > 0 && (
                  <div className="flex items-center justify-center text-ink-3" aria-hidden>
                    <Icon name="arrow" size={16} className="rotate-90 md:rotate-0" />
                  </div>
                )}
                <div className="min-w-0 flex-1" data-lane={l.key}>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                    <span className={`h-2 w-2 rounded-[2px] ${LANE_DOT[l.key]}`} aria-hidden /> {l.title}
                  </div>
                  <div className="space-y-2">
                    {l.blocks.map((b, j) => (
                      <BlockBox key={j} b={b} lane={l.key} />
                    ))}
                  </div>
                </div>
              </Fragment>
            ))}
          </div>
        </Assemble>

        {move ? (
          <div className="mt-4 border-t border-[#f1f0ec] pt-3">
            <p className="text-[13px] leading-snug text-ink-2">{captionOf(move)}</p>
            <p className="num mt-1.5 text-[12.5px] text-ink-3" data-testid="workspace-cost">
              Up to ${usdc(bp.costUsd ?? 0)} · nothing is spent until you approve
              {move.venue === "paper" && move.action && move.action.kind !== "itinerary" ? " · practice order" : ""}
            </p>
          </div>
        ) : (
          <div className="mt-4 border-t border-[#f1f0ec] pt-3">
            <p className="text-[13px] text-ink-2">{kind.line}. The outline fills in as you and the agent settle the details.</p>
            {onExample && (bp.kind !== guessed || chat.length <= 1) && (
              <button type="button" onClick={() => onExample(kind.example)} className="mt-2 inline-flex max-w-full items-center gap-1.5 text-left text-[12.5px] text-agent-ink underline decoration-agent/40 underline-offset-2" data-testid="workspace-example">
                <Icon name="chat" size={13} className="shrink-0" /> <span className="truncate">Try: “{kind.example}”</span>
              </button>
            )}
          </div>
        )}

        {found.length > 0 && (
          <div className="mt-4 rounded-xl bg-[#f7f6f2] px-3 py-2.5" data-testid="workspace-found">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Read so far</div>
            <ul className="mt-1 space-y-0.5 text-[12.5px] text-ink-2">
              {found.map((t) => (
                <li key={t.summary} className="flex gap-1.5">
                  <Icon name="check" size={12} stroke={2.4} className="mt-[3px] shrink-0 text-good" /> <span className="min-w-0">{t.summary}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
