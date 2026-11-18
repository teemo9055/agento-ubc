"use client";
import { Activity } from "./Activity";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Card, ChatMsg, Plan, Proposal, Run, Venue } from "@/lib/types";
import Link from "next/link";
import { THEMES } from "@/lib/themes";
import { fmt } from "@/lib/money";
import { AgentIcon } from "./AgentIcon";
import { Button, Spinner } from "./ui";
import { Icon } from "./Icon";
import { post } from "./useRun";
import { toast } from "./Toaster";
import { runOutfit } from "@/lib/summary";
import { quickFor, stepFromText, type Quick } from "@/lib/quick";
import { actionText, cents, conditionLabel, lookupCost, maxCost, usdc } from "@/lib/move";

export { actionText, conditionLabel, usdc };

const VENUE_BADGE: Record<Venue, { label: string; title: string; cls: string }> = {
  gemini: { label: "Live · real money", title: "Orders go to your Gemini account with real money", cls: "border-bad/50 bg-bad/10 text-bad" },
  "gemini-sandbox": { label: "Gemini sandbox · test money", title: "Real orders on Gemini's test exchange, with test funds", cls: "border-agent/40 bg-agent-soft text-agent-ink" },
  paper: { label: "Practice · no real order", title: "No exchange is connected, so the order is only simulated", cls: "border-warn bg-warn/15 text-warn-ink" },
};

export function VenueBadge({ venue }: { venue: Venue }) {
  const b = VENUE_BADGE[venue];
  return (
    <span className={`inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-md border px-2 text-[12px] font-semibold ${b.cls}`} title={b.title} data-testid="venue-badge">
      {b.label}
    </span>
  );
}

/** A proposed move. In chat it carries the "Build graph" button; once chosen it is the plan's summary. */
/** Short labels for paid steps, so the card reads as a sentence, not a spreadsheet. */
const STEP_LABEL: Record<string, (r: Proposal["research"][number]) => string> = {
  oracle_price: (r) => `Chainlink ${r.args.symbol?.replace(/usd$/i, "").toUpperCase()}`,
  odds_history: () => "How the odds moved",
  trade_tape: () => "Recent trades",
  spot_candles: (r) => `${r.args.symbol?.replace(/usd$/i, "").toUpperCase()} chart`,
  drive_route: () => "Route",
};

/** Only the notes that change the decision, said briefly. */
function notes(p: Proposal) {
  return (p.adjustments ?? [])
    .filter((x) => !/^Price rounded/.test(x))
    .map((x) =>
      x
        .replace(/^Contract closes \w+, (\d+) (\w+) \d{4} (\d\d:\d\d) UTC$/, "Closes $2 $1, $3 UTC")
        .replace(/^Fills now: cheapest (YES|NO) seller is at (\d+¢)$/, "Fills now at $2")
        .replace(/^Waits on the book: cheapest (YES|NO) seller is at (\d+¢) now$/, "Waits until the price drops (now $2)")
        .replace(/^Price check folded into the order.*$/, "Waits on the exchange until the price is right"),
    );
}

export function MoveCard({ p, run, chosen, onChoose, busy, drawn }: { p: Proposal; run: Run; chosen?: boolean; onChoose?: () => void; busy?: boolean; /** The move is drawn in the workspace beside the chat, so the card only needs the facts and the button. */ drawn?: boolean }) {
  const research = p.research.reduce((s, r) => s + lookupCost(r), 0);
  const total = research + maxCost(p.action);
  const trade = p.action && p.action.kind !== "itinerary";
  // One line of facts: the most it costs, then the one or two notes that change the decision.
  const facts = [
    `Up to $${total < 0.01 ? usdc(total) : total.toFixed(2)}`,
    p.research.length ? `${p.research.length} paid lookup${p.research.length > 1 ? "s" : ""} first` : "",
    p.condition ? `only if ${[p.condition, ...(p.also ?? [])].map(conditionLabel).join(" and ")}` : "",
    ...notes(p)
      .filter((x) => !/^Sized to|^Hedge|^Fee/.test(x))
      .slice(0, 2),
  ].filter(Boolean);
  return (
    <div className={`mt-2 rounded-xl border-[1.5px] bg-panel p-3.5 ${chosen ? "border-line" : "border-ink shadow-[3px_3px_0_0_var(--agent)]"}`} data-testid="move-card">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[15px] font-semibold leading-snug">{p.title}</div>
        {chosen ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-good">
            <Icon name="check" size={13} stroke={2.6} /> Chosen
          </span>
        ) : (
          trade && p.venue !== "paper" && <VenueBadge venue={p.venue ?? "paper"} />
        )}
      </div>
      {!drawn && <p className="mt-1 text-[13.5px] leading-snug text-ink-2">{p.ask}</p>}
      {p.changes && p.changes.length > 0 && (
        <p className="mt-2 text-[12px] font-medium text-agent-ink" data-testid="move-changes">
          Changed: {p.changes.join(" · ")}
        </p>
      )}
      {/* Beside the drawing the facts are already on screen; on their own (phones) the card says the most it costs. */}
      {!drawn && (
        <p className="num mt-2 text-[12.5px] text-ink-3" data-testid="move-facts">
          {facts.slice(0, 1).join(" · ")}
          {p.venue === "paper" && trade ? " · practice, nothing is sent" : ""}
        </p>
      )}
      {onChoose && !chosen && (
        <Button onClick={onChoose} disabled={busy || run.status !== "exploring"} variant="agent" className="mt-3 h-10 w-full" data-testid="adopt-move">
          {busy ? <Spinner /> : null} Review and approve <Icon name="arrow" size={15} stroke={2.2} />
        </Button>
      )}
    </div>
  );
}

export const stepCost = (p: Proposal) => p.research.reduce((s, r) => s + lookupCost(r), 0) + maxCost(p.action);

/** The model sometimes uses **bold**; render it rather than show asterisks. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (/^\*\*[^*]+\*\*$/.test(part) ? <b key={i} className="font-semibold">{part.slice(2, -2)}</b> : part))}</>;
}

function AgentRow({ run, mood = "happy", children }: { run: Run; mood?: "happy" | "working"; children: React.ReactNode }) {
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5">
      <span className="mt-0.5 shrink-0">
        <AgentIcon agent={run.agent} size={28} outfit={runOutfit(run)} mood={mood} />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </motion.li>
  );
}

function UserRow({ children, tag }: { children: React.ReactNode; tag?: string }) {
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end" data-testid="msg-user">
      <div className="max-w-[85%]">
        {tag && <div className="mb-1 text-right text-[11px] font-semibold uppercase tracking-wide text-agent-ink">{tag}</div>}
        <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-3.5 py-2.5 text-[14px] leading-relaxed text-white">{children}</div>
      </div>
    </motion.li>
  );
}

const bubble = "whitespace-pre-wrap rounded-2xl rounded-bl-md border border-line bg-panel px-3.5 py-2.5 text-[14px] leading-relaxed";

function Bubble({ m, run, onChoose, busy, onShowPlan, drawn }: { m: ChatMsg; run: Run; onChoose: (id: string) => void; busy: boolean; onShowPlan?: () => void; drawn?: boolean }) {
  if (m.role === "user") return <UserRow>{m.text}</UserRow>;
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5" data-testid="msg-agent">
      <span className="mt-0.5 shrink-0">
        <AgentIcon agent={run.agent} size={28} outfit={runOutfit(run)} mood="happy" />
      </span>
      <div className="min-w-0 flex-1">
        {m.tools && m.tools.length > 0 && <Activity tools={m.tools} className="mb-1" />}
        <div className={bubble}>
          <Rich text={m.text} />
        </div>
        {m.unverified && m.unverified.length > 0 && (
          <p className="mt-1 text-[11.5px] text-warn-ink" data-testid="unverified">
            Couldn't check {m.unverified.join(", ")} against live data; treat as approximate.
          </p>
        )}
        {m.plan && (
          <button
            type="button"
            onClick={onShowPlan}
            className="mt-2 flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-panel px-3 py-2.5 text-left text-[13px] hover:border-ink/40"
            data-testid="plan-summary"
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold">{m.plan.title}</span>
              <span className="text-ink-3">
                {m.plan.steps.length} steps on the plan board{m.plan.unavailable.length ? ` · ${m.plan.unavailable.length} part${m.plan.unavailable.length > 1 ? "s" : ""} it can't do` : ""}
              </span>
            </span>
            <Icon name="graph" size={16} className="shrink-0 text-agent-ink" />
          </button>
        )}
        {m.proposal && <MoveCard p={m.proposal} run={run} chosen={run.proposal?.id === m.proposal.id} onChoose={() => onChoose(m.proposal!.id)} busy={busy} drawn={drawn} />}
      </div>
    </motion.li>
  );
}

export const CARD_LABEL: Record<Card["kind"], string> = { price: "Price", deliverable: "What you get", method: "How it's done", risk: "Limits" };
const CARD_HINT: Record<Card["kind"], string> = {
  price: "e.g. big-spend threshold 0.5",
  deliverable: "e.g. make it 5 contracts",
  method: "e.g. add a Chainlink check",
  risk: "e.g. no condition, or max 50¢",
};

/** What the chat is editing: a card of the plan, or one step of the graph. */
export type EditTarget = { kind: "card"; card: Card["kind"] } | { kind: "step"; step: string; label: string; hint: string };

/** The edit target for a graph step, with a hint matched to what that step can change; null for steps with nothing to edit. */
export function stepTarget(run: Run, phaseId: string): EditTarget | null {
  const ph = run.phases.find((p) => p.id === phaseId);
  const p = run.proposal;
  if (!ph || !p) return null;
  const r = p.research.find((x) => x.id === phaseId);
  let hint = "";
  if (r) hint = r.tool === "drive_route" ? "e.g. add Kamloops" : r.tool === "odds_history" ? "e.g. use hourly data, or drop it" : r.tool === "spot_candles" ? "e.g. use daily data, or drop it" : "e.g. drop this step";
  else if (phaseId === "check") {
    if (!p.condition) return null;
    hint = p.condition.metric === "spot_price" ? `e.g. only if below $${Math.round(p.condition.value * 0.98).toLocaleString("en-US")}, or drop the check` : "e.g. only if below 40¢, or drop the check";
  } else if (phaseId === "act") hint = p.action?.kind === "itinerary" ? "e.g. 4 hours a day" : p.action?.kind === "spot_order" ? "e.g. $5, or don't place the trade" : "e.g. 8 contracts, max 50¢";
  else return null;
  return { kind: "step", step: phaseId, label: ph.label, hint };
}

export const targetKey = (t?: EditTarget | null) => (!t ? "" : t.kind === "card" ? `card:${t.card}` : `step:${t.step}`);
const targetName = (t: EditTarget) => (t.kind === "card" ? CARD_LABEL[t.card] : t.label);
const targetBody = (t: EditTarget) => (t.kind === "card" ? { card: t.card } : { step: t.step });

interface Preview {
  ok: boolean;
  message: string;
  alternatives?: string[];
  before?: { total: string; lines: { purpose: string; approved: string }[] };
  after?: { total: string; lines: { purpose: string; approved: string }[] };
}

/** A card edit asked in chat: the request, then a priced preview to apply or drop. Lives only in this browser tab. */
interface EditTurn {
  id: number;
  target: EditTarget;
  prompt: string;
  state: "checking" | "preview" | "applying" | "applied" | "dropped";
  preview?: Preview;
}

function EditReply({ t, run, onApply, onDrop, onTry, last }: { t: EditTurn; run: Run; onApply: () => void; onDrop: () => void; onTry: (alt: string) => void; last: boolean }) {
  if (t.state === "checking")
    return (
      <AgentRow run={run} mood="working">
        <div className={`${bubble} inline-flex items-center gap-2 text-ink-2`}>
          <Spinner /> {run.planner === "ai" ? "Thinking it through and re-pricing…" : "Re-pricing…"}
        </div>
      </AgentRow>
    );
  const p = t.preview!;
  if (!p.ok)
    return (
      <AgentRow run={run}>
        <div className="rounded-2xl rounded-bl-md border border-bad/30 bg-bad/5 px-3.5 py-2.5 text-[14px]" role="alert">
          <div className="font-semibold text-bad">Can&apos;t do that</div>
          <div className="mt-0.5 text-ink-2">{p.message}</div>
        </div>
        {last && p.alternatives && p.alternatives.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.alternatives.map((a) => (
              <button key={a} type="button" onClick={() => onTry(a)} className="pressable rounded-lg border border-agent/40 bg-agent-soft px-3 py-1.5 text-[13px] font-medium text-agent-ink hover:border-agent">
                {a}
              </button>
            ))}
          </div>
        )}
      </AgentRow>
    );
  const delta = p.before && p.after ? BigInt(p.after.total) - BigInt(p.before.total) : 0n;
  const settled = t.state === "applied" || t.state === "dropped" || run.status !== "draft";
  return (
    <AgentRow run={run}>
      <div className={`rounded-2xl rounded-bl-md border-[1.5px] bg-panel p-3.5 text-[13.5px] ${settled ? "border-line" : "border-ink shadow-[3px_3px_0_0_var(--agent)]"}`} data-testid={settled ? undefined : "edit-preview"}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold">{p.message}</span>
          {p.before && p.after && (
            <span className="num shrink-0">
              {fmt(p.before.total)} → <b>{fmt(p.after.total)}</b>
              {delta !== 0n && <span className={`ml-1.5 text-[12px] ${delta < 0n ? "text-good" : "text-ink-3"}`}>{delta < 0n ? `−${fmt(-delta)}` : `+${fmt(delta)}`}</span>}
            </span>
          )}
        </div>
        {p.after && (
          <ul className="mt-2 space-y-0.5 text-[12.5px] text-ink-2">
            {p.after.lines.map((l) => (
              <li key={l.purpose} className="flex justify-between gap-3">
                <span>{l.purpose}</span>
                <span className="num">{fmt(l.approved)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center justify-end gap-2 border-t border-[#f1f0ec] pt-2.5">
          {t.state === "applied" ? (
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 520, damping: 18 }}
              className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-good"
            >
              <Icon name="check" size={13} stroke={2.6} /> Applied to the plan
            </motion.span>
          ) : settled ? (
            <span className="text-[12.5px] text-ink-3">Not applied</span>
          ) : (
            <>
              <Button variant="quiet" className="h-9" onClick={onDrop} disabled={t.state === "applying"}>
                Not now
              </Button>
              <Button variant="agent" className="h-9" onClick={onApply} disabled={t.state === "applying" || run.status !== "draft"} data-testid="apply-edit">
                {t.state === "applying" ? <Spinner /> : null} Apply change
              </Button>
            </>
          )}
        </div>
      </div>
    </AgentRow>
  );
}

/**
 * The conversation with the agent, docked beside the plan for the whole job.
 * With a card in focus, messages edit that card: the agent re-prices and you apply or drop the change.
 */
export function Chat({
  run,
  focus,
  onFocusClear,
  onAdopted,
  onShowPlan,
  plan,
  prefill,
  drawn,
}: {
  run: Run;
  focus?: EditTarget | null;
  onFocusClear?: () => void;
  onAdopted?: () => void;
  onShowPlan?: () => void;
  /** The plan on the board, when there is one: quick options can change it directly. */
  plan?: Plan;
  /** Text to put in the box for the user to send or change, e.g. an example from the workspace. */
  prefill?: { text: string; n: number } | null;
  /** The work is drawn beside the chat, so cards here stay short. */
  drawn?: boolean;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [edits, setEdits] = useState<EditTurn[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const chat = run.chat ?? [];
  const last = chat[chat.length - 1];
  const open = run.status === "exploring" || run.status === "draft";
  const editing = Boolean(focus) && run.status === "draft";
  const busy = Boolean(run.thinking) || sending || edits.some((e) => e.state === "checking" || e.state === "applying");

  // New messages scroll into view inside the panel, not the page.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [chat.length, run.thinking, edits]);

  useEffect(() => {
    if (focus) input.current?.focus();
  }, [focus]);

  useEffect(() => {
    if (!prefill) return;
    setText(prefill.text);
    input.current?.focus();
  }, [prefill]);

  const patch = (id: number, p: Partial<EditTurn>) => setEdits((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  async function checkEdit(target: EditTarget, prompt: string) {
    const id = Date.now();
    setEdits((xs) => [...xs.map((x) => (x.state === "preview" ? { ...x, state: "dropped" as const } : x)), { id, target, prompt, state: "checking" }]);
    try {
      const preview = await post<Preview>(`/api/runs/${run.id}/preview`, { ...targetBody(target), prompt });
      patch(id, { state: "preview", preview });
    } catch (e) {
      patch(id, { state: "preview", preview: { ok: false, message: (e as Error).message } });
    }
  }

  async function applyEdit(t: EditTurn) {
    patch(t.id, { state: "applying" });
    try {
      await post<Run>(`/api/runs/${run.id}/edit`, { ...targetBody(t.target), prompt: t.prompt });
      patch(t.id, { state: "applied" });
      toast(t.preview?.message ?? "Plan updated", "good");
      onFocusClear?.();
    } catch (e) {
      patch(t.id, { state: "preview" });
      toast((e as Error).message, "bad");
    }
  }

  async function send(t: string) {
    const msg = t.trim();
    if (!msg || busy) return;
    setText("");
    if (editing && focus) return checkEdit(focus, msg);
    // "Add a step: …" while a plan is on the board goes onto the board, not back through the whole plan.
    const step = proposedPlan ? stepFromText(msg) : null;
    if (step) return void planAct("Your own step", "plan-edit", { op: "add", agent: "auto", brief: step }, "Step added to the board");
    setSending(true);
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

  /** Something done to the plan from the chat: the board shows the result. */
  async function planAct(label: string, path: string, body: unknown, ok?: string) {
    setActing(label);
    try {
      await post(`/api/runs/${run.id}/${path}`, body);
      if (ok) toast(ok, "good");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setActing(null);
    }
  }

  function doQuick(q: Quick) {
    const d = q.do;
    if ("say" in d) return void send(d.say);
    if ("fill" in d) {
      setText(d.fill);
      return input.current?.focus();
    }
    if ("add" in d) return void planAct(q.label, "plan-edit", { op: "add", agent: d.add.agent, brief: d.add.brief }, `${q.label} added to the board`);
    // Done by code, no waiting for the agent: the drawing beside the chat changes as the answer comes back.
    if ("adjust" in d) return void planAct(q.label, "adjust", { kind: d.adjust });
    if (d.act === "review") {
      const id = [...chat].reverse().find((m) => m.proposal)?.proposal?.id;
      return id ? void choose(id) : undefined;
    }
    if (d.act === "stop-plan" && plan) return void planAct(q.label, "plan-stop", { planId: plan.id }, "Plan stopped · steps already running will finish");
    if (d.act === "start-plan" && proposedPlan) return void planAct(q.label, "plan-start", { planId: proposedPlan.id }, "Plan started · each step runs as its own job");
  }

  async function choose(proposalId: string) {
    setAdopting(true);
    try {
      await post(`/api/runs/${run.id}/adopt`, { proposalId });
      setEdits([]);
      toast("Ready to review · nothing is spent until you approve", "good");
      onAdopted?.();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setAdopting(false);
    }
  }

  const proposedPlan = plan?.status === "proposed" && run.status === "exploring" ? plan : undefined;
  const quick = quickFor(run, plan);
  const placeholder = editing && focus ? (focus.kind === "card" ? CARD_HINT[focus.card] : focus.hint) : run.status === "draft" ? "Ask for something different" : proposedPlan ? "Say what to change, or “Add a step: …”" : last?.options?.length ? "Or type your own answer" : chat.length > 1 ? "Reply or ask something else" : `Ask ${THEMES[run.agent].name} anything`;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Chat with the agent">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ul className="space-y-4" aria-live="polite">
          {chat.map((m) => (
            <Bubble key={m.id} m={m} run={run} onChoose={choose} busy={adopting} onShowPlan={onShowPlan} drawn={drawn} />
          ))}
          <AnimatePresence>
            {run.thinking && (
              <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2.5 text-[13px] text-ink-3" data-testid="thinking">
                <AgentIcon agent={run.agent} size={28} outfit={runOutfit(run)} mood="working" />
                <span className="inline-flex items-center gap-1.5 rounded-2xl border border-line bg-panel px-3 py-2">
                  <Spinner /> {run.thinking}…
                </span>
              </motion.li>
            )}
          </AnimatePresence>
          {edits.map((t, i) => (
            <li key={t.id} className="space-y-4">
              <ul className="space-y-4">
                <UserRow tag={`Editing ${targetName(t.target)}`}>{t.prompt}</UserRow>
                <EditReply
                  t={t}
                  run={run}
                  last={i === edits.length - 1}
                  onApply={() => applyEdit(t)}
                  onDrop={() => patch(t.id, { state: "dropped" })}
                  onTry={(alt) => checkEdit(t.target, alt)}
                />
              </ul>
            </li>
          ))}
        </ul>
      </div>

      {open ? (
        <div className="border-t border-line bg-panel px-3 pb-3 pt-2.5">
          {!busy && run.status === "exploring" && last?.role === "agent" && last.options && last.options.length > 0 && (
            <div className="mb-2.5 grid gap-1.5 sm:grid-cols-2" data-testid="answer-options">
              {last.options.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="pressable rounded-lg border-[1.5px] border-ink bg-panel px-3 py-2.5 text-left text-[14px] font-medium hover:bg-agent-soft">
                  {s}
                </button>
              ))}
            </div>
          )}
          {!busy && !editing && quick.length > 0 && (
            <div className="mb-2.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick options" data-testid="quick">
              {quick.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => doQuick(q)}
                  disabled={Boolean(acting)}
                  className={`pressable inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[12.5px] font-medium disabled:opacity-50 ${
                    q.primary ? "border-ink bg-agent text-agent-on shadow-[2px_2px_0_0_var(--color-ink)]" : "border-line bg-panel text-ink-2 hover:border-ink/40 hover:text-ink"
                  }`}
                  data-testid={q.primary ? "quick-primary" : "quick-option"}
                >
                  {acting === q.label ? <Spinner /> : q.adds ? <Icon name="plus" size={12} stroke={2.6} className="text-agent-ink" /> : null}
                  {q.label}
                </button>
              ))}
            </div>
          )}
          <AnimatePresence initial={false}>
            {editing && focus && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ type: "spring", stiffness: 500, damping: 32 }} className="mb-2 flex">
                <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border-[1.5px] border-ink bg-agent-soft pl-2.5 pr-1 text-[13px] font-semibold text-agent-ink" data-testid="chat-focus">
                  <Icon name="edit" size={13} /> Editing {focus.kind === "step" ? "step: " : ""}
                  {targetName(focus)}
                  <button type="button" onClick={onFocusClear} aria-label="Stop editing this card" className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-2 hover:bg-panel hover:text-ink">
                    <Icon name="x" size={13} stroke={2.2} />
                  </button>
                </span>
              </motion.div>
            )}
          </AnimatePresence>
          <form
            className={`flex items-end gap-2 rounded-xl border bg-panel p-1.5 transition-[border-color,box-shadow] ${editing ? "border-ink shadow-[3px_3px_0_0_var(--agent)]" : "border-line focus-within:border-ink/40"}`}
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <textarea
              ref={input}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
                if (e.key === "Escape" && editing) onFocusClear?.();
              }}
              placeholder={placeholder}
              className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[14px] leading-snug outline-none placeholder:text-ink-3"
              maxLength={1000}
              aria-label={editing && focus ? `Change ${targetName(focus)}` : "Message"}
              data-testid="chat-input"
            />
            <button
              type="submit"
              disabled={busy || !text.trim()}
              aria-label={editing ? "Preview change" : "Send"}
              className="pix-press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-[1.5px] border-ink bg-agent text-agent-on disabled:opacity-40 disabled:shadow-none"
            >
              {busy ? <Spinner /> : <Icon name="send" size={17} stroke={2.2} />}
            </button>
          </form>
          {editing && <p className="mt-2 px-1 text-[12px] text-ink-3">You&apos;ll see the new price before anything changes.</p>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-[12.5px] text-ink-3">
          <span>This job is approved, so its chat is closed.</span>
          <Link href={`/new?agent=${run.agent}`} className="font-medium text-ink underline decoration-line underline-offset-2" data-testid="ask-more">
            Ask {THEMES[run.agent].name} something else
          </Link>
        </div>
      )}
    </section>
  );
}
