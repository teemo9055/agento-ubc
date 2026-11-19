import { describe, expect, it } from "vitest";
import { buildHandoff, safeHandoffUrl } from "./handoff";
import { matchRecipes, recipeById, recipeReady, RECIPES } from "./recipes";
import { THEMES } from "./themes";

describe("steps you finish yourself", () => {
  it("builds a ready link for a ride, flight, hotel or table, on known sites only", () => {
    const ride = buildHandoff({ kind: "ride", from: "SEA airport", to: "Hotel Belmont, Seattle" })!;
    expect(ride).toMatchObject({ app: "Uber", label: "Book the ride to Hotel Belmont, Seattle" });
    expect(new URL(ride.url).searchParams.get("dropoff[formatted_address]")).toBe("Hotel Belmont, Seattle");
    const flight = buildHandoff({ kind: "flight", from: "Vancouver", to: "Austin", date: "2026-12-04" })!;
    expect(new URL(flight.url).searchParams.get("q")).toBe("Flights from Vancouver to Austin on 2026-12-04");
    expect(buildHandoff({ kind: "hotel", to: "Seattle", date: "not a date" })!.url).not.toContain("checkin");
    for (const h of [ride, flight, buildHandoff({ kind: "hotel", to: "Seattle" })!, buildHandoff({ kind: "table", to: "Pike Place" })!]) expect(safeHandoffUrl(h.url)).toBe(true);
  });

  it("refuses links without a destination, and anything off the list", () => {
    expect(buildHandoff({ kind: "ride", from: "here" })).toBeNull();
    expect(buildHandoff({ kind: "flight", to: "Austin" })).toBeNull();
    expect(safeHandoffUrl("https://evil.example/uber")).toBe(false);
    expect(safeHandoffUrl("http://m.uber.com/ul/")).toBe(false);
  });
});

describe("the recipe book", () => {
  it("finds the closest recipe from everyday words", () => {
    expect(matchRecipes("is this marketplace listing a scam?")[0].recipe.id).toBe("scam-shield");
    expect(matchRecipes("my landlord wants rent upfront, looking for an apartment near campus")[0].recipe.id).toBe("apartment-hunt");
    expect(matchRecipes("I saw a meme coin hyped on twitter, rug pull?")[0].recipe.id).toBe("rug-check");
    expect(matchRecipes("rain would ruin our wedding on saturday")[0].recipe.id).toBe("event-weather");
    expect(matchRecipes("I land tonight and need a ride to the hotel", { agent: "worko" })[0].recipe.id).toBe("airport-ride");
    expect(matchRecipes("xyz")).toEqual([]);
  });

  it("is consistent: unique ids, real agents, next steps that exist, honest readiness", () => {
    const ids = RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RECIPES) {
      expect(THEMES[r.agent]).toBeDefined();
      for (const n of r.next ?? []) expect(recipeById(n), `${r.id} → ${n}`).toBeDefined();
      for (const s of r.steps) if (s.kind === "pays") expect(s.cost, `${r.id}: ${s.label}`).toBeGreaterThan(0);
      if (r.steps.some((s) => s.where === "later")) expect(recipeReady(r)).toBe("later");
    }
    // Every agent has its own row of problems on its home.
    for (const a of Object.keys(THEMES)) expect(RECIPES.filter((r) => r.agent === a).length).toBeGreaterThanOrEqual(4);
  });
});
