import { describe, expect, it } from "vitest";
import { matchRecipes, recipeById, RECIPES } from "./recipes";
import { THEMES } from "./themes";

describe("the recipe book", () => {
  it("finds the closest recipe from everyday words", () => {
    expect(matchRecipes("a cold snap would ruin our wedding on saturday")[0].recipe.id).toBe("event-weather");
    expect(matchRecipes("is the gas fee low enough to send on base?")[0].recipe.id).toBe("gas-check");
    expect(matchRecipes("plan an ev road trip with chargers")[0].recipe.id).toBe("ev-trip");
    expect(matchRecipes("my mortgage goes up if the fed raises rates")[0].recipe.id).toBe("rate-hike");
    expect(matchRecipes("xyz")).toEqual([]);
  });

  it("is consistent: unique ids, real agents, next steps that exist, every step runs today", () => {
    const ids = RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RECIPES) {
      expect(THEMES[r.agent]).toBeDefined();
      for (const n of r.next ?? []) expect(recipeById(n), `${r.id} → ${n}`).toBeDefined();
      for (const s of r.steps) if (s.kind === "pays") expect(s.cost, `${r.id}: ${s.label}`).toBeGreaterThan(0);
      // Only steps that run today are listed.
      for (const s of r.steps) expect(s.where, `${r.id}: ${s.label}`).toBe("now");
    }
    // Every agent has its own row of problems on its home.
    for (const a of Object.keys(THEMES)) expect(RECIPES.filter((r) => r.agent === a).length).toBeGreaterThanOrEqual(3);
  });
});
