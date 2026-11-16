"use client";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * Blocks fly in from scattered positions and settle into the outline of whatever is appearing,
 * then the real thing fades in under them. Pure motion: nothing is generated, the blocks just
 * trace the shapes already on the page (every element marked data-block, or the whole child).
 *
 * `play` names the appearance: the animation runs when it is first set and whenever it changes.
 * People who ask for less motion get the content straight away.
 */
interface Block {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  delay: number;
  dur: number;
  bend: number;
  color: string;
  size: number;
}

const FLY_MS = 620;
const SPREAD_MS = 420;
const FADE_MS = 260;
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);

/** Points that sketch a rectangle: its edge, then a sparse fill, so a few blocks read as the shape. */
function sketch(x: number, y: number, w: number, h: number, step: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= w; i += step) pts.push([x + i, y], [x + i, y + h]);
  for (let j = step; j < h; j += step) pts.push([x, y + j], [x + w, y + j]);
  for (let j = step * 2; j < h - step; j += step * 2.5) for (let i = step * 2; i < w - step; i += step * 2.5) pts.push([x + i, y + j]);
  return pts;
}

export function Assemble({ play, children, className = "" }: { play: string | number | null | undefined; children: React.ReactNode; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Hidden only while blocks are in the air; with no animation the content is simply there.
  const [flying, setFlying] = useState(play != null);
  const played = useRef<string | number | null | undefined>(undefined);

  // Runs before paint, so the content never flashes ahead of its own entrance. It depends on
  // `play` alone: re-renders of what's inside must never restart or cut short a run in progress.
  useLayoutEffect(() => {
    const el = host.current;
    const cv = canvas.current;
    if (play == null || played.current === play) {
      if (play == null) setFlying(false);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = cv?.getContext("2d");
    if (reduce || !el || !cv || !ctx) {
      played.current = play;
      setFlying(false);
      return;
    }

    const box = el.getBoundingClientRect();
    // The canvas covers the window, not the content: blocks can come from anywhere on screen and nothing gets wider.
    const W = window.innerWidth;
    const H = window.innerHeight;
    const marked = [...el.querySelectorAll<HTMLElement>("[data-block]")];
    // Only what is on screen gets blocks; shapes below the fold just fade in.
    const shapes = (marked.length ? marked : [el]).map((n) => n.getBoundingClientRect()).filter((r) => r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < H);
    if (!shapes.length) {
      played.current = play;
      setFlying(false);
      return;
    }
    played.current = play;
    setFlying(true);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = `${W}px`;
    cv.style.height = `${H}px`;
    cv.style.display = "block";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const agent = getComputedStyle(el).getPropertyValue("--agent").trim() || "#6351d8";
    const palette = [agent, agent, agent, "#0b0b0b", "#0b0b0b", "#c9c8c2"];
    // Fewer, larger steps on big scenes keep it light on slower machines.
    const area = shapes.reduce((a, r) => a + r.width * r.height, 0);
    const step = area > 260_000 ? 22 : area > 90_000 ? 17 : 13;
    let pts = shapes.flatMap((r) => sketch(r.left, r.top, r.width, r.height, step));
    const MAX = 620;
    if (pts.length > MAX) pts = pts.filter((_, i) => Math.floor((i * MAX) / pts.length) !== Math.floor(((i - 1) * MAX) / pts.length));

    const edge = 160;
    const sceneBottom = Math.min(H, box.bottom);
    const blocks: Block[] = pts.map(([tx, ty]) => {
      // Start scattered in a loose ring around the scene.
      const side = Math.random();
      const sx = side < 0.5 ? box.left - edge + Math.random() * (box.width + edge * 2) : side < 0.75 ? box.left - Math.random() * edge : box.right + Math.random() * edge;
      const sy = side < 0.5 ? (Math.random() < 0.5 ? box.top - Math.random() * edge : sceneBottom + Math.random() * edge) : box.top - edge / 2 + Math.random() * (sceneBottom - box.top + edge);
      return {
        sx,
        sy,
        tx,
        ty,
        // A sweep from left to right, with enough randomness that it reads as a swarm, not a wipe.
        delay: ((tx - box.left) / Math.max(1, box.width)) * SPREAD_MS * 0.55 + Math.random() * SPREAD_MS * 0.45,
        dur: FLY_MS * (0.75 + Math.random() * 0.5),
        bend: (Math.random() - 0.5) * 150,
        color: palette[Math.floor(Math.random() * palette.length)],
        size: Math.random() < 0.2 ? 8 : 6,
      };
    });

    const end = Math.max(...blocks.map((b) => b.delay + b.dur));
    let raf = 0;
    let start = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setFlying(false);
    };
    const frame = (now: number) => {
      start ||= now;
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      // If the page scrolls mid-flight the blocks follow their shapes.
      const cur = el.getBoundingClientRect();
      const ox = cur.left - box.left;
      const oy = cur.top - box.top;
      const fade = t > end ? Math.max(0, 1 - (t - end) / FADE_MS) : 1;
      for (const b of blocks) {
        const k = Math.min(1, Math.max(0, (t - b.delay) / b.dur));
        if (k <= 0) continue;
        const e = easeOut(k);
        // An arc, not a straight line: each block swings out sideways and curls into its place.
        const arc = Math.sin(Math.PI * k) * b.bend * (1 - k);
        const dx = b.tx - b.sx;
        const dy = b.ty - b.sy;
        const len = Math.hypot(dx, dy) || 1;
        const x = b.sx + dx * e + (-dy / len) * arc;
        const y = b.sy + dy * e + (dx / len) * arc;
        ctx.globalAlpha = fade * Math.min(1, k * 4);
        ctx.fillStyle = b.color;
        ctx.fillRect(Math.round(x + ox - b.size / 2), Math.round(y + oy - b.size / 2), b.size, b.size);
      }
      if (t > end) finish();
      if (t < end + FADE_MS) raf = requestAnimationFrame(frame);
      else cv.style.display = "none";
    };
    raf = requestAnimationFrame(frame);
    // If the tab is in the background and frames never come, don't leave the content hidden.
    const safety = window.setTimeout(() => {
      finish();
      cv.style.display = "none";
    }, end + FADE_MS + 1200);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(safety);
      cv.style.display = "none";
      // Cut short (a new appearance, or the component going away): allow it to run again.
      if (!finished) played.current = undefined;
    };
  }, [play]);

  return (
    <div ref={host} className={`relative ${className}`} data-assembling={flying ? "true" : undefined}>
      <div style={{ opacity: flying ? 0 : 1, transition: `opacity ${FADE_MS}ms ease-out` }}>{children}</div>
      <canvas ref={canvas} aria-hidden className="pointer-events-none fixed left-0 top-0 z-50" style={{ display: "none" }} />
    </div>
  );
}
