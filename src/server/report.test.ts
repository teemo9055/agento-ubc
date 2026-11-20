import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Run } from "@/lib/types";

// The model is replaced: these tests read what it would be shown, and check what code does with its reply.
const seen: { system: string; user: string }[] = [];
let reply: unknown = { headline: "x", verdict: "unclear", claims: [] };
vi.mock("./ai", () => ({
  aiEnabled: () => true,
  aiJson: async (_schema: unknown, o: { system: string; user: string }) => {
    seen.push({ system: o.system, user: o.user });
    return { value: reply, usage: { model: "test", calls: 1, promptTokens: 0, completionTokens: 0 } };
  },
}));

const { buildReport, digest } = await import("./report");

// The shape of the first real mainnet job: 447 odds points, flat at 0.74 for days, then up to 0.86.
const odds = Array.from({ length: 447 }, (_, i) => ({ t: 1794729600000 + i * 900_000, p: i < 200 ? 0.74 : i < 380 ? 0.86 : i < 420 ? 0.74 : 0.86 }));

const run = {
  id: "j1",
  agent: "trado",
  task: "Which Bitcoin prediction markets are open right now on Gemini?",
  proposal: { id: "p1", title: "Odds history", why: "", ask: "Pull 15-minute odds history for the $61,500 Nov 20 contract for 0.02 USDC?", research: [{ id: "r1", tool: "odds_history", args: {}, label: "Odds history", why: "" }] },
  lines: [{ id: "r1", payee: "0x00000000000000000000000000000000000000aa", payeeName: "Agento data feed", rail: "x402", approved: "20000", actual: "20000" }],
  phases: [{ id: "r1", label: "Odds history", status: "done", lineId: "r1", payments: [{ txState: "settled", amount: "20000" }] }],
  results: { r1: odds },
} as unknown as Run;

beforeEach(() => {
  seen.length = 0;
});

describe("the report", () => {
  it("is judged against the approved check, with the first message only as background", async () => {
    await buildReport(run);
    expect(seen[0].user).toMatch(/^What they approved: Pull 15-minute odds history/);
    expect(seen[0].user).toContain("(They first asked: Which Bitcoin prediction markets");
  });

  it("sees a long list whole, in short, instead of its first entries", async () => {
    await buildReport(run);
    const shown = seen[0].user;
    expect(shown).toContain('"count":447');
    expect(shown).toContain('"p":{"first":0.74,"last":0.86,"lowest":0.74,"highest":0.86}');
    // The end of the series is there, not just the flat start.
    expect(shown).toContain(String(odds[446].t));
  });

  it("lets a claim quoting the end of the series pass the number check", async () => {
    reply = { headline: "Odds rose to 86%", verdict: "looks_fine", claims: [{ text: "Odds went from 74% to 86%.", evidence: ["r1"] }] };
    const built = await buildReport(run);
    expect(built?.report.claims[0]).not.toHaveProperty("unverified");
  });

  it("leaves short answers as they are", () => {
    expect(digest([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
    expect(digest({ name: "BTC", price: 1 })).toEqual({ name: "BTC", price: 1 });
    expect(digest(Array.from({ length: 20 }, (_, i) => i))).toMatchObject({ count: 20, numbers: { first: 0, last: 19, lowest: 0, highest: 19 } });
  });
});
