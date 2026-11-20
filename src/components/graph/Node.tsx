"use client";
import { useNet } from "../NetContext";
import { fmt } from "@/lib/money";
import type { CostLine, Phase } from "@/lib/types";
import { txUrl } from "@/lib/format";
import { Icon } from "../Icon";
import { NODE_H, NODE_W } from "./layout";

export type Tone = "done" | "running" | "waiting" | "needs" | "failed" | "skipped";

export const toneOf = (p: Phase): Tone =>
  p.status === "done"
    ? "done"
    : p.status === "active"
      ? "running"
      : p.status === "awaiting_reapproval" || p.status === "failed_waiting"
        ? "needs"
        : p.status === "failed"
          ? "failed"
          : p.status === "skipped"
            ? "skipped"
            : "waiting";

const FRAME: Record<Tone, string> = {
  done: "border-[1.5px] border-good bg-good/[0.06]",
  running: "border-[1.5px] border-ink bg-panel shadow-[3px_3px_0_0_var(--agent)]",
  waiting: "border-[1.5px] border-dashed border-[#cfcec8] bg-panel",
  needs: "border-[1.5px] border-ink bg-warn/15 shadow-[3px_3px_0_0_var(--color-warn)]",
  failed: "border-[1.5px] border-bad bg-bad/[0.06]",
  skipped: "border border-dashed border-line bg-panel opacity-55",
};

const STATE_TEXT: Record<Tone, string> = { done: "Done", running: "Running", waiting: "Waiting", needs: "Needs you", failed: "Failed", skipped: "Skipped" };

/** A tie-breaker waits grey and dashed until its sources disagree; a gap is hatched and never runs. */
const TIE_WAITING = "border-[1.5px] border-dashed border-ink/25 bg-[#f6f5f1]";
const GAP = "border-[1.5px] border-dashed border-ink/30 bg-[repeating-linear-gradient(135deg,#f6f5f1_0_6px,#efeee8_6px_12px)]";

const FINDING: Record<NonNullable<Phase["finding"]>["tone"], string> = {
  good: "bg-good/10 text-good",
  warn: "bg-warn/20 text-warn-ink",
  bad: "bg-bad/10 text-bad",
  neutral: "bg-[#f1f0ec] text-ink-2",
};
const FINDING_WORD: Record<NonNullable<Phase["finding"]>["tone"], string> = { good: "reassuring", warn: "warning", bad: "red flag", neutral: "no signal" };

function Mark({ tone, step }: { tone: Tone; step: number }) {
  const base = "inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] text-[11px] font-semibold";
  if (tone === "done")
    return (
      <span className={`${base} bg-good text-white`}>
        <Icon name="check" size={13} stroke={3} />
      </span>
    );
  if (tone === "running")
    return (
      <span className={`${base} border-[1.5px] border-ink bg-agent`}>
        <span className="mascot-spark h-1.5 w-1.5 bg-white" />
      </span>
    );
  if (tone === "needs") return <span className={`${base} border-[1.5px] border-ink bg-warn font-pixel text-ink`}>!</span>;
  if (tone === "failed") return <span className={`${base} bg-bad font-pixel text-white`}>!</span>;
  if (tone === "skipped") return <span className={`${base} border border-dashed border-ink-3 text-ink-3`}>–</span>;
  return <span className={`${base} num border-[1.5px] border-[#d5d4ce] text-ink-3`}>{step}</span>;
}

export function Node({ p, line, step, simulated, onEdit, focused, dim, x, y, onGap, diff }: { p: Phase; line?: CostLine; step: number; simulated: boolean; onEdit?: () => void; focused?: boolean; dim?: boolean; x: number; y: number; /** For a gap: find another way, or skip it. */ onGap?: (action: "another" | "skip") => void; /** Just changed by an edit: shown for a moment. */ diff?: { isNew?: boolean; priceFrom?: string; providerFrom?: string } }) {
  const net = useNet();
  const tone = toneOf(p);
  const last = p.payments[p.payments.length - 1];
  const tieWaiting = Boolean(p.tieBreaker) && tone === "waiting";
  const sub = p.gap
    ? p.gap.why
    : p.error && (tone === "needs" || tone === "failed")
      ? p.error.message
      : p.note && tone !== "waiting"
        ? p.note
        : tieWaiting
          ? "Only if sources disagree"
          : p.conditional && tone === "waiting"
            ? `Only if ${p.conditional}`
            : p.sub;
  const Box = onEdit ? "button" : "div";
  const frame = p.gap ? GAP : tieWaiting ? TIE_WAITING : FRAME[tone];
  const red = p.finding?.tone === "bad" && tone === "done";
  const label = [`Step ${step}: ${p.label}`, p.gap ? "no service found for this" : STATE_TEXT[tone].toLowerCase(), p.finding ? `${FINDING_WORD[p.finding.tone]}: ${p.finding.text}` : null].filter(Boolean).join(", ");
  return (
    <Box
      type={onEdit ? "button" : undefined}
      onClick={onEdit}
      aria-pressed={onEdit ? Boolean(focused) : undefined}
      aria-label={onEdit ? `${label}. Edit in chat` : label}
      className={`node-in group absolute flex flex-col overflow-hidden rounded-xl px-3.5 pb-2.5 pt-3 text-left transition-[box-shadow,border-color,opacity,transform,background-color] duration-300 motion-reduce:transition-none ${frame} ${red ? "!shadow-[3px_3px_0_0_var(--color-bad)]" : ""} ${diff?.isNew ? "!border-good !border-2" : ""} ${focused ? "!border-ink shadow-[3px_3px_0_0_var(--agent)]" : ""} ${
        onEdit && !focused ? "cursor-pointer hover:-translate-y-0.5 hover:border-ink" : ""
      } ${dim ? "opacity-55" : ""}`}
      style={{ left: x, top: y, width: NODE_W, height: NODE_H, animationDelay: `${(step - 1) * 60}ms` }}
      data-testid={`phase-${p.id}`}
      data-status={p.status}
      data-tone={tone}
      data-finding-tone={p.finding?.tone}
      data-gap={p.gap ? "true" : undefined}
      data-tiebreaker={p.tieBreaker ? "true" : undefined}
      data-new={diff?.isNew ? "true" : undefined}
    >
      {diff?.isNew && <span className="absolute right-1.5 top-1.5 rounded bg-good px-1 text-[10px] font-semibold text-white" data-testid={`new-${p.id}`}>+ new</span>}
      <div className="flex items-start gap-2.5">
        {p.gap ? <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border border-dashed border-ink/40 text-[12px] text-ink-3">?</span> : <Mark tone={tone} step={step} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {p.conditional && <span aria-hidden title={`Only if ${p.conditional}`} className="inline-block h-2 w-2 shrink-0 rotate-45 border-[1.5px] border-ink bg-panel" data-testid={`when-${p.id}`} />}
            <span className="truncate text-[13.5px] font-semibold leading-tight">{p.label}</span>
            {diff?.providerFrom && <span className="truncate text-[11px] text-ink-3 line-through" title={`Was ${diff.providerFrom}`}>{diff.providerFrom}</span>}
            {p.conflict && (
              <span
                title={p.conflict.note}
                className={`ml-auto shrink-0 rounded-[4px] px-1 text-[11px] font-bold leading-[16px] ${p.conflict.agree ? "bg-good/15 text-good" : "bg-bad text-white"}`}
                data-testid={`conflict-${p.id}`}
                data-agree={p.conflict.agree ? "true" : "false"}
              >
                {p.conflict.agree ? "=" : "≠"}
              </span>
            )}
          </div>
          {p.finding && tone === "done" ? (
            <span key={p.finding.text} title={p.finding.text} className={`finding-in mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-[1px] text-[11.5px] font-medium ${FINDING[p.finding.tone]}`} data-testid={`finding-${p.id}`}>
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
              <span className="truncate">{p.finding.text}</span>
            </span>
          ) : (
            <div className={`truncate text-[12px] leading-snug ${tone === "failed" || (tone === "needs" && p.error) ? "text-bad" : "text-ink-3"}`} title={sub}>
              {!p.gap && tone !== "waiting" && tone !== "running" ? <b className="font-semibold">{STATE_TEXT[tone]} · </b> : null}
              {p.gap ? <b className="font-semibold text-ink-2">No service found for this · </b> : null}
              {sub && sub.toLowerCase() !== p.label.toLowerCase() ? sub : tone === "waiting" ? "Waiting its turn" : null}
            </div>
          )}
        </div>
      </div>
      {p.gap && onGap ? (
        <div className="mt-auto flex items-center gap-1.5 text-[11.5px]">
          <button type="button" onClick={(e) => (e.stopPropagation(), onGap("another"))} className="rounded-md bg-ink px-1.5 py-0.5 font-semibold text-white hover:bg-ink/85" data-testid={`gap-another-${p.id}`}>
            Find another way
          </button>
          <button type="button" onClick={(e) => (e.stopPropagation(), onGap("skip"))} className="rounded-md bg-[#f1f0ec] px-1.5 py-0.5 font-semibold text-ink-2 hover:bg-ink/10" data-testid={`gap-skip-${p.id}`}>
            Skip
          </button>
        </div>
      ) : (
      <div className="mt-auto flex items-center justify-between gap-2 text-[12px]">
        <span className="num truncate text-ink-3" data-kind={line ? "pays" : "free"}>
          {p.gap ? (
            "Not priced"
          ) : line ? (
            diff?.priceFrom ? (
              <span data-testid={`price-change-${p.id}`}>
                ${fmt(diff.priceFrom)} → ${fmt(line.approved)}
              </span>
            ) : tone === "waiting" || tone === "skipped" ? `${tieWaiting || p.conditional ? "Up to" : "Agento pays"} $${fmt(line.approved === "0" && line.calls ? line.calls.unitPrice : line.approved)}` : `$${fmt(line.actual)} of $${fmt(line.approved)}`
          ) : (
            "Free"
          )}
        </span>
        {onEdit ? (
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${focused ? "bg-ink text-white" : "bg-[#f1f0ec] text-ink-2 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`} aria-hidden>
            <Icon name={focused ? "chat" : "edit"} size={11} /> {focused ? "In chat" : "Edit"}
          </span>
        ) : last?.txHash ? (
          <a href={txUrl(last.txHash, net)} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-0.5 text-ink-3 hover:text-ink" aria-label={`Payment record for ${p.label}`} title="Payment record on Arc">
            receipt <Icon name="external" size={11} />
          </a>
        ) : last?.txState === "settled" && simulated ? (
          <span className="shrink-0 text-ink-3">practice</span>
        ) : null}
      </div>
      )}
      {tone === "running" && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-agent-soft">
          <div className="h-full bg-agent transition-[width] duration-500" style={{ width: `${Math.max(6, Math.round((p.progress ?? 0) * 100))}%` }} />
        </div>
      )}
    </Box>
  );
}

