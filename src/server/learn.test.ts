import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Run } from "@/lib/types";

const PAY = "0x00000000000000000000000000000000000000c1" as const;
const answers: Record<string, () => unknown> = {
  "https://a.test/risk": () => ({ risk: "high" }),
  "https://rev.test/reviews": () => ({ rating: 4.6 }),
};
const listing = (resource: string) => ({ name: resource, provider: new URL(resource).host, category: "", description: "", resource, method: "GET" as const, priceUsd: 0.01, networks: ["eip155:5042002"], payableHere: true, payTo: PAY, amount: "10000" });
vi.mock("@/server/marketplace", async (orig) => ({
  ...(await orig<typeof import("@/server/marketplace")>()),
  findService: async (url: string) => (answers[url] ? listing(url) : undefined),
  quoteService: async () => ({ amount: 10000n, payTo: PAY }),
  callService: async (s: { resource: string; provider: string }) => ({ provider: s.provider, resource: s.resource, data: answers[s.resource](), paid: { amountUsdc: 0.01, payTo: PAY, via: "test", at: new Date().toISOString() } }),
}));
vi.mock("@/server/nanopay", async (orig) => ({ ...(await orig<typeof import("@/server/nanopay")>()), gatewayBalance: async () => 1, ensureGatewayFunds: async () => {} }));

// A well-known local test key (Foundry's default account), so this server has a seller to be paid at.
process.env.SELLER_PRIVATE_KEY ??= "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
process.env.DEMO_DELAY_SCALE = "0";
process.env.AI_DISABLED = "true";
process.env.RECIPE_PROMOTE_AFTER = "2";

let learn: typeof import("./learn");
beforeAll(async () => {
  learn = await import("./learn");
});
beforeEach(() => learn.resetLearned());

const PHONE = "(604) 555-0199";
/** A finished composed job, as the orchestrator leaves it. */
function finished(id: string, ok = true): Run {
  const step = (sid: string, url: string, input: Record<string, string>, lane: string) => ({ id: sid, tool: "service", args: { url, input: JSON.stringify(input), what: "x", provider: new URL(url).host, price: "10000", payTo: PAY }, label: `${new URL(url).host}: check`, why: "because", resource: url, lane });
  return {
    id,
    agent: "worko",
    task: `Is this seller real? ${PHONE}`,
    status: "done",
    mode: "demo",
    lanes: [
      { id: "f1", question: "Is this phone number risky?", importance: "must" },
      { id: "f2", question: "What do reviews say?", importance: "should" },
    ],
    proposal: {
      id: `p-${id}`,
      title: "Check the seller: thorough",
      why: "",
      ask: "",
      venue: "paper",
      givens: { phone: { type: "phone", value: PHONE } },
      compose: { searched: 40, relevant: 5, considered: 6, facts: [{ id: "f1", question: "Is this phone number risky?", covered: true, importance: "must" }, { id: "f2", question: "What do reviews say?", covered: true, importance: "should" }], ms: 1 },
      research: [step("r1", "https://a.test/risk", { phone: PHONE }, "f1"), step("r2", "https://rev.test/reviews", { q: PHONE }, "f2")],
    },
    phases: [
      { id: "r1", label: "a", sub: "", status: ok ? "done" : "skipped", dependsOn: [], optional: true, payments: [], lineId: "r1", lane: "f1" },
      { id: "r2", label: "b", sub: "", status: "done", dependsOn: [], optional: true, payments: [], lineId: "r2", lane: "f2" },
    ],
    lines: [
      { id: "r1", phaseId: "r1", purpose: "", service: "", payeeName: "", payee: PAY, rail: "gateway", approved: "10000", actual: ok ? "10000" : "0", index: -1, bigSpend: false },
      { id: "r2", phaseId: "r2", purpose: "", service: "", payeeName: "", payee: PAY, rail: "gateway", approved: "10000", actual: "10000", index: -1, bigSpend: false },
    ],
  } as unknown as Run;
}

describe("learning recipes from jobs that worked", () => {
  it("a first run that worked is a draft, with the user's number replaced by a placeholder", () => {
    const r = learn.learnFromRun(finished("j1"))!;
    expect(r).toMatchObject({ status: "draft", runs: 1, successes: 1, avgCostUsd: 0.02, needs: [{ name: "phone", type: "phone" }], title: "Check the seller" });
    expect(JSON.stringify(r)).not.toContain("555-0199");
    expect(JSON.parse(r.steps[0].args.input)).toEqual({ phone: "{{given.phone}}" });
  });

  it("a second similar run counts toward the same recipe and promotes it; the same job never counts twice", () => {
    learn.learnFromRun(finished("j1"));
    expect(learn.learnFromRun(finished("j1"))!.runs).toBe(1);
    const r = learn.learnFromRun(finished("j2"))!;
    expect(r).toMatchObject({ runs: 2, successes: 2, successRate: 1, status: "promoted" });
    expect(learn.allLearned()).toHaveLength(1);
  });

  it("a run that didn't deliver a must-know step doesn't become a recipe, and lowers a known one's rate", () => {
    expect(learn.learnFromRun(finished("j3", false))).toBeNull();
    learn.learnFromRun(finished("j4"));
    const r = learn.learnFromRun(finished("j5", false))!;
    expect(r).toMatchObject({ runs: 2, successes: 1, successRate: 0.5, status: "draft" });
  });

  it("is offered when a request fits a promoted recipe", () => {
    learn.learnFromRun(finished("j6"));
    learn.learnFromRun(finished("j7"));
    expect(learn.matchLearned("is this phone number risky? seller wants a deposit")[0]?.recipe.id).toBe(learn.allLearned()[0].id);
  });
});

describe("selling a promoted recipe over x402", () => {
  const req = (path: string) => new NextRequest(new URL(`http://localhost${path}`));
  let id = "";
  beforeEach(() => {
    learn.learnFromRun(finished("s1"));
    id = learn.learnFromRun(finished("s2"))!.id;
  });

  it("asks for its price first (402), priced from real runs plus the margin", async () => {
    const { GET } = await import("@/app/api/x402/[product]/route");
    const r = await GET(req(`/api/x402/recipe.${id}?phone=%2B16045550199`), { params: Promise.resolve({ product: `recipe.${id}` }) });
    expect(r.status).toBe(402);
    const body = await r.json();
    // $0.02 a run × 1.3 = $0.026; never below what its steps may cost ($0.02).
    expect(body.accepts[0].maxAmountRequired).toBe("26000");
  });

  it("refuses a bad request before anything is charged", async () => {
    const { GET } = await import("@/app/api/x402/[product]/route");
    const r = await GET(req(`/api/x402/recipe.${id}?phone=call-me`), { params: Promise.resolve({ product: `recipe.${id}` }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/isn't a valid phone/);
    const none = await GET(req(`/api/x402/recipe.${id}`), { params: Promise.resolve({ product: `recipe.${id}` }) });
    expect(none.status).toBe(400);
  });

  it("runs as its own practice job and returns the report and the receipt", async () => {
    const { productFor } = await import("./x402");
    const out = (await productFor(`recipe.${id}`)!.run(new URLSearchParams({ phone: "+1 778 555 0123" }))) as import("./recipeRun").RecipeResult;
    expect(out.ok).toBe(true);
    expect(out.report?.claims.length).toBe(2);
    expect(out.receipt.spentUsd).toBeCloseTo(0.02, 6);
    expect(out.receipt.steps.every((s) => s.delivered)).toBe(true);
    // A sold run doesn't teach the book again.
    expect(learn.allLearned()[0].runs).toBe(2);
  });

  it("isn't for sale while it's a draft", async () => {
    learn.resetLearned();
    const draft = learn.learnFromRun(finished("d1"))!;
    const { productFor } = await import("./x402");
    expect(productFor(`recipe.${draft.id}`)).toBeUndefined();
  });
});
