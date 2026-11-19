"use client";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { Mascot } from "@/components/Mascot";
import type { AgentId } from "@/lib/types";
import { PLACES, PlaceIcon, type PlaceId } from "./places";
import { A, ART, ArtDefs, B, BOX, Bush, Cloud, Flowers, Hills, INK, Lamp, Pine, Shadow, Square, Tree, diamond, iso, pts, type Lot, type P } from "./art";
import s from "./town.module.css";

/**
 * The town at dusk: a floating island of grass under a pastel sky, dirt roads showing how a request
 * travels (Town Hall → Lab → Library, Town Hall → Forum → Store), one building per place with warm
 * windows, a pond that spills over the edge, mascots on the roads and fireflies over the square.
 * Every building is a real link named after its place; the bar under the map is the same navigation.
 * Motion is CSS only, stops under reduced motion and pauses while the tab is hidden.
 */
export const MAP_W = 1200;
export const MAP_H = 800;
const N = 12; // tiles per side
const OX = 600;
const OY = 118;
const DEPTH = 26;

/** Centre of tile (i, j). */
const tile = (i: number, j: number): P => [OX + (i - j) * A, OY + (i + j) * B + B];
/** A grid corner (tile edges meet here). */
const corner = (i: number, j: number): P => [OX + (i - j) * A, OY + (i + j) * B];

const LOTS: Record<Lot, P> = {
  hq: [1.2, 1.2],
  library: [4.5, 2],
  store: [2, 5.5],
  lab: [9, 4.5],
  forum: [5.5, 9],
  hall: [9, 9],
};

const ROADS: { tiles: P[]; flow?: boolean }[] = [
  { tiles: [[9, 8], [9, 6]], flow: true },
  { tiles: [[8, 4], [5, 4], [5, 3]], flow: true },
  { tiles: [[8, 9], [7, 9]], flow: true },
  { tiles: [[4, 9], [2, 9], [2, 7]], flow: true },
  { tiles: [[1, 3], [1, 4]] },
  { tiles: [[2, 2]] },
  { tiles: [[3, 1]] },
];

function runTiles(corners: P[]): P[] {
  const out: P[] = [corners[0]];
  for (let k = 1; k < corners.length; k++) {
    const [pi, pj] = corners[k - 1];
    const [i, j] = corners[k];
    let ci = pi;
    let cj = pj;
    while (ci !== i || cj !== j) {
      ci += Math.sign(i - pi);
      cj += Math.sign(j - pj);
      out.push([ci, cj]);
    }
  }
  return out;
}

/** runTiles for walks, which may start between tiles. */
function runTilesF(corners: P[]): P[] {
  const out: P[] = [corners[0]];
  for (let k = 1; k < corners.length; k++) {
    const [pi, pj] = corners[k - 1];
    const [i, j] = corners[k];
    const steps = Math.max(1, Math.round(Math.max(Math.abs(i - pi), Math.abs(j - pj))));
    for (let t = 1; t <= steps; t++) out.push([pi + ((i - pi) * t) / steps, pj + ((j - pj) * t) / steps]);
  }
  return out;
}

const WALKS: { agent: AgentId; corners: P[]; seconds: number }[] = [
  { agent: "inso", corners: [[9, 8], [9, 5], [8, 4], [5, 4], [5, 3]], seconds: 16 },
  { agent: "trado", corners: [[8, 9], [2, 9], [2, 7]], seconds: 14 },
  { agent: "worko", corners: [[1, 4], [1, 3], [2, 2], [3, 1]], seconds: 8 },
];

const SIGN_UP: Record<Lot, number> = { library: 172, store: 132, hall: 200, lab: 150, forum: 118, hq: 168 };
const SHADOW: Record<Lot, [number, number]> = { library: [100, 46], store: [96, 44], hall: [118, 54], lab: [80, 38], forum: [70, 30], hq: [64, 32] };

// ---------- the island ----------

/** A small deterministic scatter, so the server and the browser draw the same grass. */
const rand = (k: number) => {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  // Rounded so the server and the browser agree to the last digit.
  return Math.round((x - Math.floor(x)) * 1000) / 1000;
};

function Island() {
  const Nc = corner(0, 0);
  const Ec = corner(N, 0);
  const Sc = corner(N, N);
  const Wc = corner(0, N);
  const down = (p: P, d = DEPTH): P => [p[0], p[1] + d];
  // The rock underneath: a ragged belly that hangs lowest under the front corner.
  const belly = (t: number) => 92 * Math.sin(Math.PI * t) ** 0.8 + (Math.round(t * 18) % 3) * 7;
  const along = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const left: P[] = [];
  const right: P[] = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    const pl = along(down(Wc), down(Sc), t);
    left.push([Math.round(pl[0] / 6) * 6, pl[1] + belly(t / 2)]);
    const pr = along(down(Sc), down(Ec), t);
    right.push([Math.round(pr[0] / 6) * 6, pr[1] + belly(0.5 + t / 2)]);
  }
  const tiles: JSX.Element[] = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if ((i + j) % 2) tiles.push(<polygon key={`t${i}-${j}`} points={diamond(tile(i, j), 0.5)} fill="#86c866" />);
  const tufts: JSX.Element[] = [];
  for (let k = 0; k < 70; k++) {
    const p = tile(rand(k) * 11.6 + 0.2, rand(k + 99) * 11.6 + 0.2);
    tufts.push(<path key={`g${k}`} d={`M${Math.round(p[0] - 4)} ${Math.round(p[1])}h2v-3h1v3h2v-5h1v5h2`} fill="none" stroke="#5fae4f" strokeWidth={1.2} />);
  }
  return (
    <g>
      {/* rock belly */}
      <polygon points={pts(down(Wc), down(Sc), ...[...left].reverse())} fill="#8c7aa6" stroke={INK} strokeWidth={2} />
      <polygon points={pts(down(Sc), down(Ec), ...[...right].reverse())} fill="#6d5b88" stroke={INK} strokeWidth={2} />
      <polyline points={pts(...left.map((p, k): P => [p[0], p[1] - 22 - (k % 2) * 6]))} fill="none" stroke="#7a6996" strokeWidth={2} />
      <polyline points={pts(...right.map((p, k): P => [p[0], p[1] - 24 - (k % 2) * 6]))} fill="none" stroke="#5c4b76" strokeWidth={2} />
      {/* hanging roots and vines */}
      {[0.18, 0.34, 0.52, 0.7, 0.86].map((t, k) => {
        const p = along(down(Wc), down(Sc), t);
        return <rect key={`v${k}`} x={p[0]} y={p[1]} width={3} height={14 + (k % 3) * 10} fill="#3f9e5e" />;
      })}
      {[0.12, 0.3, 0.6, 0.78].map((t, k) => {
        const p = along(down(Sc), down(Ec), t);
        return <rect key={`w${k}`} x={p[0]} y={p[1]} width={3} height={12 + (k % 2) * 14} fill="#2f8a52" />;
      })}
      {/* soil sides with a grass lip */}
      <polygon points={pts(Wc, Sc, down(Sc), down(Wc))} fill="#b98256" stroke={INK} strokeWidth={2} />
      <polygon points={pts(Sc, Ec, down(Ec), down(Sc))} fill="#946240" stroke={INK} strokeWidth={2} />
      <polygon points={pts(Wc, Sc, down(Sc, 7), down(Wc, 7))} fill="#5fb552" />
      <polygon points={pts(Sc, Ec, down(Ec, 7), down(Sc, 7))} fill="#4e9a45" />
      <polyline points={pts(down(Wc, 16), down(Sc, 16), down(Ec, 16))} fill="none" stroke="#a06c44" strokeWidth={2} />
      {/* grass top */}
      <polygon points={pts(Nc, Ec, Sc, Wc)} fill="#8fd06f" stroke={INK} strokeWidth={2} />
      {tiles}
      {tufts}
    </g>
  );
}

function Road({ tiles: corners }: { tiles: P[] }) {
  const all = runTiles(corners);
  return (
    <g>
      {all.map(([i, j], k) => (
        <polygon key={k} points={diamond(tile(i, j), 0.5)} fill="#efd8a6" stroke="#d6b77d" strokeWidth={1.5} />
      ))}
      {all.map(([i, j], k) => {
        const c = tile(i, j);
        return k % 2 ? <rect key={`p${k}`} x={c[0] - 10 + (k % 3) * 8} y={c[1] - 3} width={4} height={3} fill="#d6b77d" /> : null;
      })}
    </g>
  );
}

function FlowArrows({ tiles: corners }: { tiles: P[] }) {
  const all = runTiles(corners);
  const out: JSX.Element[] = [];
  for (let k = 0; k < all.length - 1; k += 2) {
    const a = tile(...all[k]);
    const b = tile(...all[k + 1]);
    const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    out.push(<path key={k} d="M-5 -4 L1 0 L-5 4" transform={`translate(${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2}) rotate(${ang})`} fill="none" stroke="#a37a3e" strokeWidth={2} />);
  }
  return <g>{out}</g>;
}

/** The pond, the stream to the island's edge and the waterfall off it. */
function Water() {
  const c = tile(10.55, 6.55);
  const top1 = corner(12, 6.72);
  const top2 = corner(12, 7.08);
  const H = 196;
  const fall = pts(top1, top2, [top2[0], top2[1] + H], [top1[0], top1[1] + H]);
  return (
    <g>
      <polygon points={pts(iso(c, -0.95, -0.65), iso(c, 0.55, -0.95), iso(c, 0.95, 0.3), iso(c, -0.2, 0.95), iso(c, -0.95, 0.42))} fill="#c6eefa" stroke={INK} strokeWidth={2} />
      <polygon points={pts(iso(c, -0.8, -0.5), iso(c, 0.45, -0.8), iso(c, 0.8, 0.25), iso(c, -0.15, 0.8), iso(c, -0.8, 0.35))} fill="#86cdef" />
      <polygon points={pts(corner(10.95, 6.72), corner(12, 6.72), corner(12, 7.08), corner(10.95, 7.08))} fill="#86cdef" stroke="#5fb0d8" strokeWidth={1.5} />
      {[
        [-18, -4, 12],
        [6, 6, 8],
        [-2, -14, 6],
        [16, -6, 5],
      ].map(([dx, dy, w], k) => (
        <rect key={k} x={c[0] + dx} y={c[1] + dy} width={w} height={2} fill="#ffffff" className={s.shimmer} style={{ animationDelay: `${k * 0.7}s` }} />
      ))}
      {/* the waterfall */}
      <clipPath id="tg-fall-clip">
        <polygon points={fall} />
      </clipPath>
      <polygon points={fall} fill="url(#tg-fall)" />
      <g clipPath="url(#tg-fall-clip)">
        <g className={s.fall}>
          {Array.from({ length: 14 }, (_, k) => (
            <rect key={k} x={top2[0] + 2 + ((k * 5) % 13)} y={top1[1] - 40 + k * 18} width={2} height={10} fill="#ffffff" opacity={0.85} />
          ))}
        </g>
      </g>
      <g opacity={0.8}>
        <rect x={top2[0] - 10} y={top1[1] + H - 12} width={36} height={10} fill="#f4fbff" />
        <rect x={top2[0] - 4} y={top1[1] + H - 18} width={22} height={8} fill="#ffffff" />
      </g>
    </g>
  );
}

const TREES: [number, number, number, number?][] = [
  [0.6, 7, 1.05], [0.9, 8.7, 0.9], [1.5, 10.5, 1], [3.2, 11.3, 0.9, 1], [5.1, 11.4, 1.05], [7.6, 11.3, 0.9], [11.2, 10.2, 1], [10.6, 11.4, 0.85, 1],
  [11.4, 3, 1.05], [11.5, 4.2, 0.8, 1], [0.6, 4.6, 0.8, 1], [3.6, 7.2, 0.8], [7.4, 6.8, 0.75, 1],
];
const PINES: [number, number, number][] = [[10.5, 1, 1], [8.4, 0.7, 1.1], [6.6, 0.8, 0.9], [11.5, 1.8, 0.9], [3.2, 0.3, 0.8]];
const BUSHES: [number, number][] = [[3.1, 3.2], [6.9, 2.6], [7.2, 5.6], [4.1, 6.4], [6.7, 10.6], [10.4, 8.3], [1.2, 6.2], [8.2, 11.6], [11.6, 7.9], [2.8, 10.6]];
const FLOWERS: [number, number][] = [[2.6, 3.6], [6.4, 2.2], [7.6, 3.1], [3.4, 6.6], [4.6, 7.6], [7.6, 7.6], [10.2, 9.6], [9.6, 11.2], [6.2, 11.6], [1.7, 8.1], [0.7, 9.8], [11.3, 5.6], [8.4, 5.8], [4.2, 10.4], [11.7, 9.1], [5.9, 6.2]];
const LAMPS: P[] = [[8, 7], [6, 8], [6, 4], [3, 8]];

// ---------- sky ----------

const FIREFLIES = Array.from({ length: 18 }, (_, k) => ({ x: Math.round(170 + rand(k + 7) * 860), y: Math.round(240 + rand(k + 51) * 380), d: Math.round(40 + rand(k + 3) * 50) / 10, delay: -Math.round(rand(k + 11) * 80) / 10 }));

function FarSky() {
  return (
    <svg width={MAP_W + 1200} height={MAP_H} viewBox={`-600 0 ${MAP_W + 1200} ${MAP_H}`} shapeRendering="crispEdges" aria-hidden className="absolute top-0" style={{ left: -600 }}>
      <circle cx={210} cy={150} r={190} fill="url(#tg-sun)" shapeRendering="auto" />
      <rect x={182} y={122} width={56} height={56} fill="#fff6dc" />
      <rect x={176} y={130} width={68} height={40} fill="#fff6dc" />
      <rect x={190} y={116} width={40} height={68} fill="#fff6dc" />
      <Hills x={-600} y={330} w={MAP_W + 1200} tone="url(#tg-hill1)" step={48} />
      <Hills x={-600} y={378} w={MAP_W + 1200} tone="url(#tg-hill2)" step={36} />
      {/* small far islands */}
      <g opacity={0.6}>
        <polygon points={pts([60, 236], [150, 236], [138, 250], [118, 268], [96, 272], [72, 252])} fill="#b9a3d6" />
        <rect x={60} y={230} width={90} height={7} fill="#a8d59a" />
        <rect x={96} y={214} width={10} height={16} fill="#7fbf86" />
        <polygon points={pts([1060, 196], [1140, 196], [1128, 210], [1100, 226], [1074, 210])} fill="#b9a3d6" />
        <rect x={1060} y={190} width={80} height={7} fill="#a8d59a" />
      </g>
    </svg>
  );
}

const CLOUDS_FAR = [
  { x: 40, y: 54, w: 1.1, dur: 150, delay: -40 },
  { x: 420, y: 22, w: 0.8, dur: 190, delay: -120 },
  { x: 760, y: 96, w: 1.3, dur: 170, delay: -10 },
  { x: 980, y: 268, w: 0.9, dur: 210, delay: -160 },
];
const CLOUDS_NEAR = [
  { x: 60, y: 716, w: 1.6, dur: 120, delay: -30 },
  { x: 640, y: 744, w: 1.9, dur: 140, delay: -90 },
  { x: 980, y: 700, w: 1.4, dur: 110, delay: -60 },
];

function Clouds({ list }: { list: typeof CLOUDS_FAR }) {
  return (
    <>
      {list.map((c, k) => (
        <svg key={k} width={130 * c.w} height={34} viewBox={`0 0 ${130 * c.w} 34`} shapeRendering="crispEdges" aria-hidden className={`${s.drift} absolute`} style={{ left: c.x, top: c.y, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }}>
          <Cloud x={0} y={0} w={c.w} />
        </svg>
      ))}
    </>
  );
}

function Birds() {
  return (
    <div aria-hidden className={`${s.birds} absolute left-0 top-[70px]`}>
      {[
        [0, 0],
        [22, 10],
        [42, -4],
      ].map(([x, y], k) => (
        <svg key={k} width={14} height={8} viewBox="0 0 14 8" shapeRendering="crispEdges" className={`${s.bird} absolute`} style={{ left: x, top: y, animationDelay: `${k * 0.15}s` }}>
          <path d="M0 2h2v2h2v2h2v-2h2v-2h2v-2h2v2h-2v2h-2v2h-2v2h-2v-2h-2v-2h-2z" fill="#5d4a7a" />
        </svg>
      ))}
    </div>
  );
}

/** The leafy frame in front of everything, at the bottom corners of the view. */
function Foreground({ k }: { k: number }) {
  const w = 300 * k;
  const h = 280 * k;
  return (
    <>
      <svg width={w} height={h} viewBox="0 0 300 280" shapeRendering="crispEdges" aria-hidden className="absolute bottom-0 left-0" overflow="visible">
        <Tree c={[-6, 286]} size={1.9} hue={1} />
        <Tree c={[70, 312]} size={2.5} />
        <Bush c={[170, 286]} size={1.9} />
        <Bush c={[232, 292]} size={1.4} />
        <Flowers c={[200, 262]} seed={3} n={9} />
        <Flowers c={[128, 270]} seed={5} n={7} />
      </svg>
      <svg width={w} height={h} viewBox="0 0 300 280" shapeRendering="crispEdges" aria-hidden className="absolute bottom-0 right-0" overflow="visible">
        <Tree c={[300, 290]} size={1.8} />
        <Tree c={[232, 318]} size={2.6} hue={1} />
        <Bush c={[118, 292]} size={1.8} />
        <Flowers c={[90, 266]} seed={8} n={9} />
      </svg>
    </>
  );
}

// ---------- the map ----------

export function TownMap() {
  const box = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      // Wide screens see the whole town; phones keep it readable and pan.
      setScale(w >= 760 ? Math.min(1, w / MAP_W, Math.max(0.7, (window.innerHeight - 250) / MAP_H)) : 0.62);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // On a phone, start looking at the middle of town, a little toward Town Hall.
  useEffect(() => {
    const sc = scroller.current;
    if (!sc || scale == null || sc.scrollWidth <= sc.clientWidth) return;
    sc.scrollLeft = Math.max(0, 600 * scale - sc.clientWidth / 2);
    sc.scrollTop = Math.max(0, 400 * scale - sc.clientHeight / 2);
  }, [scale]);

  // Gentle parallax with a mouse (not on touch, not under reduced motion), and no motion while the tab is hidden.
  useEffect(() => {
    const root = box.current;
    const el = box.current;
    if (!root || !el) return;
    const onVis = () => root.classList.toggle(s.paused, document.hidden);
    document.addEventListener("visibilitychange", onVis);
    const ok = window.matchMedia("(hover: hover) and (pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let mx = 0;
    let my = 0;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      mx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      my = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      if (!frame && !document.hidden)
        frame = requestAnimationFrame(() => {
          frame = 0;
          root.style.setProperty("--mx", mx.toFixed(3));
          root.style.setProperty("--my", my.toFixed(3));
        });
    };
    const leave = () => {
      root.style.setProperty("--mx", "0");
      root.style.setProperty("--my", "0");
    };
    if (ok) {
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerleave", leave);
    }
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(frame);
    };
  }, []);

  const k = scale ?? 1;
  const order = (Object.keys(LOTS) as Lot[]).sort((a, b) => LOTS[a][0] + LOTS[a][1] - (LOTS[b][0] + LOTS[b][1]));
  const walkCss = WALKS.map((w) => {
    const path = runTilesF(w.corners).map((t) => tile(t[0], t[1]));
    const frames = path.map((p, i) => `${((i / (path.length - 1)) * 100).toFixed(2)}% { transform: translate(${p[0] - 16}px, ${p[1] - 34}px); }`).join(" ");
    return `@keyframes walk-${w.agent} { ${frames} }`;
  }).join("\n");

  return (
    <div ref={box} className={`${s.scene} relative w-full`}>
      <style>{walkCss}</style>
      <div ref={scroller} className={`${s.scroller} overflow-auto`} style={{ height: scale == null ? undefined : MAP_H * k, maxHeight: scale != null && scale < 0.7 ? "max(300px, calc(100svh - 470px))" : undefined }}>
        <div style={{ width: MAP_W * k, height: MAP_H * k, visibility: scale == null ? "hidden" : undefined }} className="relative mx-auto">
          <div className="absolute left-0 top-0 origin-top-left" style={{ width: MAP_W, height: MAP_H, transform: `scale(${k})` }}>
            <svg width={0} height={0} aria-hidden className="absolute">
              <ArtDefs />
            </svg>

            <div className={`${s.far} absolute inset-0`} aria-hidden>
              <FarSky />
              <Clouds list={CLOUDS_FAR} />
              <Birds />
            </div>

            <div className={`${s.mid} absolute inset-0`}>
              {/* the island: a picture only */}
              <svg width={MAP_W} height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`} shapeRendering="crispEdges" aria-hidden className="absolute inset-0">
                <Island />
                {ROADS.map((r, i) => (
                  <Road key={i} tiles={r.tiles} />
                ))}
                <Square c={tile(...LOTS.forum)} />
                <Water />
                {ROADS.filter((r) => r.flow).map((r, i) => (
                  <FlowArrows key={i} tiles={r.tiles} />
                ))}
                {order.map((id) => (
                  <Shadow key={id} c={tile(...LOTS[id])} rx={SHADOW[id][0]} ry={SHADOW[id][1]} />
                ))}
                {FLOWERS.map(([i, j], n) => (
                  <Flowers key={`f${n}`} c={tile(i, j)} seed={n} />
                ))}
                {PINES.map(([i, j, t], n) => (
                  <Pine key={`p${n}`} c={tile(i, j)} size={t} />
                ))}
                {BUSHES.map(([i, j], n) => (
                  <Bush key={`b${n}`} c={tile(i, j)} size={n % 3 ? 1 : 1.2} />
                ))}
                {TREES.map(([i, j, t, hue], n) => (
                  <Tree key={`t${n}`} c={tile(i, j)} size={t} hue={hue} />
                ))}
                {LAMPS.map((p, n) => (
                  <Lamp key={n} c={tile(p[0], p[1])} />
                ))}
                {/* haze toward the back of the island */}
                <polygon points={pts(corner(0, 0), corner(N, 0), corner(N, N), corner(0, N))} fill="url(#tg-haze)" />
              </svg>

              <div aria-hidden className="absolute inset-0">
                {WALKS.map((w) => {
                  const first = tile(...runTilesF(w.corners)[0]);
                  return (
                    <div key={w.agent} className={`${s.walker} absolute left-0 top-0`} style={{ transform: `translate(${first[0] - 16}px, ${first[1] - 34}px)`, animation: `walk-${w.agent} ${w.seconds}s linear infinite alternate` }}>
                      <Mascot agent={w.agent} size={32} framed={false} />
                    </div>
                  );
                })}
              </div>

              <nav aria-label="Town map" className="absolute inset-0">
                <ul>
                  {order.map((id) => {
                    const c = tile(...LOTS[id]);
                    const [bx, by, bw, bh] = BOX[id];
                    const place = PLACES[id === "hq" ? "home" : (id as PlaceId)];
                    const Art = ART[id];
                    const name = id === "hq" ? "Office" : place.name;
                    return (
                      <li key={id}>
                        <Link href={place.href} className={`${s.building} absolute`} style={{ left: c[0] + bx, top: c[1] + by, width: bw, height: bh, zIndex: 10 + LOTS[id][0] + LOTS[id][1] }} data-testid={`building-${id}`}>
                          <svg width={bw} height={bh} viewBox={`${c[0] + bx} ${c[1] + by} ${bw} ${bh}`} shapeRendering="crispEdges" aria-hidden className={s.art} overflow="visible">
                            <Art c={c} />
                          </svg>
                          <span className={s.sign} style={{ top: -by - SIGN_UP[id], ["--accent" as string]: place.color }}>
                            <span className={s.signIcon}>
                              <PlaceIcon place={id === "hq" ? "home" : (id as PlaceId)} size={14} />
                            </span>
                            <span className="font-pixel">{name}</span>
                          </span>
                          <span className="sr-only">: {id === "hq" ? "your jobs" : place.does}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </div>

            <div aria-hidden className={`${s.near} pointer-events-none absolute inset-0`}>
              {FIREFLIES.map((f, n) => (
                <span key={n} className={s.firefly} style={{ left: f.x, top: f.y, animationDuration: `${f.d}s, ${f.d * 0.6}s`, animationDelay: `${f.delay}s, ${f.delay}s` }} />
              ))}
              <Clouds list={CLOUDS_NEAR} />
            </div>
          </div>
        </div>
      </div>
      <div aria-hidden className={`${s.fore} pointer-events-none absolute inset-0 hidden overflow-hidden sm:block`}>
        <Foreground k={k} />
      </div>
    </div>
  );
}
