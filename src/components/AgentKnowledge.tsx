"use client";
import { useCallback, useEffect, useState } from "react";
import type { AgentId } from "@/lib/types";
import { Icon } from "./Icon";
import { Point, Points } from "./Points";
import { toast } from "./Toaster";

interface Outcome {
  id: string;
  topic: string;
  kind: "order" | "rejection";
  data: { filled?: boolean; gap?: number; orderType?: string; reason?: string; venue?: string };
  createdAt: string;
}
interface Knowledge {
  primers: string[];
  lessons: string[];
  outcomes: Outcome[];
}

const outcomeText = (o: Outcome) =>
  o.kind === "rejection"
    ? `${o.topic}: exchange refused (${o.data.reason ?? "no reason given"})`
    : `${o.topic}: ${o.data.orderType ?? "limit"} order ${o.data.filled ? "filled" : "cancelled unfilled"}${typeof o.data.gap === "number" ? `, placed ${o.data.gap <= 0 ? "at or above" : `${o.data.gap}¢ below`} the ask` : ""}`;

/** What the agent reads before answering: hand-written primers, plus lessons from how past orders ended. */
export function Knowledge({ agent }: { agent: AgentId }) {
  const [k, setK] = useState<Knowledge | null>(null);
  const load = useCallback(
    () =>
      fetch(`/api/knowledge?agent=${agent}`)
        .then((r) => r.json())
        .then((j) => setK(j[agent] ?? null))
        .catch(() => undefined),
    [agent],
  );
  useEffect(() => void load(), [load]);

  async function forget(id: string) {
    await fetch(`/api/knowledge?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Forgotten");
    void load();
  }

  if (!k) return <div className="h-16 animate-pulse rounded-lg bg-line/50 motion-reduce:animate-none" />;
  return (
    <div className="space-y-4 text-[14px]">
      <div>
        <div className="mb-1.5 text-[13px] font-semibold">Knows</div>
        <Points as="ul" min={260}>
          {k.primers.map((p) => (
            <Point as="li" key={p} size="sm" tone="agent">
              {p}
            </Point>
          ))}
        </Points>
      </div>
      <div>
        <div className="mb-1.5 text-[13px] font-semibold">Learned from past orders</div>
        {k.lessons.length === 0 ? (
          <p className="text-ink-3">Nothing yet. Lessons appear once orders on the exchange fill, get cancelled or are refused.</p>
        ) : (
          <Points as="ul" min={260}>
            {k.lessons.map((l) => (
              <Point as="li" key={l} size="sm" tone="agent" soft>
                {l}
              </Point>
            ))}
          </Points>
        )}
      </div>
      {k.outcomes.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none text-[13px] font-medium text-ink-2 hover:text-ink">
            <Icon name="chevron" size={13} className="mr-1 inline transition-transform group-open:rotate-90" /> The {k.outcomes.length} outcomes behind these
          </summary>
          <ul className="mt-2 divide-y divide-[#f1f0ec] text-[13px]">
            {k.outcomes.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-ink-2">{outcomeText(o)}</span>
                <button type="button" onClick={() => forget(o.id)} className="pressable shrink-0 rounded-md px-2 py-1 text-[12px] text-ink-3 hover:bg-ink/5 hover:text-ink">
                  Forget
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-[12px] text-ink-3">Shared by everyone using this app. No chats or wallets are stored, only how orders turned out.</p>
    </div>
  );
}
