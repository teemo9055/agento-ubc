"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "@/lib/money";
import type { CostLine, Phase, Run } from "@/lib/types";
import { Node, toneOf } from "./graph/Node";
import { connector, depthOf, gridLayout, laneLayout, GAP_X, NODE_H, NODE_W, LANE_LABEL_W, VERDICT_H, VERDICT_W, type Layout, type Pt } from "./graph/layout";
import { VaultNode, VAULT_H, VAULT_W, spendOf } from "./graph/VaultNode";
import { VerdictNode } from "./graph/VerdictNode";

export { depthOf };

/**
 * The job drawn as a graph of its steps: laid out on a grid by what waits on what, so rows and
 * columns line up, nodes are one size and connectors meet node edges cleanly. A connector into a
 * running step marches; a finished one is solid; one still waiting is faint and dashed.
 *
 * With the job itself (`run`), it also tells the story: the vault on the left with money flowing
 * to each paid step, labelled edges carrying data between steps, what each step found, and for a
 * composed job, one lane per question ending in a verdict.
 */

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const canPath = () => typeof CSS !== "undefined" && CSS.supports?.("offset-path", 'path("M0,0 L1,1")');

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

/** A value moving along an edge when the step it feeds starts: a small square with what it carries. */
function Packet({ d, preview }: { d: string; preview?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced() || !canPath()) return setGone(true);
    const a = el.animate([{ offsetDistance: "0%" }, { offsetDistance: "100%" }], { duration: 700, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
    a.onfinish = () => setGone(true);
    return () => a.cancel();
  }, []);
  if (gone) return null;
  return (
    <div ref={ref} className="pointer-events-none absolute left-0 top-0 z-20 flex items-center gap-1" style={{ offsetPath: `path("${d}")`, offsetRotate: "0deg" } as React.CSSProperties} data-testid="packet" aria-hidden>
      <span className="h-1.5 w-1.5 bg-agent" />
      {preview && <span className="rounded-full border border-line bg-white px-1 text-[10px] text-ink-2">{preview}</span>}
    </div>
  );
}

/** A coin flying from the vault to the step it just paid. */
function Coin({ from, to }: { from: Pt; to: Pt }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return setGone(true);
    const a = el.animate([{ transform: `translate(${from.x}px, ${from.y}px)`, opacity: 1 }, { transform: `translate(${to.x}px, ${to.y}px)`, opacity: 0.9 }], { duration: 500, easing: "ease-in-out", fill: "forwards" });
    a.onfinish = () => setGone(true);
    return () => a.cancel();
  }, [from, to]);
  if (gone) return null;
  return (
    <span ref={ref} className="pointer-events-none absolute left-0 top-0 z-30 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#2775ca] text-[8px] font-bold text-white" data-testid="coin" aria-hidden>
      $
    </span>
  );
}

const IMPORTANCE: Record<string, string> = { must: "font-semibold text-ink", should: "text-ink-2", nice: "text-ink-3" };

export function PhaseGraph({
  phases: all,
  lines,
  simulated,
  editable,
  focusedId,
  onEditStep,
  run,
  draft,
  onGap,
}: {
  phases: Phase[];
  lines: CostLine[];
  simulated: boolean;
  /** Step ids that can be edited (draft only). */
  editable?: string[];
  focusedId?: string | null;
  onEditStep?: (id: string) => void;
  /** The whole job: adds the vault, money flow, lanes and the verdict. */
  run?: Run;
  /** Before approval: amounts are "at most", nothing moves. */
  draft?: boolean;
  onGap?: (fact: string, action: "another" | "skip") => void;
}) {
  const [box, width] = useWidth();
  const lanes = run?.lanes?.length ? run.lanes : undefined;
  // In lanes, the Verdict node is where the findings meet, so the "write it up" step isn't drawn again.
  const phases = useMemo(() => (lanes ? all.filter((p) => p.id !== "check") : all), [all, lanes]);
  const layout: Layout = useMemo(() => {
    const grid = gridLayout(phases, width);
    // Lanes scroll sideways when they don't fit; only a phone-sized box gets the plain grid instead.
    if (!lanes || (width > 0 && width < 560)) return grid;
    return laneLayout(phases, lanes);
  }, [phases, width, lanes]);
  const showVault = Boolean(run) && !layout.vertical && lines.some((l) => l.rail !== "exchange");
  // Everything shifts right to make room for the vault on the far left.
  const offX = showVault ? VAULT_W + GAP_X : 0;
  const vaultAt: Pt = { x: 0, y: Math.max(0, layout.h / 2 - VAULT_H / 2) };
  const at = (id: string): Pt => ({ x: (layout.pos[id]?.x ?? 0) + offX, y: layout.pos[id]?.y ?? 0 });

  const edges = phases.flatMap((p) =>
    p.dependsOn
      .filter((src) => layout.pos[src])
      .map((src) => {
        const from = phases.find((x) => x.id === src)!;
        const into = toneOf(p);
        const state = into === "running" ? "running" : from.status === "done" || from.status === "skipped" ? "done" : "waiting";
        // An edge that carries data is labelled with what flows along it ("phone →").
        const fields = (p.binds ?? []).filter((b) => b.from === src).map((b) => b.field);
        const preview = (p.inputs ?? []).find((i) => i.from === src)?.preview;
        const a = at(src);
        const b = at(p.id);
        const mid = layout.vertical ? { x: (a.x + b.x) / 2 + NODE_W / 2, y: a.y + NODE_H + (b.y - a.y - NODE_H) / 2 } : { x: a.x + NODE_W + (b.x - a.x - NODE_W) / 2, y: (a.y + b.y) / 2 + NODE_H / 2 };
        return { id: `${src}-${p.id}`, d: connector(a, b, layout.vertical), state, label: fields.length ? fields.join(", ").replace(/_/g, " ") : null, preview, mid, target: p };
      }),
  );
  const verdictAt = layout.verdict ? { x: layout.verdict.x + offX, y: layout.verdict.y } : null;
  const toVerdict =
    verdictAt && layout.laneEnds
      ? layout.laneEnds.map((id) => {
          const p = phases.find((x) => x.id === id)!;
          return { id: `${id}-verdict`, d: connector(at(id), verdictAt, false, { w: NODE_W, h: NODE_H }, { w: VERDICT_W, h: VERDICT_H }), state: p.status === "done" || p.status === "skipped" ? "done" : "waiting" };
        })
      : [];
  const paidSteps = showVault ? phases.filter((p) => p.lineId && lines.find((l) => l.id === p.lineId && l.rail !== "exchange")) : [];
  const w = layout.w + offX;
  const h = Math.max(layout.h, showVault ? VAULT_H : 0);
  const scale = layout.vertical && width > 0 && w > width ? Math.max(0.7, width / w) : 1;
  const scrolls = !layout.vertical && width > 0 && w > width;
  const spend = run ? spendOf(run) : null;
  const animate = phases.length <= 20;
  const now = Date.now();
  const finished = run && (run.status === "done" || run.status === "cancelled");

  return (
    <div ref={box} className="w-full" aria-label="Steps of this job" data-testid="phase-graph" data-layout={layout.vertical ? "vertical" : layout.bands ? "lanes" : "horizontal"}>
      {run && spend && (
        <p className="num mb-3 text-[12.5px] text-ink-2" data-testid="graph-spend" aria-live="polite">
          {draft
            ? `At most $${fmt(lines.filter((l) => l.rail !== "exchange").reduce((a, l) => a + BigInt(l.approved), 0n).toString())} · nothing is spent until you approve`
            : finished
              ? `Done · spent $${fmt(spend.spent.toString())} of $${fmt(spend.cap.toString())}${run.refunded && BigInt(run.refunded) > 0n ? ` · $${fmt(run.refunded)} returned to you` : spend.cap > spend.spent ? ` · $${fmt((spend.cap - spend.spent).toString())} never spent` : ""}`
              : `Spent $${fmt(spend.spent.toString())} of $${fmt(spend.cap.toString())} · ${spend.sellers} seller${spend.sellers === 1 ? "" : "s"} paid`}
        </p>
      )}
      <div className={scrolls ? "overflow-x-auto pb-2" : undefined} tabIndex={scrolls ? 0 : undefined} aria-label={scrolls ? "Steps, scroll sideways for more" : undefined}>
      <div className="mx-auto" style={{ width: w * scale, height: h * scale }}>
        <div className="relative origin-top-left" style={{ width: w, height: h, transform: scale !== 1 ? `scale(${scale})` : undefined }}>
          {layout.bands?.map((b, i) => (
            <div key={b.id} className={`absolute border-t border-dashed border-[#e3e2dc] ${i === 0 ? "border-t-0" : ""}`} style={{ left: offX, top: b.y, width: w - offX, height: b.h }} data-testid={`lane-${b.id}`}>
              <div className={`absolute left-0 top-3 pr-3 text-[12px] leading-snug ${IMPORTANCE[b.importance]}`} style={{ width: LANE_LABEL_W - 12 }}>
                {b.question}
                {b.importance === "must" && <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-ink-3">must know</span>}
              </div>
            </div>
          ))}
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={w} height={h} aria-hidden>
            {/* Money lines from the vault sit behind the step edges. */}
            {paidSteps.map((p) => {
              const b = at(p.id);
              return <path key={`v-${p.id}`} d={`M${VAULT_W},${vaultAt.y + VAULT_H / 2} C${VAULT_W + GAP_X / 2},${vaultAt.y + VAULT_H / 2} ${b.x - GAP_X / 2},${b.y + NODE_H / 2} ${b.x},${b.y + NODE_H / 2}`} fill="none" stroke="#2775ca" strokeOpacity={0.22} strokeWidth={1.2} strokeDasharray="1.5 4" />;
            })}
            {[...edges, ...toVerdict].map((e) => (
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
                {e.label} →{e.preview && !draft ? <span className="ml-1 text-ink-3">{e.preview}</span> : null}
              </span>
            ))}
          {/* Data moving: a packet runs along the edge when the step it feeds starts. */}
          {animate && !draft && edges.filter((e) => e.label && e.target.status === "active").map((e) => <Packet key={`p-${e.id}-${e.target.startedAt ?? ""}`} d={e.d} preview={e.preview} />)}
          {showVault && run && <VaultNode run={run} x={vaultAt.x} y={vaultAt.y} draft={Boolean(draft)} />}
          {/* Money moving: a coin flies to each step as it is paid. */}
          {animate &&
            showVault &&
            !draft &&
            paidSteps.flatMap((p) =>
              p.payments
                .filter((x) => x.txState === "settled" && x.at && now - Date.parse(x.at) < 1500)
                .map((x) => {
                  const b = at(p.id);
                  return <Coin key={`c-${p.id}-${x.id}`} from={{ x: VAULT_W - 10, y: vaultAt.y + VAULT_H / 2 - 7 }} to={{ x: b.x + 4, y: b.y + NODE_H / 2 - 7 }} />;
                }),
            )}
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
              x={at(p.id).x}
              y={at(p.id).y}
              onGap={p.gap && onGap ? (a) => onGap(p.gap!.fact, a) : undefined}
            />
          ))}
          {verdictAt && run && <VerdictNode run={run} x={verdictAt.x} y={verdictAt.y} />}
        </div>
      </div>
      </div>
    </div>
  );
}
