import { describe, expect, it } from "vitest";
import type { Run } from "@/lib/types";
import { signalsOf } from "./signals";

const paid = { amountUsdc: 0.002, payTo: "0x0", via: "test", at: "" };
const run = (task: string, steps: { id: string; tool: string }[], results: Record<string, unknown>) =>
  ({ task, proposal: { ask: "", research: steps.map((s) => ({ ...s, args: {}, label: s.id, why: "" })) }, results }) as unknown as Run;

describe("rules that judge the answers", () => {
  it("flags a scammy contractor: internet-only phone that isn't the company's, a brand-new site, bad reviews", () => {
    const s = signalsOf(
      run("Can I trust them?", [{ id: "a", tool: "place_reviews" }, { id: "b", tool: "phone_check" }, { id: "c", tool: "company_record" }], {
        a: { place: "X", found: { name: "X Plumbing" }, reviews: [{ rating: 1 }, { rating: 2 }, { rating: 5 }], average: 2.7, paid },
        b: { phone: "+1 415 555 0134", valid: true, lineType: "non_fixed_voip", paid },
        c: { domain: "xplumbing.com", found: true, name: "X Plumbing", phones: ["+1 415 555 9999"], emails: [], social: {}, domainSince: new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10), domainAgeYears: 0, paid },
      }),
    );
    const bad = s.filter((x) => x.level === "bad").map((x) => x.text);
    const warn = s.filter((x) => x.level === "warn").map((x) => x.text);
    expect(bad.some((t) => /less than a year/.test(t))).toBe(true);
    expect(warn.some((t) => /internet-only/.test(t))).toBe(true);
    expect(warn.some((t) => /isn't one of X Plumbing's official numbers/.test(t))).toBe(true);
    expect(warn.some((t) => /2\.7★/.test(t))).toBe(true);
    // The cross-check cites both stages it compared.
    expect(s.find((x) => /official numbers/.test(x.text))?.evidence).toEqual(["b", "c"]);
  });

  it("reassures when the number matches the company's own and the site is old", () => {
    const s = signalsOf(
      run("check", [{ id: "b", tool: "phone_check" }, { id: "c", tool: "company_record" }], {
        b: { phone: "+1 (734) 855-4350", valid: true, lineType: "landline", paid },
        c: { domain: "rivian.com", found: true, name: "Rivian", phones: ["+17348554350"], emails: [], social: {}, domainSince: "1998-04-06", domainAgeYears: 28, paid },
      }),
    );
    expect(s.every((x) => x.level === "good")).toBe(true);
    expect(s.some((x) => /matches one of Rivian's official/.test(x.text))).toBe(true);
  });

  it("calls a price far below what stores charge too good to be true", () => {
    const s = signalsOf(run("Buying a 2018 Civic for $6,000", [{ id: "p", tool: "shopping_prices" }], { p: { product: "civic", offers: [], median: 15000, paid } }));
    expect(s[0]).toMatchObject({ level: "bad" });
    expect(s[0].text).toMatch(/60% below/);
  });

  it("only judges stages that answered", () => {
    expect(signalsOf(run("x", [{ id: "b", tool: "phone_check" }], {}))).toEqual([]);
  });
});
