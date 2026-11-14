import { describe, expect, it } from "vitest";
import { checkSpend } from "./policy";
import type { Run } from "./types";

const seller = "0x00000000000000000000000000000000000000aa" as const;
const run = {
  status: "running",
  lines: [
    { id: "l1", payee: seller, approved: "1000000", actual: "400000", rail: "x402", payeeName: "Data" },
    { id: "l2", payee: seller, approved: "0", actual: "0", rail: "subscription", payeeName: "Own AI" },
  ],
} as unknown as Run;

describe("checkSpend", () => {
  it("allows a spend within the approved line", () => {
    expect(checkSpend(run, { lineId: "l1", payee: seller, amount: 600000n })).toEqual({ ok: true });
  });
  it("blocks going over the approved amount", () => {
    expect(checkSpend(run, { lineId: "l1", payee: seller, amount: 600001n })).toMatchObject({ ok: false, reason: "over_amount" });
  });
  it("blocks a per-request price above the approved unit price", () => {
    const withCalls = { ...run, lines: [{ ...run.lines[0], calls: { max: 5, unitPrice: "100000" } }] } as Run;
    expect(checkSpend(withCalls, { lineId: "l1", payee: seller, amount: 100000n })).toEqual({ ok: true });
    expect(checkSpend(withCalls, { lineId: "l1", payee: seller, amount: 200000n })).toMatchObject({ ok: false, reason: "over_amount" });
  });
  it("blocks a different payee", () => {
    const r = checkSpend(run, { lineId: "l1", payee: "0x00000000000000000000000000000000000000bb", amount: 1n });
    expect(r).toMatchObject({ ok: false, reason: "new_payee" });
  });
  it("blocks spends without a line", () => {
    expect(checkSpend(run, { lineId: "nope", payee: seller, amount: 1n })).toMatchObject({ ok: false, reason: "off_plan" });
  });
  it("blocks USDC on subscription lines", () => {
    expect(checkSpend(run, { lineId: "l2", payee: seller, amount: 1n })).toMatchObject({ ok: false, reason: "off_plan" });
  });
  it("blocks when the run is not running", () => {
    expect(checkSpend({ ...run, status: "draft" }, { lineId: "l1", payee: seller, amount: 1n })).toMatchObject({ ok: false, reason: "not_running" });
  });
});
