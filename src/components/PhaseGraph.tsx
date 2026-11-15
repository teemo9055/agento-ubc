"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Handle, Position, BaseEdge, getSmoothStepPath, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import { motion, useReducedMotion } from "framer-motion";
import "@xyflow/react/dist/style.css";
import { fmt } from "@/lib/money";
import type { CostLine, Phase } from "@/lib/types";
import { txUrl } from "@/lib/format";
import { Icon } from "./Icon";

type PhaseNodeData = { phase: Phase; line?: CostLine; step: number; vertical: boolean; simulated: boolean; onEdit?: () => void; focused?: boolean; dim?: boolean };

const NODE_W = 188;
const NODE_H = 92;

/** One quiet mark per state: outline (planned), filled square (running), check (done), "!" (needs you). */
function StateMark({ p, step }: { p: Phase; step: number }) {
  const base = "inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] text-[11px] font-semibold";
  if (p.status === "done")
    return (
      <motion.span className={`${base} bg-good text-white`} initial={{ scale: 0.4, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 520, damping: 16 }}>
        <Icon name="check" size={13} stroke={3} />
      </motion.span>
    );
  if (p.status === "active") return <span className={`${base} border-[1.5px] border-ink bg-agent`}><span className="mascot-spark h-1.5 w-1.5 bg-white" /></span>;
  if (p.status === "awaiting_reapproval") return <span className={`${base} border-[1.5px] border-ink bg-warn font-pixel text-ink`}>!</span>;
  if (p.status === "failed_waiting" || p.status === "failed") return <span className={`${base} bg-bad font-pixel text-white`}>!</span>;
  if (p.status === "skipped") return <span className={`${base} border border-dashed border-ink-3 text-ink-3`}>–</span>;
  return <span className={`${base} num border-[1.5px] border-[#d5d4ce] text-ink-3`}>{step}</span>;
}

const STATE_TEXT: Partial<Record<Phase["status"], string>> = {
  active: "Running",
  awaiting_reapproval: "Needs you",
  failed_waiting: "Needs you",
  failed: "Failed",
  skipped: "Skipped",
};

function PhaseNode({ data }: NodeProps<Node<PhaseNodeData>>) {
  const { phase: p, line, step, vertical, simulated, onEdit, focused, dim } = data;
  const active = p.status === "active";
  const needs = p.status === "awaiting_reapproval" || p.status === "failed_waiting";
  const last = p.payments[p.payments.length - 1];
  const paid = p.payments.filter((x) => x.txState === "settled").length;
  const frame = focused || active
    ? "border-[1.5px] border-ink shadow-[3px_3px_0_0_var(--agent)]"
    : needs
      ? "border-[1.5px] border-ink shadow-[3px_3px_0_0_var(--color-warn)]"
      : p.status === "failed"
        ? "border border-bad/50"
        : p.status === "skipped"
          ? "border border-dashed border-line opacity-60"
          : "border border-line";
  const sub = p.error && (p.status === "failed_waiting" || p.status === "failed") ? p.error.message : p.note && active ? p.note : p.sub;
  // Editable steps are real buttons; the whole box hands this step to the chat.
  const Box = onEdit ? "button" : "div";
  return (
    <Box
      type={onEdit ? "button" : undefined}
      onClick={onEdit}
      aria-pressed={onEdit ? Boolean(focused) : undefined}
      aria-label={onEdit ? `Step ${step}: ${p.label}. Edit in chat` : undefined}
      className={`node-in nodrag group relative flex flex-col overflow-hidden rounded-xl bg-panel px-3.5 pb-2.5 pt-3 text-left transition-[box-shadow,border-color,opacity,transform] duration-200 ${frame} ${
        onEdit && !focused ? "cursor-pointer hover:-translate-y-0.5 hover:border-ink hover:shadow-[3px_3px_0_0_var(--agent)]" : ""
      } ${dim ? "opacity-55" : ""}`}
      style={{ width: NODE_W, height: NODE_H, animationDelay: `${(step - 1) * 70}ms` }}
      data-testid={`phase-${p.id}`}
      data-status={p.status}
    >

      <Handle type="target" position={vertical ? Position.Top : Position.Left} className="!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
      <div className="flex items-start gap-2.5">
        <StateMark p={p} step={step} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold leading-tight">{p.label}</div>
          <div className={`truncate text-[12px] leading-snug ${p.error ? "text-bad" : "text-ink-3"}`} title={sub}>
            {STATE_TEXT[p.status] && p.status !== "active" ? <b className="font-semibold">{STATE_TEXT[p.status]} · </b> : null}
            {sub}
          </div>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 text-[12px]">
        {line ? (
          <span className="num truncate text-ink-3">
            {p.status === "planned" || p.status === "skipped" ? (
              <>{fmt(line.approved)} USDC</>
            ) : (
              <>
                <b className="font-semibold text-ink">{fmt(line.actual)}</b> / {fmt(line.approved)}
              </>
            )}
            {line.calls && paid > 0 && p.status === "active" ? ` · ${paid}/${line.calls.max}` : ""}
          </span>
        ) : (
          <span className="text-ink-3">Free</span>
        )}
        {onEdit ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold transition-opacity ${
              focused ? "bg-ink text-white opacity-100" : "reveal bg-[#f1f0ec] text-ink-2 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
            }`}
            aria-hidden
          >
            <Icon name={focused ? "chat" : "edit"} size={11} /> {focused ? "In chat" : "Edit"}
          </span>
        ) : last?.txHash ? (
          <a href={txUrl(last.txHash)} target="_blank" rel="noreferrer" className="nodrag inline-flex shrink-0 items-center gap-0.5 text-ink-3 hover:text-ink" aria-label={`Transaction for ${p.label}`}>
            tx <Icon name="external" size={11} />
          </a>
        ) : last?.txState === "settled" && simulated ? (
          <span className="shrink-0 text-ink-3">demo</span>
        ) : null}
      </div>
      {active && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-agent-soft">
          <div className="h-full bg-agent transition-[width] duration-500" style={{ width: `${Math.max(6, Math.round((p.progress ?? 0) * 100))}%` }} />
        </div>
      )}
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} className="!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
    </Box>
  );
}

const nodeTypes = { phase: PhaseNode };

type FlowEdgeData = { flowing: boolean; filled: boolean };

/** Edge that fills when the source finishes; a dot travels only while money or data is moving. */
function FlowEdge(props: EdgeProps<Edge<FlowEdgeData>>) {
  const reduce = useReducedMotion();
  const [path] = getSmoothStepPath({ ...props, borderRadius: 18, offset: 16 });
  const { flowing, filled } = props.data ?? { flowing: false, filled: false };
  return (
    <>
      <BaseEdge path={path} style={{ stroke: filled ? "var(--color-good)" : flowing ? "var(--agent)" : "#d5d4ce", strokeWidth: 1.5, strokeDasharray: filled || flowing ? undefined : "3 4", transition: "stroke 400ms" }} />
      {flowing && !reduce && (
        <rect width="6" height="6" x="-3" y="-3" fill="var(--agent)" stroke="var(--color-ink)" strokeWidth="1">
          <animateMotion dur="1.2s" repeatCount="indefinite" path={path} />
        </rect>
      )}
    </>
  );
}

const edgeTypes = { flow: FlowEdge };

/** Steps grow as payments appear; keep the whole graph in view when they do. */
function FitOnChange({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.04, maxZoom: 1, minZoom: 0.85, duration: 220 }), 80);
    return () => clearTimeout(t);
  }, [signature, fitView]);
  return null;
}

/** Width of the box the graph sits in (it shares the row with the chat). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Columns in the dependency order, i.e. how wide the left-to-right layout needs to be. */
function depthCount(phases: Phase[]) {
  const depth: Record<string, number> = {};
  const d = (p: Phase): number => (depth[p.id] ??= p.dependsOn.length ? 1 + Math.max(...p.dependsOn.map((x) => d(phases.find((q) => q.id === x)!))) : 0);
  phases.forEach(d);
  return Math.max(0, ...Object.values(depth)) + 1;
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
  // Left to right whenever it fits at 85% size or more (it reads like a timeline); top to bottom only on narrow screens.
  const vertical = width > 0 && (depthCount(phases) * (NODE_W + 44) - 44 + 16) * 0.85 > width;

  const { nodes, edges, size } = useMemo(() => {
    const depth: Record<string, number> = {};
    const d = (p: Phase): number => (depth[p.id] ??= p.dependsOn.length ? 1 + Math.max(...p.dependsOn.map((x) => d(phases.find((q) => q.id === x)!))) : 0);
    phases.forEach(d);
    const cols: Record<number, string[]> = {};
    phases.forEach((p) => (cols[depth[p.id]] ??= []).push(p.id));
    const maxRows = Math.max(...Object.values(cols).map((c) => c.length));
    // Even rhythm: a fixed node size and fixed gaps, so rows and columns line up.
    const GAP_MAIN = vertical ? NODE_H + 44 : NODE_W + 44;
    const GAP_CROSS = vertical ? NODE_W + 20 : NODE_H + 24;

    const nodes: Node<PhaseNodeData>[] = phases.map((p, i) => {
      const col = depth[p.id];
      const row = cols[col].indexOf(p.id);
      const offset = ((maxRows - cols[col].length) * GAP_CROSS) / 2;
      const main = col * GAP_MAIN;
      const cross = row * GAP_CROSS + offset;
      return {
        id: p.id,
        type: "phase",
        position: vertical ? { x: cross, y: main } : { x: main, y: cross },
        data: {
          phase: p,
          line: lines.find((l) => l.id === p.lineId),
          step: i + 1,
          vertical,
          simulated,
          onEdit: editable?.includes(p.id) && onEditStep ? () => onEditStep(p.id) : undefined,
          focused: focusedId === p.id,
          dim: Boolean(focusedId) && focusedId !== p.id,
        },
        draggable: false,
        selectable: false,
        // React Flow makes non-selectable nodes click-through; editable steps must take clicks.
        style: editable?.includes(p.id) ? { pointerEvents: "all" as const } : undefined,
      };
    });

    const edges: Edge<FlowEdgeData>[] = phases.flatMap((p) =>
      p.dependsOn.map((src) => {
        const from = phases.find((x) => x.id === src)!;
        const flowing = p.status === "active" && p.payments.some((x) => x.txState === "signing" || x.txState === "pending");
        const filled = from.status === "done" || from.status === "skipped";
        return { id: `${src}-${p.id}`, source: src, target: p.id, type: "flow", data: { flowing, filled } };
      }),
    );
    const cols_n = Object.keys(cols).length;
    const size = vertical ? { h: cols_n * GAP_MAIN + 24 } : { h: maxRows * GAP_CROSS + 24 };
    return { nodes, edges, size };
  }, [phases, lines, vertical, simulated, editable, focusedId, onEditStep]);

  return (
    <div ref={box} className="w-full" style={{ height: size.h }} aria-label="Phase graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.04, maxZoom: 1, minZoom: 0.85 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        <FitOnChange signature={`${vertical}|${phases.map((p) => `${p.status}:${p.payments.length}:${p.error ? 1 : 0}`).join(",")}`} />
      </ReactFlow>
    </div>
  );
}
