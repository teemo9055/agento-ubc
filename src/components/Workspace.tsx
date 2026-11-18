"use client";
import { Fragment, useState } from "react";
import type { Plan, Proposal, Run } from "@/lib/types";
import { KINDS, blueprintOf, kindOf, outline, type Block, type Blueprint, type LaneKey } from "@/lib/shape";
import { usdc } from "@/lib/move";
import { sizeOf, type AdjustKind } from "@/lib/adjust";
import { Assemble } from "./Assemble";
import { Icon } from "./Icon";
import { Spinner } from "./ui";
import { LiveMarket } from "./Live";
import { PriceSketch, TripSketch } from "./Sketches";
import { BriefCard, briefOf } from "./BriefCard";
import { CoverSheet, TradeBoard, TripSheet, tripParts } from "./AgentSheets";

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

/** Less and more, right on the thing they change. */
function Stepper({ onAdjust, busy, canLess, canMore }: { onAdjust: (k: AdjustKind) => void; busy: boolean; canLess: boolean; canMore: boolean }) {
  const btn = "pressable inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel text-[16px] font-semibold leading-none text-ink hover:border-ink/50 disabled:opacity-40";
  return (
    <div className="flex items-center gap-1.5 [[data-block]_&]:mt-2" data-testid="stepper">
      <button type="button" className={btn} disabled={busy || !canLess} onClick={() => onAdjust("less")} aria-label="Less" data-testid="step-less">
        −
      </button>
      <button type="button" className={btn} disabled={busy || !canMore} onClick={() => onAdjust("more")} aria-label="More" data-testid="step-more">
        +
      </button>
      {busy && (
        <span className="ml-1 text-agent-ink">
          <Spinner />
        </span>
      )}
    </div>
  );
}

function BlockBox({ b, lane, children }: { b: Block; lane: LaneKey; children?: React.ReactNode }) {
  const real = lane === "does" ? "border-ink bg-panel shadow-[3px_3px_0_0_var(--agent)]" : "border-ink/70 bg-panel";
  return (
    <div data-block data-ghost={b.ghost ? "" : undefined} className={`rounded-xl border-[1.5px] px-3 py-2.5 ${b.ghost ? "border-dashed border-line bg-transparent" : real}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-[13.5px] font-semibold leading-snug ${b.ghost ? "text-ink-3" : ""}`}>{b.label}</span>
        {b.cost != null && b.cost > 0 && <span className="num shrink-0 text-[12px] text-ink-2">${usdc(b.cost)}</span>}
      </div>
      {b.detail && <div className="mt-0.5 text-[12px] leading-snug text-ink-3">{b.detail}</div>}
      {children}
    </div>
  );
}

/**
 * The drawing of one job: what it reads, what must be true, what it does and what you get.
 * The same drawing is used for a job on its own and for a step opened on the plan board.
 */
export function BlueprintView({ bp, extra }: { bp: Blueprint; extra?: (lane: LaneKey, index: number) => React.ReactNode }) {
  return (
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
                <BlockBox key={j} b={b} lane={l.key}>
                  {extra?.(l.key, j)}
                </BlockBox>
              ))}
            </div>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/** What the agent that owns this kind of move shows beside it: a price chart, the trip's days, or the live market. */
export function AgentView({ p }: { p: Proposal }) {
  const a = p.action;
  if (a?.kind === "spot_order") return <PriceSketch action={a} />;
  if (a?.kind === "itinerary") return <TripSketch action={a} />;
  if (a?.kind === "prediction_order" && a.trade !== "sell") return <LiveMarket action={a} hedge={p.hedge} venue={p.venue} />;
  return null;
}

/**
 * The left side while a job is taking shape. Every agent gets the same layout: its live instrument
 * for the move on top (Inso: the market and the line; Trado: the price with your limit; Travo: the
 * route and days), then the drawing of what it reads, checks, does and what you get, then the cost.
 * Before there is a move it shows the outline of the work being asked for.
 */
export function Workspace({ run, onExample, onAdjust }: { run: Run; onExample?: (text: string) => void; /** Applies a quick change to the move; resolves when the new numbers are in. */ onAdjust?: (kind: AdjustKind) => Promise<unknown> }) {
  const [stepping, setStepping] = useState(false);
  const chat = run.chat ?? [];
  const move = [...chat].reverse().find((m) => m.proposal)?.proposal;
  const guessed = kindOf(run.task);
  const bp = move ? blueprintOf(move) : outline(guessed);
  const kind = KINDS[bp.kind];
  const b = briefOf(run);
  const size = move ? sizeOf(move) : undefined;
  const said = [run.task, ...chat.filter((m) => m.role === "user").map((m) => m.text)].join(" ");
  // An agent's own sheet already says what the move does and gets, so the drawing keeps only what it looks up first.
  const sheet =
    Boolean(move) &&
    (run.agent === "trado" ||
      (run.agent === "inso" && move?.action?.kind === "prediction_order" && move.action.trade !== "sell") ||
      (run.agent === "travo" && (move?.action?.kind === "itinerary" || Object.values(tripParts(said)).some(Boolean))));
  const lanes = sheet ? { ...bp, lanes: bp.lanes.filter((l) => l.key === "reads" || l.key === "checks") } : bp;
  const stepper =
    move && onAdjust && size && !run.thinking ? (
      <Stepper
        busy={stepping}
        canLess={size.down != null}
        canMore={size.up > size.now}
        onAdjust={(k) => {
          setStepping(true);
          void onAdjust(k).finally(() => setStepping(false));
        }}
      />
    ) : null;

  return (
    <div className="space-y-4">
      {b && <BriefCard {...b} />}
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

        <div className="space-y-4 p-4">
          {/* Each agent's own view of the work: Inso the cover, Trado the trading board, Travo the trip. */}
          {run.agent === "inso" && move && <CoverSheet p={move} />}
          {run.agent === "trado" && <TradeBoard p={move} />}
          {run.agent === "travo" && <TripSheet p={move} task={said} />}
          {sheet && stepper && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-2" data-testid="size-row">
              <span className="text-[13px] text-ink-2">{size?.unit === "hours" ? "Hours of driving a day" : size?.unit === "cover" ? "How much to cover" : "Size of the order"}</span>
              {stepper}
            </div>
          )}
          {/* Trado's board says it all; its chart added little while shaping. */}
          {move && run.agent !== "trado" && (
            <div className="empty:hidden" data-testid="instrument">
              <AgentView p={move} />
            </div>
          )}

          {lanes.lanes.length > 0 && (
            <Assemble play={move ? `move-${move.id}` : `outline-${bp.kind}`}>
              <BlueprintView bp={lanes} extra={(l, j) => (!sheet && l === "does" && j === 0 ? stepper : null)} />
            </Assemble>
          )}

          {move ? (
            <p className="num border-t border-[#f1f0ec] pt-3 text-[12.5px] text-ink-3" data-testid="workspace-cost">
              Up to ${usdc(bp.costUsd ?? 0)}
              {move.venue === "paper" && move.action && move.action.kind !== "itinerary" ? " · practice order" : ""}
            </p>
          ) : (
            <div className="border-t border-[#f1f0ec] pt-3">
              <p className="text-[13px] text-ink-2">{kind.line}. The outline fills in as you and the agent settle the details.</p>
              {onExample && chat.length <= 1 && (
                <button type="button" onClick={() => onExample(kind.example)} className="mt-2 inline-flex max-w-full items-center gap-1.5 text-left text-[12.5px] text-agent-ink underline decoration-agent/40 underline-offset-2" data-testid="workspace-example">
                  <Icon name="chat" size={13} className="shrink-0" /> <span className="truncate">Try: “{kind.example}”</span>
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
