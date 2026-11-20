import { describe, expect, it, vi } from "vitest";
import { jobById, JOBS, SECTIONS } from "@/lib/jobs";
import { buildJob, venueFor } from "./jobs";
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

describe("every check job in the catalog", () => {
  // Checks need no market data, so each one can be built and checked here: a wrong argument name
  // or an unpriced lookup fails now, not when someone clicks the card.
  const checks = ["company-deep", "place-reviews", "listing-check", "seller-check", "business-check"];
  for (const id of checks)
    it(`${id} builds and passes the checks on mainnet`, async () => {
      const b = await buildJob(id, "paper");
      if ("error" in b || !("input" in b)) throw new Error("error" in b ? b.error : "not a single move");
      const r = await withNet("mainnet", () => validateProposal("worko", b.input, `t-${id}`, { composed: true }));
      if ("error" in r) throw new Error(`${id}: ${r.error}`);
      expect(r.proposal.research.length).toBe(b.input.research.length);
    });
});

describe("chained jobs", () => {
  it("keep their links: the phone and website checks read what the Google stage found", async () => {
    const b = await buildJob("business-check", "paper");
    if ("error" in b || !("input" in b)) throw new Error("not a single move");
    const r = await withNet("mainnet", () => validateProposal("worko", b.input, "t-chain", { composed: true }));
    if ("error" in r) throw new Error(r.error);
    const [google, phone, site, company] = r.proposal.research;
    expect(phone.bind?.phone).toBe(`$${google.id}.found.phone`);
    expect(site.bind?.url).toBe(`$${google.id}.found.website`);
    expect(company.bind?.site).toBe(`$${google.id}.found.website`);
  });
});

describe("jobs built from what the person typed", () => {
  it("their business fills every stage, and travels with the job as theirs", async () => {
    const b = await buildJob("business-check", "paper", undefined, undefined, { business: "Acme Plumbing, Denver" });
    if ("error" in b || !("input" in b)) throw new Error("not a single move");
    const r = await withNet("mainnet", () => validateProposal("worko", b.input, "t-in", { composed: true }));
    if ("error" in r) throw new Error(r.error);
    expect(r.proposal.title).toBe("Check: Acme Plumbing, Denver");
    expect(r.proposal.research[0].args.place).toBe("Acme Plumbing, Denver");
    // Later searches are built from what Google found: its exact name and address.
    expect(r.proposal.research[5].bind?.query).toBe("{$r1.found.name} {$r1.found.address} license number complaints");
    expect(r.proposal.questions?.[0].ask).toBe("Is Acme Plumbing, Denver a real, established business?");
    expect(r.proposal.givens?.business).toEqual({ type: "company_name", value: "Acme Plumbing, Denver" });
    expect(r.proposal.then?.watch.title).toBe("Watch: news about Acme Plumbing, Denver");
    expect(JSON.stringify(r.proposal)).not.toMatch(/Bay Area/);
  });

  it("the company check pins the company by its website, and each stage reads the one before", async () => {
    const b = await buildJob("company-brief", "paper", undefined, undefined, { company: "Acme", website: "acme.io" });
    if ("error" in b || !("input" in b)) throw new Error("not a single move");
    const r = await withNet("mainnet", () => validateProposal("worko", b.input, "t-co", { composed: true }));
    if ("error" in r) throw new Error(r.error);
    const [s1, s2, s3, s4] = r.proposal.research;
    expect(s1.args.site).toBe("acme.io");
    expect(s2.bind?.site).toBe("$r1.domain");
    expect(s3.bind).toEqual({ site: "$r1.domain", since: "$r2.lastRoundDate" });
    expect(s4.args.exclude).toBe("acme.io");
    expect(r.proposal.questions).toHaveLength(5);
    expect(r.proposal.reserveUsd).toBe(0.06);
  });

  it("a pasted listing is read first, and later stages price and check what it sells", async () => {
    const b = await buildJob("listing-check", "paper", undefined, undefined, { listing: "https://www.ebay.com/itm/123" });
    if ("error" in b || !("input" in b)) throw new Error("not a single move");
    const r = await withNet("mainnet", () => validateProposal("worko", b.input, "t-l", { composed: true }));
    if ("error" in r) throw new Error(r.error);
    const [read, prices, photo] = r.proposal.research;
    expect(read.tool).toBe("read_listing");
    expect(read.args.url).toBe("https://www.ebay.com/itm/123");
    expect(prices.bind?.product).toBe(`$${read.id}.searchTitle`);
    expect(photo.bind?.imageUrl).toBe(`$${read.id}.photo`);
  });
});
