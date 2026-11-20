"use client";
import type { NotPossible as Info } from "@/lib/impossible";
import { Icon } from "./Icon";

/** Read from a failed start: the server's "this can't be done here" answer, if that's what it was. */
export const notPossibleOf = (e: unknown): Info | null => ((e as { data?: { notPossible?: Info } } | null)?.data?.notPossible ?? null);

/**
 * Shown on the ask screen instead of starting a job, when the request is something no service here
 * can ever do. One plain line, then close things that do work, each one tap away.
 */
export function NotPossibleCard({ info, onPick, busy }: { info: Info; onPick: (text: string) => void; busy?: boolean }) {
  return (
    <section role="status" className="mt-3 rounded-xl border-[1.5px] border-ink bg-panel p-3.5 text-left shadow-[3px_3px_0_0_var(--agent)]" data-testid="not-possible">
      <div className="font-pixel text-[11px] uppercase tracking-wide text-agent-ink">Can&apos;t do that here</div>
      <p className="mt-1 text-[14.5px] font-semibold leading-snug">{info.what}</p>
      <p className="mt-0.5 text-[13px] text-ink-2">No job was made and nothing was spent. Try one of these instead:</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {info.instead.map((t) => (
          <button
            key={t}
            type="button"
            disabled={busy}
            onClick={() => onPick(t)}
            className="pressable inline-flex min-h-8 items-center gap-1.5 rounded-full border-[1.5px] border-ink bg-agent-soft px-3 py-1 text-[12.5px] font-semibold text-agent-ink hover:bg-ink hover:text-white disabled:opacity-60"
            data-testid="not-possible-try"
          >
            {t} <Icon name="arrow" size={12} />
          </button>
        ))}
      </div>
    </section>
  );
}
