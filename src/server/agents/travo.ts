import { SELLERS } from "../sellers";
import { PRODUCTS } from "../x402";
import type { Place, Route } from "../geo";
import type { AgentDef, EditResult, LineDraft, PhaseDraft } from "./types";
import { PhaseFailure } from "./types";

interface Opts {
  stops: string[];
  hoursPerDay: number;
}

const seller = SELLERS.primary;
const mirror = SELLERS.mirror;
const P = (id: string) => PRODUCTS[id].price;

const clean = (s: string) => s.replace(/[.?!]+$/, "").replace(/^(a |the )/i, "").trim();

/** "Road trip from Vancouver to Seattle via Whistler" -> [Vancouver, Whistler, Seattle] */
export function stopsIn(text: string): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  const m = t.match(/from (.+?) to (.+?)(?: via (.+))?$/i);
  if (m) {
    const via = m[3] ? m[3].split(/,| and /i).map(clean).filter(Boolean) : [];
    return [clean(m[1]), ...via, clean(m[2])];
  }
  const parts = t.replace(/^.*?:/, "").split(/ to | -> |→/i).map(clean).filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, 6) : [];
}

export const travo: AgentDef = {
  id: "travo",
  name: "Travo",
  tagline: "Plans driving routes and day trips.",
  examples: ["Road trip from Vancouver to San Francisco via Portland", "Drive from Calgary to Banff", "From Toronto to Montreal via Ottawa"],
  defaults: { stops: [], hoursPerDay: 6 } satisfies Opts,
  faultPhase: "route",
  analysisPhase: "days",

  async plan(task, o) {
    const opts = o as unknown as Opts;
    const stops = opts.stops.length ? opts.stops : stopsIn(task);
    const n = Math.max(2, stops.length);
    const lines: LineDraft[] = [
      {
        id: "geocode",
        phaseId: "geocode",
        purpose: `Find ${n} places`,
        service: "places.geocode",
        payeeName: seller.name,
        payee: seller.address,
        rail: "x402",
        approved: (P("places.geocode") * BigInt(n)).toString(),
        calls: { max: n, unitPrice: P("places.geocode").toString() },
      },
      {
        id: "route",
        phaseId: "route",
        purpose: "Driving route",
        service: "routes.drive",
        payeeName: seller.name,
        payee: seller.address,
        rail: "x402",
        approved: P("routes.drive").toString(),
        calls: { max: 1, unitPrice: P("routes.drive").toString() },
      },
    ];
    const phases: PhaseDraft[] = [
      { id: "geocode", label: "Pin the stops", sub: stops.join(" → ") || "stops needed", dependsOn: [], optional: false, lineId: "geocode" },
      {
        id: "route",
        label: "Buy the route",
        sub: "roads · distance · time",
        dependsOn: ["geocode"],
        optional: false,
        lineId: "route",
        alternatives: [{ payeeName: mirror.name, payee: mirror.address, service: "routes.drive", price: ((P("routes.drive") * mirror.markup) / 100n).toString() }],
      },
      { id: "days", label: "Split into days", sub: `≤ ${opts.hoursPerDay}h driving/day`, dependsOn: ["route"], optional: false },
      { id: "deliver", label: "Trip plan", sub: "map + days", dependsOn: ["days"], optional: false },
    ];
    return {
      cards: [
        { kind: "deliverable", title: "Trip plan", points: [stops.join(" → ") || "Add a start and end", "Route map", `Days at ≤ ${opts.hoursPerDay}h driving`] },
        { kind: "risk", title: "Plan, not booking", points: ["Nothing booked or paid to venues", "Times exclude traffic and stops", "Check border and road rules"] },
        { kind: "method", title: "Pay per request", points: ["OpenStreetMap places + roads", "x402 on Arc, paid from vault", "Built-in day planner"] },
      ],
      lines,
      phases,
    };
  },

  edit(_card, prompt, o): EditResult {
    const opts = { ...(o as unknown as Opts) };
    const p = prompt.trim();
    const lower = p.toLowerCase();
    if (/book|reserve|buy (a )?ticket|hotel/.test(lower))
      return { ok: false, message: "Travo plans routes. Booking is a later add-on.", alternatives: ["Max 5 hours a day", "Max 8 hours a day"] };
    if (/fly|flight|plane|train/.test(lower)) return { ok: false, message: "Driving routes only for now.", alternatives: ["Max 5 hours a day"] };
    const add = p.match(/(?:add|stop at|via)\s+(.+)/i);
    const hrs = lower.match(/(\d+)\s*h(ou)?rs?/);
    let changed = false;
    if (add) {
      const base = opts.stops.length ? opts.stops : [];
      if (base.length < 2) return { ok: false, message: "Set a start and end first.", alternatives: ["From Vancouver to Seattle"] };
      if (base.length >= 6) return { ok: false, message: "Up to 6 stops per order.", alternatives: ["Max 8 hours a day"] };
      opts.stops = [...base.slice(0, -1), clean(add[1]), base[base.length - 1]];
      changed = true;
    } else if (/from .+ to /i.test(p)) {
      opts.stops = stopsIn(p);
      changed = opts.stops.length >= 2;
    }
    if (hrs) {
      const h = Number(hrs[1]);
      if (h < 2 || h > 12) return { ok: false, message: "Keep driving days between 2 and 12 hours.", alternatives: ["6 hours a day", "8 hours a day"] };
      opts.hoursPerDay = h;
      changed = true;
    }
    if (!changed) return { ok: false, message: "Not something Travo can change.", alternatives: ["Max 5 hours a day", "From Vancouver to Seattle via Whistler"] };
    return { ok: true, message: "Updated", options: opts as unknown as Record<string, unknown> };
  },

  async runPhase(id, ctx) {
    const opts = ctx.options as unknown as Opts;
    const stops = opts.stops.length ? opts.stops : stopsIn(ctx.task);
    const mem = ctx.memory as { places?: Place[]; route?: Route; days?: unknown[] };

    if (id === "geocode") {
      if (stops.length < 2) throw new PhaseFailure("unknown", "Need a start and an end, e.g. 'from Vancouver to Seattle'");
      const places: Place[] = [];
      for (const [i, s] of stops.entries()) {
        const hit = await ctx.buy<Place | null>("geocode", "places.geocode", { q: s }, `geo:${s.toLowerCase()}`);
        if (!hit) throw new PhaseFailure("unknown", `Couldn't find "${s}"`);
        places.push({ ...hit, name: s });
        ctx.progress((i + 1) / stops.length, s);
      }
      mem.places = places;
      return;
    }
    if (id === "route") {
      mem.route = await ctx.buy<Route>("route", "routes.drive", { stops: JSON.stringify(mem.places) }, `route:${stops.join("|")}`);
      ctx.progress(1, `${Math.round(mem.route.distanceKm)} km`);
      return;
    }
    if (id === "days") {
      if (ctx.fault("model_error")) throw new PhaseFailure("model_error", "Day planner crashed mid-run");
      const route = mem.route!;
      const places = mem.places!;
      const days: { day: number; from: string; to: string; hours: number; km: number }[] = [];
      let cur = { from: places[0].name, hours: 0, km: 0 };
      route.legs.forEach((leg, i) => {
        if (cur.hours > 0 && cur.hours + leg.hours > opts.hoursPerDay) {
          days.push({ day: days.length + 1, from: cur.from, to: places[i].name, hours: cur.hours, km: cur.km });
          cur = { from: places[i].name, hours: 0, km: 0 };
        }
        cur.hours += leg.hours;
        cur.km += leg.distanceKm;
      });
      days.push({ day: days.length + 1, from: cur.from, to: places[places.length - 1].name, hours: cur.hours, km: cur.km });
      mem.days = days;
      ctx.progress(1, `${days.length} days`);
      return;
    }
    ctx.progress(1);
  },

  deliver(ctx) {
    const route = ctx.memory.route as Route | undefined;
    const days = (ctx.memory.days ?? []) as unknown[];
    return {
      summary: route ? `${Math.round(route.distanceKm)} km · ${route.hours.toFixed(1)} h driving · ${days.length} ${days.length === 1 ? "day" : "days"}` : "No route",
      method: "OpenStreetMap data via x402 on Arc",
      data: { places: ctx.memory.places, route, days },
    };
  },
};
