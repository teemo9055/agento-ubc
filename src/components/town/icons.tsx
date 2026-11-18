/**
 * Small 12×12 pixel icons for Library categories and Store categories, in Agento's palette.
 * Decorative: a name always sits next to them.
 */
const G: Record<string, { grid: string[]; a: string; soft: string }> = {
  basics: {
    a: "#6250d6",
    soft: "#efedfc",
    grid: ["......kkk...", ".....kaak...", "....kaak....", "...kaak.....", "..kaakkkk...", ".kaaaaaak...", ".kkkkaak....", "....kaak....", "...kaak.....", "..kaak......", "..kkk.......", "............"],
  },
  combos: {
    a: "#2368c4",
    soft: "#e6effb",
    grid: ["............", ".kkkk.......", "kaaaak......", "ka..akkkk...", "ka..aaaaak..", "kaaaak..ak..", ".kkkka..ak..", "....kaaaak..", "....kkkkk...", "............", "............", "............"],
  },
  tools: {
    a: "#1baf7a",
    soft: "#e3f6ec",
    grid: [".......kkk..", "......kaak..", "......ka.k.k", "......kaaaak", ".....kaaakk.", "....kaaak...", "...kaaak....", "..kaaak.....", ".kaaak......", "kaak........", "kkk.........", "............"],
  },
  limits: {
    a: "#eb6834",
    soft: "#fdeee7",
    grid: ["....kkkk....", "..kkaaaakk..", ".kaaaaaaaak.", ".kaaawwaaak.", ".kaaawwaaak.", ".kaaawwaaak.", ".kaaaaaaaak.", "..kaawwaak..", "..kaaaaaak..", "...kaaaak...", "....kkkk....", "............"],
  },
  practices: {
    a: "#fab219",
    soft: "#fff4d9",
    grid: [".....kk.....", "....kaak....", "....kaak....", "kkkkkaakkkkk", "kaaaaaaaaaak", ".kaaaaaaaak.", "..kaaaaaak..", "..kaaaaaak..", ".kaaakkaaak.", ".kaak..kaak.", ".kkk....kkk.", "............"],
  },
  updates: {
    a: "#e87ba4",
    soft: "#fde9f1",
    grid: [".....kk.....", "....kaak....", "...kaaaak...", "..kaaaaaak..", "..kaaaaaak..", "..kaaaaaak..", ".kaaaaaaaak.", "kaaaaaaaaaak", "kkkkkkkkkkkk", "....kaak....", ".....kk.....", "............"],
  },
  glossary: {
    a: "#6250d6",
    soft: "#efedfc",
    grid: ["kkkkkkkkkkk.", "kwwwwwwwwwkk", "kw.kk..k.wka", "kwk..kk.kwka", "kwkkkk.k.wka", "kwk..k.k.wka", "kwk..k.kkwka", "kwwwwwwwwwka", "kkkkkkkkkkka", ".kaaaaaaaaaa", "............", "............"],
  },
  learned: {
    a: "#fab219",
    soft: "#fff4d9",
    grid: ["....kkkk....", "..kkaaaakk..", ".kaaawaaaak.", ".kaawaaaaak.", ".kaaaaaaaak.", "..kaaaaaak..", "...kaaaak...", "....kwwk....", "....kkkk....", "....kwwk....", ".....kk.....", "............"],
  },
  // Store
  "Prediction markets": {
    a: "#6250d6",
    soft: "#efedfc",
    grid: ["............", "..........k.", ".........kak", "...k....kak.", "..kak..kak..", ".kak.kkak...", "kak..kak....", "kk..........", "kkkkkkkkkkkk", "kwkwkwkwkwkk", "kkkkkkkkkkkk", "............"],
  },
  Prices: {
    a: "#fab219",
    soft: "#fff4d9",
    grid: ["...kkkkkk...", "..kaaaaaak..", ".kaaakkaaak.", "kaaakaaaaaak", "kaaakkkaaaak", "kaaaaaakaaak", "kaaaaaakaaak", "kaaakkkaaaak", ".kaaakkaaak.", "..kaaaaaak..", "...kkkkkk...", "............"],
  },
  Travel: {
    a: "#e34948",
    soft: "#fde8e8",
    grid: ["...kkkkk....", "..kaaaaak...", ".kaaawaaak..", ".kaawwwaak..", ".kaaawaaak..", ".kaaaaaaak..", "..kaaaaak...", "...kaaak....", "....kak.....", ".....k......", "..kkkkkkk...", "............"],
  },
  Cover: {
    a: "#2368c4",
    soft: "#e6effb",
    grid: [".....kk.....", "...kkaakk...", "..kaaaaaak..", ".kaaaaaaaak.", "kaaaaaaaaaak", "kkkkkkkkkkkk", ".....kk.....", ".....kk.....", ".....kk.....", ".....kk.kk..", "......kkk...", "............"],
  },
  "Town Hall": {
    a: "#fab219",
    soft: "#fff4d9",
    grid: ["............", "kkkkkkkkkkkk", "kakwwwwwwkak", "kwakwwwwkawk", "kwwakwwkawwk", "kwwwakkawwwk", "kwwwwaawwwwk", "kwwwwwwwwwwk", "kkkkkkkkkkkk", "............", "............", "............"],
  },
  "Listed by the community": {
    a: "#eb6834",
    soft: "#fdeee7",
    grid: [".....kk.....", "....kaak....", "...kaaaak...", "..kaaaaaak..", ".kaaaaaaaak.", "kkkkkkkkkkkk", ".kwwwwwwwwk.", ".kwkkwwkkwk.", ".kwkkwwkkwk.", ".kwwwwwwwwk.", ".kkkkkkkkkk.", "............"],
  },
  Infrastructure: {
    a: "#1baf7a",
    soft: "#e3f6ec",
    grid: ["kkkkkkkkkkkk", "kwwwwwwwwaak", "kkkkkkkkkkkk", "kwwwwwwwwaak", "kkkkkkkkkkkk", "kwwwwwwwwaak", "kkkkkkkkkkkk", ".....kk.....", ".....kk.....", "..kkkkkkkk..", "............", "............"],
  },
  "Web search research": {
    a: "#2368c4",
    soft: "#e6effb",
    grid: ["..kkkkk.....", ".kwwwwwk....", "kwwaaawwk...", "kwawwwawk...", "kwawwwawk...", "kwwaaawwk...", ".kwwwwwk....", "..kkkkkkk...", ".......kkk..", "........kkk.", ".........kk.", "............"],
  },
  "Financial analysis": {
    a: "#1baf7a",
    soft: "#e3f6ec",
    grid: ["............", ".........kk.", ".........kk.", "......kk.kk.", "......kk.kk.", "...kk.kk.kk.", "...kk.kk.kk.", "kk.kk.kk.kk.", "kk.kk.kk.kk.", "kkkkkkkkkkkk", "............", "............"],
  },
  Data: {
    a: "#6250d6",
    soft: "#efedfc",
    grid: ["..kkkkkkkk..", ".kaaaaaaaak.", ".kkaaaaaakk.", ".kwkkkkkkwk.", ".kwwwwwwwwk.", ".kkwwwwwwkk.", ".kwkkkkkkwk.", ".kwwwwwwwwk.", ".kkwwwwwwkk.", "..kkkkkkkk..", "............", "............"],
  },
  Other: {
    a: "#52514e",
    soft: "#f1f0ec",
    grid: ["............", "...kkkkkk...", "..kaaaaaak..", ".kaaaaaaaak.", "kkkkkkkkkkkk", "kwwwwwwwwwwk", "kwwwkkkwwwwk", "kwwwwwwwwwwk", "kwwwwwwwwwwk", "kkkkkkkkkkkk", "............", "............"],
  },
};

export const iconStyle = (name: string) => G[name] ?? G[Object.keys(G).find((k) => name.toLowerCase().includes(k.toLowerCase().split(" ")[0])) ?? "Other"] ?? G.Other;

export function CatIcon({ name, size = 24, className = "" }: { name: string; size?: number; className?: string }) {
  const g = iconStyle(name);
  const fill: Record<string, string> = { k: "#0b0b0b", w: "#ffffff", a: g.a };
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden className={`shrink-0 ${className}`}>
      {g.grid.flatMap((row, y) => row.split("").map((c, x) => (fill[c] ? <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={fill[c]} /> : null)))}
    </svg>
  );
}
