"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { AgentIcon } from "@/components/AgentIcon";
import { Mascot } from "@/components/Mascot";
import dynamic from "next/dynamic";
import { CancelModal, FailureModal, ReapprovalModal } from "@/components/RunPopups";
import { transitionReady } from "@/components/transitions";
import { ApproveModal, Cards, CostTable, EditCardModal, MethodPicker } from "@/components/WorkOrder";

// Heavy parts load only when the job reaches them.
const PhaseGraph = dynamic(() => import("@/components/PhaseGraph").then((m) => m.PhaseGraph), {
  ssr: false,
  loading: () => <div className="h-48 animate-pulse bg-line/40 motion-reduce:animate-none" />,
});
const AgentWidget = dynamic(() => import("@/components/widgets/AgentWidget").then((m) => m.AgentWidget), {
  ssr: false,
  loading: () => <div className="h-56 animate-pulse bg-line/40 motion-reduce:animate-none" />,
});
const ReceiptView = dynamic(() => import("@/components/ReceiptView").then((m) => m.ReceiptView), { ssr: false });
import { Amount, Button, Spinner } from "@/components/ui";
import { useAgentTheme, useRun } from "@/components/useRun";
import { toast } from "@/components/Toaster";
import { fmt, sum } from "@/lib/money";
import { THEMES } from "@/lib/themes";
import { short, txUrl } from "@/lib/format";
import type { Card } from "@/lib/types";
import { moodFor } from "@/lib/outfit";
import { runOutfit } from "@/lib/summary";

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6 motion-reduce:animate-none" aria-busy="true" aria-label="Loading work order">
      <div className="h-4 w-48 rounded bg-line" />
      <div className="h-8 w-96 max-w-full rounded bg-line" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-36 rounded-2xl bg-line/70" />
        ))}
      </div>
      <div className="h-48 rounded-2xl bg-line/60" />
    </div>
  );
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { run, missing, lastEvent, connection, isLive } = useRun(id);
  const [editing, setEditing] = useState<Card["kind"] | null>(null);
  const [approving, setApproving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useAgentTheme(run?.agent);

  useEffect(() => {
    if (run) transitionReady();
  }, [run]);

  // Toast the moments that matter, only when they happen live (not on replay).
  useEffect(() => {
    if (!lastEvent || !isLive(lastEvent)) return;
    if (lastEvent.type === "run.done") toast(`Done · ${fmt(lastEvent.refunded)} USDC returned · receipt ready`, "good");
    if (lastEvent.type === "run.cancelled") toast(`Cancelled · ${fmt(lastEvent.refunded)} USDC returned`);
    if (lastEvent.type === "workorder.updated" && !lastEvent.run.planning && lastEvent.seq === 1) toast("Plan ready · review and approve when you're happy", "good");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);

  const pending = run ? [...run.pendingReapprovals.map((r) => ({ kind: "re" as const, id: r.id })), ...run.pendingFailures.map((f) => ({ kind: "fail" as const, id: f.id }))] : [];
  const head = pending[0];
  useEffect(() => {
    if (head && dismissed && dismissed !== head.id) setDismissed(null);
  }, [head, dismissed]);

  // Keyboard: A to review & approve on a draft.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "a" && !e.metaKey && !e.ctrlKey && run?.status === "draft" && !(e.target as HTMLElement).closest("input,textarea") && !editing) setApproving(true);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [run?.status, editing]);

  if (missing)
    return (
      <div className="mx-auto max-w-md pt-16 text-center">
        <div className="text-lg font-semibold">This job isn&apos;t on this server anymore</div>
        <p className="mt-1 text-sm text-ink-2">Jobs live in server memory. If it had a vault, the client wallet can still close it to recover funds.</p>
        <Link className="mt-4 inline-block rounded-lg bg-ink px-4 py-2 text-sm text-white" href="/">
          Start a new job
        </Link>
      </div>
    );
  if (!run) return <Skeleton />;

  const theme = THEMES[run.agent];
  const planning = Boolean(run.planning);
  const draft = !planning && (run.status === "draft" || run.status === "funding");
  const finished = run.status === "done" || run.status === "cancelled";
  const done = run.phases.filter((p) => p.status === "done" || p.status === "skipped").length;
  const total = sum(run.lines.map((l) => l.approved));
  const actual = sum(run.lines.map((l) => l.actual));
  const showPopup = head && dismissed !== head.id && !editing && !approving && !cancelling;
  const reapproval = head?.kind === "re" ? run.pendingReapprovals.find((r) => r.id === head.id) : undefined;
  const failure = head?.kind === "fail" ? run.pendingFailures.find((f) => f.id === head.id) : undefined;

  return (
    <div className="space-y-6 pb-24 sm:pb-0">
      <AnimatePresence>
        {run.faults.length > 0 && !finished && (
          <motion.div exit={{ opacity: 0, height: 0 }} role="status" className="rounded-xl border border-warn bg-warn/15 px-4 py-2 text-sm text-[#7a5000]">
            <b>Test mode.</b> Fault switches on: {run.faults.join(", ").replaceAll("_", " ")}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.header initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span style={{ viewTransitionName: `mascot-${run.id}` }}>
            <AgentIcon agent={run.agent} size={56} outfit={runOutfit(run)} mood={moodFor(run.status, run.pendingReapprovals.length + run.pendingFailures.length)} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-ink-3">
              <span className="text-agent">{theme.name}</span>
              <span>·</span>
              <span>{theme.domain}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${run.mode === "live" ? "bg-ink text-white" : "bg-ink/5 text-ink-2"}`}>{run.mode === "live" ? "Arc testnet" : "Demo rail"}</span>
              {connection === "reconnecting" && (
                <span className="inline-flex items-center gap-1 border border-warn bg-warn/15 px-2 py-0.5 text-[11px] text-[#7a5000]" role="status">
                  <Spinner /> Reconnecting
                </span>
              )}
              <span className="rounded-full bg-agent-soft px-2 py-0.5 text-[11px] text-agent" title={run.ai ? `${run.ai.calls} model calls` : undefined}>
                {run.planner === "ai" ? `Planned by AI · ${run.ai?.model ?? ""}` : "Rule-based plan"}
              </span>
            </div>
            <h1 style={{ viewTransitionName: `task-${run.id}` }} className="mt-1 max-w-2xl text-[22px] font-semibold leading-tight tracking-tight sm:text-[26px]">{run.task}</h1>
            <AnimatePresence mode="wait">
              <motion.p key={run.status} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-1 text-sm text-ink-2">
                {theme.copy[run.status]}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[12px] text-ink-3">{planning ? "Pricing…" : draft ? "Total cost" : finished ? "Paid" : "Spent so far"}</div>
          <div className="text-[40px] font-semibold leading-none tracking-tight" data-testid="big-number">
            {planning ? <span className="inline-block h-10 w-36 animate-pulse bg-line align-middle motion-reduce:animate-none" /> : <Amount value={draft ? total : actual} />}
          </div>
          {!draft && <div className="num mt-1 text-[12px] text-ink-3">of {fmt(total)} approved</div>}
        </div>
      </motion.header>

      {planning && (
        <section className="space-y-6" aria-busy="true" aria-label="Planning">
          <div className="flex items-center gap-4 rounded-2xl border border-line bg-panel p-5">
            <Mascot agent={run.agent} outfit={runOutfit(run)} mood="working" size={72} />
            <div>
              <div className="font-pixel text-[15px] text-agent">{theme.name} is planning</div>
              <p className="mt-1 text-sm text-ink-2">
                {run.agent === "inso" ? "Reading active prediction markets and picking the ones that answer you." : run.agent === "trado" ? "Choosing coins and timeframes for your question." : "Working out the stops and the route."} Nothing is spent until you approve.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {["Price", "Deliverable", "Method", "Risk"].map((k, i) => (
              <div key={k} className="rounded-2xl border border-line bg-panel p-4">
                <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{k}</div>
                <div className="mt-2 h-4 w-2/3 animate-pulse bg-line motion-reduce:animate-none" style={{ animationDelay: `${i * 120}ms` }} />
                <div className="mt-3 h-3 w-full animate-pulse bg-line/70 motion-reduce:animate-none" />
                <div className="mt-2 h-3 w-4/5 animate-pulse bg-line/70 motion-reduce:animate-none" />
              </div>
            ))}
          </div>
          <div className="h-40 animate-pulse rounded-2xl border border-line bg-panel/60 motion-reduce:animate-none" />
        </section>
      )}

      {draft && (
        <>
          <Cards run={run} onEdit={run.status === "draft" ? setEditing : undefined} />
          <MethodPicker run={run} />
          <CostTable run={run} />
          <AnimatePresence>
            {run.editNote && (
              <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`text-right text-[12.5px] ${run.editNote.ok ? "text-ink-2" : "text-bad"}`}>
                {run.editNote.message}
              </motion.p>
            )}
          </AnimatePresence>
          <div className="fixed inset-x-0 bottom-[var(--tabbar-h)] z-20 border-t border-line bg-surface/90 px-4 py-3 backdrop-blur-md sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
              <Button variant="quiet" onClick={() => setCancelling(true)}>
                Discard
              </Button>
              <div className="flex items-center gap-3">
                <span className="num text-sm text-ink-2 sm:hidden">{fmt(total)} USDC</span>
                <Button onClick={() => setApproving(true)} disabled={run.status !== "draft"} data-testid="open-approve" className="bg-agent px-5 hover:opacity-90">
                  {run.status === "funding" ? (
                    <>
                      <Spinner /> Funding vault…
                    </>
                  ) : (
                    <>
                      Review & approve <kbd className="ml-1 hidden rounded border border-white/30 px-1 text-[10px] sm:inline">A</kbd>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {!draft && !planning && (
        <>
          <section className="rounded-2xl border border-line bg-panel p-4" aria-label="Progress">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span className="font-medium">
                {finished ? (run.status === "done" ? "All steps done" : "Stopped") : (
                  <>
                    Step <span className="num">{Math.min(done + 1, run.phases.length)}</span> of {run.phases.length}
                  </>
                )}
              </span>
              <div className="flex items-center gap-3">
                <AnimatePresence>
                  {pending.length > 0 && dismissed === head?.id && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      onClick={() => setDismissed(null)}
                      className="rounded-full border border-warn bg-warn/15 px-2.5 py-0.5 text-[12px] font-medium text-[#7a5000]"
                    >
                      {pending.length} needs you
                    </motion.button>
                  )}
                </AnimatePresence>
                <span className="num text-ink-3">{Math.round((done / run.phases.length) * 100)}%</span>
              </div>
            </div>
            <div className="sr-only" aria-live="polite">
              {run.phases.filter((p) => p.status === "active").map((p) => `${p.label} running`).join(", ")}
              {pending.length ? ` · ${pending.length} needs your decision` : ""}
            </div>
            <div className="h-1.5 pix-bar overflow-hidden bg-line">
              <motion.div className="h-full rounded-full bg-good" animate={{ width: `${(done / run.phases.length) * 100}%` }} transition={{ duration: 0.5 }} />
            </div>
            <div className="mt-2">
              <PhaseGraph phases={run.phases} lines={run.lines} simulated={run.mode === "demo"} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[11.5px] text-ink-3">
              <span>
                {run.vault ? (
                  <>
                    Vault <span className="font-mono">{short(run.vault)}</span>
                    {run.fundingTx && (
                      <a className="ml-2 underline decoration-line underline-offset-2 hover:text-ink" href={txUrl(run.fundingTx)} target="_blank" rel="noreferrer">
                        funding tx ↗
                      </a>
                    )}
                  </>
                ) : (
                  "Vault simulated on demo rail"
                )}
              </span>
              {!finished && (
                <Button variant="quiet" className="h-7 text-[12px]" onClick={() => setCancelling(true)}>
                  Cancel job
                </Button>
              )}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
            <section className="min-w-0 rounded-2xl border border-line bg-panel p-4" aria-label="Result">
              <AgentWidget run={run} />
            </section>
            <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
              <CostTable run={run} compact />
            </div>
          </div>

          <AnimatePresence>
            {finished && (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}>
                <ReceiptView run={run} />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {editing && <EditCardModal run={run} kind={editing} onClose={() => setEditing(null)} />}
      <ApproveModal run={run} open={approving} onClose={() => setApproving(false)} />
      <CancelModal run={run} open={cancelling} onClose={() => setCancelling(false)} />
      {showPopup && reapproval && <ReapprovalModal key={reapproval.id} run={run} req={reapproval} onClose={() => setDismissed(reapproval.id)} />}
      {showPopup && failure && <FailureModal key={failure.id} run={run} failure={failure} onClose={() => setDismissed(failure.id)} />}
    </div>
  );
}
