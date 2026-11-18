"use client";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Mascot } from "@/components/Mascot";
import type { AgentId } from "@/lib/types";
import { PLACES, PlaceIcon, type PlaceId } from "./places";
import s from "./town.module.css";

/**
 * The town drawn as an isometric pixel map: a slab of grid paper, dirt roads showing how a request
 * travels (Town Hall → Lab → Library, Town Hall → Forum → Store), and one building per place.
 * Every building is a real link named after its place; the bar under the map is the same navigation.
 */

/** Canvas size in map pixels; the canvas is scaled to fit and pans on phones. */
export const MAP_W = 1200;
export const MAP_H = 745;
const A = 48; // half a tile's width
const B = 24; // half a tile's height
const N = 12; // tiles per side
const OX = 600;
const OY = 118;
type P = [number, number];

/** Centre of tile (i, j). */
const tile = (i: number, j: number): P => [OX + (i - j) * A, OY + (i + j) * B + B];
/** A point (di, dj) tiles away from c, raised by h pixels. */
const iso = (c: P, di: number, dj: number, h = 0): P => [c[0] + (di - dj) * A, c[1] + (di + dj) * B - h];
const pts = (...ps: P[]) => ps.map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).join(" ");
const INK = "#0b0b0b";

/** Where each place stands (tile), and where the road reaches its door. */
const LOTS: Record<Exclude<PlaceId, "home"> | "hq", P> = {
  hq: [1.2, 1.2],
  library: [4.5, 2],
  store: [2, 5.5],
  lab: [9, 4.5],
  forum: [5.5, 9],
  hall: [9, 9],
};

/** Roads as tile runs: each pair is a straight stretch from one tile to the next corner. */
const ROADS: { from: PlaceId | "hq"; to: PlaceId | "hq"; tiles: P[]; flow?: boolean }[] = [
  { from: "hall", to: "lab", tiles: [[9, 8], [9, 6]], flow: true },
  { from: "lab", to: "library", tiles: [[8, 4], [5, 4], [5, 3]], flow: true },
  { from: "hall", to: "forum", tiles: [[8, 9], [7, 9]], flow: true },
  { from: "forum", to: "store", tiles: [[4, 9], [2, 9], [2, 7]], flow: true },
  { from: "hq", to: "store", tiles: [[1, 3], [1, 4]] },
  { from: "hq", to: "library", tiles: [[2, 2]] },
  { from: "hq", to: "library", tiles: [[3, 1]] },
];

function runTiles(corners: P[]): P[] {
  const out: P[] = [];
  for (let k = 0; k < corners.length; k++) {
    const [i, j] = corners[k];
    if (k === 0) {
      out.push([i, j]);
      continue;
    }
    const [pi, pj] = corners[k - 1];
    const di = Math.sign(i - pi);
    const dj = Math.sign(j - pj);
    let ci = pi;
    let cj = pj;
    while (ci !== i || cj !== j) {
      ci += di;
      cj += dj;
      out.push([ci, cj]);
    }
  }
  return out;
}

/** The mascots' walks: back and forth along a road, between two doors. */
const WALKS: { agent: AgentId; corners: P[]; seconds: number }[] = [
  { agent: "inso", corners: [[9, 8], [9, 5], [8, 4], [5, 4], [5, 3]], seconds: 16 },
  { agent: "trado", corners: [[8, 9], [2, 9], [2, 7]], seconds: 14 },
  { agent: "travo", corners: [[1, 4], [1, 3], [2, 2], [3, 1]], seconds: 8 },
];

// ---------- drawing helpers ----------

function Box({ c, u, v, h, wall, side, top, z = 0 }: { c: P; u: number; v: number; h: number; wall: string; side: string; top: string; z?: number }) {
  const W = iso(c, -u, v, z);
  const S = iso(c, u, v, z);
  const E = iso(c, u, -v, z);
  const Nn = iso(c, -u, -v, z);
  const up = (p: P): P => [p[0], p[1] - h];
  return (
    <g stroke={INK} strokeWidth={2} strokeLinejoin="miter">
      <polygon points={pts(W, S, up(S), up(W))} fill={wall} />
      <polygon points={pts(S, E, up(E), up(S))} fill={side} />
      <polygon points={pts(up(Nn), up(E), up(S), up(W))} fill={top} />
    </g>
  );
}

/** A roof with its ridge running back to front (the gable faces the road on the left side). */
function Gable({ c, u, v, h, r, front, roof, roofDark }: { c: P; u: number; v: number; h: number; r: number; front: string; roof: string; roofDark: string }) {
  const W = iso(c, -u, v, h);
  const S = iso(c, u, v, h);
  const E = iso(c, u, -v, h);
  const Nn = iso(c, -u, -v, h);
  const rf: P = [(W[0] + S[0]) / 2, (W[1] + S[1]) / 2 - r];
  const rb: P = [(Nn[0] + E[0]) / 2, (Nn[1] + E[1]) / 2 - r];
  return (
    <g stroke={INK} strokeWidth={2} strokeLinejoin="miter">
      <polygon points={pts(W, Nn, rb, rf)} fill={roofDark} />
      <polygon points={pts(W, S, rf)} fill={front} />
      <polygon points={pts(S, E, rb, rf)} fill={roof} />
    </g>
  );
}

/** A four-sided pyramid roof. */
function Pyramid({ c, u, v, h, r, roof, roofDark }: { c: P; u: number; v: number; h: number; r: number; roof: string; roofDark: string }) {
  const W = iso(c, -u, v, h);
  const S = iso(c, u, v, h);
  const E = iso(c, u, -v, h);
  const apex: P = [c[0], c[1] - h - r];
  return (
    <g stroke={INK} strokeWidth={2} strokeLinejoin="miter">
      <polygon points={pts(W, S, apex)} fill={roof} />
      <polygon points={pts(S, E, apex)} fill={roofDark} />
    </g>
  );
}

/** Rectangles painted onto the left face (x along the face 0..1, y up from the base in px). */
function onLeft(c: P, u: number, v: number, x: number, y: number, w: number, h: number): string {
  const W = iso(c, -u, v);
  const S = iso(c, u, v);
  const at = (fx: number, fy: number): P => [W[0] + (S[0] - W[0]) * fx, W[1] + (S[1] - W[1]) * fx - fy];
  return pts(at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h));
}
function onRight(c: P, u: number, v: number, x: number, y: number, w: number, h: number): string {
  const S = iso(c, u, v);
  const E = iso(c, u, -v);
  const at = (fx: number, fy: number): P => [S[0] + (E[0] - S[0]) * fx, S[1] + (E[1] - S[1]) * fx - fy];
  return pts(at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h));
}

// ---------- buildings ----------

function Library({ c }: { c: P }) {
  const u = 1.05;
  const v = 0.85;
  const h = 46;
  const purple = PLACES.library.color;
  return (
    <g>
      {/* steps */}
      <Box c={iso(c, 0, 0.12)} u={u + 0.12} v={v + 0.1} h={8} wall="#e9e4d8" side="#d6d0c2" top="#f4f0e6" />
      <Box c={c} u={u} v={v} h={h} wall="#f7f3ea" side="#e2dccd" top="#f7f3ea" z={8} />
      {/* columns on the front */}
      {[0.08, 0.27, 0.46, 0.65, 0.84].map((x) => (
        <polygon key={x} points={onLeft(iso(c, 0, 0, 8), u, v, x, 0, 0.09, h - 4)} fill="#ffffff" stroke={INK} strokeWidth={1.5} />
      ))}
      {/* door */}
      <polygon points={onLeft(iso(c, 0, 0, 8), u, v, 0.38, 0, 0.12, 24)} fill={purple} stroke={INK} strokeWidth={1.5} opacity={0.0} />
      {/* windows on the side */}
      {[0.18, 0.5, 0.78].map((x) => (
        <polygon key={x} points={onRight(iso(c, 0, 0, 8), u, v, x, 14, 0.12, 18)} fill="#cfc8f5" stroke={INK} strokeWidth={1.5} />
      ))}
      <Gable c={iso(c, 0, 0, 8)} u={u + 0.08} v={v + 0.08} h={h} r={34} front="#ffffff" roof={purple} roofDark="#4b3bb0" />
      {/* the pediment's round window */}
      <rect x={iso(c, 0, v, 8 + h + 12)[0] - 26} y={iso(c, 0, v, 8 + h + 12)[1] - 2} width={8} height={8} fill={purple} stroke={INK} strokeWidth={1.5} />
      {/* bell cupola */}
      <g>
        <Box c={iso(c, 0.25, -0.25, 8 + h + 18)} u={0.22} v={0.22} h={22} wall="#f7f3ea" side="#e2dccd" top="#f7f3ea" />
        <rect x={iso(c, 0.25, -0.25)[0] - 11} y={iso(c, 0.25, -0.25, 8 + h + 34)[1]} width={8} height={9} fill="#fab219" stroke={INK} strokeWidth={1.5} className={s.bell} />
        <Pyramid c={iso(c, 0.25, -0.25)} u={0.28} v={0.28} h={8 + h + 18 + 22} r={20} roof={purple} roofDark="#4b3bb0" />
      </g>
    </g>
  );
}

function Store({ c }: { c: P }) {
  const blue = PLACES.store.color;
  const u = 1.05;
  const v = 0.75;
  // Two counters along the front: Verified by Circle (left) and Independent (right).
  const counter = (dc: number, label: string, goods: string[]) => {
    const cc = iso(c, dc, 0.25);
    return (
      <g>
        <Box c={cc} u={0.46} v={0.32} h={26} wall="#ffffff" side="#e7e6e2" top="#f6efe0" />
        {goods.map((g, k) => (
          <Box key={k} c={iso(cc, -0.25 + k * 0.25, 0)} u={0.09} v={0.09} h={10} wall={g} side={g} top="#ffffff" z={26} />
        ))}
        <text x={cc[0] - 8} y={cc[1] + 14} fontSize={10} fontFamily="var(--font-pixel)" fill={INK} textAnchor="middle" transform={`rotate(26.57 ${cc[0] - 8} ${cc[1] + 14})`}>
          {label}
        </text>
      </g>
    );
  };
  const post = (di: number, dj: number) => {
    const b = iso(c, di, dj);
    return <rect x={b[0] - 2} y={b[1] - 74} width={4} height={74} fill="#c99a5b" stroke={INK} strokeWidth={1.5} />;
  };
  // Awning: a striped slope from the back wall over the counters.
  const W = iso(c, -u, v + 0.15, 66);
  const S = iso(c, u, v + 0.15, 66);
  const Wb = iso(c, -u, -v, 92);
  const Sb = iso(c, u, -v, 92);
  const stripes = 7;
  return (
    <g>
      <Box c={iso(c, 0, -0.45)} u={u} v={0.3} h={70} wall="#dbe7f7" side="#c3d4ee" top="#e6effb" />
      {post(-u + 0.06, v + 0.1)}
      {post(u - 0.06, v + 0.1)}
      {counter(-0.52, "✓", ["#1baf7a", "#2368c4", "#fab219"])}
      {counter(0.52, "i", ["#eb6834", "#6250d6", "#e87ba4"])}
      <g stroke={INK} strokeWidth={2}>
        {Array.from({ length: stripes }, (_, k) => {
          const f0 = k / stripes;
          const f1 = (k + 1) / stripes;
          const lerp = (a: P, b: P, f: number): P => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
          return <polygon key={k} points={pts(lerp(W, S, f0), lerp(W, S, f1), lerp(Wb, Sb, f1), lerp(Wb, Sb, f0))} fill={k % 2 ? "#ffffff" : blue} />;
        })}
        {/* scalloped front edge */}
        {Array.from({ length: stripes }, (_, k) => {
          const f = (k + 0.5) / stripes;
          const p: P = [W[0] + (S[0] - W[0]) * f, W[1] + (S[1] - W[1]) * f];
          return <rect key={k} x={p[0] - 6} y={p[1] - 1} width={12} height={7} fill={k % 2 ? "#ffffff" : blue} />;
        })}
      </g>
    </g>
  );
}

function Hall({ c }: { c: P }) {
  const u = 1.2;
  const v = 1.0;
  const h = 58;
  const gold = PLACES.hall.color;
  const towerC = iso(c, 0.05, -0.1);
  const th = h + 64;
  const face = iso(towerC, -0.32, 0.32, th - 30);
  const mail = iso(c, 0.55, v + 0.45);
  return (
    <g>
      <Box c={c} u={u} v={v} h={h} wall="#f1ebdd" side="#ddd3bf" top="#f1ebdd" />
      {/* door and windows on the front */}
      <polygon points={onLeft(c, u, v, 0.42, 0, 0.16, 32)} fill="#7a5000" stroke={INK} strokeWidth={1.5} />
      {[0.1, 0.24, 0.66, 0.8].map((x) => (
        <polygon key={x} points={onLeft(c, u, v, x, 26, 0.09, 18)} fill="#fff4d9" stroke={INK} strokeWidth={1.5} />
      ))}
      {[0.12, 0.34, 0.56, 0.78].map((x) => (
        <polygon key={x} points={onRight(c, u, v, x, 26, 0.1, 18)} fill="#fff4d9" stroke={INK} strokeWidth={1.5} />
      ))}
      <Pyramid c={c} u={u + 0.1} v={v + 0.1} h={h} r={30} roof="#3a3936" roofDark="#252422" />
      {/* clock tower */}
      <Box c={towerC} u={0.32} v={0.32} h={th} wall="#f1ebdd" side="#ddd3bf" top="#f1ebdd" z={0} />
      <rect x={face[0] - 12} y={face[1] - 4} width={22} height={22} fill="#ffffff" stroke={INK} strokeWidth={2} />
      <rect x={face[0] - 2} y={face[1] + 1} width={2} height={7} fill={INK} className={s.hand} style={{ transformOrigin: `${face[0] - 1}px ${face[1] + 7}px` }} />
      <rect x={face[0] - 1} y={face[1] + 6} width={6} height={2} fill={INK} />
      <Pyramid c={towerC} u={0.4} v={0.4} h={th} r={28} roof={gold} roofDark="#c98a00" />
      {/* flag */}
      <rect x={towerC[0] - 1} y={towerC[1] - th - 52} width={2} height={26} fill={INK} />
      <polygon points={pts([towerC[0] + 1, towerC[1] - th - 52], [towerC[0] + 18, towerC[1] - th - 46], [towerC[0] + 1, towerC[1] - th - 40])} fill="#e34948" stroke={INK} strokeWidth={1.5} className={s.flag} />
      {/* mailbox at the door */}
      <rect x={mail[0] - 1} y={mail[1] - 20} width={3} height={20} fill={INK} />
      <rect x={mail[0] - 9} y={mail[1] - 34} width={18} height={14} fill="#e34948" stroke={INK} strokeWidth={2} />
      <rect x={mail[0] - 5} y={mail[1] - 30} width={10} height={2} fill={INK} />
    </g>
  );
}

function Lab({ c }: { c: P }) {
  const green = PLACES.lab.color;
  const h = 40;
  const r = 52;
  const base: P = [c[0], c[1]];
  const chim = iso(c, 0.7, -0.6);
  return (
    <g>
      {/* chimney behind the dome */}
      <Box c={chim} u={0.13} v={0.13} h={104} wall="#c9c8c2" side="#a9a8a2" top="#8a8984" />
      <g className={s.smoke}>
        <rect x={chim[0] - 6} y={chim[1] - 124} width={10} height={8} fill="#e7e6e2" stroke={INK} strokeWidth={1.5} />
        <rect x={chim[0] + 4} y={chim[1] - 140} width={8} height={7} fill="#f1f0ec" stroke={INK} strokeWidth={1.5} />
      </g>
      {/* drum */}
      <path d={`M${base[0] - r} ${base[1]} L${base[0] - r} ${base[1] - h} A ${r} ${r / 2} 0 0 0 ${base[0] + r} ${base[1] - h} L ${base[0] + r} ${base[1]} A ${r} ${r / 2} 0 0 1 ${base[0] - r} ${base[1]} Z`} fill="#f4f6f2" stroke={INK} strokeWidth={2} />
      {/* door */}
      <rect x={base[0] - 34} y={base[1] - 12} width={16} height={30} fill={green} stroke={INK} strokeWidth={1.5} />
      {/* band */}
      <path d={`M${base[0] - r} ${base[1] - h + 6} A ${r} ${r / 2} 0 0 0 ${base[0] + r} ${base[1] - h + 6}`} fill="none" stroke={green} strokeWidth={5} />
      {/* dome */}
      <path d={`M${base[0] - r - 4} ${base[1] - h} A ${r + 4} ${r + 8} 0 0 1 ${base[0] + r + 4} ${base[1] - h} A ${r + 4} ${(r + 4) / 2} 0 0 1 ${base[0] - r - 4} ${base[1] - h} Z`} fill="#dfe3e6" stroke={INK} strokeWidth={2} />
      {/* slit and telescope */}
      <polygon points={pts([base[0] - 4, base[1] - h - r - 6], [base[0] + 10, base[1] - h - r - 4], [base[0] + 12, base[1] - h + 18], [base[0] - 2, base[1] - h + 18])} fill="#3a3936" stroke={INK} strokeWidth={1.5} />
      <polygon points={pts([base[0] + 2, base[1] - h - 30], [base[0] + 40, base[1] - h - 62], [base[0] + 46, base[1] - h - 54], [base[0] + 8, base[1] - h - 22])} fill={green} stroke={INK} strokeWidth={2} />
      <rect x={base[0] - 26} y={base[1] - h - 30} width={6} height={6} fill="#ffffff" />
    </g>
  );
}

/** The Forum's open square, drawn with the ground so people walk across it. */
function Square({ c }: { c: P }) {
  const stones: React.JSX.Element[] = [];
  for (let a = -1; a < 1; a += 0.5)
    for (let b = -1; b < 1; b += 0.5) {
      const p = iso(c, a + 0.25, b + 0.25);
      stones.push(<polygon key={`${a}${b}`} points={pts(iso(p, -0.22, -0.22), iso(p, 0.22, -0.22), iso(p, 0.22, 0.22), iso(p, -0.22, 0.22))} fill={Math.round((a + b) * 2) % 2 === 0 ? "#efe6d6" : "#e6dac4"} stroke="#cdbd9e" strokeWidth={1} />);
    }
  return (
    <g>
      <polygon points={pts(iso(c, -1.05, -1.05), iso(c, 1.05, -1.05), iso(c, 1.05, 1.05), iso(c, -1.05, 1.05))} fill="#f3ecdd" stroke={INK} strokeWidth={2} />
      {stones}
    </g>
  );
}

function Forum({ c }: { c: P }) {
  const orange = PLACES.forum.color;
  // A notice board facing the road, and two benches.
  const board = iso(c, -0.15, -0.35);
  const bl = iso(board, -0.62, 0);
  const br = iso(board, 0.62, 0);
  const bench = (p: P) => <Box c={p} u={0.36} v={0.1} h={10} wall="#c99a5b" side="#a87c42" top="#d8ae73" />;
  return (
    <g>
      {/* posts */}
      <rect x={bl[0] - 2} y={bl[1] - 70} width={5} height={70} fill="#8a5a2b" stroke={INK} strokeWidth={1.5} />
      <rect x={br[0] - 2} y={br[1] - 70} width={5} height={70} fill="#8a5a2b" stroke={INK} strokeWidth={1.5} />
      {/* the board */}
      <polygon points={pts([bl[0], bl[1] - 74], [br[0], br[1] - 74], [br[0], br[1] - 26], [bl[0], bl[1] - 26])} fill="#c99a5b" stroke={INK} strokeWidth={2} />
      {(
        [
          [0.08, 30, "#ffffff"],
          [0.36, 34, "#fff4d9"],
          [0.64, 28, "#ffffff"],
          [0.2, 56, "#fdeee7"],
          [0.52, 58, "#ffffff"],
        ] as const
      ).map(([f, y, col], k) => {
        const x0 = bl[0] + (br[0] - bl[0]) * f;
        const y0 = bl[1] + (br[1] - bl[1]) * f - y - 8;
        return (
          <g key={k}>
            <polygon points={pts([x0, y0], [x0 + 18, y0 + 9], [x0 + 18, y0 + 26], [x0, y0 + 17])} fill={col} stroke={INK} strokeWidth={1.5} />
            <rect x={x0 + 7} y={y0 + 2} width={4} height={4} fill={k % 2 ? orange : "#e34948"} />
          </g>
        );
      })}
      <polygon points={pts([bl[0] - 2, bl[1] - 80], [br[0] + 2, br[1] - 80], [br[0] + 2, br[1] - 74], [bl[0] - 2, bl[1] - 74])} fill={orange} stroke={INK} strokeWidth={2} />
      {bench(iso(c, 0.55, 0.62))}
      {bench(iso(c, -0.45, 0.72))}
    </g>
  );
}

function HQ({ c }: { c: P }) {
  const u = 0.6;
  const v = 0.6;
  const h = 112;
  const win = [];
  for (let row = 0; row < 4; row++)
    for (const x of [0.12, 0.42, 0.72]) {
      win.push(<polygon key={`l${row}${x}`} points={onLeft(c, u, v, x, 18 + row * 22, 0.16, 12)} fill={row === 1 && x === 0.42 ? "#fab219" : "#e6effb"} stroke={INK} strokeWidth={1.5} />);
      win.push(<polygon key={`r${row}${x}`} points={onRight(c, u, v, x, 18 + row * 22, 0.16, 12)} fill="#c3d4ee" stroke={INK} strokeWidth={1.5} />);
    }
  const roofC = iso(c, 0, 0, h);
  return (
    <g>
      <Box c={c} u={u} v={v} h={h} wall="#f7f7f5" side="#e2e1dc" top="#3a3936" />
      {win}
      <Box c={roofC} u={0.28} v={0.28} h={12} wall="#0b0b0b" side="#0b0b0b" top="#6250d6" />
    </g>
  );
}

const ART: Record<Exclude<PlaceId, "home"> | "hq", (p: { c: P }) => React.JSX.Element> = { library: Library, store: Store, hall: Hall, lab: Lab, forum: Forum, hq: HQ };
/** How far above its tile each sign hangs, in map pixels. */
const SIGN_UP: Record<keyof typeof ART, number> = { library: 172, store: 132, hall: 200, lab: 150, forum: 118, hq: 168 };
/** The bounding box of each drawing around its tile centre: [left, top, width, height]. */
const BOX: Record<keyof typeof ART, [number, number, number, number]> = {
  library: [-80, -146, 160, 190],
  store: [-80, -130, 160, 175],
  hall: [-100, -210, 200, 260],
  lab: [-74, -150, 150, 190],
  forum: [-110, -100, 220, 160],
  hq: [-60, -140, 120, 180],
};

// ---------- ground ----------

function Ground() {
  const top = tile(0, 0);
  const corner = (i: number, j: number): P => [OX + (i - j) * A, OY + (i + j) * B];
  const Nc = corner(0, 0);
  const Ec = corner(N, 0);
  const Sc = corner(N, N);
  const Wc = corner(0, N);
  const depth = 22;
  const down = (p: P): P => [p[0], p[1] + depth];
  const lines: React.JSX.Element[] = [];
  for (let k = 1; k < N; k++) {
    lines.push(<line key={`i${k}`} x1={corner(k, 0)[0]} y1={corner(k, 0)[1]} x2={corner(k, N)[0]} y2={corner(k, N)[1]} />);
    lines.push(<line key={`j${k}`} x1={corner(0, k)[0]} y1={corner(0, k)[1]} x2={corner(N, k)[0]} y2={corner(N, k)[1]} />);
  }
  void top;
  return (
    <g>
      {/* the slab's sides */}
      <polygon points={pts(Wc, Sc, down(Sc), down(Wc))} fill="#e4dccb" stroke={INK} strokeWidth={2} />
      <polygon points={pts(Sc, Ec, down(Ec), down(Sc))} fill="#d3c8b0" stroke={INK} strokeWidth={2} />
      {/* soil stripes on the sides */}
      <polyline points={pts([Wc[0], Wc[1] + 9], [Sc[0], Sc[1] + 9], [Ec[0], Ec[1] + 9])} fill="none" stroke="#c4b796" strokeWidth={2} />
      {/* grid paper top */}
      <polygon points={pts(Nc, Ec, Sc, Wc)} fill="#f7f6f1" stroke={INK} strokeWidth={2} />
      <g stroke="rgb(11 11 11 / 0.07)" strokeWidth={1}>
        {lines}
      </g>
    </g>
  );
}

function Road({ tiles: corners }: { tiles: P[] }) {
  const all = runTiles(corners);
  return (
    <g>
      {all.map(([i, j], k) => {
        const c = tile(i, j);
        return <polygon key={k} points={pts(iso(c, -0.5, -0.5), iso(c, 0.5, -0.5), iso(c, 0.5, 0.5), iso(c, -0.5, 0.5))} fill="#ecdcb8" stroke="#d6c08f" strokeWidth={1.5} />;
      })}
      {/* pebbles */}
      {all.map(([i, j], k) => {
        const c = tile(i, j);
        return k % 2 ? <rect key={`p${k}`} x={c[0] - 10 + (k % 3) * 8} y={c[1] - 3} width={4} height={3} fill="#d6c08f" /> : null;
      })}
    </g>
  );
}

/** Small arrows along a road, pointing the way a request travels. */
function FlowArrows({ tiles: corners }: { tiles: P[] }) {
  const all = runTiles(corners);
  const out: React.JSX.Element[] = [];
  for (let k = 0; k < all.length - 1; k += 2) {
    const a = tile(...all[k]);
    const b = tile(...all[k + 1]);
    const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    out.push(<path key={k} d="M-5 -4 L1 0 L-5 4" transform={`translate(${m[0]} ${m[1]}) rotate(${ang})`} fill="none" stroke="#a88a52" strokeWidth={2} />);
  }
  return <g>{out}</g>;
}

function Tree({ c, tall = 1 }: { c: P; tall?: number }) {
  const h = 30 * tall;
  return (
    <g stroke={INK} strokeWidth={1.5}>
      <rect x={c[0] - 3} y={c[1] - 14} width={6} height={14} fill="#8a5a2b" />
      <polygon points={pts([c[0], c[1] - 14 - h], [c[0] + 16, c[1] - 14 - h * 0.35], [c[0] + 12, c[1] - 12], [c[0] - 12, c[1] - 12], [c[0] - 16, c[1] - 14 - h * 0.35])} fill="#1baf7a" />
      <polygon points={pts([c[0], c[1] - 14 - h], [c[0] + 16, c[1] - 14 - h * 0.35], [c[0] + 12, c[1] - 12], [c[0], c[1] - 12])} fill="#13895f" />
    </g>
  );
}

function Pond({ c }: { c: P }) {
  return (
    <g>
      <polygon points={pts(iso(c, -0.9, -0.6), iso(c, 0.5, -0.9), iso(c, 0.9, 0.3), iso(c, -0.2, 0.9), iso(c, -0.9, 0.4))} fill="#bcd9f2" stroke={INK} strokeWidth={2} />
      <rect x={c[0] - 18} y={c[1] - 4} width={12} height={2} fill="#ffffff" />
      <rect x={c[0] + 6} y={c[1] + 6} width={8} height={2} fill="#ffffff" />
    </g>
  );
}

function Lamp({ c }: { c: P }) {
  return (
    <g>
      <rect x={c[0] - 1.5} y={c[1] - 38} width={3} height={38} fill={INK} />
      <rect x={c[0] - 5} y={c[1] - 46} width={10} height={9} fill="#fff4d9" stroke={INK} strokeWidth={1.5} className={s.lamp} />
    </g>
  );
}

const TREES: [number, number, number][] = [
  [0.6, 7, 1.1], [0.9, 8.7, 0.9], [1.5, 10.5, 1], [3.2, 11.3, 0.9], [5.1, 11.4, 1.1], [7.6, 11.3, 0.9], [11.2, 10.2, 1], [10.6, 11.4, 0.9],
  [11.4, 3, 1.1], [10.5, 1, 0.9], [8.4, 0.7, 1], [6.6, 0.8, 0.9], [11.5, 4.2, 0.8], [0.6, 4.6, 0.8],
];
const LAMPS: P[] = [[8, 7], [6, 8], [6, 4], [3, 8]];

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

  // On a phone, start looking at Town Hall's square.
  useEffect(() => {
    const sc = scroller.current;
    if (!sc || scale == null || sc.scrollWidth <= sc.clientWidth) return;
    // Look at the middle of town, a little toward Town Hall.
    sc.scrollLeft = Math.max(0, 600 * scale - sc.clientWidth / 2);
    sc.scrollTop = Math.max(0, 390 * scale - sc.clientHeight / 2);
  }, [scale]);

  const k = scale ?? 1;
  const order = (Object.keys(LOTS) as (keyof typeof LOTS)[]).sort((a, b) => LOTS[a][0] + LOTS[a][1] - (LOTS[b][0] + LOTS[b][1]));
  const walkCss = WALKS.map((w) => {
    const path = runTilesF(w.corners).map((t) => tile(t[0], t[1]));
    const frames = path.map((p, i) => `${((i / (path.length - 1)) * 100).toFixed(2)}% { transform: translate(${p[0] - 16}px, ${p[1] - 34}px); }`).join(" ");
    return `@keyframes walk-${w.agent} { ${frames} }`;
  }).join("\n");

  return (
    <div ref={box} className="relative w-full">
      <style>{walkCss}</style>
      <div ref={scroller} className={`${s.scroller} overflow-auto`} style={{ height: scale == null ? undefined : MAP_H * k, maxHeight: scale != null && scale < 0.7 ? "max(300px, calc(100svh - 470px))" : undefined }}>
        <div style={{ width: MAP_W * k, height: MAP_H * k, visibility: scale == null ? "hidden" : undefined }} className="relative mx-auto">
          <div className="absolute left-0 top-0 origin-top-left" style={{ width: MAP_W, height: MAP_H, transform: `scale(${k})` }}>
            {/* ground, roads, trees: a picture only */}
            <svg width={MAP_W} height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`} shapeRendering="crispEdges" aria-hidden className="absolute inset-0">
              <Ground />
              {ROADS.map((r, i) => (
                <Road key={i} tiles={r.tiles} />
              ))}
              <Square c={tile(...LOTS.forum)} />
              <Pond c={tile(10.7, 6.7)} />
              {ROADS.filter((r) => r.flow).map((r, i) => (
                <FlowArrows key={i} tiles={r.tiles} />
              ))}
              {TREES.map(([i, j, t], n) => (
                <Tree key={n} c={tile(i, j)} tall={t} />
              ))}
              {LAMPS.map((p, n) => (
                <Lamp key={n} c={tile(p[0], p[1])} />
              ))}
            </svg>

            {/* the mascots walking the roads */}
            <div aria-hidden className="absolute inset-0">
              {WALKS.map((w) => {
                const first = tile(...runTilesF(w.corners)[0]);
                return (
                  <div
                    key={w.agent}
                    className={`${s.walker} absolute left-0 top-0`}
                    style={{ transform: `translate(${first[0] - 16}px, ${first[1] - 34}px)`, animation: `walk-${w.agent} ${w.seconds}s linear infinite alternate` }}
                  >
                    <Mascot agent={w.agent} size={32} framed={false} />
                  </div>
                );
              })}
            </div>

            {/* the buildings: real links, in drawing order back to front */}
            <nav aria-label="Town map" className="absolute inset-0">
              <ul>
                {order.map((id) => {
                  const c = tile(...LOTS[id]);
                  const [bx, by, bw, bh] = BOX[id];
                  const place = PLACES[id === "hq" ? "home" : id];
                  const Art = ART[id];
                  const name = id === "hq" ? "Office" : place.name;
                  return (
                    <li key={id}>
                      <Link
                        href={place.href}
                        className={`${s.building} absolute`}
                        style={{ left: c[0] + bx, top: c[1] + by, width: bw, height: bh, zIndex: 10 + LOTS[id][0] + LOTS[id][1] }}
                        data-testid={`building-${id}`}
                      >
                        <svg width={bw} height={bh} viewBox={`${c[0] + bx} ${c[1] + by} ${bw} ${bh}`} shapeRendering="crispEdges" aria-hidden className={s.art} overflow="visible">
                          <Art c={c} />
                        </svg>
                        <span className={s.sign} style={{ top: -by - SIGN_UP[id], ["--accent" as string]: place.color }}>
                          <span className={s.signIcon}>
                            <PlaceIcon place={id === "hq" ? "home" : id} size={14} />
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
        </div>
      </div>
    </div>
  );
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
