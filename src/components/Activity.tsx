"use client";
import type { ToolCall } from "@/lib/types";
import { Icon } from "./Icon";

/** What kind of thing each free lookup looks at, for the one-line summary. */
const NOUN: Record<string, [string, string]> = {
  search_markets: ["market", "markets"],
  browse_markets: ["market", "markets"],
  get_market: ["market", "markets"],
  combo_quote: ["combination", "combinations"],
  spot_price: ["price", "prices"],
  my_positions: ["holding", "holdings"],
  find_place: ["place", "places"],
  find_nearby: ["place", "places"],
  search_services: ["service", "services"],
  read_arc: ["Arc record", "Arc records"],
};

/** "Looked at 6 markets · 2 sources", counted from what each lookup found, not from how many calls were made. */
export function activityLine(tools: ToolCall[]): string {
  const counts = new Map<string, number>();
  let other = 0;
  for (const t of tools) {
    const noun = NOUN[t.tool];
    if (!noun || !t.ok) {
      other += 1;
      continue;
    }
    // Searches report how many they found ("6 markets for “BTC”"); single lookups count once.
    const n = Number(t.summary.match(/^(\d+)\s/)?.[1] ?? 1) || 1;
    counts.set(t.tool in NOUN ? NOUN[t.tool][1] : "sources", (counts.get(NOUN[t.tool][1]) ?? 0) + n);
  }
  const parts = [...counts].map(([plural, n]) => {
    const pair = Object.values(NOUN).find((x) => x[1] === plural)!;
    return `${n} ${n === 1 ? pair[0] : pair[1]}`;
  });
  if (other) parts.push(`${other} ${other === 1 ? "source" : "sources"}`);
  return `Looked at ${parts.join(" · ")}`;
}

/**
 * The agent's working notes as one quiet row, closed by default: a summary you can open to see each
 * lookup in order, one line each, with a check or a cross. Like a coding agent's tool calls.
 */
export function Activity({ tools, className = "" }: { tools: ToolCall[]; className?: string }) {
  if (!tools.length) return null;
  const failed = tools.filter((t) => !t.ok).length;
  return (
    <details className={`group text-[12px] text-ink-3 ${className}`} data-testid="activity">
      <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1.5 rounded-md hover:text-ink-2 [&::-webkit-details-marker]:hidden">
        <Icon name="search" size={11} />
        <span data-testid="activity-line">{activityLine(tools)}</span>
        {failed > 0 && <span className="text-warn-ink">· {failed} didn&apos;t answer</span>}
        <Icon name="chevron" size={10} className="transition-transform group-open:rotate-90 motion-reduce:transition-none" />
      </summary>
      <ol className="mt-1 space-y-0.5 border-l border-line pl-3" aria-label="Lookups, in order">
        {tools.map((t, i) => (
          <li key={i} className="flex items-start gap-1.5" data-testid="activity-item">
            {t.ok ? (
              <Icon name="check" size={11} stroke={2.6} className="mt-[3px] shrink-0 text-good" />
            ) : (
              <span className="mt-[1px] shrink-0 font-semibold text-warn-ink" aria-label="failed">
                ×
              </span>
            )}
            <span className={`min-w-0 ${t.ok ? "" : "text-warn-ink"}`}>{t.summary}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
