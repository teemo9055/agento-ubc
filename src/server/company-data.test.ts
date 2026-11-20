import { describe, expect, it, vi } from "vitest";
import type { Run } from "@/lib/types";

/** Answers in the shapes the sellers document; nothing is bought. */
const answers: Record<string, unknown> = {};
vi.mock("./nanopay", () => ({
  payRequest: vi.fn(async (url: string) => {
    const key = Object.keys(answers).find((k) => url.includes(k));
    return { data: key ? answers[key] : {}, amount: 1n, payTo: "0x0", at: "2026-11-20T00:00:00Z" };
  }),
}));

const { headcountHistory, fundingHistory, companyEvents, changeOver } = await import("./web-tools");
const { signalsOf } = await import("./signals");

const months = (from: string, counts: number[]) =>
  counts.map((n, i) => {
    const [y, m] = from.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return { date: d.toISOString().slice(0, 10), employees_count: n };
  });

describe("company data a web search can't show", () => {
  it("reads a staff history and works out its change", async () => {
    answers["company_multi_source"] = {
      company_name: "Acme",
      website: "acme.io",
      industry: "Software",
      employees_count: 180,
      employees_count_by_month: months("2025-05", [220, 225, 231, 230, 228, 225, 228, 230, 232, 235, 236, 210, 190, 180]),
      key_executive_arrivals: [{ member_full_name: "Dana Lee", member_position_title: "VP Sales", arrival_date: "2026-06-01" }],
      active_job_postings_count: 14,
      active_job_postings_count_change: { change_quarterly: 6 },
    };
    const h = await headcountHistory("https://www.acme.io/about");
    expect(h.domain).toBe("acme.io");
    expect(h.found).toBe(true);
    expect(h.byMonth).toHaveLength(14);
    expect(h.change12m).toBeCloseTo((180 - 225) / 225, 3);
    expect(h.executiveArrivals[0]).toEqual({ name: "Dana Lee", title: "VP Sales", date: "2026-06-01" });
    expect(h.openJobsChange?.quarterly).toBe(6);
  });

  it("reads funding rounds with their investors, newest first", async () => {
    answers["financing_events"] = {
      data: [
        { id: "1", type: "financing_event", attributes: { effective_date: "2024-02-10", financing_type_normalized: "Series A", amount_normalized: 12000000 }, relationships: { investors: { data: [{ id: "c1", type: "company" }] } } },
        { id: "2", type: "financing_event", attributes: { effective_date: "2026-03-05", financing_type_normalized: "Series B", amount_normalized: 40000000 }, relationships: { investors: { data: [{ id: "c2", type: "company" }] } } },
      ],
      included: [
        { id: "c1", type: "company", attributes: { company_name: "Seed Fund" } },
        { id: "c2", type: "company", attributes: { company_name: "Big Ventures" } },
      ],
    };
    const f = await fundingHistory("acme.io");
    expect(f.rounds.map((r) => r.type)).toEqual(["Series B", "Series A"]);
    expect(f.rounds[0].investors).toEqual(["Big Ventures"]);
    expect(f.totalRaisedUsd).toBe(52000000);
    expect(f.lastRoundDate).toBe("2026-03-05");
  });

  it("reads dated events with the article behind each", async () => {
    answers["news_events"] = {
      data: [{ id: "e1", attributes: { category: "decreases_headcount_by", summary: "Acme cut about 40 engineering roles", found_at: "2026-08-14" }, relationships: { most_relevant_source: { data: { id: "a1", type: "news_article" } } } }],
      included: [{ id: "a1", type: "news_article", attributes: { url: "https://news.example.com/acme-cuts", title: "Acme cuts 40 roles" } }],
    };
    const e = await companyEvents("acme.io", "2026-03-05");
    expect(e.since).toBe("2026-03-05");
    expect(e.events[0]).toMatchObject({ date: "2026-08-14", category: "decreases_headcount_by", source: "https://news.example.com/acme-cuts" });
  });

  it("works out staff change since the last round, across the two sellers", async () => {
    const h = await headcountHistory("acme.io");
    const f = await fundingHistory("acme.io");
    const run = {
      task: "check",
      proposal: { ask: "", research: [{ id: "s1", tool: "headcount_history", args: {}, label: "", why: "" }, { id: "s2", tool: "funding_events", args: {}, label: "", why: "" }] },
      results: { s1: h, s2: f },
    } as unknown as Run;
    const s = signalsOf(run);
    const cross = s.find((x) => x.evidence.length === 2);
    expect(cross?.text).toMatch(/Since its 2026-03 round, staff went from 236 to 180 \(-24%\)/);
    expect(cross?.level).toBe("warn");
    expect(cross?.evidence).toEqual(["s2", "s1"]);
  });

  it("measures change only when the history reaches back far enough", () => {
    expect(changeOver([{ month: "2026-09", employees: 10 }, { month: "2026-10", employees: 12 }], 6)).toBeUndefined();
  });
});
