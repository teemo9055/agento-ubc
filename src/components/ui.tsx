"use client";
import { motion, AnimatePresence } from "framer-motion";
import { fmt } from "@/lib/money";
import { short, txUrl } from "@/lib/format";
import type { PhaseStatus, TxState } from "@/lib/types";
import { Icon } from "./Icon";

export function Button({
  variant = "primary",
  className = "",
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "agent" | "ghost" | "danger" | "quiet" }) {
  const v = {
    primary: "pix-press border-[1.5px] border-ink bg-ink font-semibold text-white disabled:bg-ink/40 disabled:shadow-none",
    agent: "pix-press border-[1.5px] border-ink bg-agent font-semibold text-agent-on disabled:opacity-50 disabled:shadow-none",
    ghost: "border border-line bg-panel font-medium text-ink hover:border-[#c9c8c2] disabled:text-ink-3",
    danger: "border border-bad/40 font-medium text-bad hover:bg-bad/5",
    quiet: "font-medium text-ink-2 hover:bg-ink/5 hover:text-ink",
  }[variant];
  return <button {...p} className={`tap inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm transition-colors disabled:cursor-not-allowed ${v} ${className}`} />;
}

/** Number that changes in place. */
export function Amount({ value, className = "", unit = true }: { value?: string | bigint; className?: string; unit?: boolean }) {
  const s = fmt(value);
  return (
    <span className={`num ${className}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={s} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
          {s}
        </motion.span>
      </AnimatePresence>
      {unit && <span className="ml-1 text-[0.8em] text-ink-3">USDC</span>}
    </span>
  );
}

const statusMeta: Record<PhaseStatus, { label: string; cls: string; dot: string }> = {
  planned: { label: "Planned", cls: "text-ink-2 bg-[#f1f0ec]", dot: "border border-ink-3" },
  active: { label: "Running", cls: "text-agent-ink bg-agent-soft", dot: "bg-agent" },
  awaiting_reapproval: { label: "Needs you", cls: "text-warn-ink border border-warn bg-warn/15", dot: "bg-warn border border-warn-ink" },
  failed_waiting: { label: "Needs you", cls: "text-bad bg-bad/5 border border-bad/40", dot: "bg-bad" },
  done: { label: "Done", cls: "text-good bg-good/10", dot: "" },
  failed: { label: "Failed", cls: "text-bad bg-bad/5", dot: "bg-bad" },
  skipped: { label: "Skipped", cls: "text-ink-2 bg-[#f1f0ec]", dot: "bg-ink-3" },
};

/** Small status tag: a pixel dot (or a check when done) and a label. */
export function StatusTag({ status }: { status: PhaseStatus }) {
  const m = statusMeta[status];
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] font-semibold ${m.cls}`}>
      {status === "done" ? <Icon name="check" size={12} stroke={2.6} /> : <span aria-hidden className={`h-1.5 w-1.5 ${m.dot}`} />}
      {m.label}
    </span>
  );
}

const txLabel: Record<TxState, string> = { planned: "Planned", signing: "Signing", pending: "Pending", settled: "Settled", failed: "Failed" };

export function TxChip({ state, hash, simulated }: { state: TxState; hash?: string; simulated?: boolean }) {
  const cls =
    state === "settled" ? "text-good border-good/40" : state === "failed" ? "text-bad border-bad/40" : state === "planned" ? "text-ink-3 border-line" : "text-accent border-accent/40";
  const body = (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] ${cls}`}>
      {txLabel[state]}
      {hash ? ` · ${short(hash, 6)}` : state === "settled" && simulated ? " · demo" : ""}
    </span>
  );
  return hash ? (
    <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="hover:opacity-80">
      {body}
    </a>
  ) : (
    body
  );
}

export function Spinner() {
  return <span aria-hidden className="inline-block h-3 w-3 animate-spin rounded-[50%] border-[1.5px] border-current border-t-transparent motion-reduce:animate-none" />;
}
