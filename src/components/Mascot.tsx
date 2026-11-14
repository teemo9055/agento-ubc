import type { AgentId } from "@/lib/types";
import { OUTFIT_LABEL, type Mood, type Outfit } from "@/lib/outfit";

/**
 * 16×16 pixel mascots. One shared body; each agent has its own head feature,
 * and an outfit layer dresses it for the job's category. "_" keeps the layer below.
 */
const PALETTE: Record<string, string> = {
  k: "var(--color-ink)",
  a: "var(--agent)",
  d: "color-mix(in oklab, var(--agent) 62%, black)",
  l: "var(--agent-soft)",
  w: "#ffffff",
  e: "var(--color-ink)",
  r: "#e34948",
  y: "#eda100",
  g: "#8a8984",
  s: "#c3c2b7",
  b: "#2a78d6",
  n: "#1baf7a",
  o: "#eb6834",
  p: "#e87ba4",
};

const BODY = [
  "________________",
  "________________",
  "____kkkkkkkk____",
  "___kaaaaaaaak___",
  "___kawwaawwak___",
  "___kaweaaweak___",
  "___kaaaaaaaak___",
  "___kaaakkaaak___",
  "___kaaaaaaaak___",
  "____kkkkkkkk____",
  "___kddddddddk___",
  "__kddddddddddk__",
  "__kddddddddddk__",
  "___kddddddddk___",
  "____kk____kk____",
  "____kk____kk____",
];

const HEAD: Record<AgentId, string[]> = {
  // Inso: antenna orb and a forehead gem (the oracle)
  inso: ["_______ll_______", "_______kk_______", "________________", "_______ww_______"],
  // Trado: horns
  trado: ["__kk________kk__", "___kk______kk___", "________________", "________________"],
  // Travo: cap with a brim
  travo: ["________________", "____kkkkkkkk____", "___kddddddddkkk_", "________________"],
};

const OUTFITS: Record<Outfit, Record<number, string>> = {
  none: {},
  sports: {
    10: "___krrrrrrrrk___",
    11: "__krrrwwwwrrrk__",
    12: "__krrrrrwrrrrk__",
    13: "___krrrrwrrrk___",
  },
  health: {
    9: "____kgkkkkgk____",
    10: "___kgddddddgk___",
    11: "__kddgddddgddk__",
    12: "__kdddggggdddk__",
    13: "___kddddsdddk___",
  },
  crypto: {
    11: "__kddddyyddddk__",
    12: "__kdddykkydddk__",
    13: "___kdddyydddk___",
  },
  commodities: {
    0: "________________",
    1: "____yyyyyyyy____",
    2: "__yyyyyyyyyyyy__",
    3: "___kaaaaaaaak___",
  },
  weather: {
    0: "___bbbbbbbbbb___",
    1: "__bbbbbbbbbbbb__",
    2: "____kkkkkkkk_k__",
    3: "___kaaaaaaaakk__",
  },
  politics: {
    11: "__kddddbbddddk__",
    12: "__kdddbwwbdddk__",
    13: "___kddrbbrddk___",
  },
  travel: {
    10: "___kdnddddndk___",
    11: "__kddnddddnddkn_",
    12: "__kddnddddnddkn_",
    13: "___kddddddddkn__",
  },
  finance: {
    10: "___kdddwwdddk___",
    11: "__kddddrrddddk__",
    12: "__kddddrrddddk__",
    13: "___kddddrdddk___",
  },
};

const HAPPY_EYES = { 4: "___kaaaaaaaak___", 5: "___kakkaakkak___" };
const SAD_EYES = { 4: "___kaaaaaaaak___", 5: "___kakaaaakak___", 7: "___kaakaakaak___" };

function layer(rows: Record<number, string> | string[], into: string[][]) {
  const entries = Array.isArray(rows) ? rows.map((r, i) => [i, r] as const) : Object.entries(rows).map(([i, r]) => [Number(i), r] as const);
  for (const [y, row] of entries) for (let x = 0; x < 16; x++) if (row[x] && row[x] !== "_") into[y][x] = row[x];
}

function grid(agent: AgentId, outfit: Outfit, mood: Mood) {
  const g = BODY.map((r) => r.split(""));
  layer(HEAD[agent], g);
  if (mood === "happy") layer(HAPPY_EYES, g);
  if (mood === "sad") layer(SAD_EYES, g);
  layer(OUTFITS[outfit], g);
  return g;
}

export function Mascot({
  agent,
  outfit = "none",
  mood = "idle",
  size = 40,
  framed = true,
  className = "",
}: {
  agent: AgentId;
  outfit?: Outfit;
  mood?: Mood;
  size?: number;
  framed?: boolean;
  className?: string;
}) {
  const g = grid(agent, outfit, mood);
  const label = `${agent} mascot${OUTFIT_LABEL[outfit] ? `, ${OUTFIT_LABEL[outfit].toLowerCase()}` : ""}`;
  return (
    <span
      data-agent={agent}
      role="img"
      aria-label={label}
      title={OUTFIT_LABEL[outfit] || undefined}
      className={`relative inline-flex shrink-0 items-end justify-center ${framed ? "pix-frame bg-agent-soft" : ""} ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 16 16" width={size * (framed ? 0.82 : 1)} height={size * (framed ? 0.82 : 1)} shapeRendering="crispEdges" className={`mascot mascot-${mood}`} aria-hidden>
        {g.flatMap((row, y) =>
          row.map((c, x) =>
            c === "_" || !PALETTE[c] ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={PALETTE[c]} className={y === 5 && c === "e" ? "mascot-pupil" : undefined} />,
          ),
        )}
        {mood === "working" && (
          <g className="mascot-spark">
            <rect x={13} y={1} width={1} height={1} fill="var(--agent)" />
            <rect x={14} y={3} width={1} height={1} fill="var(--agent)" />
            <rect x={1} y={2} width={1} height={1} fill="var(--agent)" />
          </g>
        )}
        {mood === "happy" && (
          <g className="mascot-spark">
            <rect x={1} y={1} width={1} height={1} fill="#eda100" />
            <rect x={14} y={2} width={1} height={1} fill="#eda100" />
            <rect x={13} y={0} width={1} height={1} fill="#eda100" />
          </g>
        )}
      </svg>
      {mood === "alert" && (
        <span className="pix-bubble absolute -right-1.5 -top-1.5 flex h-[42%] min-h-3.5 w-[34%] min-w-3 items-center justify-center bg-warn font-pixel text-[9px] leading-none text-ink" aria-hidden>
          !
        </span>
      )}
    </span>
  );
}
