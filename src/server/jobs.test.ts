import { describe, expect, it, vi } from "vitest";
import { jobById, JOBS, SECTIONS } from "@/lib/jobs";
import { venueFor } from "./jobs";
import { validateProposal } from "./tools";
import { withNet } from "./netContext";

describe("the job catalog", () => {
  it("has at least 6 jobs for each agent, at most 10 a section, in that agent's own sections", () => {
    for (const agent of ["inso", "worko"] as const) {
      const mine = JOBS.filter((j) => j.agent === agent);
      expect(mine.length).toBeGreaterThanOrEqual(6);
      for (const sec of new Set(mine.map((j) => j.section))) expect(mine.filter((j) => j.section === sec).length).toBeLessThanOrEqual(10);
      for (const j of mine) expect(SECTIONS[j.section].agent).toBe(agent);
    }
    expect(new Set(JOBS.map((j) => j.id)).size).toBe(JOBS.length);
  });

  it("sends weather, sports and Fed orders to Gemini's real exchange; practice only while no Gemini account is connected", () => {
    const wedding = jobById("wedding-cold")!;
    const gold = jobById("ring-gold")!;
    // Nothing connected: practice.
    expect(venueFor(wedding, "gemini-sandbox")).toBe("paper");
    expect(venueFor(gold, "paper")).toBe("paper");
    // The test exchange connected: no practice any more; real-only markets wait for the real exchange.
    vi.stubEnv("GEMINI_SANDBOX_KEY", "k");
    vi.stubEnv("GEMINI_SANDBOX_SECRET", "s");
    expect(venueFor(gold, "paper")).toBe("gemini-sandbox");
    expect(venueFor(gold, "gemini-sandbox")).toBe("gemini-sandbox");
    expect(venueFor(wedding, "gemini-sandbox")).toBe("paper");
    // The real exchange connected too: weather, sports and the Fed go there.
    vi.stubEnv("GEMINI_LIVE_KEY", "k");
    vi.stubEnv("GEMINI_LIVE_SECRET", "s");
    expect(venueFor(wedding, "gemini-sandbox")).toBe("gemini");
    expect(venueFor(jobById("news-fed")!, "gemini-sandbox")).toBe("gemini");
    expect(venueFor(gold, "gemini-sandbox")).toBe("gemini-sandbox");
    vi.unstubAllEnvs();
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
