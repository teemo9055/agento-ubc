import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fieldType, isReadOnly, tagByRules } from "./tag";
import { searchCapabilities, catalogFunnel } from "./search";
import { allCapabilities, getCapability, recordOutcome, reliabilityScore, resetCatalog, upsertCapability } from "./store";
import { crawlCatalog } from "./crawl";
import { recordDelivery, resetDeliveries } from "../strikes";
import type { Capability, IoType } from "./types";

describe("rule tagger: field names → types", () => {
  const cases: [string, IoType][] = [
    ["phone", "phone"],
    ["phone_number", "phone"],
    ["msisdn", "phone"],
    ["email", "email"],
    ["domain", "domain"],
    ["hostname", "domain"],
    ["url", "url"],
    ["link", "url"],
    ["image_url", "image_url"],
    ["photo", "image_url"],
    ["wallet", "wallet_address"],
    ["tx_hash", "tx_hash"],
    ["chain", "chain"],
    ["lat", "geo"],
    ["lon", "geo"],
    ["q", "text_query"],
    ["query", "text_query"],
    ["symbol", "ticker"],
    ["company", "company_name"],
    ["business_name", "company_name"],
    ["city", "place"],
    ["country_code", "country"],
    ["start_date", "date"],
    ["listing_url", "listing_url"],
    ["product_name", "product_name"],
  ];
  it.each(cases)("%s → %s", (field, type) => expect(fieldType(field)).toBe(type));

  it("reads patterns and formats too", () => {
    expect(fieldType("from", { pattern: "^\\+1\\d{10}$" })).toBe("phone");
    expect(fieldType("owner", { pattern: "^0x[a-fA-F0-9]{40}$" })).toBe("wallet_address");
    expect(fieldType("target", { format: "uri" })).toBe("url");
  });

  it("tags a listing with no schema from its description, and outputs from its words", () => {
    const t = tagByRules({ resource: "https://x.test/lookup", name: "Phone lookup", provider: "X", category: "", description: "Carrier and line type (VoIP or mobile) for a phone number", method: "GET", priceUsd: 0.01, networks: [], payableNow: true, payableMainnet: true });
    expect(t.inputs).toEqual([{ field: "phone", type: "phone", required: true, guessed: true }]);
    expect(t.outputs.map((o) => o.type)).toContain("risk_signal");
  });

  it("keeps listings that act (send, buy, call) out of plans", () => {
    expect(isReadOnly({ method: "POST", name: "Make an AI phone call", description: "Send a phone number and task" })).toBe(false);
    expect(isReadOnly({ method: "DELETE", name: "x", description: "remove a thing" })).toBe(false);
    expect(isReadOnly({ method: "GET", name: "Reviews", description: "Reviews of a business" })).toBe(true);
  });
});

const cap = (n: number, over: Partial<Capability> = {}): Capability => ({
  resource: `https://svc${n}.test/api`,
  name: `Service ${n}`,
  provider: `Provider${n}`,
  category: "DATA_ENRICHMENT",
  description: "General data",
  method: "GET",
  priceUsd: 0.01,
  networks: ["eip155:5042"],
  payableNow: false,
  payableMainnet: true,
  readOnly: true,
  inputs: [{ field: "q", type: "text_query", required: true }],
  outputs: [{ path: "", type: "web_results", label: "results" }],
  answers: [],
  taggedBy: "rules",
  taggedAt: "2026-11-01T00:00:00Z",
  schemaHash: String(n),
  ...over,
});

describe("searching the capability map", () => {
  beforeEach(() => {
    resetCatalog();
    resetDeliveries();
    for (let i = 0; i < 30; i++) upsertCapability(cap(i));
    upsertCapability(cap(100, { name: "Phone risk", provider: "PhoneCo", description: "Fraud risk and VoIP line type for a phone number", inputs: [{ field: "phone", type: "phone", required: true }], outputs: [{ path: "risk", type: "risk_signal", label: "risk" }], payTo: "0x00000000000000000000000000000000000000a1" }));
    upsertCapability(cap(101, { name: "Seller risk", provider: "TrustCo", description: "Scam risk score for a phone number or email", inputs: [{ field: "phone", type: "phone", required: true }], outputs: [{ path: "score", type: "risk_signal", label: "risk" }], payTo: "0x00000000000000000000000000000000000000a2" }));
    upsertCapability(cap(102, { name: "Struck risk", provider: "BadCo", description: "Phone fraud risk", inputs: [{ field: "phone", type: "phone", required: true }], outputs: [{ path: "r", type: "risk_signal", label: "risk" }], payTo: "0x00000000000000000000000000000000000000a3" }));
    upsertCapability(cap(103, { name: "Call someone", provider: "Caller", description: "Make a phone call about fraud risk", readOnly: false, outputs: [{ path: "", type: "risk_signal", label: "call" }] }));
  });
  afterEach(() => resetDeliveries());

  it("keeps only services that give back the asked type, ranked, without struck sellers or ones that act", async () => {
    recordDelivery({ vendor: "0x00000000000000000000000000000000000000a3", ok: false, reason: "x" });
    recordDelivery({ vendor: "0x00000000000000000000000000000000000000a3", ok: false, reason: "y" });
    const hits = await searchCapabilities("is this phone number a fraud risk", { outputs: ["risk_signal"] });
    expect(hits.map((h) => h.cap.provider)).toEqual(expect.arrayContaining(["PhoneCo", "TrustCo"]));
    expect(hits.map((h) => h.cap.provider)).not.toContain("BadCo");
    expect(hits.map((h) => h.cap.provider)).not.toContain("Caller");
    expect(hits.every((h) => h.cap.outputs.some((o) => o.type === "risk_signal"))).toBe(true);
    expect(hits[0].cap.provider).toBe("PhoneCo");
  });

  it("a seller that keeps delivering ranks higher", async () => {
    for (let i = 0; i < 6; i++) recordOutcome("https://svc101.test/api", true);
    expect(reliabilityScore("https://svc101.test/api")).toBeGreaterThan(0.7);
    const hits = await searchCapabilities("phone risk", { outputs: ["risk_signal"] });
    expect(hits[0].cap.provider).toBe("TrustCo");
  });

  it("filters by where it can be paid", async () => {
    upsertCapability(cap(104, { name: "Testnet phone risk", description: "phone fraud risk", payableNow: true, payableMainnet: false, outputs: [{ path: "", type: "risk_signal", label: "r" }] }));
    const now = await searchCapabilities("phone fraud risk", { outputs: ["risk_signal"], payable: "now" });
    expect(now.map((h) => h.cap.resource)).toEqual(["https://svc104.test/api"]);
    expect(catalogFunnel()).toMatchObject({ total: 35, payableNow: 1 });
  });
});

describe("crawling the catalog", () => {
  const listing = (n: number, description = `Listing ${n} search the web`) => ({
    resource: `https://crawl${n}.test/x`,
    accepts: [{ network: "eip155:5042", amount: "1000", payTo: "0x00000000000000000000000000000000000000b1", extra: { name: "GatewayWalletBatched" } }],
    metadata: { provider: { name: `P${n}`, category: "WEB_SEARCH_RESEARCH" }, method: "GET", description, input: { queryParams: { properties: { q: { type: "string" } }, required: ["q"] } } },
  });
  let items = Array.from({ length: 250 }, (_, i) => listing(i));
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    resetCatalog();
    items = Array.from({ length: 250 }, (_, i) => listing(i));
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      const offset = Number(u.searchParams.get("offset") ?? 0);
      const limit = Number(u.searchParams.get("limit") ?? 100);
      return new Response(JSON.stringify({ items: items.slice(offset, offset + limit), pagination: { total: items.length } }), { status: 200 });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("stores every listing over several pages, and re-tags only the ones that changed", async () => {
    const first = await crawlCatalog();
    expect(first).toMatchObject({ seen: 250, total: 250, tagged: 250, kept: 0 });
    expect(allCapabilities()).toHaveLength(250);
    const c = getCapability("https://crawl7.test/x")!;
    expect(c.inputs).toEqual([{ field: "q", type: "text_query", required: true }]);
    expect(c.payableMainnet).toBe(true);
    items[7] = listing(7, "Now it reads reviews of a business");
    const second = await crawlCatalog();
    expect(second).toMatchObject({ seen: 250, tagged: 1, kept: 249 });
    expect(getCapability("https://crawl7.test/x")!.outputs.map((o) => o.type)).toContain("reviews");
  });

  it("drops listings that left the catalog only after a complete crawl", async () => {
    await crawlCatalog();
    items = items.slice(0, 240);
    const r = await crawlCatalog();
    expect(r.pruned).toBe(10);
    expect(allCapabilities()).toHaveLength(240);
  });
});
