const UA = { "user-agent": "agento/0.1 (demo)" };

export interface Place {
  name: string;
  lat: number;
  lon: number;
}

export async function geocode(q: string): Promise<Place | null> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: "json", limit: "1" })}`, {
    headers: UA,
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`geocode ${r.status}`);
  const [hit] = (await r.json()) as { display_name: string; lat: string; lon: string }[];
  return hit ? { name: hit.display_name.split(",")[0], lat: Number(hit.lat), lon: Number(hit.lon) } : null;
}

export interface Route {
  distanceKm: number;
  hours: number;
  path: [number, number][]; // [lon, lat]
  legs: { distanceKm: number; hours: number }[];
}

export async function drive(stops: Place[]): Promise<Route> {
  const coords = stops.map((s) => `${s.lon},${s.lat}`).join(";");
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=simplified&geometries=geojson`, {
    headers: UA,
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`route ${r.status}`);
  const j = (await r.json()) as {
    code: string;
    routes: { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { distance: number; duration: number }[] }[];
  };
  if (j.code !== "Ok" || !j.routes[0]) throw new Error("no route");
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
  const q = new URLSearchParams({ q: NEARBY[kind], format: "json", limit: String(limit * 3), bounded: "1", extratags: "1", viewbox: `${at.lon - d * 1.4},${at.lat + d},${at.lon + d * 1.4},${at.lat - d}` });
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, { headers: UA, cache: "no-store" });
  if (!r.ok) throw new Error(`nearby ${r.status}`);
  const hits = (await r.json()) as { display_name: string; lat: string; lon: string; extratags?: { website?: string } | null }[];
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
