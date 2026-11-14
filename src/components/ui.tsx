"use client";
import { motion, AnimatePresence } from "framer-motion";
import { fmt } from "@/lib/money";
import { short, txUrl } from "@/lib/format";
import type { PhaseStatus, TxState } from "@/lib/types";

export function Button({
  variant = "primary",
  className = "",
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "quiet" }) {
  const v = {
    primary: "bg-ink text-white hover:bg-ink/85 disabled:bg-ink/40",
    ghost: "border border-line bg-panel text-ink hover:bg-surface disabled:text-ink-3",
    danger: "border border-bad/40 text-bad hover:bg-bad/5",
    quiet: "text-ink-2 hover:text-ink hover:bg-ink/5",
  }[variant];
  return <button {...p} className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${v} ${className}`} />;
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

const statusMeta: Record<PhaseStatus, { label: string; cls: string; icon: string }> = {
  planned: { label: "Planned", cls: "text-ink-3 border-line", icon: "○" },
  active: { label: "Running", cls: "text-agent border-agent/40 bg-agent-soft", icon: "●" },
  awaiting_reapproval: { label: "Needs you", cls: "text-[#8a5a00] border-warn bg-warn/15", icon: "!" },
  failed_waiting: { label: "Needs you", cls: "text-bad border-bad/40 bg-bad/5", icon: "!" },
  done: { label: "Done", cls: "text-good border-good/40 bg-good/5", icon: "✓" },
  failed: { label: "Failed", cls: "text-bad border-bad/40 bg-bad/5", icon: "✕" },
  skipped: { label: "Skipped", cls: "text-ink-3 border-line", icon: "–" },
};

export function StatusTag({ status }: { status: PhaseStatus }) {
  const m = statusMeta[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${m.cls}`}>
      <span aria-hidden>{m.icon}</span>
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
  return <span aria-hidden className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent motion-reduce:animate-none" />;
}
