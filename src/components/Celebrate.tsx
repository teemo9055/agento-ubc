"use client";
import { useEffect, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { offVault, type Run } from "@/lib/types";
import { fmt } from "@/lib/money";
import { AgentIcon } from "./AgentIcon";
import { Icon } from "./Icon";
import { runOutfit } from "@/lib/summary";

/**
 * A one-off burst of pixel squares from the centre of its parent. Agent colour, ink and gold.
 * Renders nothing for people who prefer reduced motion.
 */
export function Sparkles({ count = 30, spread = 150, seed = 1 }: { count?: number; spread?: number; seed?: number }) {
  const reduce = useReducedMotion();
  const bits = useMemo(() => {
    // Deterministic per seed so a re-render doesn't reshuffle a burst mid-flight.
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const colors = ["var(--agent)", "var(--color-ink)", "#eda100", "var(--agent)", "#ffffff"];
    return Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + rnd() * 0.5;
      const d = spread * (0.45 + rnd() * 0.55);
      return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.8, size: 5 + Math.round(rnd() * 5), color: colors[i % colors.length], delay: rnd() * 0.12, rot: Math.round(rnd() * 4) * 90 };
    });
  }, [count, spread, seed]);
  if (reduce) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-0 w-0">
      {bits.map((b, i) => (
        <motion.span
          key={i}
          className="absolute block"
          style={{ width: b.size, height: b.size, background: b.color, boxShadow: b.color === "#ffffff" ? "0 0 0 1px var(--color-ink)" : undefined, left: -b.size / 2, top: -b.size / 2 }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0.4, rotate: 0 }}
          animate={{ x: b.x, y: [0, b.y, b.y + 24], opacity: [1, 1, 0], scale: [0.4, 1, 0.8], rotate: b.rot }}
          transition={{ duration: 1.1, delay: b.delay, ease: [0.2, 0.8, 0.2, 1], times: [0, 0.6, 1] }}
        />
      ))}
    </span>
  );
}

/** A check that draws itself. */
export function DrawCheck({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="text-good">
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.14" />
      <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="draw" />
    </svg>
  );
}

/**
 * Shown when a job finishes while you watch: done (with sparkles) or cancelled (calmer, refund first).
 * Not a dialog: it doesn't block the page, closes itself, and Escape or ✕ closes it sooner.
 */
export function FinishCard({ run, kind, onClose }: { run: Run; kind: "done" | "cancelled" | null; onClose: () => void }) {
  useEffect(() => {
    if (!kind) return;
    const t = setTimeout(onClose, 9000);
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", k);
    };
  }, [kind, onClose]);

  const paid = run.lines.filter((l) => !offVault(l.rail)).reduce((a, l) => a + BigInt(l.actual), 0n);
  const back = BigInt(run.refunded ?? 0);
  const done = kind === "done";

  return (
    <AnimatePresence>
      {kind && (
        <motion.div
          role="status"
          aria-live="polite"
          data-testid="finish-card"
          data-agent={run.agent}
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, transition: { duration: 0.15 } }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          className="fixed inset-x-4 bottom-[calc(var(--tabbar-h)+16px)] z-40 mx-auto max-w-sm sm:inset-x-auto sm:bottom-6 sm:right-6"
        >
          <div className="relative overflow-visible rounded-2xl border-[1.5px] border-ink bg-panel p-4 shadow-[4px_4px_0_0_var(--agent)]">
            {done && <Sparkles seed={run.id.length + 3} spread={170} />}
            <div className="flex items-start gap-3">
              <motion.span
                initial={{ y: 0 }}
                animate={done ? { y: [0, -10, 0, -5, 0] } : { y: 0 }}
                transition={{ duration: 0.9, ease: "easeOut", delay: 0.15 }}
              >
                <AgentIcon agent={run.agent} size={48} outfit={runOutfit(run)} mood={done ? "happy" : "sad"} />
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className={`flex items-center gap-1.5 text-[15px] font-semibold ${done ? "text-good" : "text-ink"}`}>
                  {done && <DrawCheck size={20} />}
                  {done ? "Job done" : "Job stopped"}
                </div>
                <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{done ? "Your receipt is ready." : "The vault is closed and the rest is back in your wallet."}</p>
                <div className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                  <span>
                    Paid <b className="font-semibold">{fmt(paid)}</b> USDC
                  </span>
                  <motion.span
                    initial={{ scale: 1 }}
                    animate={back > 0n ? { scale: [1, 1.12, 1] } : {}}
                    transition={{ duration: 0.5, delay: 0.5 }}
                    className="inline-block origin-left font-semibold text-good"
                  >
                    {fmt(back)} back to you
                  </motion.span>
                </div>
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/5 hover:text-ink">
                <Icon name="x" size={15} stroke={2} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                document.getElementById("receipt")?.scrollIntoView({ behavior: "smooth", block: "start" });
                onClose();
              }}
              className="pix-press mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-ink bg-agent text-sm font-semibold text-agent-on"
            >
              <Icon name="receipt" size={16} /> See receipt
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
