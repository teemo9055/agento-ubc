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
