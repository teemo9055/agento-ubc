import type { Run } from "@/lib/types";

/**
 * The live tally on the graph's Verdict node: how the findings read so far, by code.
 * - any bad on a must lane → don't go ahead
 * - any bad, or two or more warnings → be careful
 * - every must lane answered good or neutral → looks fine
 * - otherwise → still unclear
 * Without lanes (trading jobs, old runs) every finding counts as a must.
 */
export function tally(run: Pick<Run, "phases" | "lanes">): NonNullable<Run["verdict"]> {
  const importance = new Map((run.lanes ?? []).map((l) => [l.id, l.importance]));
  const counted = run.phases.filter((p) => !p.gap && p.lineId && (!run.lanes || (p.lane && importance.get(p.lane) !== "nice")));
  let good = 0;
  let warn = 0;
  let bad = 0;
  let pending = 0;
  let badOnMust = false;
  for (const p of counted) {
    if (p.status === "skipped") continue;
    if (!p.finding) {
      if (p.status !== "failed") pending++;
      continue;
    }
    if (p.finding.tone === "good") good++;
    else if (p.finding.tone === "warn") warn++;
    else if (p.finding.tone === "bad") {
      bad++;
      if (!run.lanes || importance.get(p.lane ?? "") === "must") badOnMust = true;
    }
  }
  const mustLanes = run.lanes ? run.lanes.filter((l) => l.importance === "must").map((l) => l.id) : null;
  const mustDone = mustLanes
    ? mustLanes.every((id) => counted.some((p) => p.lane === id && p.finding && (p.finding.tone === "good" || p.finding.tone === "neutral")) && !counted.some((p) => p.lane === id && !p.finding && p.status !== "skipped" && p.status !== "failed"))
    : counted.length > 0 && pending === 0 && counted.some((p) => p.finding);
  const lean = badOnMust ? "do_not_proceed" : bad || warn >= 2 ? "be_careful" : mustDone && !warn ? "looks_fine" : "unclear";
  return { lean, good, warn, bad, pending };
}

export const LEAN_TEXT: Record<NonNullable<Run["verdict"]>["lean"], string> = {
  looks_fine: "Looks fine",
  be_careful: "Be careful",
  do_not_proceed: "Don't go ahead",
  unclear: "Still checking",
};
