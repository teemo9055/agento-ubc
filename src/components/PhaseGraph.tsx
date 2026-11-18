"use client";
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

const STATE_TEXT: Record<Tone, string> = { done: "Done", running: "Running", waiting: "Waiting", needs: "Needs you", failed: "Failed", skipped: "Skipped" };

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
  const tone = toneOf(p);
  const last = p.payments[p.payments.length - 1];
  const sub = p.error && (tone === "needs" || tone === "failed") ? p.error.message : p.note && tone !== "waiting" ? p.note : p.sub;
  const Box = onEdit ? "button" : "div";
  return (
    <Box
      type={onEdit ? "button" : undefined}
      onClick={onEdit}
      aria-pressed={onEdit ? Boolean(focused) : undefined}
      aria-label={onEdit ? `Step ${step}: ${p.label}. Edit in chat` : undefined}
      className={`node-in group absolute flex flex-col overflow-hidden rounded-xl px-3.5 pb-2.5 pt-3 text-left transition-[box-shadow,border-color,opacity,transform,background-color] duration-300 motion-reduce:transition-none ${FRAME[tone]} ${focused ? "!border-ink shadow-[3px_3px_0_0_var(--agent)]" : ""} ${
        onEdit && !focused ? "cursor-pointer hover:-translate-y-0.5 hover:border-ink" : ""
      } ${dim ? "opacity-55" : ""}`}
      style={{ left: x, top: y, width: NODE_W, height: NODE_H, animationDelay: `${(step - 1) * 60}ms` }}
      data-testid={`phase-${p.id}`}
      data-status={p.status}
      data-tone={tone}
    >
      <div className="flex items-start gap-2.5">
        <Mark tone={tone} step={step} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold leading-tight">{p.label}</div>
          <div className={`truncate text-[12px] leading-snug ${tone === "failed" || (tone === "needs" && p.error) ? "text-bad" : "text-ink-3"}`} title={sub}>
            {tone !== "waiting" && tone !== "running" ? <b className="font-semibold">{STATE_TEXT[tone]} · </b> : null}
            {sub && sub.toLowerCase() !== p.label.toLowerCase() ? sub : tone === "waiting" ? "Waiting its turn" : null}
          </div>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 text-[12px]">
        <span className="num truncate text-ink-3">{line ? (tone === "waiting" || tone === "skipped" ? `$${fmt(line.approved)}` : `$${fmt(line.actual)} of $${fmt(line.approved)}`) : "Free"}</span>
        {onEdit ? (
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${focused ? "bg-ink text-white" : "bg-[#f1f0ec] text-ink-2 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`} aria-hidden>
            <Icon name={focused ? "chat" : "edit"} size={11} /> {focused ? "In chat" : "Edit"}
          </span>
        ) : last?.txHash ? (
          <a href={txUrl(last.txHash)} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-0.5 text-ink-3 hover:text-ink" aria-label={`Payment record for ${p.label}`} title="Payment record on Arc">
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
          return { id: `${src}-${p.id}`, d: connector(pos[src], pos[p.id], vertical), state };
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
