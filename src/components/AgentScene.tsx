"use client";
import { useReducedMotion } from "framer-motion";
import type { AgentId } from "@/lib/types";

/**
 * A small live picture of each agent's work, shown before the graph exists:
 * Inso's odds bars trade places, Trado's candles print with a price line, Worko's route draws between pins.
 * Pure SVG + CSS; still when the user prefers reduced motion.
 */
export function AgentScene({ agent, className = "" }: { agent: AgentId; className?: string }) {
  return (
    <svg viewBox="0 0 240 96" width="240" height="96" className={`scene ${className}`} aria-hidden shapeRendering="crispEdges">
      {agent === "inso" && <Odds />}
      {agent === "trado" && <Candles />}
      {agent === "worko" && <Route />}
    </svg>
  );
}

function Odds() {
  const bars = [
    { x: 30, a: 56, b: 30 },
    { x: 80, a: 24, b: 62 },
    { x: 130, a: 44, b: 20 },
    { x: 180, a: 18, b: 50 },
  ];
  return (
    <g>
      <line x1="16" y1="84" x2="224" y2="84" stroke="var(--color-ink)" strokeWidth="1.5" />
      {bars.map((b, i) => (
        <g key={b.x}>
          <rect x={b.x} width="26" fill="var(--agent)" stroke="var(--color-ink)" strokeWidth="1.5" className="scene-bar" style={{ ["--a" as string]: `${b.a}px`, ["--b" as string]: `${b.b}px`, animationDelay: `${i * 0.35}s` }} />
          <text x={b.x + 13} y="12" textAnchor="middle" className="scene-label" fontSize="9" fill="var(--color-ink-3)">
            {["YES", "NO", "YES", "NO"][i]}
          </text>
        </g>
      ))}
    </g>
  );
}

function Candles() {
  const c = [
    { x: 20, o: 60, c: 48, h: 40, l: 66 },
    { x: 46, o: 48, c: 54, h: 44, l: 60 },
    { x: 72, o: 54, c: 40, h: 34, l: 58 },
    { x: 98, o: 40, c: 46, h: 36, l: 52 },
    { x: 124, o: 46, c: 32, h: 26, l: 50 },
    { x: 150, o: 32, c: 36, h: 28, l: 42 },
    { x: 176, o: 36, c: 24, h: 18, l: 40 },
    { x: 202, o: 24, c: 18, h: 12, l: 30 },
  ];
  return (
    <g>
      {c.map((k, i) => {
        const up = k.c < k.o;
        return (
          <g key={k.x} className="scene-candle" style={{ animationDelay: `${i * 0.18}s` }}>
            <line x1={k.x + 6} x2={k.x + 6} y1={k.h} y2={k.l} stroke="var(--color-ink)" strokeWidth="1.5" />
            <rect x={k.x} y={Math.min(k.o, k.c)} width="12" height={Math.max(3, Math.abs(k.o - k.c))} fill={up ? "var(--agent)" : "var(--color-panel)"} stroke="var(--color-ink)" strokeWidth="1.5" />
          </g>
        );
      })}
      <polyline points="16,70 52,58 78,52 104,46 130,38 156,34 182,26 214,18" fill="none" stroke="var(--color-good)" strokeWidth="1.5" strokeDasharray="3 4" className="scene-trend" shapeRendering="auto" />
    </g>
  );
}

function Route() {
  const reduce = useReducedMotion();
  const path = "M24 72 C 60 72, 64 30, 104 34 S 150 70, 176 52 S 206 20, 220 22";
  return (
    <g shapeRendering="auto">
      <path d={path} fill="none" stroke="#d5d4ce" strokeWidth="2" strokeDasharray="4 5" />
      <path d={path} fill="none" stroke="var(--agent)" strokeWidth="2.5" className="scene-route" pathLength={100} />
      {[
        [24, 72],
        [104, 34],
        [176, 52],
        [220, 22],
      ].map(([x, y], i) => (
        <rect key={i} x={x - 5} y={y - 5} width="10" height="10" fill={i === 0 ? "var(--color-ink)" : "var(--color-panel)"} stroke="var(--color-ink)" strokeWidth="1.5" shapeRendering="crispEdges" />
      ))}
      {!reduce && (
        <rect width="8" height="8" x="-4" y="-4" fill="var(--agent)" stroke="var(--color-ink)" strokeWidth="1.5" shapeRendering="crispEdges">
          <animateMotion dur="3.2s" repeatCount="indefinite" path={path} />
        </rect>
      )}
    </g>
  );
}
