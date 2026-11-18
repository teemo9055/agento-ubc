/**
 * The town's places: name, where they live, what they are for and their 12×12 pixel sign icon.
 * One list, used by the map, the bottom bar and every building's page header.
 */
export type PlaceId = "library" | "store" | "hall" | "lab" | "forum" | "home";

export interface Place {
  id: PlaceId;
  name: string;
  href: string;
  /** What you do there, in a few words. */
  does: string;
  /** Accent colour (Agento's palette). */
  color: string;
  /** Text colour on the accent. */
  on: string;
  soft: string;
  icon: string[];
}

export const PLACES: Record<PlaceId, Place> = {
  library: {
    id: "library",
    name: "Library",
    href: "/town/library",
    does: "Learn what agents can do",
    color: "#6250d6",
    on: "#ffffff",
    soft: "#efedfc",
    icon: [
      "............",
      ".kkkk..kkkk.",
      "kwwwwkkwwwwk",
      "kwkkwkkwkkwk",
      "kwwwwkkwwwwk",
      "kwkkwkkwkkwk",
      "kwwwwkkwwwwk",
      "kwkkwkkwkkwk",
      "kwwwwkkwwwwk",
      ".kkkkaakkkk.",
      "....kaak....",
      "............",
    ],
  },
  store: {
    id: "store",
    name: "Store",
    href: "/town/store",
    does: "Services to buy or list",
    color: "#2368c4",
    on: "#ffffff",
    soft: "#e6effb",
    icon: [
      "............",
      "kkkkkkkkkkkk",
      "kaawwaawwaak",
      "kaawwaawwaak",
      "kkkkkkkkkkkk",
      ".k........k.",
      ".k........k.",
      ".k.yy..nn.k.",
      "kkkkkkkkkkkk",
      "kwwwwwwwwwwk",
      "kkkkkkkkkkkk",
      "............",
    ],
  },
  hall: {
    id: "hall",
    name: "Town Hall",
    href: "/town/hall",
    does: "Ask, suggest, give feedback",
    color: "#fab219",
    on: "#0b0b0b",
    soft: "#fff4d9",
    icon: [
      "....kkkk....",
      "..kkaaaakk..",
      ".kaawwkwwak.",
      ".kawwwkwwwk.",
      "kawwwwkwwwak",
      "kawwwwkkkwak",
      "kawwwwwwwwak",
      ".kawwwwwwak.",
      ".kaawwwwaak.",
      "..kkaaaakk..",
      "....kkkk....",
      "............",
    ],
  },
  lab: {
    id: "lab",
    name: "Lab",
    href: "/town/lab",
    does: "Research open requests",
    color: "#1baf7a",
    on: "#0b0b0b",
    soft: "#e3f6ec",
    icon: [
      "...kkkkkk...",
      "....kwwk....",
      "....kwwk....",
      "....kwwk....",
      "...kwwwwk...",
      "..kwwwwwwk..",
      ".kaaaaaaaak.",
      ".kaawaaaaak.",
      "kaaaaaawaaak",
      "kaaaaaaaaaak",
      ".kkkkkkkkkk.",
      "............",
    ],
  },
  forum: {
    id: "forum",
    name: "Forum",
    href: "/town/forum",
    does: "Open needs and offers",
    color: "#eb6834",
    on: "#0b0b0b",
    soft: "#fdeee7",
    icon: [
      "............",
      "kkkkkkkkkkkk",
      "kbbbbbbbbbbk",
      "kbwwkbbwwwbk",
      "kbwwkbbwwwbk",
      "kbbbbbbwwwbk",
      "kbwwwbbbbbbk",
      "kbwwwbbaabbk",
      "kkkkkkkkkkkk",
      ".k........k.",
      ".k........k.",
      ".k........k.",
    ],
  },
  home: {
    id: "home",
    name: "Home",
    href: "/",
    does: "Your jobs",
    color: "#0b0b0b",
    on: "#ffffff",
    soft: "#f1f0ec",
    icon: [
      ".....kk.....",
      "....kaak....",
      "...kaaaak...",
      "..kaaaaaak..",
      ".kaaaaaaaak.",
      "kkkkkkkkkkkk",
      ".kwwwwwwwwk.",
      ".kwkkwwkkwk.",
      ".kwkkwwwwwk.",
      ".kwwwwkkwwk.",
      ".kkkkkkkkkk.",
      "............",
    ],
  },
};

export const PLACE_ORDER: PlaceId[] = ["library", "store", "hall", "lab", "forum", "home"];

/** A place's sign icon, drawn pixel by pixel. Decorative: the name always sits next to it. */
export function PlaceIcon({ place, size = 24, className = "" }: { place: PlaceId; size?: number; className?: string }) {
  const p = PLACES[place];
  const fill: Record<string, string> = { k: "#0b0b0b", w: "#ffffff", a: p.id === "home" ? "#52514e" : p.color, y: "#fab219", n: "#1baf7a", b: "#c99a5b" };
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden className={`shrink-0 ${className}`}>
      {p.icon.flatMap((row, y) => row.split("").map((c, x) => (fill[c] ? <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={fill[c]} /> : null)))}
    </svg>
  );
}
