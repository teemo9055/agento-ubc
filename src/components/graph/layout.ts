import type { Phase, Run } from "@/lib/types";

/**
 * Where each step of a job sits. Columns come from what each step waits on; rows either stack
 * steps in a column (as before), or, for a composed job, put each question it answers in its own
 * band (a lane), with a Verdict node on the right that every lane's last step leads to.
 */
export const NODE_W = 196;
export const NODE_H = 88;
export const GAP_X = 56;
export const GAP_Y = 22;
export const GAP_V = 40;
export const LANE_LABEL_W = 132;
export const LANE_PAD = 14;
export const VERDICT_W = 176;
export const VERDICT_H = 112;

export type Pt = { x: number; y: number };

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
export function connector(a: Pt, b: Pt, vertical: boolean, size: { w: number; h: number } = { w: NODE_W, h: NODE_H }, into: { w: number; h: number } = size) {
  const r = 10;
  if (vertical) {
    const x1 = a.x + size.w / 2;
    const y1 = a.y + size.h;
    const x2 = b.x + into.w / 2;
    const y2 = b.y;
    if (Math.abs(x1 - x2) < 1) return `M${x1},${y1} V${y2}`;
    const mid = (y1 + y2) / 2;
    const s = x2 > x1 ? 1 : -1;
    return `M${x1},${y1} V${mid - r} Q${x1},${mid} ${x1 + s * r},${mid} H${x2 - s * r} Q${x2},${mid} ${x2},${mid + r} V${y2}`;
  }
  const x1 = a.x + size.w;
  const y1 = a.y + size.h / 2;
  const x2 = b.x;
  const y2 = b.y + into.h / 2;
  if (Math.abs(y1 - y2) < 1) return `M${x1},${y1} H${x2}`;
  const mid = (x1 + x2) / 2;
  const s = y2 > y1 ? 1 : -1;
  const rr = Math.min(r, Math.abs(y2 - y1) / 2);
  return `M${x1},${y1} H${mid - rr} Q${mid},${y1} ${mid},${y1 + s * rr} V${y2 - s * rr} Q${mid},${y2} ${mid + rr},${y2} H${x2}`;
}

export interface Layout {
  pos: Record<string, Pt>;
  w: number;
  h: number;
  vertical: boolean;
  /** Lane bands, top to bottom, when the job has lanes. */
  bands?: { id: string; question: string; importance: "must" | "should" | "nice"; y: number; h: number }[];
  verdict?: Pt;
  /** The last step of each lane, which leads to the Verdict node. */
  laneEnds?: string[];
}

/** The plain grid: left to right when it fits, top to bottom when it doesn't. Unchanged from before lanes. */
export function gridLayout(phases: Phase[], width: number): Layout {
  const depth = depthOf(phases);
  const cols: string[][] = [];
  phases.forEach((p) => (cols[depth[p.id]] ??= []).push(p.id));
  const nCols = cols.length;
  const maxRows = Math.max(1, ...cols.map((c) => c?.length ?? 0));
  const wideW = nCols * NODE_W + (nCols - 1) * GAP_X;
  const vertical = width > 0 && wideW > width;
  const pos: Record<string, Pt> = {};
  cols.forEach((ids, c) =>
    (ids ?? []).forEach((id, r) => {
      // Each column is centred on the tallest one, so a single step sits level with a pair beside it.
      const off = (maxRows - ids.length) / 2;
      pos[id] = vertical ? { x: (r + off) * (NODE_W + GAP_Y), y: c * (NODE_H + GAP_V) } : { x: c * (NODE_W + GAP_X), y: (r + off) * (NODE_H + GAP_Y) };
    }),
  );
  const w = vertical ? maxRows * NODE_W + (maxRows - 1) * GAP_Y : wideW;
  const h = vertical ? nCols * NODE_H + (nCols - 1) * GAP_V : maxRows * NODE_H + (maxRows - 1) * GAP_Y;
  return { pos, w, h, vertical };
}

/**
 * Lanes: one band per question, in the order the composer found them, then "Other" for steps with
 * no lane. Columns still follow what waits on what, so a step in one lane that reads another lane's
 * answer still sits to its right. The Verdict node sits right of the last column, centred.
 */
export function laneLayout(phases: Phase[], lanes: NonNullable<Run["lanes"]>): Layout {
  const depth = depthOf(phases);
  const nCols = Math.max(0, ...phases.map((p) => depth[p.id])) + 1;
  const ids = [...lanes.map((l) => l.id), "__other"];
  const laneOf = (p: Phase) => (p.lane && lanes.some((l) => l.id === p.lane) ? p.lane : "__other");
  const pos: Record<string, Pt> = {};
  const bands: NonNullable<Layout["bands"]> = [];
  let y = 0;
  for (const id of ids) {
    const inLane = phases.filter((p) => laneOf(p) === id);
    if (!inLane.length) continue;
    const perCol = new Map<number, string[]>();
    for (const p of inLane) perCol.set(depth[p.id], [...(perCol.get(depth[p.id]) ?? []), p.id]);
    const rows = Math.max(...[...perCol.values()].map((v) => v.length));
    const h = rows * NODE_H + (rows - 1) * GAP_Y + LANE_PAD * 2;
    for (const [c, list] of perCol) list.forEach((pid, r) => (pos[pid] = { x: LANE_LABEL_W + c * (NODE_W + GAP_X), y: y + LANE_PAD + r * (NODE_H + GAP_Y) + ((rows - list.length) * (NODE_H + GAP_Y)) / 2 }));
    const lane = lanes.find((l) => l.id === id);
    bands.push({ id, question: lane?.question ?? "Other steps", importance: lane?.importance ?? "nice", y, h });
    y += h;
  }
  const stepsW = LANE_LABEL_W + nCols * NODE_W + (nCols - 1) * GAP_X;
  const verdict = { x: stepsW + GAP_X, y: Math.max(0, y / 2 - VERDICT_H / 2) };
  // Each lane's last step (deepest; ties: lowest) leads to the verdict.
  const laneEnds = bands
    .filter((b) => b.id !== "__other")
    .map((b) => {
      const inLane = phases.filter((p) => laneOf(p) === b.id && !p.gap);
      return inLane.sort((a, b2) => depth[b2.id] - depth[a.id] || pos[b2.id].y - pos[a.id].y)[0]?.id;
    })
    .filter((x): x is string => Boolean(x));
  return { pos, w: verdict.x + VERDICT_W, h: Math.max(y, VERDICT_H), vertical: false, bands, verdict, laneEnds };
}
