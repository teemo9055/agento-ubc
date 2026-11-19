"use client";
import { useNet } from "./NetContext";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "@/lib/money";
import type { CostLine, Phase } from "@/lib/types";
import { txUrl } from "@/lib/format";
import { Icon } from "./Icon";

/**
 * The job drawn as a graph of its steps: laid out on a grid by what waits on what, so rows and
 * columns line up, nodes are one size and connectors meet node edges cleanly. A connector into a
 * running step marches; a finished one is solid; one still waiting is faint and dashed.
 */
const NODE_W = 196;
const NODE_H = 88;
const GAP_X = 56;
const GAP_Y = 22;
const GAP_V = 40;

type Tone = "done" | "running" | "waiting" | "needs" | "failed" | "skipped";

const toneOf = (p: Phase): Tone =>
  p.status === "done"
    ? "done"
    : p.status === "active"
      ? "running"
      : p.status === "awaiting_reapproval" || p.status === "failed_waiting"
        ? "needs"
        : p.status === "failed"
          ? "failed"
          : p.status === "skipped"
            ? "skipped"
            : "waiting";

const FRAME: Record<Tone, string> = {
  done: "border-[1.5px] border-good bg-good/[0.06]",
  running: "border-[1.5px] border-ink bg-panel shadow-[3px_3px_0_0_var(--agent)]",
  waiting: "border-[1.5px] border-dashed border-[#cfcec8] bg-panel",
  needs: "border-[1.5px] border-ink bg-warn/15 shadow-[3px_3px_0_0_var(--color-warn)]",
  failed: "border-[1.5px] border-bad bg-bad/[0.06]",
  skipped: "border border-dashed border-line bg-panel opacity-55",
};

/** A step you finish yourself looks different: a dashed, warm card, so it's clear the agent stops there. */
const YOURS = { open: "border-[1.5px] border-dashed border-ink/45 bg-[#fbf7ee]", done: "border-[1.5px] border-dashed border-ink bg-[#fbf7ee] shadow-[3px_3px_0_0_var(--agent)]" };

const STATE_TEXT: Record<Tone, string> = { done: "Done", running: "Running", waiting: "Waiting", needs: "Needs you", failed: "Failed", skipped: "Skipped" };

/** A tie-breaker waits grey and dashed until its sources disagree; a gap is hatched and never runs. */
const TIE_WAITING = "border-[1.5px] border-dashed border-ink/25 bg-[#f6f5f1]";
const GAP = "border-[1.5px] border-dashed border-ink/30 bg-[repeating-linear-gradient(135deg,#f6f5f1_0_6px,#efeee8_6px_12px)]";

const FINDING: Record<NonNullable<Phase["finding"]>["tone"], string> = {
  good: "bg-good/10 text-good",
  warn: "bg-warn/20 text-warn-ink",
  bad: "bg-bad/10 text-bad",
  neutral: "bg-[#f1f0ec] text-ink-2",
};
const FINDING_WORD: Record<NonNullable<Phase["finding"]>["tone"], string> = { good: "reassuring", warn: "warning", bad: "red flag", neutral: "no signal" };

function Mark({ tone, step }: { tone: Tone; step: number }) {
  const base = "inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] text-[11px] font-semibold";
  if (tone === "done")
    return (
      <span className={`${base} bg-good text-white`}>
        <Icon name="check" size={13} stroke={3} />
      </span>
    );
  if (tone === "running")
    return (
      <span className={`${base} border-[1.5px] border-ink bg-agent`}>
        <span className="mascot-spark h-1.5 w-1.5 bg-white" />
      </span>
    );
  if (tone === "needs") return <span className={`${base} border-[1.5px] border-ink bg-warn font-pixel text-ink`}>!</span>;
  if (tone === "failed") return <span className={`${base} bg-bad font-pixel text-white`}>!</span>;
  if (tone === "skipped") return <span className={`${base} border border-dashed border-ink-3 text-ink-3`}>–</span>;
  return <span className={`${base} num border-[1.5px] border-[#d5d4ce] text-ink-3`}>{step}</span>;
}

function Node({ p, line, step, simulated, onEdit, focused, dim, x, y }: { p: Phase; line?: CostLine; step: number; simulated: boolean; onEdit?: () => void; focused?: boolean; dim?: boolean; x: number; y: number }) {
  const net = useNet();
  const tone = toneOf(p);
  const last = p.payments[p.payments.length - 1];
  const tieWaiting = Boolean(p.tieBreaker) && tone === "waiting";
  const sub = p.gap
    ? p.gap.why
    : p.error && (tone === "needs" || tone === "failed")
      ? p.error.message
      : p.note && tone !== "waiting"
        ? p.note
        : tieWaiting
          ? "Only if sources disagree"
          : p.conditional && tone === "waiting"
            ? `Only if ${p.conditional}`
            : p.sub;
  const Box = onEdit ? "button" : "div";
  const frame = p.gap ? GAP : p.finish && tone !== "skipped" ? YOURS[tone === "done" ? "done" : "open"] : tieWaiting ? TIE_WAITING : FRAME[tone];
  const red = p.finding?.tone === "bad" && tone === "done";
  const label = [`Step ${step}: ${p.label}`, p.gap ? "no service found for this" : STATE_TEXT[tone].toLowerCase(), p.finding ? `${FINDING_WORD[p.finding.tone]}: ${p.finding.text}` : null].filter(Boolean).join(", ");
  return (
    <Box
      type={onEdit ? "button" : undefined}
      onClick={onEdit}
      aria-pressed={onEdit ? Boolean(focused) : undefined}
      aria-label={onEdit ? `${label}. Edit in chat` : label}
      className={`node-in group absolute flex flex-col overflow-hidden rounded-xl px-3.5 pb-2.5 pt-3 text-left transition-[box-shadow,border-color,opacity,transform,background-color] duration-300 motion-reduce:transition-none ${frame} ${red ? "!shadow-[3px_3px_0_0_var(--color-bad)]" : ""} ${focused ? "!border-ink shadow-[3px_3px_0_0_var(--agent)]" : ""} ${
        onEdit && !focused ? "cursor-pointer hover:-translate-y-0.5 hover:border-ink" : ""
      } ${dim ? "opacity-55" : ""}`}
      style={{ left: x, top: y, width: NODE_W, height: NODE_H, animationDelay: `${(step - 1) * 60}ms` }}
      data-testid={`phase-${p.id}`}
      data-status={p.status}
      data-tone={tone}
      data-finding-tone={p.finding?.tone}
      data-gap={p.gap ? "true" : undefined}
      data-tiebreaker={p.tieBreaker ? "true" : undefined}
    >
      <div className="flex items-start gap-2.5">
        {p.gap ? <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border border-dashed border-ink/40 text-[12px] text-ink-3">?</span> : <Mark tone={tone} step={step} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {p.conditional && <span aria-hidden title={`Only if ${p.conditional}`} className="inline-block h-2 w-2 shrink-0 rotate-45 border-[1.5px] border-ink bg-panel" data-testid={`when-${p.id}`} />}
            <span className="truncate text-[13.5px] font-semibold leading-tight">{p.label}</span>
            {p.conflict && (
              <span
                title={p.conflict.note}
                className={`ml-auto shrink-0 rounded-[4px] px-1 text-[11px] font-bold leading-[16px] ${p.conflict.agree ? "bg-good/15 text-good" : "bg-bad text-white"}`}
                data-testid={`conflict-${p.id}`}
                data-agree={p.conflict.agree ? "true" : "false"}
              >
                {p.conflict.agree ? "=" : "≠"}
              </span>
            )}
          </div>
          {p.finding && tone === "done" ? (
            <span key={p.finding.text} title={p.finding.text} className={`finding-in mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-[1px] text-[11.5px] font-medium ${FINDING[p.finding.tone]}`} data-testid={`finding-${p.id}`}>
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
              <span className="truncate">{p.finding.text}</span>
            </span>
          ) : (
            <div className={`truncate text-[12px] leading-snug ${tone === "failed" || (tone === "needs" && p.error) ? "text-bad" : "text-ink-3"}`} title={sub}>
              {!p.gap && tone !== "waiting" && tone !== "running" ? <b className="font-semibold">{STATE_TEXT[tone]} · </b> : null}
              {p.gap ? <b className="font-semibold text-ink-2">No service found for this · </b> : null}
              {sub && sub.toLowerCase() !== p.label.toLowerCase() ? sub : tone === "waiting" ? "Waiting its turn" : null}
            </div>
          )}
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 text-[12px]">
        <span className="num truncate text-ink-3" data-kind={p.finish ? "yours" : line ? "pays" : "free"}>
          {p.gap ? (
            "Not priced"
          ) : p.finish ? (
            <span className="font-semibold text-ink-2">You finish it</span>
          ) : line ? (
            tone === "waiting" || tone === "skipped" ? `${tieWaiting || p.conditional ? "Up to" : "Agento pays"} $${fmt(line.approved === "0" && line.calls ? line.calls.unitPrice : line.approved)}` : `$${fmt(line.actual)} of $${fmt(line.approved)}`
          ) : (
            "Free"
          )}
        </span>
        {p.finish && tone === "done" ? (
          <a href={p.finish.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-semibold text-white hover:bg-ink/85" data-testid={`finish-${p.id}`}>
            Open {p.finish.app} <Icon name="external" size={11} />
          </a>
        ) : onEdit ? (
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${focused ? "bg-ink text-white" : "bg-[#f1f0ec] text-ink-2 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`} aria-hidden>
            <Icon name={focused ? "chat" : "edit"} size={11} /> {focused ? "In chat" : "Edit"}
          </span>
        ) : last?.txHash ? (
          <a href={txUrl(last.txHash, net)} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-0.5 text-ink-3 hover:text-ink" aria-label={`Payment record for ${p.label}`} title="Payment record on Arc">
            receipt <Icon name="external" size={11} />
          </a>
        ) : last?.txState === "settled" && simulated ? (
          <span className="shrink-0 text-ink-3">practice</span>
        ) : null}
      </div>
      {tone === "running" && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-agent-soft">
          <div className="h-full bg-agent transition-[width] duration-500" style={{ width: `${Math.max(6, Math.round((p.progress ?? 0) * 100))}%` }} />
        </div>
      )}
    </Box>
  );
}

/** Width of the box the graph sits in. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Column of each step: one more than the deepest step it waits on. */
export function depthOf(phases: Phase[]): Record<string, number> {
  const depth: Record<string, number> = {};
  const d = (p: Phase, seen: Set<string>): number => {
    if (depth[p.id] != null) return depth[p.id];
    if (seen.has(p.id)) return 0;
    seen.add(p.id);
    const deps = p.dependsOn.map((x) => phases.find((q) => q.id === x)).filter((q): q is Phase => Boolean(q));
    return (depth[p.id] = deps.length ? 1 + Math.max(...deps.map((q) => d(q, seen))) : 0);
  };
  phases.forEach((p) => d(p, new Set()));
  return depth;
}

/** A connector with rounded elbows that leaves the side of one node and enters the side of the next. */
function connector(a: { x: number; y: number }, b: { x: number; y: number }, vertical: boolean) {
  const r = 10;
  if (vertical) {
    const x1 = a.x + NODE_W / 2;
    const y1 = a.y + NODE_H;
    const x2 = b.x + NODE_W / 2;
    const y2 = b.y;
    if (Math.abs(x1 - x2) < 1) return `M${x1},${y1} V${y2}`;
    const mid = (y1 + y2) / 2;
    const s = x2 > x1 ? 1 : -1;
    return `M${x1},${y1} V${mid - r} Q${x1},${mid} ${x1 + s * r},${mid} H${x2 - s * r} Q${x2},${mid} ${x2},${mid + r} V${y2}`;
  }
  const x1 = a.x + NODE_W;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x;
  const y2 = b.y + NODE_H / 2;
  if (Math.abs(y1 - y2) < 1) return `M${x1},${y1} H${x2}`;
  const mid = (x1 + x2) / 2;
  const s = y2 > y1 ? 1 : -1;
  return `M${x1},${y1} H${mid - r} Q${mid},${y1} ${mid},${y1 + s * r} V${y2 - s * r} Q${mid},${y2} ${mid + r},${y2} H${x2}`;
}

export function PhaseGraph({
  phases,
  lines,
  simulated,
  editable,
  focusedId,
  onEditStep,
}: {
  phases: Phase[];
  lines: CostLine[];
  simulated: boolean;
  /** Step ids that can be edited (draft only). */
  editable?: string[];
  focusedId?: string | null;
  onEditStep?: (id: string) => void;
}) {
  const [box, width] = useWidth();
  const { pos, w, h, vertical, edges } = useMemo(() => {
    const depth = depthOf(phases);
    const cols: string[][] = [];
    phases.forEach((p) => (cols[depth[p.id]] ??= []).push(p.id));
    const nCols = cols.length;
    const maxRows = Math.max(1, ...cols.map((c) => c?.length ?? 0));
    const wideW = nCols * NODE_W + (nCols - 1) * GAP_X;
    // Left to right when it fits (it reads like a timeline); top to bottom on narrow screens.
    const vertical = width > 0 && wideW > width;
    const pos: Record<string, { x: number; y: number }> = {};
    cols.forEach((ids, c) =>
      (ids ?? []).forEach((id, r) => {
        // Each column is centred on the tallest one, so a single step sits level with a pair beside it.
        const off = (maxRows - ids.length) / 2;
        pos[id] = vertical ? { x: (r + off) * (NODE_W + GAP_Y), y: c * (NODE_H + GAP_V) } : { x: c * (NODE_W + GAP_X), y: (r + off) * (NODE_H + GAP_Y) };
      }),
    );
    const w = vertical ? maxRows * NODE_W + (maxRows - 1) * GAP_Y : wideW;
    const h = vertical ? nCols * NODE_H + (nCols - 1) * GAP_V : maxRows * NODE_H + (maxRows - 1) * GAP_Y;
    const edges = phases.flatMap((p) =>
      p.dependsOn
        .filter((src) => pos[src])
        .map((src) => {
          const from = phases.find((x) => x.id === src)!;
          const into = toneOf(p);
          const state = into === "running" ? "running" : from.status === "done" || from.status === "skipped" ? "done" : "waiting";
          // An edge that carries data is labelled with what flows along it ("phone →").
          const fields = (p.binds ?? []).filter((b) => b.from === src).map((b) => b.field);
          const preview = (p.inputs ?? []).find((i) => i.from === src)?.preview;
          const a = pos[src];
          const b = pos[p.id];
          const mid = vertical ? { x: (a.x + b.x) / 2 + NODE_W / 2, y: a.y + NODE_H + (b.y - a.y - NODE_H) / 2 } : { x: a.x + NODE_W + (b.x - a.x - NODE_W) / 2, y: (a.y + b.y) / 2 + NODE_H / 2 };
          return { id: `${src}-${p.id}`, d: connector(a, b, vertical), state, label: fields.length ? fields.join(", ").replace(/_/g, " ") : null, preview, mid, target: p.id };
        }),
    );
    return { pos, w, h, vertical, edges };
  }, [phases, width]);

  // Narrow screens scale the vertical layout down a little rather than scrolling sideways.
  const scale = vertical && width > 0 && w > width ? Math.max(0.7, width / w) : 1;

  return (
    <div ref={box} className="w-full" aria-label="Steps of this job" data-testid="phase-graph" data-layout={vertical ? "vertical" : "horizontal"}>
      <div className="mx-auto" style={{ width: w * scale, height: h * scale }}>
        <div className="relative origin-top-left" style={{ width: w, height: h, transform: scale !== 1 ? `scale(${scale})` : undefined }}>
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={w} height={h} aria-hidden>
            {edges.map((e) => (
              <path
                key={e.id}
                d={e.d}
                fill="none"
                strokeLinecap="round"
                className={e.state === "running" ? "edge-march" : undefined}
                style={{
                  stroke: e.state === "done" ? "var(--color-ink)" : e.state === "running" ? "var(--agent)" : "#cfcec8",
                  strokeWidth: e.state === "waiting" ? 1.5 : 2,
                  strokeDasharray: e.state === "done" ? undefined : e.state === "running" ? "6 5" : "3 5",
                  transition: "stroke 400ms",
                }}
              />
            ))}
          </svg>
          {edges
            .filter((e) => e.label)
            .map((e) => (
              <span
                key={`l-${e.id}`}
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-line bg-white px-1.5 py-[1px] text-[11px] font-medium text-ink-2 shadow-[1px_1px_0_0_rgba(0,0,0,0.08)]"
                style={{ left: e.mid.x, top: e.mid.y }}
                title={e.preview ? `${e.label}: ${e.preview}` : e.label!}
                data-testid={`edge-label-${e.id}`}
              >
                {e.label} →{e.preview ? <span className="ml-1 text-ink-3">{e.preview}</span> : null}
              </span>
            ))}
          {phases.map((p, i) => (
            <Node
              key={p.id}
              p={p}
              line={lines.find((l) => l.id === p.lineId)}
              step={i + 1}
              simulated={simulated}
              onEdit={editable?.includes(p.id) && onEditStep ? () => onEditStep(p.id) : undefined}
              focused={focusedId === p.id}
              dim={Boolean(focusedId) && focusedId !== p.id}
              x={pos[p.id]?.x ?? 0}
              y={pos[p.id]?.y ?? 0}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
