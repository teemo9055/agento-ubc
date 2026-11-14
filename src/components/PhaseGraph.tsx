"use client";
import { useEffect, useMemo, useState } from "react";
import { ReactFlow, Handle, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { fmt } from "@/lib/money";
import type { CostLine, Phase } from "@/lib/types";
import { Spinner, StatusTag, TxChip } from "./ui";

type PhaseNodeData = { phase: Phase; line?: CostLine; step: number; vertical: boolean; simulated: boolean };

function PhaseNode({ data }: NodeProps<Node<PhaseNodeData>>) {
  const { phase: p, line, step, vertical, simulated } = data;
  const active = p.status === "active";
  const last = p.payments[p.payments.length - 1];
  const paid = p.payments.filter((x) => x.txState === "settled").length;
  return (
    <div
      className={`w-[208px] rounded-xl border bg-panel px-3.5 py-3 text-left transition-[transform,opacity] duration-300 ${
        active ? "glow -translate-y-0.5 border-accent/50" : p.status === "skipped" ? "border-line opacity-50" : "border-line"
      } ${p.status === "awaiting_reapproval" ? "border-warn" : ""} ${p.status === "failed_waiting" || p.status === "failed" ? "border-bad/50" : ""}`}
      data-testid={`phase-${p.id}`}
      data-status={p.status}
    >
      <Handle type="target" position={vertical ? Position.Top : Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-line" />
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-ink-3">
          {active ? <Spinner /> : <span>{String(step).padStart(2, "0")}</span>}
        </span>
        <StatusTag status={p.status} />
      </div>
      <div className="mt-1.5 text-[13.5px] font-semibold leading-tight">{p.label}</div>
      <div className="truncate text-[11.5px] text-ink-3">{p.note && active ? p.note : p.sub}</div>

      {active && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round((p.progress ?? 0) * 100)}%` }} />
        </div>
      )}

      {p.error && (p.status === "failed_waiting" || p.status === "failed") && <div className="mt-1.5 text-[11.5px] text-bad">{p.error.message}</div>}

      {line && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-[11px]">
          {p.status === "skipped" ? (
            <span className="text-ink-3">Skipped · cost released</span>
          ) : (
            <>
              <span className="num text-ink-2">
                {fmt(line.actual)}
                <span className="text-ink-3">/{fmt(line.approved)}</span>
              </span>
              <span className="text-ink-3">→ {line.payeeName}</span>
              {line.bigSpend && <span className="rounded border border-ink/20 px-1 text-[10px] text-ink-2">Approved</span>}
              {last && <TxChip state={last.txState} hash={last.txHash} simulated={simulated} />}
              {line.calls && paid > 0 && (
                <span className="num text-ink-3">
                  {paid}/{line.calls.max} calls
                </span>
              )}
            </>
          )}
        </div>
      )}
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-line" />
    </div>
  );
}

const nodeTypes = { phase: PhaseNode };

function useNarrow() {
  const [narrow, set] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 720px)");
    const f = () => set(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return narrow;
}

export function PhaseGraph({ phases, lines, simulated }: { phases: Phase[]; lines: CostLine[]; simulated: boolean }) {
  const vertical = useNarrow();

  const { nodes, edges, size } = useMemo(() => {
    const depth: Record<string, number> = {};
    const d = (p: Phase): number => (depth[p.id] ??= p.dependsOn.length ? 1 + Math.max(...p.dependsOn.map((x) => d(phases.find((q) => q.id === x)!))) : 0);
    phases.forEach(d);
    const cols: Record<number, string[]> = {};
    phases.forEach((p) => (cols[depth[p.id]] ??= []).push(p.id));
    const maxRows = Math.max(...Object.values(cols).map((c) => c.length));
    const GAP_MAIN = vertical ? 190 : 250;
    const GAP_CROSS = vertical ? 230 : 170;

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
        data: { phase: p, line: lines.find((l) => l.id === p.lineId), step: i + 1, vertical, simulated },
        draggable: false,
        selectable: false,
      };
    });

    const edges: Edge[] = phases.flatMap((p) =>
      p.dependsOn.map((src) => {
        const from = phases.find((x) => x.id === src)!;
        const flowing = p.status === "active" && p.payments.some((x) => x.txState === "signing" || x.txState === "pending");
        const filled = from.status === "done" || from.status === "skipped";
        return {
          id: `${src}-${p.id}`,
          source: src,
          target: p.id,
          type: "smoothstep",
          className: flowing ? "edge-flow" : "",
          style: { stroke: filled ? "var(--color-good)" : "var(--color-line)", strokeWidth: 1.75, transition: "stroke 400ms" },
        };
      }),
    );
    const cols_n = Object.keys(cols).length;
    const size = vertical ? { h: cols_n * GAP_MAIN + 40 } : { h: maxRows * GAP_CROSS + 30 };
    return { nodes, edges, size };
  }, [phases, lines, vertical, simulated]);

  return (
    <div className="w-full" style={{ height: size.h }} aria-label="Phase graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      />
    </div>
  );
}
