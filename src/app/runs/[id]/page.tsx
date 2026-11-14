"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { PhaseGraph } from "@/components/PhaseGraph";
import { ReceiptView } from "@/components/ReceiptView";
import { CancelModal, FailureModal, ReapprovalModal } from "@/components/RunPopups";
import { ApproveModal, Cards, CostTable, EditCardModal } from "@/components/WorkOrder";
import { AgentWidget } from "@/components/widgets/AgentWidget";
import { Amount, Button } from "@/components/ui";
import { useRun } from "@/components/useRun";
import { fmt, sum } from "@/lib/money";
import { THEMES } from "@/lib/themes";
import { short, txUrl } from "@/lib/format";
import type { Card } from "@/lib/types";

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { run, missing } = useRun(id);
  const [editing, setEditing] = useState<Card["kind"] | null>(null);
  const [approving, setApproving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // A new pending item reopens the queue.
  const pending = run ? [...run.pendingReapprovals.map((r) => ({ kind: "re" as const, id: r.id })), ...run.pendingFailures.map((f) => ({ kind: "fail" as const, id: f.id }))] : [];
  const head = pending[0];
  useEffect(() => {
    if (head && dismissed && dismissed !== head.id) setDismissed(null);
  }, [head, dismissed]);

  if (missing)
    return (
      <div className="pt-10 text-center text-ink-2">
        This job isn&apos;t on this server anymore.{" "}
        <Link className="underline" href="/">
          Start a new one
        </Link>
      </div>
    );
  if (!run) return <div className="pt-10 text-center text-ink-3">Loading work order…</div>;

  const theme = THEMES[run.agent];
  const draft = run.status === "draft" || run.status === "funding";
  const finished = run.status === "done" || run.status === "cancelled";
  const done = run.phases.filter((p) => p.status === "done" || p.status === "skipped").length;
  const total = sum(run.lines.map((l) => l.approved));
  const actual = sum(run.lines.map((l) => l.actual));
  const showPopup = head && dismissed !== head.id && !editing && !approving && !cancelling;
  const reapproval = head?.kind === "re" ? run.pendingReapprovals.find((r) => r.id === head.id) : undefined;
  const failure = head?.kind === "fail" ? run.pendingFailures.find((f) => f.id === head.id) : undefined;

  return (
    <div className="space-y-6">
      {run.faults.length > 0 && !finished && (
        <div role="status" className="rounded-lg border border-warn bg-warn/15 px-4 py-2 text-sm text-[#7a5000]">
          <b>Test mode.</b> Fault switches on: {run.faults.join(", ")}
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-medium uppercase tracking-wide text-ink-3">
            {theme.name} · {theme.domain} · {run.mode === "live" ? "Arc testnet" : "Demo rail"}
          </div>
          <h1 className="mt-1 max-w-2xl text-2xl font-semibold tracking-tight">{run.task}</h1>
          <p className="mt-1 text-sm text-ink-2">{theme.copy[run.status]}</p>
        </div>
        <div className="text-right">
          <div className="text-[12px] text-ink-3">{draft ? "Total cost" : finished ? "Paid" : "Spent so far"}</div>
          <div className="text-4xl font-semibold tracking-tight" data-testid="big-number">
            <Amount value={draft ? total : actual} />
          </div>
          {!draft && <div className="num text-[12px] text-ink-3">of {fmt(total)} approved</div>}
        </div>
      </div>

      {draft && (
        <>
          <Cards run={run} onEdit={run.status === "draft" ? setEditing : undefined} />
          <CostTable run={run} />
          <div className="flex items-center justify-between gap-3">
            <Button variant="quiet" onClick={() => setCancelling(true)}>
              Discard
            </Button>
            <Button onClick={() => setApproving(true)} disabled={run.status !== "draft"} data-testid="open-approve">
              {run.status === "funding" ? "Funding vault…" : "Review & approve"}
            </Button>
          </div>
          {run.editNote?.ok && <p className="text-right text-[12.5px] text-ink-2">{run.editNote.message}</p>}
        </>
      )}

      {!draft && (
        <>
          <div className="rounded-2xl border border-line bg-panel p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span className="font-medium">
                Step <span className="num">{Math.min(done + (finished ? 0 : 1), run.phases.length)}</span> of {run.phases.length}
              </span>
              <div className="flex items-center gap-3">
                {pending.length > 0 && dismissed === head?.id && (
                  <button onClick={() => setDismissed(null)} className="rounded-full border border-warn bg-warn/15 px-2.5 py-0.5 text-[12px] font-medium text-[#7a5000]">
                    {pending.length} needs you
                  </button>
                )}
                <span className="num text-ink-3">{Math.round((done / run.phases.length) * 100)}%</span>
              </div>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-line">
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
                      <a className="ml-2 underline" href={txUrl(run.fundingTx)} target="_blank" rel="noreferrer">
                        funding tx
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
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,420px)]">
            <div className="rounded-2xl border border-line bg-panel p-4">
              <AgentWidget run={run} />
            </div>
            <div className="lg:sticky lg:top-20 lg:self-start">
              <CostTable run={run} />
            </div>
          </div>

          <AnimatePresence>
            {finished && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
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
