"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PLACE_ORDER, PLACES, PlaceIcon, type PlaceId } from "./places";

/**
 * The town's icon bar: every place by name, so the town works without the map (keyboard, screen
 * readers, phones). `game` is the dark bar under the map; `strip` is the light row on a building's page.
 */
export function TownBar({ variant = "game", counts = {}, className = "" }: { variant?: "game" | "strip"; counts?: Partial<Record<PlaceId, number>>; className?: string }) {
  const path = usePathname();
  const active = (id: PlaceId) => (id === "home" ? path === "/" : path.startsWith(PLACES[id].href));
  if (variant === "strip")
    return (
      <nav aria-label="Town" className={`-mx-1 overflow-x-auto ${className}`}>
        <ul className="flex min-w-max gap-1 px-1 py-0.5">
          <li>
            <Link href="/town" className="pressable inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink" aria-current={path === "/town" ? "page" : undefined}>
              <span aria-hidden className="font-pixel text-[11px]">◆</span> Map
            </Link>
          </li>
          {PLACE_ORDER.filter((id) => id !== "home").map((id) => (
            <li key={id}>
              <Link
                href={PLACES[id].href}
                aria-current={active(id) ? "page" : undefined}
                className={`pressable inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium ${active(id) ? "bg-panel text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-2 hover:bg-ink/5 hover:text-ink"}`}
              >
                <PlaceIcon place={id} size={16} />
                {PLACES[id].name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  return (
    <nav aria-label="Town" className={className}>
      <ul className="pix-shadow grid grid-cols-6 overflow-hidden rounded-[10px] border-[1.5px] border-ink bg-ink">
        {PLACE_ORDER.map((id, i) => (
          <li key={id} className={i ? "border-l border-white/15" : ""}>
            <Link
              href={PLACES[id].href}
              aria-current={active(id) ? "page" : undefined}
              className="group relative flex h-[58px] flex-col items-center justify-center gap-1 px-1 text-white outline-offset-[-3px] transition-colors hover:bg-white/10 focus-visible:bg-white/10 sm:h-16"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-[5px] bg-white transition-transform group-hover:-translate-y-0.5 motion-reduce:transition-none">
                <PlaceIcon place={id} size={20} />
              </span>
              <span className="whitespace-nowrap font-pixel text-[9.5px] leading-none sm:text-[11px]">
                {id === "hall" ? (
                  <>
                    <span className="sr-only sm:not-sr-only">Town </span>Hall
                  </>
                ) : (
                  PLACES[id].name
                )}
              </span>
              {counts[id] ? (
                <span className="num absolute right-1.5 top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] border-[1.5px] border-ink bg-warn px-0.5 text-[9px] font-bold text-ink sm:right-3">
                  {counts[id]}
                  <span className="sr-only"> waiting</span>
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A building's page header: back to the map, the place's sign, its title and one line on what it's for. */
export function TownHeader({ place, title, sub, children }: { place: PlaceId; title?: string; sub: string; children?: React.ReactNode }) {
  const p = PLACES[place];
  return (
    <header className="space-y-4">
      <TownBar variant="strip" />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="pix-frame flex h-14 w-14 shrink-0 items-center justify-center" style={{ background: p.soft }}>
            <PlaceIcon place={place} size={36} />
          </span>
          <div>
            <h1 className="font-pixel text-[28px] leading-tight sm:text-[32px]">{title ?? p.name}</h1>
            <p className="mt-0.5 text-[15px] text-ink-2">{sub}</p>
          </div>
        </div>
        {children}
      </div>
    </header>
  );
}
