import { describe, expect, it, vi } from "vitest";

// A straight road east along the equator: an hour of driving per degree, towns named by where they sit.
vi.mock("./geo", async (orig) => {
  const real = await orig<typeof import("./geo")>();
  const drive = async (stops: { lon: number; lat: number }[]) => {
    const legs = stops.slice(1).map((s, i) => ({ distanceKm: 100 * (s.lon - stops[i].lon), hours: s.lon - stops[i].lon }));
    return { distanceKm: legs.reduce((a, l) => a + l.distanceKm, 0), hours: legs.reduce((a, l) => a + l.hours, 0), path: stops.map((s) => [s.lon, s.lat] as [number, number]), legs };
  };
  return { ...real, drive: vi.fn(drive), townAt: vi.fn(async (lat: number, lon: number) => ({ name: `Town at ${Math.round(lon)}`, lat, lon: Math.round(lon) })) };
});

const { fitLongLegs } = await import("./agents/toolbox");
const geo = await import("./geo");
const at = (name: string, lon: number) => ({ name, lat: 0, lon });

describe("splitting a drive into days that fit", () => {
  it("adds a night at a town on the way when one stretch is longer than a day's driving", async () => {
    const places = [at("A", 0), at("B", 4), at("C", 13)];
    const route = await geo.drive(places);
    const fit = await fitLongLegs(places, route, 6);
    expect(fit.added).toEqual(["Town at 9"]);
    expect(fit.places.map((p) => p.name)).toEqual(["A", "B", "Town at 9", "C"]);
    expect(Math.max(...fit.route.legs.map((l) => l.hours))).toBeLessThanOrEqual(6);
  });

  it("leaves a drive alone when every stretch already fits", async () => {
    const places = [at("A", 0), at("B", 5), at("C", 10)];
    const fit = await fitLongLegs(places, await geo.drive(places), 6);
    expect(fit.added).toEqual([]);
    expect(fit.places).toBe(places);
  });
});
