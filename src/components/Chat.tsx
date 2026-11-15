"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ChatMsg, MoveAction, MoveCondition, Proposal, Run, Venue } from "@/lib/types";
import { THEMES } from "@/lib/themes";
import { AgentIcon } from "./AgentIcon";
import { Button, Spinner } from "./ui";
import { post } from "./useRun";
import { toast } from "./Toaster";
import { runOutfit } from "@/lib/summary";

const RESEARCH_PRICE: Record<string, number> = { odds_history: 0.02, trade_tape: 0.1, spot_candles: 0.02, drive_route: 0.03, oracle_price: 0.0001 };
const usdc = (x: number) => (x < 0.01 ? x.toFixed(4) : x.toFixed(2));
const cents = (x: number) => `${Math.round(x * 100)}¢`;

export function actionText(a: MoveAction) {
  if (a.kind === "prediction_order")
    return a.orderType === "stop-limit"
      ? `${a.quantity} × ${a.side.toUpperCase()} “${a.label}” once it rises to ${cents(a.stopPrice ?? a.maxPrice)}, paying ≤ ${cents(a.maxPrice)}`
      : `${a.quantity} × ${a.side.toUpperCase()} “${a.label}” at ≤ ${cents(a.maxPrice)}, resting until filled`;
  if (a.kind === "spot_order") return `${a.side === "buy" ? "Buy" : "Sell"} $${a.amountUsd} of ${a.symbol.replace(/usd$/, "").toUpperCase()} at ${a.side === "buy" ? "≤" : "≥"} $${a.limitPrice.toLocaleString()}`;
  return `Plan ${a.stops.join(" → ")} · ≤ ${a.hoursPerDay} h/day`;
}
export function conditionLabel(c: MoveCondition) {
  const coin = c.symbol.replace(/usd$/, "").toUpperCase();
  const what = c.metric === "oracle_price" ? `Chainlink ${coin}` : c.metric === "spot_price" ? `${coin} price` : c.metric === "yes_price" ? "YES price" : "NO price";
  const dollars = c.metric === "spot_price" || c.metric === "oracle_price";
  return `${what} ${c.op === "<=" ? "≤" : "≥"} ${dollars ? `$${c.value.toLocaleString()}` : cents(c.value)}`;
}
const maxCost = (a?: MoveAction) => (!a ? 0 : a.kind === "prediction_order" ? a.maxPrice * a.quantity : a.kind === "spot_order" ? a.amountUsd : 0);

const VENUE_BADGE: Record<Venue, { label: string; title: string; cls: string }> = {
  gemini: { label: "Live · real money", title: "Orders go to your Gemini account with real money", cls: "border-bad/50 bg-bad/10 text-bad" },
  "gemini-sandbox": { label: "Gemini sandbox · test money", title: "Real orders on Gemini's test exchange, with test funds", cls: "border-agent/40 bg-agent-soft text-agent" },
  paper: { label: "Simulation · not sent", title: "No exchange is connected, so the order is only simulated", cls: "border-warn bg-warn/15 text-[#7a5000]" },
};

export function VenueBadge({ venue }: { venue: Venue }) {
  const b = VENUE_BADGE[venue];
  return (
    <span className={`rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium ${b.cls}`} title={b.title} data-testid="venue-badge">
      {b.label}
    </span>
  );
}

export function MoveCard({ p, run, chosen, onChoose, busy }: { p: Proposal; run: Run; chosen?: boolean; onChoose?: () => void; busy?: boolean }) {
  const research = p.research.reduce((s, r) => s + (RESEARCH_PRICE[r.tool] ?? 0), 0);
  return (
    <div className={`mt-2 rounded-xl border-2 bg-panel p-3.5 ${chosen ? "border-good/60" : "border-agent/50"}`} data-testid="move-card">
      <div className="flex items-center justify-between gap-2">
        <span className="font-pixel text-[12px] uppercase tracking-wide text-agent">Proposed move</span>
        <span className="flex items-center gap-1.5">
          {p.action && p.action.kind !== "itinerary" && <VenueBadge venue={p.venue ?? "paper"} />}
          {chosen && <span className="text-[11px] font-medium text-good">✓ In the work order</span>}
        </span>
      </div>
      <div className="mt-1 text-[15px] font-semibold leading-snug">{p.title}</div>
      <p className="mt-1 text-[13.5px] font-medium text-ink">{p.ask}</p>
      <ol className="mt-2.5 space-y-1 text-[12.5px] text-ink-2">
        {p.research.map((r, i) => (
          <li key={r.id} className="flex gap-2">
            <span className="num w-4 shrink-0 text-ink-3">{i + 1}</span>
            <span className="min-w-0 flex-1">
              {r.label} <span className="text-ink-3">· {r.why}</span>
            </span>
            <span className="num shrink-0 text-ink-3">{RESEARCH_PRICE[r.tool] != null ? usdc(RESEARCH_PRICE[r.tool]) : "?"} USDC</span>
          </li>
        ))}
        {p.condition && (
          <li className="flex gap-2">
            <span className="num w-4 shrink-0 text-ink-3">{p.research.length + 1}</span>
            <span>
              Check on fresh price: <b className="font-medium text-ink">{conditionLabel(p.condition)}</b>
            </span>
          </li>
        )}
        {p.action && (
          <li className="flex gap-2">
            <span className="num w-4 shrink-0 text-ink-3">{p.research.length + (p.condition ? 2 : 1)}</span>
            <span className="min-w-0 flex-1 font-medium text-ink">{actionText(p.action)}</span>
            {maxCost(p.action) > 0 && <span className="num shrink-0 text-ink-3">≤ ${maxCost(p.action).toFixed(2)}</span>}
          </li>
        )}
      </ol>
      {p.adjustments && p.adjustments.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11.5px] text-ink-3">
          {p.adjustments.map((x) => (
            <li key={x}>↳ {x}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
        <span className="num text-[12px] text-ink-3">
          Research {usdc(research)} USDC from your vault{maxCost(p.action) > 0 ? ` · order ≤ $${maxCost(p.action).toFixed(2)} ${p.venue === "paper" ? "simulated" : "on the exchange"}` : ""}
        </span>
        {onChoose && !chosen && (
          <Button onClick={onChoose} disabled={busy || run.status !== "exploring"} className="bg-agent hover:opacity-90" data-testid="adopt-move">
            {busy ? <Spinner /> : null} Set it up
          </Button>
        )}
      </div>
    </div>
  );
}

/** The model sometimes uses **bold**; render it rather than show asterisks. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (/^\*\*[^*]+\*\*$/.test(part) ? <b key={i} className="font-semibold">{part.slice(2, -2)}</b> : part))}</>;
}

function Bubble({ m, run, onChoose, busy }: { m: ChatMsg; run: Run; onChoose: (id: string) => void; busy: boolean }) {
  const mine = m.role === "user";
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`flex gap-2.5 ${mine ? "justify-end" : ""}`} data-testid={`msg-${m.role}`}>
      {!mine && (
        <span className="mt-0.5 shrink-0">
          <AgentIcon agent={run.agent} size={30} outfit={runOutfit(run)} mood="happy" />
        </span>
      )}
      <div className={`min-w-0 ${mine ? "max-w-[85%]" : "max-w-[92%] flex-1 sm:max-w-[80%]"}`}>
        {m.tools && m.tools.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {m.tools.map((t, i) => (
              <span key={i} className={`rounded-md border px-1.5 py-0.5 text-[11px] ${t.ok ? "border-line bg-surface text-ink-3" : "border-bad/30 text-bad"}`} title={JSON.stringify(t.args)}>
                {t.tool === "search_services" ? "◆ " : "⌕ "}
                {t.summary}
              </span>
            ))}
          </div>
        )}
        <div className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${mine ? "rounded-br-md bg-ink text-white" : "rounded-bl-md border border-line bg-panel"}`}>
          <Rich text={m.text} />
        </div>
        {m.proposal && <MoveCard p={m.proposal} run={run} chosen={run.proposal?.id === m.proposal.id} onChoose={() => onChoose(m.proposal!.id)} busy={busy} />}
      </div>
    </motion.li>
  );
}

export function Chat({ run, compact = false }: { run: Run; compact?: boolean }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const chat = run.chat ?? [];
  const last = chat[chat.length - 1];
  const open = run.status === "exploring" || run.status === "draft";
  const busy = Boolean(run.thinking) || sending;

  useEffect(() => {
    if (!compact) end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat.length, run.thinking, compact]);

  async function send(t: string) {
    const msg = t.trim();
    if (!msg || busy) return;
    setSending(true);
    setText("");
    try {
      if (run.status === "draft") await post(`/api/runs/${run.id}/back`);
      await post(`/api/runs/${run.id}/chat`, { text: msg });
    } catch (e) {
      toast((e as Error).message, "bad");
      setText(msg);
    } finally {
      setSending(false);
    }
  }

  async function choose(proposalId: string) {
    setAdopting(true);
    try {
      await post(`/api/runs/${run.id}/adopt`, { proposalId });
      toast("Move priced · review the work order and approve", "good");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setAdopting(false);
    }
  }

  const accept = (s: string) => /^(yes|set it up|do it|ok)/i.test(s);
  const latestMove = [...chat].reverse().find((m) => m.proposal)?.proposal;

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-3 sm:p-4" aria-label="Chat with the agent">
      <ul className="space-y-3.5" aria-live="polite">
        {chat.map((m) => (
          <Bubble key={m.id} m={m} run={run} onChoose={choose} busy={adopting} />
        ))}
        <AnimatePresence>
          {run.thinking && (
            <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2.5 text-[13px] text-ink-3" data-testid="thinking">
              <AgentIcon agent={run.agent} size={30} outfit={runOutfit(run)} mood="working" />
              <span className="inline-flex items-center gap-1.5 rounded-2xl border border-line bg-panel px-3 py-2">
                <Spinner /> {run.thinking}…
              </span>
            </motion.li>
          )}
        </AnimatePresence>
      </ul>
      <div ref={end} />

      {open && (
        <>
          {!busy && last?.role === "agent" && last.suggestions && last.suggestions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5 pl-10">
              {last.suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => (accept(s) && latestMove && run.status === "exploring" ? choose(latestMove.id) : send(s))}
                  className="pressable rounded-full border border-agent/40 bg-agent-soft px-3 py-1.5 text-[12.5px] font-medium text-agent hover:border-agent"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={run.status === "draft" ? "Change the move… (sends you back to chat)" : `Ask ${THEMES[run.agent].name} anything, or say what you want to do`}
              className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-panel px-3.5 text-[14px] outline-none focus:border-agent"
              maxLength={600}
              aria-label="Message"
              data-testid="chat-input"
            />
            <Button type="submit" disabled={busy || !text.trim()} className="h-11 px-4">
              {busy ? <Spinner /> : "Send"}
            </Button>
          </form>
          <p className="mt-2 pl-1 text-[11.5px] text-ink-3">Exploring is free. Nothing is paid or placed until you approve a move.</p>
        </>
      )}
    </section>
  );
}
