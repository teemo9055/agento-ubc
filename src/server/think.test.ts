import { describe, expect, it } from "vitest";
import type { Run } from "@/lib/types";
import { checkNext, doneThinking, reserveFor, researchSettled, RESERVE_ID } from "./think";
import { resolveBind, refsOf } from "./dataflow";
import { sameItem } from "./web-tools";
import { signalsOf } from "./signals";

const paid = { amountUsdc: 0.002, payTo: "0x0", via: "test", at: "" };

/** A finished first stage on mainnet: Google found the business, its phone and website. */
const run = (over: Partial<Run> = {}): Run =>
  ({
    agent: "worko",
    mode: "live",
    network: "mainnet",
    task: "Can I trust Bay Area Plumbing?",
    proposal: {
      ask: "Check Bay Area Plumbing?",
      research: [{ id: "r1", tool: "place_reviews", args: { place: "Bay Area Plumbing" }, label: "Find them", why: "" }],
    },
    results: {
      r1: { place: "Bay Area Plumbing", found: { name: "Bay Area Plumbing Inc", phone: "(415) 668-8000", website: "https://bayareaplumbing.com" }, reviews: [], paid },
    },
    phases: [{ id: "r1", label: "Find them", sub: "", status: "done", dependsOn: [], optional: true, payments: [] }],
    lines: [{ id: RESERVE_ID, index: -1, phaseId: RESERVE_ID, purpose: "", service: "", payeeName: "", payee: "0x0", rail: "gateway", approved: "20000", actual: "0", bigSpend: false }],
    thoughts: [],
    ...over,
  }) as unknown as Run;

describe("thinking between paid steps", () => {
  it("keeps lookups built from what was found, within the spare money", () => {
    const { keep, dropped } = checkNext(
      run(),
      [
        { tool: "read_page", args: { url: "https://bayareaplumbing.com" }, label: "Read their site", why: "See the licence number they claim" },
        { tool: "phone_check", args: { phone: "+1 415 668 8000" }, label: "Check their phone", why: "A real line?" },
      ],
      0,
    );
    expect(dropped).toEqual([]);
    expect(keep.map((k) => [k.id, k.tool])).toEqual([
      ["f1", "read_page"],
      ["f2", "phone_check"],
    ]);
  });

  it("never follows a link or number that nothing bought contains", () => {
    const { keep, dropped } = checkNext(
      run(),
      [
        { tool: "read_page", args: { url: "https://made-up.example.com/licence" }, label: "Read a page", why: "x" },
        { tool: "phone_check", args: { phone: "+1 212 555 0100" }, label: "Check a phone", why: "x" },
      ],
      0,
    );
    expect(keep).toEqual([]);
    expect(dropped).toHaveLength(2);
  });

  it("drops what this agent can't buy, what was already bought, and what's over the spare money", () => {
    const r = run({ lines: [{ id: RESERVE_ID, index: -1, phaseId: RESERVE_ID, purpose: "", service: "", payeeName: "", payee: "0x0", rail: "gateway", approved: "3000", actual: "0", bigSpend: false }] } as Partial<Run>);
    const { keep, dropped } = checkNext(
      r,
      [
        { tool: "spot_candles", args: { symbol: "btcusd" }, label: "Candles", why: "x" },
        { tool: "place_reviews", args: { place: "Bay Area Plumbing" }, label: "Again", why: "x" },
        { tool: "web_search", args: { query: "Bay Area Plumbing Inc license" }, label: "Licence", why: "x" },
        { tool: "phone_check", args: { phone: "(415) 668-8000" }, label: "Phone", why: "x" },
      ],
      0,
    );
    // The search fits the 0.3¢ left; the phone check (1¢) doesn't.
    expect(keep.map((k) => k.tool)).toEqual(["web_search"]);
    expect(dropped.join(" | ")).toMatch(/not a lookup this agent can buy/);
    expect(dropped.join(" | ")).toMatch(/already bought/);
    expect(dropped.join(" | ")).toMatch(/over what's left/);
  });

  it("waits for every lookup before thinking, and stops after the last round", () => {
    expect(researchSettled(run())).toBe(true);
    expect(researchSettled(run({ phases: [{ id: "r1", label: "", sub: "", status: "active", dependsOn: [], optional: true, payments: [] }] } as Partial<Run>))).toBe(false);
    expect(doneThinking(run())).toBe(false);
    expect(doneThinking(run({ thoughts: [{ round: 1, learned: "", open: [], added: [], final: true, at: "" }] }))).toBe(true);
  });

  it("sets aside about what the planned lookups cost, between 2¢ and 15¢", () => {
    expect(reserveFor(4_000n)).toBe(20_000n);
    expect(reserveFor(60_000n)).toBe(60_000n);
    expect(reserveFor(900_000n)).toBe(150_000n);
  });
});

describe("a later search built from several earlier answers", () => {
  const results = { r1: { found: { name: "Bay Area Plumbing Inc", address: "12 Main St, San Francisco" } } };
  it("fills each part, and waits for every step it reads", () => {
    expect(resolveBind("{$r1.found.name} {$r1.found.address} license", results)).toBe("Bay Area Plumbing Inc 12 Main St, San Francisco license");
    expect(refsOf({ bind: { query: "{$r1.found.name} {$r2.domain}" } })).toEqual(["r1", "r2"]);
  });
  it("leaves out a part that wasn't found, and fails only when nothing was", () => {
    expect(resolveBind("{$r1.found.name} {$r1.found.phone} reviews", results)).toBe("Bay Area Plumbing Inc reviews");
    expect(() => resolveBind("{$r1.found.phone}", results)).toThrow();
  });
});

describe("answers that used to mislead", () => {
  it("leaves bundles and other models out of a store price", () => {
    expect(sameItem("EcoFlow DELTA 3 Max", "EcoFlow DELTA 3 Max Portable Power Station")).toBe(true);
    expect(sameItem("EcoFlow DELTA 3 Max", "EcoFlow DELTA 3 Max + 220W Solar Panel")).toBe(false);
    expect(sameItem("EcoFlow DELTA 3 Max", "EcoFlow DELTA 3 Plus")).toBe(false);
    expect(sameItem("EcoFlow DELTA 3 Max", "2 x EcoFlow DELTA 3 Max")).toBe(false);
  });

  it("doesn't pin a story about another firm on this one", () => {
    const r = {
      task: "check",
      proposal: { ask: "", givens: { business: { type: "company_name", value: "Acme Plumbing" } }, research: [{ id: "n", tool: "news_search", args: {}, label: "n", why: "" }] },
      results: {
        n: {
          query: "Acme Plumbing",
          results: [
            { title: "Longtime Bay Area plumbing contractor files for Chapter 11 bankruptcy", link: "x" },
            { title: "Acme Plumbing opens a second shop", link: "y" },
          ],
          paid,
        },
      },
    } as unknown as Run;
    const s = signalsOf(r);
    expect(s.some((x) => x.level === "warn")).toBe(false);
    expect(s.find((x) => x.level === "good")?.text).toMatch(/about other firms/);
  });

  it("does flag trouble that names them", () => {
    const r = {
      task: "check",
      proposal: { ask: "", givens: { business: { type: "company_name", value: "Acme Plumbing" } }, research: [{ id: "n", tool: "news_search", args: {}, label: "n", why: "" }] },
      results: { n: { query: "Acme Plumbing", results: [{ title: "Acme Plumbing sued by former customers", link: "x" }], paid } },
    } as unknown as Run;
    expect(signalsOf(r).some((x) => x.level === "warn" && /names them/.test(x.text))).toBe(true);
  });
});
