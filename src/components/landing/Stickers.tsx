"use client";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { AgentId } from "@/lib/types";
import type { Mood } from "@/lib/outfit";
import { Mascot } from "@/components/Mascot";

/**
 * Pieces of the landing's sticker boards. Every board is drawn on a fixed canvas
 * and scaled to fit the space it gets, so the layout stays the same on any screen.
 */

/** A sticker placed on a board canvas. `tilt` is its resting angle; `delay` staggers its pop-in. */
export function Sticker({
  x,
  y,
  w,
  tilt = 0,
  delay = 0,
  wobble = 5.5,
  className = "",
  children,
}: {
  x: number;
  y: number;
  w?: number;
  tilt?: number;
  delay?: number;
  wobble?: number;
  className?: string;
  children: ReactNode;
}) {
  const style = { left: x, top: y, width: w, "--tilt": `${tilt}deg`, "--d": `${delay}ms`, "--w": `${wobble}s` } as CSSProperties;
  return (
    <div className={`lnd-sticker absolute ${className}`} style={style}>
      {children}
    </div>
  );
}

/** White die-cut edge around a card-shaped sticker. */
export function Cut({ children, className = "", radius = 18 }: { children: ReactNode; className?: string; radius?: number }) {
  return (
    <div className={`lnd-cut ${className}`} style={{ borderRadius: radius }}>
      {children}
    </div>
  );
}

/** A pixel mascot cut out along its own outline. */
export function MascotSticker({ agent, size = 80, mood = "idle" }: { agent: AgentId; size?: number; mood?: Mood }) {
  return (
    <span className="lnd-cut-shape inline-block">
      <Mascot agent={agent} size={size} framed={false} mood={mood} />
    </span>
  );
}

/** Coloured label pill with a white sticker edge. */
export function Pill({ agent, children, className = "" }: { agent?: AgentId; children: ReactNode; className?: string }) {
  return (
    <span data-agent={agent} className={`lnd-pill inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-agent px-3 text-[13px] font-semibold text-agent-on ${className}`}>
      {children}
    </span>
  );
}

/** Three short hand-drawn strokes, like a doodle beside a title. Uses the surrounding agent colour. */
export function Strokes({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" width="30" height="30" className={`inline-block text-agent ${className}`} fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
      <path d="M5 23.5c1.8-1.6 3.6-3.1 5.6-4.4" />
      <path d="M13.5 13.2c.4-2.6.8-5 1.6-7.4" />
      <path d="M19 19.2c2.4-.9 4.9-1.6 7.5-2" />
    </svg>
  );
}

/** Four-point sparkle. */
export function Sparkle({ size = 22, color = "#eda100", className = "" }: { size?: number; color?: string; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} className={className}>
      <path d="M12 1.5c.9 5.6 3.6 8.4 10.5 10.5-6.9 2.1-9.6 4.9-10.5 10.5C11.1 16.9 8.4 14.1 1.5 12 8.4 9.9 11.1 7.1 12 1.5Z" fill={color} stroke="#0b0b0b" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Grid-paper board that scales a fixed-size drawing to fit. The drawing is
 * decorative; `label` says in words what it shows.
 */
export function Board({ w, h, label, children }: { w: number; h: number; label: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const s = Math.min((el.clientWidth - 12) / w, (el.clientHeight - 12) / h, 1.35);
      setScale(Math.max(0.3, s));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);
  return (
    <div ref={box} role="img" aria-label={label} className="lnd-grid relative min-h-0 flex-1 overflow-hidden rounded-[20px]">
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2"
        style={{ width: w, height: h, transform: `translate(-50%, -50%) scale(${scale ?? 1})`, opacity: scale === null ? 0 : 1 }}
      >
        {children}
      </div>
    </div>
  );
}
