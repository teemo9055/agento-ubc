import Link from "next/link";
import type { ReactNode } from "react";
import { PLACES, PlaceIcon, type PlaceId } from "./places";
import { ART, ArtDefs, Bush, Cloud, Flowers, Hills, INK, Lamp, Pine, Shadow, Square, Tree, diamond, iso, pts, type Lot, type P } from "./art";
import s from "./town.module.css";

/**
 * A building's banner: its own corner of the island at dusk, the same sky and light as the map,
 * with the nameplate (the page's h1) and breadcrumbs. Going inside feels like walking up to it.
 */
const C: P = [880, 236];
const SCALE: Partial<Record<Lot, number>> = { hall: 0.9, forum: 1.05 };
const FIREFLIES: [number, number, number][] = [
  [62, 58, 0],
  [70, 34, 1.4],
  [80, 64, 2.2],
  [88, 40, 0.6],
  [56, 74, 3.1],
  [94, 70, 1.9],
];

function Ground({ lot }: { lot: Lot }) {
  const c = C;
  const down = (p: P, d = 24): P => [p[0], p[1] + d];
  const W = iso(c, -3.6, 2.4);
  const S = iso(c, 3.6, 2.4);
  const E = iso(c, 3.6, -2.4);
  const Nn = iso(c, -3.6, -2.4);
  return (
    <g>
      <polygon points={pts(W, S, down(S), down(W))} fill="#b98256" stroke={INK} strokeWidth={2} />
      <polygon points={pts(S, E, down(E), down(S))} fill="#946240" stroke={INK} strokeWidth={2} />
      <polygon points={pts(Nn, E, S, W)} fill="#8fd06f" stroke={INK} strokeWidth={2} />
      {[-2, -1, 0, 1, 2].flatMap((i) => [-1, 0, 1].map((j) => ((i + j) % 2 ? <polygon key={`${i}${j}`} points={diamond(iso(c, i, j), 0.5)} fill="#86c866" /> : null)))}
      {/* the path to the door, toward the nameplate */}
      {[1.4, 2.4].map((d) => (
        <polygon key={d} points={diamond(iso(c, -0.2, d), 0.5)} fill="#efd8a6" stroke="#d6b77d" strokeWidth={1.5} />
      ))}
      {lot === "forum" && <Square c={c} />}
      <polygon points={pts(Nn, E, S, W)} fill="url(#tg-haze)" />
    </g>
  );
}

export function Banner({ place, title, crumbs = [], slim = false, children }: { place: PlaceId; title: string; crumbs?: { href: string; label: string }[]; slim?: boolean; children?: ReactNode }) {
  const lot: Lot = place === "home" ? "hq" : place;
  const Art = ART[lot];
  const p = PLACES[place];
  const k = (SCALE[lot] ?? 1) * (slim ? 0.8 : 1);
  return (
    <div className={`${s.banner} ${s.sky} rounded-2xl border border-[#d8c8ea] ${slim ? "min-h-[168px] sm:min-h-[188px]" : "min-h-[196px] sm:min-h-[236px]"}`} data-testid="building-banner">
      <svg className="absolute inset-0 h-full w-full max-sm:-translate-y-[20%] max-sm:scale-[1.08]" viewBox="0 0 1200 300" preserveAspectRatio="xMaxYMid slice" shapeRendering="crispEdges" aria-hidden>
        <ArtDefs />
        <circle cx={330} cy={64} r={150} fill="url(#tg-sun)" shapeRendering="auto" />
        <rect x={312} y={46} width={36} height={36} fill="#fff6dc" />
        <rect x={306} y={52} width={48} height={24} fill="#fff6dc" />
        <g className={s.drift} style={{ animationDuration: "140s", animationDelay: "-50s" }}>
          <Cloud x={0} y={30} w={1.2} />
        </g>
        <g className={s.drift} style={{ animationDuration: "190s", animationDelay: "-130s" }}>
          <Cloud x={0} y={92} w={0.8} />
        </g>
        <Hills x={-40} y={150} w={1300} tone="url(#tg-hill1)" step={44} />
        <Hills x={-40} y={186} w={1300} tone="url(#tg-hill2)" step={32} />
        <Ground lot={lot} />
        <Pine c={iso(C, -1.6, -2.1)} size={1.1} />
        <Pine c={iso(C, 1.2, -2.3)} size={0.9} />
        <Tree c={iso(C, 2.6, -1.2)} size={1.1} />
        <Tree c={iso(C, -2.8, -0.8)} size={0.95} hue={1} />
        <Bush c={iso(C, 2.2, 0.6)} />
        <Bush c={iso(C, -2.2, 1.2)} size={1.2} />
        <Flowers c={iso(C, -1.4, 1.9)} seed={2} n={8} />
        <Flowers c={iso(C, 1.6, 1.2)} seed={6} n={8} />
        <Flowers c={iso(C, 2.8, -0.2)} seed={9} />
        <Shadow c={C} rx={110} ry={48} />
        <g transform={`translate(${C[0]} ${C[1]}) scale(${k}) translate(${-C[0]} ${-C[1]})`}>
          <Art c={C} />
        </g>
        <Lamp c={iso(C, -1.1, 2.1)} />
        <Lamp c={iso(C, 1.5, 2.2)} />
        <Tree c={iso(C, 3.3, 1.6)} size={1.3} />
      </svg>
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-[56%] sm:w-[44%]">
        {FIREFLIES.map(([x, y, d], i) => (
          <span key={i} className={s.firefly} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `-${d}s, -${d}s` }} />
        ))}
      </div>
      <div className={`relative flex flex-col justify-between gap-6 p-3 sm:p-5 ${slim ? "min-h-[168px] sm:min-h-[188px]" : "min-h-[196px] sm:min-h-[236px]"}`}>
        {crumbs.length ? (
          <nav aria-label="Breadcrumbs" className="self-start">
            <ol className="flex flex-wrap items-center gap-1 rounded-md bg-white/85 px-2 py-1 text-[12.5px] font-medium text-ink-2 backdrop-blur">
              {crumbs.map((c, i) => (
                <li key={`${i}-${c.label}`} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden>›</span>}
                  <Link href={c.href} className="hover:text-ink hover:underline">
                    {c.label}
                  </Link>
                </li>
              ))}
            </ol>
          </nav>
        ) : (
          <span />
        )}
        <div className={`space-y-2 ${slim ? "max-w-[min(560px,54%)] max-sm:max-w-[92%]" : "max-w-[min(640px,62%)] max-sm:max-w-[78%]"}`}>
          <div className={s.plate} style={{ ["--accent" as string]: p.color }}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] bg-white sm:h-10 sm:w-10">
              <PlaceIcon place={place} size={26} />
            </span>
            <h1 className={`font-pixel leading-tight ${slim ? "text-[14px] sm:text-[18px]" : "text-[22px] sm:text-[30px]"}`}>{title}</h1>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
