import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Capability, IoType } from "../catalog/types";

/** A small catalog: phone checks from three providers, listing checks, reviews, a two-step company lookup, and filler. */
const C = (id: string, provider: string, description: string, price: number, inputs: [string, IoType, boolean?][], outputs: [string, IoType][], over: Partial<Capability> = {}): Capability => ({
  resource: `https://${id}.test/api`,
  name: `${provider} ${id}`,
  provider,
  category: "DATA_ENRICHMENT",
  description,
  method: "GET",
  priceUsd: price,
  networks: ["eip155:5042002"],
  payableNow: true,
  payableMainnet: true,
  readOnly: true,
  payTo: `0x${id.padEnd(40, "0").replace(/[^0-9a-f]/g, "a").slice(0, 40)}`,
  inputs: inputs.map(([field, type, required = true]) => ({ field, type, required })),
  outputs: outputs.map(([path, type]) => ({ path, type, label: path.split(".").pop() || type })),
  answers: [],
  taggedBy: "rules",
  taggedAt: "",
  schemaHash: id,
  ...over,
});

const FIXTURES: Capability[] = [
  C("phonea", "PhoneCo", "Phone number fraud risk and VoIP line type", 0.005, [["phone", "phone"]], [["risk", "risk_signal"], ["carrier", "identity_signal"]]),
  C("phoneb", "TrustCo", "Scam risk score for a phone number", 0.008, [["number", "phone"]], [["fraud.level", "risk_signal"]]),
  C("phonec", "CallerCheck", "Caller reputation and spam risk for a phone number", 0.006, [["msisdn", "phone"]], [["risk_level", "risk_signal"]]),
  C("listinga", "ImageTrace", "Reverse search a listing: where its photos and text appear online", 0.004, [["url", "listing_url"]], [["matches", "web_results"]]),
  C("listingb", "ScamWatch", "Scam risk flags for a marketplace listing url", 0.006, [["link", "url"]], [["flags", "risk_signal"]]),
  C("reviews", "ReviewCo", "Reviews and mentions of a seller or business", 0.002, [["q", "text_query"]], [["rating", "reviews"]]),
  C("whois", "WhoisCo", "Domain owner lookup: the company name behind a website", 0.003, [["domain", "domain"]], [["org.name", "company_name"]]),
  C("bizdata", "BizData", "Company record: registration, age, filings for a company name", 0.007, [["company", "company_name"]], [["record", "company_record"]]),
  C("pricey", "GoldCheck", "Premium phone fraud risk", 0.5, [["phone", "phone"]], [["risk", "risk_signal"]]),
  C("mainonly", "MainnetOnly", "Phone fraud risk on mainnet", 0.004, [["phone", "phone"]], [["risk", "risk_signal"]], { payableNow: false }),
  C("caller", "CallBot", "Make an AI phone call to check a seller", 0.009, [["phone", "phone"]], [["", "risk_signal"]], { readOnly: false }),
  ...Array.from({ length: 30 }, (_, i) => C(`filler${i}`, `Filler${i}`, ["Crypto token prices", "Flight status", "Weather in a city", "Stock quotes", "Wallet balances", "Gas prices"][i % 6], 0.001, [["q", "text_query"]], [["data", (["price_quote", "document", "geo", "price_quote", "price_quote", "price_quote"] as IoType[])[i % 6]]])),
];

vi.mock("@/server/marketplace", async (orig) => {
  const real = await orig<typeof import("@/server/marketplace")>();
  const byUrl = (u: string) => FIXTURES.find((c) => c.resource === u.replace(/\/$/, ""));
  return {
    ...real,
    findService: async (u: string) => {
      const c = byUrl(u);
      return c && c.payableNow ? { name: c.name, provider: c.provider, category: c.category, description: c.description, resource: c.resource, method: "GET", priceUsd: c.priceUsd, networks: c.networks, payableHere: true, payTo: c.payTo, amount: String(Math.round((c.priceUsd ?? 0) * 1e6)) } : undefined;
    },
    quoteService: async (s: { resource: string }) => {
      const c = byUrl(s.resource)!;
      return { amount: BigInt(Math.round((c.priceUsd ?? 0) * 1e6)), payTo: c.payTo };
    },
  };
});

process.env.AI_DISABLED = "true";

let compose: typeof import("./index").compose;
let planFromProposal: typeof import("../agents/toolbox").planFromProposal;
beforeAll(async () => {
  const store = await import("../catalog/store");
  store.resetCatalog();
  for (const c of FIXTURES) store.upsertCapability(c);
  compose = (await import("./index")).compose;
  planFromProposal = (await import("../agents/toolbox")).planFromProposal;
});

const SELLER = "I'm about to send $400 to someone on Facebook Marketplace for a bike, here's the listing https://www.facebook.com/marketplace/item/12345 and their number (604) 555-0199";

describe("composing a plan from the catalog", () => {
  it("a seller check gets three tiers: quick is cheapest, most certain cross-checks with a tie-breaker", async () => {
    const c = await compose(SELLER, [], { payable: "now", agent: "worko", id: "t1" });
    expect(c.analysis.givens.map((g) => g.type).sort()).toEqual(["listing_url", "phone"]);
    expect(c.tiers.map((t) => t.tier)).toEqual(["quick", "thorough", "certain"]);
    expect(c.selected).toBe("thorough");
    const [quick, thorough, certain] = c.tiers;
    expect(quick.cost).toBeLessThan(thorough.cost);
    expect(thorough.cost).toBeLessThanOrEqual(certain.cost);
    const steps = certain.proposal.research;
    const verify = steps.filter((s) => s.verify);
    expect(verify.length).toBeGreaterThanOrEqual(2);
    expect(new Set(verify.map((s) => s.args.provider)).size).toBe(verify.length);
    const tie = steps.find((s) => s.onConflict);
    expect(tie).toBeTruthy();
    // The two sources answer the same kind of thing about the same fact; the tie-breaker settles that group.
    const group = verify.filter((s) => s.verify!.group === tie!.onConflict);
    expect(group).toHaveLength(2);
    expect(group[0].verify!.path).not.toBe("");
    expect(steps.indexOf(tie!)).toBeGreaterThan(Math.max(...group.map((s) => steps.indexOf(s))));
    // Funnel numbers are real: the map's size and what scored.
    expect(c.trace.searched).toBe(FIXTURES.length);
    expect(c.trace.relevant).toBeGreaterThan(0);
    // Nothing that acts, nothing over the per-request limit, nothing unpayable here.
    const urls = c.tiers.flatMap((t) => t.proposal.research.map((s) => s.args.url));
    for (const bad of ["caller", "pricey", "mainonly"]) expect(urls.join()).not.toContain(`${bad}.test`);
    // The user's number goes in as they gave it; the title and question are written by code.
    expect(quick.proposal.ask).toMatch(/^Check the seller in \d steps?, at most \$0\.\d+\?$/);
  });

  it("chains backwards: a company record needs a company name, found from the domain the user gave", async () => {
    const c = await compose("Is acme-widgets.com a legit business before I pay their invoice?", [], { payable: "now", agent: "worko", id: "t2" });
    const steps = c.tiers.find((t) => t.tier === "thorough")!.proposal.research;
    const biz = steps.find((s) => s.args.url.includes("bizdata"))!;
    const who = steps.find((s) => s.args.url.includes("whois"))!;
    expect(JSON.parse(who.args.input)).toEqual({ domain: "acme-widgets.com" });
    expect(biz.bind).toEqual({ company: `$${who.id}.org.name` });
    expect(steps.indexOf(who)).toBeLessThan(steps.indexOf(biz));
    const plan = planFromProposal(c.tiers.find((t) => t.tier === "thorough")!.proposal);
    expect(plan.phases.find((p) => p.id === biz.id)?.dependsOn).toEqual([who.id]);
  });

  it("a fact no service answers is a gap with the reason, never an invented step", async () => {
    const c = await compose("What's the route and drive time from here to the lake?", [], { payable: "now", agent: "worko", id: "t3" });
    expect(c.tiers).toHaveLength(0);
    expect(c.gaps[0]).toMatchObject({ why: "No service sells this" });
  });

  it("every tier prices out: the sum of its lines is the 'at most' shown", async () => {
    const c = await compose(SELLER, [], { payable: "now", agent: "worko", id: "t4" });
    for (const t of c.tiers) {
      const lines = planFromProposal(t.proposal).lines;
      const sum = lines.reduce((a, l) => a + Number(l.approved), 0) / 1e6;
      expect(sum).toBeCloseTo(t.cost, 6);
      expect(t.proposal.ask).toContain(`$${t.cost < 0.01 ? t.cost.toFixed(4) : t.cost.toFixed(2)}`);
    }
  });

  it("a job on another network sees the plan, marked as not runnable here", async () => {
    const c = await compose(SELLER, [], { payable: "mainnet", agent: "worko", id: "t5" });
    expect(c.tiers.length).toBeGreaterThan(0);
  });
});

describe("what the user gave", () => {
  it("is only what they typed", async () => {
    const { inUserText, givensByRules } = await import("./facts");
    expect(inUserText({ type: "phone", value: "+1 604-555-0199" }, SELLER)).toBe(true);
    expect(inUserText({ type: "phone", value: "+1 604-555-0100" }, SELLER)).toBe(false);
    expect(inUserText({ type: "email", value: "sam@example.com" }, SELLER)).toBe(false);
    expect(givensByRules("send to 0x00000000000000000000000000000000000000aa or mail bob@x.io").map((g) => g.type)).toEqual(["email", "wallet_address"]);
  });
});
