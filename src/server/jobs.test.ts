import { describe, expect, it } from "vitest";
import { jobById, JOBS, SECTIONS } from "@/lib/jobs";
import { venueFor } from "./jobs";
import { validateProposal } from "./tools";
import { withNet } from "./netContext";

describe("the job catalog", () => {
  it("has 6 to 10 jobs for each agent, in that agent's own sections", () => {
    for (const agent of ["inso", "worko"] as const) {
      const mine = JOBS.filter((j) => j.agent === agent);
      expect(mine.length).toBeGreaterThanOrEqual(6);
      expect(mine.length).toBeLessThanOrEqual(10);
      for (const j of mine) expect(SECTIONS[j.section].agent).toBe(agent);
    }
    expect(new Set(JOBS.map((j) => j.id)).size).toBe(JOBS.length);
  });

  it("sends weather and sports orders only to Gemini's real exchange, else practice; commodities go where you chose", () => {
    const wedding = jobById("wedding-cold")!;
    const gold = jobById("ring-gold")!;
    expect(venueFor(wedding, "gemini-sandbox")).toBe("paper");
    expect(venueFor(wedding, "gemini")).toBe("gemini");
    expect(venueFor(gold, "gemini-sandbox")).toBe("gemini-sandbox");
  });
});

describe("checks paid in real USDC", () => {
  const check = { title: "Check the seller", why: "x", ask: "Check it?", research: [{ tool: "phone_check", args: { phone: "+1 415 555 0134" }, label: "Seller's phone line", why: "x" }], action: null, condition: null, budgetUsd: null };

  it("are refused on a test-money job, in plain words", async () => {
    const r = await withNet("testnet", () => validateProposal("worko", check, "p1"));
    expect("error" in r && r.error).toMatch(/real USDC on Arc mainnet/);
  });

  it("are priced from the seller's listing on a mainnet job", async () => {
    const r = await withNet("mainnet", () => validateProposal("worko", check, "p2"));
    if ("error" in r) throw new Error(r.error);
    expect(r.proposal.research[0].tool).toBe("phone_check");
  });
});
