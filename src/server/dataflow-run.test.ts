import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Proposal, ResearchStep, Run } from "@/lib/types";

/**
 * A chained job end to end in practice: step 2 and 3 read the phone number step 1 found, two
 * sources answer the same question, a tie-breaker is bought only when they disagree, and a branch
 * runs only when an earlier answer calls for it.
 */
const PAY = "0x00000000000000000000000000000000000000c1" as const;
const calls: { url: string; input: Record<string, unknown> }[] = [];
let secondOpinion = "low";
const answers: Record<string, () => unknown> = {
  "https://reader.test/listing": () => ({ seller: { name: "Sam", phone: "(604) 555-0199" } }),
  "https://a.test/risk": () => ({ risk: "high" }),
  "https://b.test/risk": () => ({ risk: secondOpinion }),
  "https://c.test/risk": () => ({ risk: "high" }),
  "https://rev.test/reviews": () => ({ rating: 4.6 }),
};
const listing = (resource: string) => ({ name: resource, provider: new URL(resource).host, category: "", description: "", resource, method: "GET" as const, priceUsd: 0.01, networks: ["eip155:5042002"], payableHere: true, payTo: PAY, amount: "10000" });

vi.mock("@/server/marketplace", async (orig) => ({
  ...(await orig<typeof import("@/server/marketplace")>()),
  findService: async (url: string) => (answers[url] ? listing(url) : undefined),
  callService: async (s: { resource: string; provider: string }, input: Record<string, unknown>) => {
    calls.push({ url: s.resource, input });
    return { provider: s.provider, resource: s.resource, data: answers[s.resource](), paid: { amountUsdc: 0.01, payTo: PAY, via: "test", at: new Date().toISOString() } };
  },
}));
vi.mock("@/server/nanopay", async (orig) => ({ ...(await orig<typeof import("@/server/nanopay")>()), gatewayBalance: async () => 1, depositToGateway: async () => ({}), ensureGatewayFunds: async () => {} }));

process.env.DEMO_DELAY_SCALE = "0";
process.env.AI_DISABLED = "true";

let orch: typeof import("@/server/orchestrator");
beforeAll(async () => {
  orch = await import("@/server/orchestrator");
  const { upsertCapability } = await import("@/server/catalog/store");
  for (const url of Object.keys(answers))
    upsertCapability({
      resource: url,
      name: url,
      provider: new URL(url).host,
      category: "",
      description: "",
      method: "GET",
      priceUsd: 0.01,
      networks: [],
      payableNow: true,
      payableMainnet: false,
      readOnly: true,
      inputs: url.includes("risk") ? [{ field: "phone", type: "phone", required: true }] : [{ field: "url", type: "url", required: true }],
      outputs: url.includes("risk") ? [{ path: "risk", type: "risk_signal", label: "risk" }] : url.includes("rev") ? [{ path: "rating", type: "reviews", label: "rating" }] : [{ path: "seller.phone", type: "phone", label: "phone" }],
      answers: [],
      taggedBy: "rules",
      taggedAt: "",
      schemaHash: "",
    });
});

const svc = (id: string, url: string, input: Record<string, unknown>, extra: Partial<ResearchStep> = {}): ResearchStep => ({
  id,
  tool: "service",
  args: { url, input: JSON.stringify(input), what: new URL(url).host, provider: new URL(url).host, price: "10000", payTo: PAY },
  label: new URL(url).host,
  why: "test",
  resource: url,
  ...extra,
});

const proposal = (id: string): Proposal => ({
  id,
  title: "Check the seller",
  why: "test",
  ask: "Check the seller in 5 steps?",
  venue: "paper",
  givens: { listing: { type: "listing_url", value: "https://fb.test/item/1" } },
  research: [
    svc("r1", "https://reader.test/listing", { url: "https://fb.test/item/1" }),
    svc("r2", "https://a.test/risk", {}, { bind: { phone: "$r1.seller.phone" }, verify: { group: "risk", path: "risk", kind: "same" }, lane: "risk" }),
    svc("r3", "https://b.test/risk", {}, { bind: { phone: "$r1.seller.phone" }, verify: { group: "risk", path: "risk", kind: "same" }, lane: "risk" }),
    svc("r4", "https://c.test/risk", {}, { bind: { phone: "$r1.seller.phone" }, onConflict: "risk", lane: "risk" }),
    svc("r5", "https://rev.test/reviews", { url: "https://fb.test/item/1" }, { when: { ref: "$r2.risk", op: "==", value: "low" } }),
  ],
});

async function runIt(id: string): Promise<Run> {
  const r = await orch.createRun({ agent: "worko", task: "Is this seller real?", proposal: proposal(id) });
  await orch.approve(r.id);
  for (let i = 0; i < 400 && !["done", "cancelled"].includes(orch.getRun(r.id)!.status); i++) {
    const f = orch.getRun(r.id)!.pendingFailures[0];
    if (f) throw new Error(`unexpected failure: ${f.message}`);
    await new Promise((res) => setTimeout(res, 5));
  }
  return orch.getRun(r.id)!;
}

const phase = (run: Run, id: string) => run.phases.find((p) => p.id === id)!;
const spent = (run: Run, id: string) => run.lines.find((l) => l.id === id)!.actual;

describe("a chained job", () => {
  it("prices every step up front and waits for the steps it reads from", async () => {
    const r = await orch.createRun({ agent: "worko", task: "x", proposal: proposal("p0") });
    expect(phase(r, "r2").dependsOn).toEqual(["r1"]);
    expect(phase(r, "r4").dependsOn.sort()).toEqual(["r1", "r2", "r3"]);
    expect(phase(r, "r5").dependsOn).toEqual(["r2"]);
    expect(phase(r, "r2").binds).toEqual([{ from: "r1", field: "phone" }]);
    expect(phase(r, "r4").tieBreaker).toBe("risk");
    expect(phase(r, "r5").conditional).toBe("step 2 risk was low");
    // Branches and tie-breakers are priced in, and the review says they may not be spent.
    expect(r.lines).toHaveLength(5);
    expect(r.cards.find((c) => c.kind === "risk")?.points[0]).toMatch(/Up to \$0\.02 is only spent if sources disagree/);
  });

  it("sources disagree: the phone flows from step 1, a third source settles it, the branch is skipped and costs nothing", async () => {
    calls.length = 0;
    secondOpinion = "low";
    const run = await runIt("p1");
    expect(run.status).toBe("done");
    // Step 1 finished before the steps that read from it started.
    expect(Date.parse(phase(run, "r1").endedAt!)).toBeLessThanOrEqual(Date.parse(phase(run, "r2").startedAt!));
    // The number went in checked and normalised; the preview on the graph is masked.
    expect(calls.find((c) => c.url === "https://a.test/risk")?.input).toEqual({ phone: "+16045550199" });
    expect(phase(run, "r2").inputs).toEqual([{ from: "r1", field: "phone", preview: "+1 604 ••• ••99" }]);
    // The number never appears whole on the graph: not in what flowed, not in a finding.
    expect(JSON.stringify(run.phases.map((p) => [p.inputs, p.finding]))).not.toContain("5550199");
    expect(phase(run, "r1").finding?.text).toBe("Phone: +1 604 ••• ••99");
    expect(phase(run, "r2").conflict).toMatchObject({ group: "risk", agree: false });
    expect(phase(run, "r4").status).toBe("done");
    expect(spent(run, "r4")).toBe("10000");
    expect(run.decisions.some((d) => d.what === "Sources disagreed, bought a third" && d.by === "system")).toBe(true);
    expect(phase(run, "r5")).toMatchObject({ status: "skipped", note: "Not needed: step 2 risk was low" });
    expect(spent(run, "r5")).toBe("0");
    expect(phase(run, "r2").finding).toEqual({ text: "Risk: high", tone: "bad" });
    expect(run.verdict?.lean).toBe("do_not_proceed");
    // The report: a claim per delivered step, each pointing at a paid step; the conflict and its settling by code.
    const rep = run.report!;
    expect(rep.headline).toBe("Here's what each check found");
    expect(rep.claims.map((c) => c.evidence[0])).toEqual(["r1", "r2", "r3", "r4"]);
    expect(rep.claims.every((c) => c.evidence.every((e) => phase(run, e).payments.some((p) => p.txState === "settled")))).toBe(true);
    expect(rep.conflicts).toEqual([
      { fact: "The same question", values: [{ source: "a.test", value: "Risk: high" }, { source: "b.test", value: "Risk: low" }], resolvedBy: "c.test", outcome: "They disagreed, so a third source was bought: Risk: high." },
    ]);
    expect(rep.spent).toEqual({ total: "40000", sources: 4, sellers: 1 });
  });

  it("sources agree: the tie-breaker isn't bought, and its money is never spent", async () => {
    calls.length = 0;
    secondOpinion = "HIGH";
    const run = await runIt("p2");
    expect(phase(run, "r4")).toMatchObject({ status: "skipped", note: expect.stringMatching(/Sources agreed, tie-breaker not needed · \$0\.01 not spent/) });
    expect(calls.some((c) => c.url === "https://c.test/risk")).toBe(false);
    expect(phase(run, "r3").conflict).toMatchObject({ agree: true });
    const paid = run.lines.reduce((a, l) => a + BigInt(l.actual), 0n);
    expect(paid).toBe(30000n);
    // Its approved line is released, so the receipt shows it as not used.
    expect(run.lines.find((l) => l.id === "r4")).toMatchObject({ approved: "0", actual: "0" });
  });

  it("a missing input fails only that step, with the reason, and pays nothing", async () => {
    const p = proposal("p3");
    p.research = [p.research[0], svc("r2", "https://a.test/risk", {}, { bind: { phone: "$r1.seller.mobile" } })];
    const r = await orch.createRun({ agent: "worko", task: "x", proposal: p });
    await orch.approve(r.id);
    for (let i = 0; i < 400 && orch.getRun(r.id)!.status !== "done"; i++) await new Promise((res) => setTimeout(res, 5));
    const run = orch.getRun(r.id)!;
    expect(run.status).toBe("done");
    expect(phase(run, "r2")).toMatchObject({ status: "skipped", note: "Step 1 didn't return “mobile”, so step 2 couldn't run." });
    expect(spent(run, "r2")).toBe("0");
  });
});
