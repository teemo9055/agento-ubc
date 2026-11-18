import type { JSX } from "react";
import { PLACES, type PlaceId } from "./places";
import s from "./town.module.css";

/**
 * The town's pixel art, shared by the map and every building's banner: isometric helpers, the
 * six buildings, and the scenery (trees, bushes, flowers, lamps with their glow, clouds, birds).
 * Flat fills and ink outlines, crisp edges; light comes from the warm low sun at the upper left.
 */
export type P = [number, number];
export const A = 48; // half a tile's width
export const B = 24; // half a tile's height
export const INK = "#0b0b0b";

/** A point (di, dj) tiles away from c, raised by h pixels. */
export const iso = (c: P, di: number, dj: number, h = 0): P => [c[0] + (di - dj) * A, c[1] + (di + dj) * B - h];
export const pts = (...ps: P[]) => ps.map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).join(" ");
export const diamond = (c: P, u: number, v = u) => pts(iso(c, -u, -v), iso(c, u, -v), iso(c, u, v), iso(c, -u, v));

/** Warm light, used for windows, lamps and the sun. */
export const GLOW = "#ffd98a";
const WIN = "#ffe7a6";

/** Gradients the art refers to. Render once per page, inside any svg. */
export function ArtDefs() {
  return (
    <defs>
      <radialGradient id="tg-glow">
        <stop offset="0" stopColor="#fff2c4" stopOpacity="0.95" />
        <stop offset="0.35" stopColor="#ffd27a" stopOpacity="0.55" />
        <stop offset="1" stopColor="#ffb35c" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="tg-shadow">
        <stop offset="0" stopColor="#2b1d4a" stopOpacity="0.34" />
        <stop offset="0.6" stopColor="#2b1d4a" stopOpacity="0.14" />
        <stop offset="1" stopColor="#2b1d4a" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="tg-sun">
        <stop offset="0" stopColor="#fffbe8" stopOpacity="1" />
        <stop offset="0.18" stopColor="#fff0c2" stopOpacity="0.95" />
        <stop offset="0.45" stopColor="#ffd6a8" stopOpacity="0.35" />
        <stop offset="1" stopColor="#ffc3b8" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="tg-haze" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f8e6f3" stopOpacity="0.6" />
        <stop offset="0.45" stopColor="#f8e6f3" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="tg-hill1" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#d9c0ea" />
        <stop offset="0.5" stopColor="#ecc6dc" stopOpacity="0.6" />
        <stop offset="1" stopColor="#f7cfc9" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="tg-hill2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#c7abe0" />
        <stop offset="0.5" stopColor="#e2bcd8" stopOpacity="0.55" />
        <stop offset="1" stopColor="#f7cfc9" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="tg-fall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#9fdcf5" />
        <stop offset="1" stopColor="#d9f3ff" stopOpacity="0.2" />
      </linearGradient>
    </defs>
  );
}

/** Soft light that blooms around a lamp or a window. */
export const Glow = ({ c, r = 26, pulse = true }: { c: P; r?: number; pulse?: boolean }) => <circle cx={c[0]} cy={c[1]} r={r} fill="url(#tg-glow)" className={pulse ? s.glow : undefined} style={{ mixBlendMode: "screen" }} />;

/** The soft shadow a building casts on the grass, away from the sun. */
export const Shadow = ({ c, rx = 96, ry = 44 }: { c: P; rx?: number; ry?: number }) => <ellipse cx={c[0] + 22} cy={c[1] + 12} rx={rx} ry={ry} fill="url(#tg-shadow)" />;

// ---------- shapes ----------

export function Box({ c, u, v, h, wall, side, top, z = 0 }: { c: P; u: number; v: number; h: number; wall: string; side: string; top: string; z?: number }) {
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
function faceAt(c: P, u: number, v: number, left: boolean) {
  const a = left ? iso(c, -u, v) : iso(c, u, v);
  const b = left ? iso(c, u, v) : iso(c, u, -v);
  return (fx: number, fy: number): P => [a[0] + (b[0] - a[0]) * fx, a[1] + (b[1] - a[1]) * fx - fy];
}
export function onLeft(c: P, u: number, v: number, x: number, y: number, w: number, h: number): string {
  const at = faceAt(c, u, v, true);
  return pts(at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h));
}
export function onRight(c: P, u: number, v: number, x: number, y: number, w: number, h: number): string {
  const at = faceAt(c, u, v, false);
  return pts(at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h));
}
/** A lit window on a face, with its bloom. */
function Window({ c, u, v, left, x, y, w, h }: { c: P; u: number; v: number; left: boolean; x: number; y: number; w: number; h: number }) {
  const at = faceAt(c, u, v, left);
  const mid = at(x + w / 2, y + h / 2);
  return (
    <g>
      <polygon points={(left ? onLeft : onRight)(c, u, v, x, y, w, h)} fill={WIN} stroke={INK} strokeWidth={1.5} />
      <Glow c={mid} r={16} pulse={false} />
    </g>
  );
}

// ---------- buildings ----------

function Library({ c }: { c: P }) {
  const u = 1.05;
  const v = 0.85;
  const h = 46;
  const purple = PLACES.library.color;
  const b = iso(c, 0, 0, 8);
  return (
    <g>
      <Box c={iso(c, 0, 0.12)} u={u + 0.12} v={v + 0.1} h={8} wall="#efe8da" side="#d8cfbe" top="#f7f2e7" />
      <Box c={c} u={u} v={v} h={h} wall="#fbf6ec" side="#e3dccb" top="#fbf6ec" z={8} />
      {[0.08, 0.27, 0.46, 0.65, 0.84].map((x) => (
        <polygon key={x} points={onLeft(b, u, v, x, 0, 0.09, h - 4)} fill="#ffffff" stroke={INK} strokeWidth={1.5} />
      ))}
      {[0.18, 0.5, 0.78].map((x) => (
        <Window key={x} c={b} u={u} v={v} left={false} x={x} y={14} w={0.12} h={18} />
      ))}
      <Gable c={b} u={u + 0.08} v={v + 0.08} h={h} r={34} front="#ffffff" roof={purple} roofDark="#4b3bb0" />
      <rect x={iso(c, 0, v, 8 + h + 12)[0] - 26} y={iso(c, 0, v, 8 + h + 12)[1] - 2} width={8} height={8} fill={WIN} stroke={INK} strokeWidth={1.5} />
      <g>
        <Box c={iso(c, 0.25, -0.25, 8 + h + 18)} u={0.22} v={0.22} h={22} wall="#fbf6ec" side="#e3dccb" top="#fbf6ec" />
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
    const p = iso(c, di, dj);
    return <rect x={p[0] - 2} y={p[1] - 74} width={4} height={74} fill="#c99a5b" stroke={INK} strokeWidth={1.5} />;
  };
  const W = iso(c, -u, v + 0.15, 66);
  const S = iso(c, u, v + 0.15, 66);
  const Wb = iso(c, -u, -v, 92);
  const Sb = iso(c, u, -v, 92);
  const stripes = 7;
  const lerp = (a: P, b: P, f: number): P => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  const back = iso(c, 0, -0.45);
  return (
    <g>
      <Box c={back} u={u} v={0.3} h={70} wall="#dbe7f7" side="#c3d4ee" top="#e6effb" />
      <Window c={back} u={u} v={0.3} left={false} x={0.3} y={22} w={0.4} h={20} />
      {post(-u + 0.06, v + 0.1)}
      {post(u - 0.06, v + 0.1)}
      {counter(-0.52, "✓", ["#1baf7a", "#2368c4", "#fab219"])}
      {counter(0.52, "i", ["#eb6834", "#6250d6", "#e87ba4"])}
      <g stroke={INK} strokeWidth={2}>
        {Array.from({ length: stripes }, (_, k) => (
          <polygon key={k} points={pts(lerp(W, S, k / stripes), lerp(W, S, (k + 1) / stripes), lerp(Wb, Sb, (k + 1) / stripes), lerp(Wb, Sb, k / stripes))} fill={k % 2 ? "#ffffff" : blue} />
        ))}
        {Array.from({ length: stripes }, (_, k) => {
          const p = lerp(W, S, (k + 0.5) / stripes);
          return <rect key={k} x={p[0] - 6} y={p[1] - 1} width={12} height={7} fill={k % 2 ? "#ffffff" : blue} />;
        })}
      </g>
      {/* string lights under the awning */}
      {Array.from({ length: 6 }, (_, k) => {
        const p = lerp(iso(c, -u + 0.1, v + 0.15, 58), iso(c, u - 0.1, v + 0.15, 58), (k + 0.5) / 6);
        return (
          <g key={`l${k}`}>
            <rect x={p[0] - 2} y={p[1] - 2} width={4} height={4} fill={GLOW} stroke={INK} strokeWidth={1} />
            <Glow c={p} r={12} />
          </g>
        );
      })}
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
  const door = faceAt(c, u, v, true)(0.5, 14);
  return (
    <g>
      <Box c={c} u={u} v={v} h={h} wall="#f4eee0" side="#ddd3bf" top="#f4eee0" />
      <polygon points={onLeft(c, u, v, 0.42, 0, 0.16, 32)} fill="#7a5000" stroke={INK} strokeWidth={1.5} />
      <Glow c={door} r={22} />
      {[0.1, 0.24, 0.66, 0.8].map((x) => (
        <Window key={x} c={c} u={u} v={v} left x={x} y={26} w={0.09} h={18} />
      ))}
      {[0.12, 0.34, 0.56, 0.78].map((x) => (
        <Window key={`r${x}`} c={c} u={u} v={v} left={false} x={x} y={26} w={0.1} h={18} />
      ))}
      <Pyramid c={c} u={u + 0.1} v={v + 0.1} h={h} r={30} roof="#3a3550" roofDark="#28243a" />
      <Box c={towerC} u={0.32} v={0.32} h={th} wall="#f4eee0" side="#ddd3bf" top="#f4eee0" z={0} />
      <rect x={face[0] - 12} y={face[1] - 4} width={22} height={22} fill="#fff6dc" stroke={INK} strokeWidth={2} />
      <Glow c={[face[0] - 1, face[1] + 7]} r={20} />
      <rect x={face[0] - 2} y={face[1] + 1} width={2} height={7} fill={INK} className={s.hand} style={{ transformOrigin: `${face[0] - 1}px ${face[1] + 7}px` }} />
      <rect x={face[0] - 1} y={face[1] + 6} width={6} height={2} fill={INK} />
      <Pyramid c={towerC} u={0.4} v={0.4} h={th} r={28} roof={gold} roofDark="#c98a00" />
      <rect x={towerC[0] - 1} y={towerC[1] - th - 52} width={2} height={26} fill={INK} />
      <polygon points={pts([towerC[0] + 1, towerC[1] - th - 52], [towerC[0] + 18, towerC[1] - th - 46], [towerC[0] + 1, towerC[1] - th - 40])} fill="#e34948" stroke={INK} strokeWidth={1.5} className={s.flag} />
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
  const chim = iso(c, 0.7, -0.6);
  return (
    <g>
      <Box c={chim} u={0.13} v={0.13} h={104} wall="#c9c8c2" side="#a9a8a2" top="#8a8984" />
      <g className={s.smoke}>
        <rect x={chim[0] - 6} y={chim[1] - 124} width={10} height={8} fill="#f3eef6" stroke={INK} strokeWidth={1.5} />
        <rect x={chim[0] + 4} y={chim[1] - 140} width={8} height={7} fill="#faf6fb" stroke={INK} strokeWidth={1.5} />
      </g>
      <path d={`M${c[0] - r} ${c[1]} L${c[0] - r} ${c[1] - h} A ${r} ${r / 2} 0 0 0 ${c[0] + r} ${c[1] - h} L ${c[0] + r} ${c[1]} A ${r} ${r / 2} 0 0 1 ${c[0] - r} ${c[1]} Z`} fill="#f4f6f2" stroke={INK} strokeWidth={2} />
      <rect x={c[0] - 34} y={c[1] - 12} width={16} height={30} fill={green} stroke={INK} strokeWidth={1.5} />
      {[-6, 18].map((dx) => (
        <g key={dx}>
          <rect x={c[0] + dx} y={c[1] - 20} width={10} height={12} fill={WIN} stroke={INK} strokeWidth={1.5} />
          <Glow c={[c[0] + dx + 5, c[1] - 14]} r={15} />
        </g>
      ))}
      <path d={`M${c[0] - r} ${c[1] - h + 6} A ${r} ${r / 2} 0 0 0 ${c[0] + r} ${c[1] - h + 6}`} fill="none" stroke={green} strokeWidth={5} />
      <path d={`M${c[0] - r - 4} ${c[1] - h} A ${r + 4} ${r + 8} 0 0 1 ${c[0] + r + 4} ${c[1] - h} A ${r + 4} ${(r + 4) / 2} 0 0 1 ${c[0] - r - 4} ${c[1] - h} Z`} fill="#e3e3ee" stroke={INK} strokeWidth={2} />
      <polygon points={pts([c[0] - 4, c[1] - h - r - 6], [c[0] + 10, c[1] - h - r - 4], [c[0] + 12, c[1] - h + 18], [c[0] - 2, c[1] - h + 18])} fill="#3a3550" stroke={INK} strokeWidth={1.5} />
      <polygon points={pts([c[0] + 2, c[1] - h - 30], [c[0] + 40, c[1] - h - 62], [c[0] + 46, c[1] - h - 54], [c[0] + 8, c[1] - h - 22])} fill={green} stroke={INK} strokeWidth={2} />
      <rect x={c[0] - 26} y={c[1] - h - 30} width={6} height={6} fill="#ffffff" />
    </g>
  );
}

/** The Forum's open square, drawn with the ground so people walk across it. */
export function Square({ c }: { c: P }) {
  const stones: JSX.Element[] = [];
  for (let a = -1; a < 1; a += 0.5)
    for (let b = -1; b < 1; b += 0.5) {
      const p = iso(c, a + 0.25, b + 0.25);
      stones.push(<polygon key={`${a}${b}`} points={diamond(p, 0.22)} fill={Math.round((a + b) * 2) % 2 === 0 ? "#f3e8d4" : "#e9dbc2"} stroke="#cdb894" strokeWidth={1} />);
    }
  return (
    <g>
      <polygon points={diamond(c, 1.05)} fill="#f3ecdd" stroke={INK} strokeWidth={2} />
      {stones}
    </g>
  );
}

function Forum({ c }: { c: P }) {
  const orange = PLACES.forum.color;
  const board = iso(c, -0.15, -0.35);
  const bl = iso(board, -0.62, 0);
  const br = iso(board, 0.62, 0);
  const bench = (p: P) => <Box c={p} u={0.36} v={0.1} h={10} wall="#c99a5b" side="#a87c42" top="#d8ae73" />;
  const lantern = iso(c, 0.9, -0.9);
  return (
    <g>
      <rect x={bl[0] - 2} y={bl[1] - 70} width={5} height={70} fill="#8a5a2b" stroke={INK} strokeWidth={1.5} />
      <rect x={br[0] - 2} y={br[1] - 70} width={5} height={70} fill="#8a5a2b" stroke={INK} strokeWidth={1.5} />
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
      <Lamp c={lantern} />
    </g>
  );
}

function HQ({ c }: { c: P }) {
  const u = 0.6;
  const v = 0.6;
  const h = 112;
  const win: JSX.Element[] = [];
  for (let row = 0; row < 4; row++)
    for (const x of [0.12, 0.42, 0.72]) {
      const lit = (row + Math.round(x * 10)) % 3 !== 0;
      win.push(lit ? <Window key={`l${row}${x}`} c={c} u={u} v={v} left x={x} y={18 + row * 22} w={0.16} h={12} /> : <polygon key={`l${row}${x}`} points={onLeft(c, u, v, x, 18 + row * 22, 0.16, 12)} fill="#c9c3e6" stroke={INK} strokeWidth={1.5} />);
      win.push(<polygon key={`r${row}${x}`} points={onRight(c, u, v, x, 18 + row * 22, 0.16, 12)} fill={row % 2 ? WIN : "#b9b3d9"} stroke={INK} strokeWidth={1.5} />);
    }
  const roofC = iso(c, 0, 0, h);
  return (
    <g>
      <Box c={c} u={u} v={v} h={h} wall="#f7f5fb" side="#e0dcea" top="#3a3550" />
      {win}
      <Box c={roofC} u={0.28} v={0.28} h={12} wall="#0b0b0b" side="#0b0b0b" top="#6250d6" />
    </g>
  );
}

export type Lot = Exclude<PlaceId, "home"> | "hq";
export const ART: Record<Lot, (p: { c: P }) => JSX.Element> = { library: Library, store: Store, hall: Hall, lab: Lab, forum: Forum, hq: HQ };
/** The bounding box of each drawing around its tile centre: [left, top, width, height]. */
export const BOX: Record<Lot, [number, number, number, number]> = {
  library: [-80, -146, 160, 190],
  store: [-80, -130, 160, 175],
  hall: [-100, -210, 200, 260],
  lab: [-74, -150, 150, 190],
  forum: [-110, -100, 220, 160],
  hq: [-60, -140, 120, 180],
};

// ---------- scenery ----------

const LEAF = ["#2f9a5a", "#3fb56a", "#58c977", "#1f7a4a"];

/** A round, leafy tree: stacked pixel blobs, lit from the upper left. */
export function Tree({ c, size = 1, hue = 0 }: { c: P; size?: number; hue?: number }) {
  const k = size;
  const dark = hue ? "#2b7d6a" : LEAF[3];
  const mid = hue ? "#3aa38a" : LEAF[0];
  const light = hue ? "#5cc6a6" : LEAF[1];
  const hi = hue ? "#8fe3c4" : LEAF[2];
  const blob = (x: number, y: number, w: number, h: number, fill: string) => <rect x={c[0] + x * k} y={c[1] + y * k} width={w * k} height={h * k} fill={fill} />;
  return (
    <g>
      <ellipse cx={c[0] + 8 * k} cy={c[1] + 2} rx={18 * k} ry={6 * k} fill="#2b1d4a" opacity={0.18} />
      <rect x={c[0] - 3 * k} y={c[1] - 16 * k} width={6 * k} height={16 * k} fill="#7a4e2a" stroke={INK} strokeWidth={1.5} />
      <g stroke={INK} strokeWidth={1.5}>
        {blob(-18, -40, 36, 26, dark)}
        {blob(-14, -50, 28, 12, dark)}
      </g>
      {blob(-16, -38, 32, 20, mid)}
      {blob(-12, -48, 22, 12, light)}
      {blob(-16, -40, 14, 10, light)}
      {blob(-10, -46, 8, 4, hi)}
      {blob(-14, -38, 4, 4, hi)}
      {blob(4, -26, 10, 6, dark)}
    </g>
  );
}

/** A tall pine, for the island's back edge. */
export function Pine({ c, size = 1 }: { c: P; size?: number }) {
  const h = 34 * size;
  return (
    <g stroke={INK} strokeWidth={1.5}>
      <rect x={c[0] - 3} y={c[1] - 12} width={6} height={12} fill="#7a4e2a" />
      <polygon points={pts([c[0], c[1] - 12 - h], [c[0] + 15, c[1] - 12 - h * 0.35], [c[0] + 12, c[1] - 10], [c[0] - 12, c[1] - 10], [c[0] - 15, c[1] - 12 - h * 0.35])} fill="#2f9a6e" />
      <polygon points={pts([c[0], c[1] - 12 - h], [c[0] + 15, c[1] - 12 - h * 0.35], [c[0] + 12, c[1] - 10], [c[0], c[1] - 10])} fill="#1f7a58" />
    </g>
  );
}

export function Bush({ c, size = 1 }: { c: P; size?: number }) {
  const k = size;
  return (
    <g>
      <rect x={c[0] - 12 * k} y={c[1] - 10 * k} width={24 * k} height={10 * k} fill={LEAF[0]} stroke={INK} strokeWidth={1.5} />
      <rect x={c[0] - 8 * k} y={c[1] - 15 * k} width={14 * k} height={6 * k} fill={LEAF[1]} stroke={INK} strokeWidth={1.5} />
      <rect x={c[0] - 6 * k} y={c[1] - 13 * k} width={5 * k} height={3 * k} fill={LEAF[2]} />
    </g>
  );
}

const PETAL = ["#ff9cc2", "#fff1a6", "#ffffff", "#c9a7ff", "#ffb38a"];
/** A little patch of flowers: pixel dots in pastel colours. */
export function Flowers({ c, seed = 0, n = 6 }: { c: P; seed?: number; n?: number }) {
  return (
    <g>
      {Array.from({ length: n }, (_, k) => {
        const x = c[0] + (((seed * 7 + k * 13) % 23) - 11) * 1.6;
        const y = c[1] + (((seed * 5 + k * 11) % 13) - 6);
        return (
          <g key={k}>
            <rect x={x} y={y + 2} width={1.5} height={3} fill="#3b8f4f" />
            <rect x={x - 1} y={y - 1} width={3.5} height={3.5} fill={PETAL[(seed + k) % PETAL.length]} />
          </g>
        );
      })}
    </g>
  );
}

/** A street lamp with its warm pool of light. */
export function Lamp({ c }: { c: P }) {
  return (
    <g>
      <ellipse cx={c[0]} cy={c[1]} rx={30} ry={12} fill="url(#tg-glow)" opacity={0.6} />
      <rect x={c[0] - 1.5} y={c[1] - 38} width={3} height={38} fill={INK} />
      <rect x={c[0] - 5} y={c[1] - 46} width={10} height={9} fill={GLOW} stroke={INK} strokeWidth={1.5} />
      <Glow c={[c[0], c[1] - 42]} r={30} />
    </g>
  );
}

/** A soft pixel cloud: stacked rounded-off rectangles. */
export function Cloud({ x, y, w = 1, tone = "#fff7fb" }: { x: number; y: number; w?: number; tone?: string }) {
  const r = (dx: number, dy: number, ww: number, hh: number, f = tone) => <rect x={x + dx * w} y={y + dy} width={ww * w} height={hh} fill={f} />;
  return (
    <g opacity={0.92}>
      {r(0, 18, 120, 14, "#f1dff0")}
      {r(10, 8, 100, 16)}
      {r(26, 0, 42, 12)}
      {r(62, 4, 30, 10)}
      {r(4, 26, 112, 6, "#ead3ea")}
    </g>
  );
}

/** Far, hazy hills on the horizon. */
export function Hills({ x: x0 = 0, y, w, tone, step = 40 }: { x?: number; y: number; w: number; tone: string; step?: number }) {
  const ps: P[] = [[x0, y + 300]];
  for (let x = x0, k = 0; x <= x0 + w; x += step, k++) {
    const top = y + [26, 6, 18, 0, 22, 10, 30, 4, 16][k % 9];
    ps.push([x, top], [x + step, top]);
  }
  ps.push([x0 + w + step, y + 300]);
  return <polygon points={pts(...ps)} fill={tone} />;
}
