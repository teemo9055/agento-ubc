import type { Hex, Run } from "./types";

export type SpendRequest = { lineId: string; payee: Hex; amount: bigint };

export type PolicyResult =
  | { ok: true }
  | { ok: false; reason: "not_running" | "off_plan" | "new_payee" | "over_amount"; detail: string };

/**
 * Every spend passes here before any signature is made. The vault enforces the
 * same rule onchain, so a bug here fails closed rather than overspending.
 */
export function checkSpend(run: Run, req: SpendRequest): PolicyResult {
  if (run.status !== "running") return { ok: false, reason: "not_running", detail: `run is ${run.status}` };
  const line = run.lines.find((l) => l.id === req.lineId);
  if (!line) return { ok: false, reason: "off_plan", detail: "no approved line for this spend" };
  if (line.rail === "subscription") return { ok: false, reason: "off_plan", detail: "line is not paid in USDC" };
  if (line.payee.toLowerCase() !== req.payee.toLowerCase())
    return { ok: false, reason: "new_payee", detail: `approved payee is ${line.payeeName}` };
  if (line.calls && req.amount > BigInt(line.calls.unitPrice))
    return { ok: false, reason: "over_amount", detail: "price per request is above the approved price" };
  if (BigInt(line.actual) + req.amount > BigInt(line.approved))
    return { ok: false, reason: "over_amount", detail: "would exceed the approved amount" };
  return { ok: true };
}
