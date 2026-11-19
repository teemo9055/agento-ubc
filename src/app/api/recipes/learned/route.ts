import { NextResponse } from "next/server";
import { allLearned, recipePrice } from "@/server/learn";

export const dynamic = "force-dynamic";

/** Recipes learned from jobs that worked: what each answers, how often it worked, what it costs, and where to buy it. */
export async function GET() {
  return NextResponse.json({
    recipes: allLearned()
      .filter((r) => r.status !== "retired")
      .map((r) => ({
        id: r.id,
        title: r.title,
        worry: r.worry,
        gets: r.gets,
        status: r.status,
        runs: r.runs,
        successes: r.successes,
        avgCostUsd: r.avgCostUsd,
        steps: r.steps.map((s) => s.label),
        needs: r.needs,
        network: r.network,
        priceUsd: Number(recipePrice(r)) / 1e6,
        buy: r.status === "promoted" ? `/api/x402/recipe.${r.id}` : null,
        lastRunAt: r.lastRunAt,
      })),
  });
}
