"use client";
import type { Run, Thought } from "@/lib/types";
import { fmt } from "@/lib/money";

/**
 * The agent's reasoning between paid steps, one card per round: what the answers so far showed,
 * what's still open, and what it bought next because of it, or why it stopped (and for a move,
 * whether it went ahead). The point of the job is visible here: each round builds on the last.
 */
export function Thinking({ run, live = false }: { run: Run; live?: boolean }) {
  const thoughts = run.thoughts ?? [];
  const reading = live && run.thinking === "Reading what came back";
  if (!thoughts.length && !reading) return null;
  return (
    <section aria-label="How it worked it out" className="grid gap-3" data-testid="thinking">
      {/* Earlier rounds in one line each; the latest in full. */}
      {thoughts.slice(0, -1).map((t) => (
        <div key={t.round} className="flex items-center gap-2.5 rounded-xl border border-line bg-panel px-3 py-2 text-[13px] text-ink-2" data-testid={`thought-${t.round}`}>
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border-[1.5px] border-ink font-pixel text-[10px] text-ink">{t.round}</span>
          <span className="min-w-0 flex-1 truncate">{t.learned}</span>
          {t.added.length > 0 && <span className="shrink-0 rounded-full bg-agent-soft px-2 text-[12px] font-semibold text-agent-ink">+{t.added.length} bought</span>}
        </div>
      ))}
      {thoughts.length > 0 && <Round t={thoughts[thoughts.length - 1]} />}
      {reading && (
        <div className="flex items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-ink/40 bg-panel px-4 py-3 text-[14px] text-ink-2" data-testid="thinking-now">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border-[1.5px] border-ink font-pixel text-[11px]">{thoughts.length + 1}</span>
          Reading what came back and deciding what to look at next…
        </div>
      )}
    </section>
  );
}

function Round({ t }: { t: Thought }) {
  const added = t.added.reduce((a, x) => a + BigInt(x.price), 0n);
  return (
    <article className="rounded-2xl border-[1.5px] border-ink bg-panel p-4 shadow-[3px_3px_0_0_var(--agent)] sm:p-5" data-testid={`thought-${t.round}`}>
      <div className="flex items-center gap-2.5">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border-[1.5px] border-ink bg-agent-soft font-pixel text-[11px]">{t.round}</span>
        <span className="text-[12px] font-semibold tracking-wide text-ink-3">WHAT I LEARNED</span>
      </div>
      <p className="mt-2 line-clamp-4 text-[14.5px] leading-snug text-ink">{t.learned}</p>
      {t.open.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {t.open.slice(0, 3).map((o) => (
            <span key={o} className="inline-flex items-center rounded-full border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-[12.5px] text-warn-ink">
              Still open: {o}
            </span>
          ))}
        </div>
      )}
      {t.added.length > 0 ? (
        <div className="mt-3 border-t border-dashed border-line pt-3">
          <div className="text-[12px] font-semibold tracking-wide text-ink-3">SO I&apos;M BUYING NEXT · {fmt(added.toString())} USDC</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {t.added.map((a) => (
              <div key={a.id} className="rounded-xl border border-line bg-surface px-3 py-2" data-testid={`added-${a.id}`}>
                <div className="text-[14px] font-semibold">{a.label}</div>
                <div className="mt-0.5 text-[13px] leading-snug text-ink-2">{a.why}</div>
              </div>
            ))}
          </div>
        </div>
      ) : t.decision ? (
        <div className={`mt-3 inline-flex items-start gap-2 rounded-xl px-3 py-2 text-[14px] leading-snug ${t.decision.go ? "bg-good/10 text-good" : "bg-warn/15 text-warn-ink"}`} data-testid="thought-decision" data-go={t.decision.go}>
          <span className="font-semibold">{t.decision.go ? "Go ahead:" : "Held back:"}</span> {t.decision.why}
        </div>
      ) : t.final ? (
        <div className="mt-3 text-[13px] font-medium text-ink-3">Enough to answer: done looking.</div>
      ) : null}
    </article>
  );
}

/** One line for a folded section: how many rounds, and what was bought because of them. */
export function thinkingSub(run: Run): string {
  const t = run.thoughts ?? [];
  const added = t.reduce((a, x) => a + x.added.length, 0);
  const held = t.find((x) => x.decision && !x.decision.go);
  return `${t.length} round${t.length === 1 ? "" : "s"} of reading the answers${added ? ` · bought ${added} more because of what it found` : ""}${held ? " · held the move back" : ""}`;
}
