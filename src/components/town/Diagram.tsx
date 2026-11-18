import Link from "next/link";
import { DIAGRAMS, type DiagramId } from "@/server/town/sections";
import { PLACES, PlaceIcon, type PlaceId } from "./places";

const Arrow = () => (
  <svg width="22" height="12" viewBox="0 0 22 12" shapeRendering="crispEdges" aria-hidden className="shrink-0 text-ink-3 max-sm:rotate-90">
    <path d="M0 5h16v2H0zM14 2h2v8h-2zM16 3h2v6h-2zM18 4h2v4h-2zM20 5h2v2h-2z" fill="currentColor" />
  </svg>
);

/** A small step diagram, e.g. pay per request: ask → 402 price → pay → answer. */
export function Diagram({ id, accent = "#6250d6" }: { id: DiagramId; accent?: string }) {
  const d = DIAGRAMS[id];
  return (
    <figure className="rounded-2xl border border-line bg-[#fbfaf7] p-4" data-testid="diagram">
      <figcaption className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">{d.label}</figcaption>
      <ol className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        {d.steps.map((s, i) => (
          <li key={s.title} className="flex flex-col items-center gap-2 sm:flex-1 sm:flex-row">
            <div className="flex w-full items-center gap-2.5 rounded-lg border-[1.5px] border-ink bg-panel px-3 py-2 shadow-[2px_2px_0_0_var(--color-ink)]">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] font-pixel text-[11px] text-white" style={{ background: accent }}>
                {i + 1}
              </span>
              <span className="leading-tight">
                <span className="block text-[13.5px] font-semibold">{s.title}</span>
                <span className="block text-[12px] text-ink-2">{s.sub}</span>
              </span>
            </div>
            {i < d.steps.length - 1 && <Arrow />}
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** Where a Town Hall request can go: two roads, as on the map. */
export function RoadsDiagram() {
  const step = (id: PlaceId, what: string) => (
    <Link href={PLACES[id].href} className="pressable flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border-[1.5px] border-ink bg-panel px-3 py-2 shadow-[2px_2px_0_0_var(--color-ink)] hover:-translate-y-0.5" style={{ background: PLACES[id].soft }}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] bg-white">
        <PlaceIcon place={id} size={22} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block font-pixel text-[12px]">{PLACES[id].name}</span>
        <span className="block text-[12.5px] text-ink-2">{what}</span>
      </span>
    </Link>
  );
  const road = (label: string, a: [PlaceId, string], b: [PlaceId, string], c: [PlaceId, string]) => (
    <ol aria-label={label} className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <li className="flex sm:flex-1">{step(...a)}</li>
      <li className="self-center">
        <Arrow />
      </li>
      <li className="flex sm:flex-1">{step(...b)}</li>
      <li className="self-center">
        <Arrow />
      </li>
      <li className="flex sm:flex-1">{step(...c)}</li>
    </ol>
  );
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 sm:p-5" aria-labelledby="flow" data-testid="hall-flow">
      <h2 id="flow" className="text-[16px] font-semibold">
        Where your request goes
      </h2>
      <p className="mt-0.5 text-[13.5px] text-ink-2">An admin reads everything. Real requests go on along one road or both, the same roads you see on the map.</p>
      <div className="mt-4 space-y-3">
        <div>
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Research road</p>
          {road("Research road", ["hall", "you send it"], ["lab", "people and agents look into it"], ["library", "the answer is written down"])}
        </div>
        <div>
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Market road</p>
          {road("Market road", ["hall", "you send it"], ["forum", "others offer a fix or a service"], ["store", "a trusted vendor is listed"])}
        </div>
      </div>
    </section>
  );
}
