const UA = { "user-agent": "agento/0.1 (demo)" };

/** Said to the person when the free map service won't answer, instead of an HTTP code. */
export const MAP_BUSY = "The map service is busy right now. Try again in a minute; nothing was charged for this step.";

/**
 * OpenStreetMap's search (Nominatim) allows about one request a second from one app. Every request
 * goes through this one queue, a second apart, answers are kept for a day, and a busy answer (429,
 * 503) is retried after a pause instead of failing the job.
 */
const SPACING_MS = Number(process.env.MAP_SPACING_MS ?? 1100);
const cache = new Map<string, { at: number; body: unknown }>();
let queue: Promise<unknown> = Promise.resolve();
let last = 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function nominatim(path: string, params: Record<string, string>): Promise<unknown> {
  const url = `https://nominatim.openstreetmap.org/${path}?${new URLSearchParams(params)}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 86_400_000) return hit.body;
  const run = queue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await wait(Math.max(0, last + SPACING_MS - Date.now()));
      last = Date.now();
      const r = await fetch(url, { headers: UA, cache: "no-store" }).catch(() => null);
      if (r?.ok) {
        const body = await r.json();
        cache.set(url, { at: Date.now(), body });
        if (cache.size > 2000) cache.delete(cache.keys().next().value!);
        return body;
      }
      if (r && r.status !== 429 && r.status !== 503) throw new Error(MAP_BUSY);
      await wait(2000 * (attempt + 1));
    }
    throw new Error(MAP_BUSY);
  });
  queue = run.catch(() => undefined);
  return run;
}

export interface Place {
  name: string;
  lat: number;
  lon: number;
}

export async function geocode(q: string): Promise<Place | null> {
  const [hit] = (await nominatim("search", { q, format: "json", limit: "1" })) as { display_name: string; lat: string; lon: string }[];
  return hit ? { name: hit.display_name.split(",")[0], lat: Number(hit.lat), lon: Number(hit.lon) } : null;
}

/** The town or city nearest a point on the map, as "Town, State", or null in the middle of nowhere. */
export async function townAt(lat: number, lon: number): Promise<Place | null> {
  type Rev = { address?: Record<string, string>; lat?: string; lon?: string } | null;
  const at = (zoom: string) => nominatim("reverse", { lat: lat.toFixed(4), lon: lon.toFixed(4), format: "json", zoom, addressdetails: "1" }) as Promise<Rev>;
  const named = (j: Rev) => j?.address?.city ?? j?.address?.town ?? j?.address?.village;
  // City level first; out in the country, the nearest village or hamlet beats a county name.
  let j = await at("10");
  if (!named(j)) {
    const closer = await at("14");
    if (named(closer) || closer?.address?.hamlet) j = closer;
  }
  const a = j?.address;
  const town = a?.city ?? a?.town ?? a?.village ?? a?.hamlet ?? a?.municipality ?? a?.county;
  if (!town) return null;
  const region = a?.state ?? a?.province ?? a?.region;
  return { name: region ? `${town}, ${region}` : town, lat: Number(j?.lat ?? lat), lon: Number(j?.lon ?? lon) };
}

export interface Route {
  distanceKm: number;
  hours: number;
  path: [number, number][]; // [lon, lat]
  legs: { distanceKm: number; hours: number }[];
}

/** The public route service also asks for about one request a second: same queue rules as the map. */
let routeQueue: Promise<unknown> = Promise.resolve();
let routeLast = 0;
const ROUTE_DOWN = "The route service didn't answer. Try again in a minute; nothing was charged for this step.";

async function osrm(url: string): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 86_400_000) return hit.body;
  const run = routeQueue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await wait(Math.max(0, routeLast + SPACING_MS - Date.now()));
      routeLast = Date.now();
      const r = await fetch(url, { headers: UA, cache: "no-store" }).catch(() => null);
      if (r?.ok) {
        const body = await r.json();
        cache.set(url, { at: Date.now(), body });
        return body;
      }
      // "No route" comes back as 400 with a body: that's an answer, not a busy server.
      if (r?.status === 400) return r.json().catch(() => ({ code: "NoRoute", routes: [] }));
      await wait(1500 * (attempt + 1));
    }
    throw new Error(ROUTE_DOWN);
  });
  routeQueue = run.catch(() => undefined);
  return run;
}

export async function drive(stops: Place[]): Promise<Route> {
  const coords = stops.map((s) => `${s.lon},${s.lat}`).join(";");
  const j = (await osrm(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=simplified&geometries=geojson`)) as {
    code: string;
    routes: { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { distance: number; duration: number }[] }[];
  };
  if (j.code !== "Ok" || !j.routes?.[0]) throw new Error("There's no road route between those places.");
  const route = j.routes[0];
  return {
    distanceKm: route.distance / 1000,
    hours: route.duration / 3600,
    path: route.geometry.coordinates,
    legs: route.legs.map((l) => ({ distanceKm: l.distance / 1000, hours: l.duration / 3600 })),
  };
}

export const NEARBY = { hotel: "hotel", charging: "charging station", fuel: "fuel", food: "restaurant" } as const;
export type NearbyKind = keyof typeof NEARBY;

export interface Spot {
  name: string;
  /** Street and town, when the map has them. */
  where: string;
  website?: string;
  lat: number;
  lon: number;
}

/**
 * Named places of one kind around a point (OpenStreetMap): hotels to sleep at, chargers, fuel, food.
 * A list to choose from, not a booking; nothing here is reserved or paid for.
 */
export async function nearby(at: Place, kind: NearbyKind, limit = 3): Promise<Spot[]> {
  const d = 0.12; // roughly 13 km north-south
  const hits = (await nominatim("search", { q: NEARBY[kind], format: "json", limit: String(limit * 3), bounded: "1", extratags: "1", viewbox: `${at.lon - d * 1.4},${at.lat + d},${at.lon + d * 1.4},${at.lat - d}` })) as { display_name: string; lat: string; lon: string; extratags?: { website?: string } | null }[];
  const seen = new Set<string>();
  return hits
    .map((h) => {
      const [name, ...rest] = h.display_name.split(",").map((x) => x.trim());
      const site = h.extratags?.website;
      return { name, where: rest.filter((x) => !/^\d+$/.test(x)).slice(0, 2).join(", "), website: site && /^https?:\/\//.test(site) ? site.split("?")[0].slice(0, 120) : undefined, lat: Number(h.lat), lon: Number(h.lon) };
    })
    .filter((x) => x.name && !/^\d/.test(x.name) && !seen.has(x.name.toLowerCase()) && seen.add(x.name.toLowerCase()))
    // Closest first.
    .sort((a, b) => Math.hypot(a.lat - at.lat, a.lon - at.lon) - Math.hypot(b.lat - at.lat, b.lon - at.lon))
    .slice(0, limit);
}

/** The point a share `f` (0-1) of the way along a path, by distance. */
export function pointAlong(path: [number, number][], f: number): [number, number] {
  if (path.length < 2) return path[0];
  const seg = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], (p[1] - path[i][1]) * 1.0));
  const total = seg.reduce((a, b) => a + b, 0);
  let goal = total * Math.min(1, Math.max(0, f));
  for (let i = 0; i < seg.length; i++) {
    if (goal <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? Math.min(1, goal / seg[i]) : 0;
      return [path[i][0] + (path[i + 1][0] - path[i][0]) * t, path[i][1] + (path[i + 1][1] - path[i][1]) * t];
    }
    goal -= seg[i];
  }
  return path[path.length - 1];
}
