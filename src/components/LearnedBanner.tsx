"use client";
import { useState } from "react";
import type { Run } from "@/lib/types";
import { Button, Spinner } from "./ui";
import { Icon } from "./Icon";
import { post } from "./useRun";
import { toast } from "./Toaster";

type TryResult = {
  request: { method: string; url: string };
  quote: { status: number; body: { accepts?: { network: string; maxAmountRequired: string }[]; error?: string } | null };
  payment: { note: string };
  answer: { from?: string; report?: { headline: string; claims: { text: string }[] }; note?: string };
};

/**
 * After a composed job that worked: it is now a recipe. Once promoted, other agents can buy it over
 * x402 at its own URL; "Try buying it as an agent" shows that exchange in practice.
 */
export function LearnedBanner({ run }: { run: Run }) {
  const l = run.learned;
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState<TryResult | null>(null);
  if (!l || l.status === "retired") return null;
  const path = `/api/x402/recipe.${l.id}`;
  const onSale = l.status === "promoted";
  const url = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  return (
    <section className="rounded-2xl border-[1.5px] border-ink bg-agent-soft px-4 py-3" aria-label="Saved as a recipe" data-testid="learned-banner" data-status={l.status}>
      <div className="flex flex-wrap items-start gap-3">
        <Icon name="receipt" size={18} className="mt-0.5 shrink-0 text-agent-ink" />
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] leading-snug">
            Saved as a recipe: <b className="font-semibold">{l.title}</b>
            {onSale ? " · other agents can buy it at " : ". "}
            {onSale ? <code className="rounded bg-panel px-1 py-0.5 text-[12.5px]">{path}</code> : <span className="text-ink-2">It goes on sale to other agents once it has worked again.</span>}
          </p>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            Worked {l.successes} of {l.runs} time{l.runs === 1 ? "" : "s"} · learned from real runs, never from the model
          </p>
        </div>
        {onSale && (
          <div className="flex shrink-0 gap-1.5">
            <Button
              variant="ghost"
              className="h-8 px-2.5 text-[12.5px]"
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(
                  () => toast("Link copied", "good"),
                  () => toast(url),
                );
              }}
              data-testid="copy-recipe-url"
            >
              Copy link
            </Button>
            <Button
              variant="agent"
              className="h-8 px-2.5 text-[12.5px]"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                post<TryResult>(`/api/recipes/${l.id}/try`)
                  .then(setTried)
                  .catch((e) => toast((e as Error).message, "bad"))
                  .finally(() => setBusy(false));
              }}
              data-testid="try-recipe"
            >
              {busy ? <Spinner /> : null} Try buying it as an agent
            </Button>
          </div>
        )}
      </div>
      {tried && (
        <ol className="mt-3 space-y-2 rounded-xl border border-line bg-panel p-3 text-[12.5px]" data-testid="try-exchange">
          <li>
            <b>1. Ask</b> <span className="text-ink-2">{tried.request.method} {tried.request.url}</span>
          </li>
          <li>
            <b>2. Price (HTTP {tried.quote.status})</b>{" "}
            <span className="text-ink-2">
              {tried.quote.body?.accepts?.map((a) => `${(Number(a.maxAmountRequired) / 1e6).toFixed(3)} USDC on ${a.network}`).join(" or ") ?? tried.quote.body?.error}
            </span>
          </li>
          <li>
            <b>3. Pay</b> <span className="text-ink-2">{tried.payment.note}</span>
          </li>
          <li>
            <b>4. Answer</b>{" "}
            <span className="text-ink-2">{tried.answer.report ? `${tried.answer.report.headline} (${tried.answer.report.claims.length} claims with evidence, ${tried.answer.from})` : tried.answer.note}</span>
          </li>
        </ol>
      )}
    </section>
  );
}
