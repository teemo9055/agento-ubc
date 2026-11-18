"use client";
import { useEffect, useState } from "react";
import { fmt, usdc } from "@/lib/money";
import { short } from "@/lib/format";
import type { Failure, FailureAction, ReapprovalRequest, Run } from "@/lib/types";
import { Modal } from "./Modal";
import { Amount, Button } from "./ui";
import { post } from "./useRun";
import { toast } from "./Toaster";
import { changePlanCalls, sendCalls, topUpCalls } from "./passkey/wallet";
import type { Hex } from "viem";

function Countdown({ until }: { until: string }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((Date.parse(until) - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.round((Date.parse(until) - Date.now()) / 1000))), 500);
    return () => clearInterval(t);
  }, [until]);
  return <span className="num">{left}s</span>;
}

export function ReapprovalModal({ run, req, onClose }: { run: Run; req: ReapprovalRequest; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(fmt(req.to.amount));
  const phase = run.phases.find((p) => p.id === req.phaseId);
  let custom: bigint | null = null;
  try {
    custom = usdc(amount || "0");
  } catch {
    custom = null;
  }
  const tooLow = custom != null && custom < BigInt(req.minAmount);
  const passkey = run.payer === "passkey" && run.mode === "live";
  const decide = async (outcome: "approved" | "denied", value?: bigint) => {
    setBusy(true);
    try {
      let txHash: Hex | undefined;
      if (outcome === "approved" && passkey) {
        // Your wallet signs the new plan root (and any top-up); the server then checks it onchain.
        const q = new URLSearchParams({ requestId: req.id, ...(value != null ? { amount: value.toString() } : {}) });
        const plan = await fetch(`/api/runs/${run.id}/reapproval-plan?${q}`).then((r) => r.json());
        if (plan.error) throw new Error(plan.error);
        toast("Confirm the change with your passkey");
        txHash = await sendCalls(changePlanCalls(plan));
      }
      await post(`/api/runs/${run.id}/reapproval`, { requestId: req.id, outcome, amount: value?.toString(), txHash });
      toast(outcome === "approved" ? `Approved ${fmt(value ?? BigInt(req.to.amount))} USDC · continuing` : "Denied · nothing extra spent", outcome === "approved" ? "good" : "default");
    } catch (e) {
      toast((e as Error).message.split("\n")[0].slice(0, 160), "bad");
    } finally {
      setBusy(false);
    }
  };
  const newPayee = req.from.payee.toLowerCase() !== req.to.payee.toLowerCase();
  return (
    <Modal open onClose={onClose} title="Needs your OK" tone="warn">
      <p className="text-[13.5px] text-ink-2">
        <b className="text-ink">{phase?.label}</b> · {req.reason}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
        <div className="rounded-lg border border-line p-3">
          <div className="text-[12px] text-ink-3">Approved</div>
          <div className="num mt-1 text-lg font-semibold">{fmt(req.from.amount)}</div>
          <div className="text-ink-2">{req.from.payeeName}</div>
          <div className="font-mono text-[10.5px] text-ink-3">{short(req.from.payee)}</div>
        </div>
        <div className="rounded-lg border border-warn bg-warn/10 p-3">
          <div className="text-[12px] text-warn-ink">Requested</div>
          <div className="num mt-1 text-lg font-semibold">{fmt(req.to.amount)}</div>
          <div className={newPayee ? "font-medium" : "text-ink-2"}>
            {req.to.payeeName}
            {newPayee && <span className="ml-1 text-[11px] text-warn-ink">new payee</span>}
          </div>
          <div className="font-mono text-[10.5px] text-ink-3">{short(req.to.payee)}</div>
        </div>
      </div>
      <div className="mt-3 text-[12.5px] text-ink-2">
        For: {req.to.service}. Budget left after this:{" "}
        {BigInt(req.budgetLeft) >= 0n ? <b className="num">{fmt(req.budgetLeft)} USDC</b> : <b className="num">tops up vault by {fmt(-BigInt(req.budgetLeft))} USDC</b>}
      </div>
      <div className="mt-1 text-[12px] text-ink-3">
        This step waits; independent steps keep going. No answer in <Countdown until={req.expiresAt} /> counts as deny.
      </div>
      {editing && (
        <div className="mt-4 rounded-xl border border-line p-3">
          <label htmlFor="reamount" className="text-[12px] text-ink-3">
            Approve a different amount for this step
          </label>
          <div className="ring-agent mt-1 flex items-center gap-2 rounded-lg border border-line px-3">
            <input id="reamount" autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className="num h-10 w-full bg-transparent text-lg font-semibold outline-none" />
            <span className="text-sm text-ink-3">USDC</span>
          </div>
          <div className={`mt-1 text-[11.5px] ${tooLow ? "text-bad" : "text-ink-3"}`}>
            Minimum {fmt(req.minAmount)} (one more request). Lower amounts mean you&apos;ll be asked again sooner.
          </div>
        </div>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => decide("denied")} disabled={busy}>
          Deny
        </Button>
        {editing ? (
          <Button onClick={() => custom != null && decide("approved", custom)} disabled={busy || custom == null || tooLow} data-testid="reapprove-edited" variant="agent">
            Approve {custom != null ? fmt(custom) : "…"}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setEditing(true)} disabled={busy} data-testid="reapprove-edit">
              Edit amount
            </Button>
            <Button onClick={() => decide("approved")} disabled={busy} data-testid="reapprove" variant="agent">
              Approve {fmt(req.to.amount)}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

const ACTION: Record<FailureAction, { label: string; hint: string }> = {
  retry: { label: "Retry", hint: "Same step again. Paid requests aren't paid twice." },
  skip: { label: "Skip", hint: "Optional step. Its cost is released." },
  edit: { label: "Edit", hint: "Change the plan." },
  topup: { label: "Top up vault", hint: "Add USDC to the vault, then retry." },
  cancel: { label: "Cancel job", hint: "Stop here. Unspent funds return to you." },
};

const TITLE: Record<string, string> = {
  seller_402_timeout: "Seller didn't answer",
  payment_rejected: "Payment rejected",
  settle_fails: "Settlement failed",
  insufficient_balance: "Not enough in the vault",
  policy_block: "Change denied",
  price_increase: "Price went up",
  model_error: "Analysis crashed",
  exchange_rejected: "Exchange refused the order",
  approval_timeout: "Approval timed out",
  bad_delivery: "The seller didn't deliver",
  unknown: "Step failed",
};

export function FailureModal({ run, failure, onClose }: { run: Run; failure: Failure; onClose: () => void }) {
  const [busy, setBusy] = useState<FailureAction | null>(null);
  const phase = run.phases.find((p) => p.id === failure.phaseId);
  const line = run.lines.find((l) => l.id === phase?.lineId);
  const act = async (action: FailureAction) => {
    setBusy(action);
    try {
      let txHash: Hex | undefined;
      if (action === "topup" && run.payer === "passkey" && run.mode === "live" && run.vault) {
        toast("Confirm the top-up with your passkey");
        txHash = await sendCalls(topUpCalls("0x3600000000000000000000000000000000000000", run.vault, BigInt(run.cap) / 2n || 1_000_000n));
      }
      await post(`/api/runs/${run.id}/failure`, { failureId: failure.id, action, txHash });
      toast(ACTION[action].label === "Cancel job" ? "Cancelling · unspent funds return to you" : `${ACTION[action].label} · on it`);
    } catch (e) {
      toast((e as Error).message.split("\n")[0].slice(0, 160), "bad");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open onClose={onClose} title={TITLE[failure.code] ?? "Step failed"} tone="bad">
      <p className="text-[13.5px]">
        <b>{phase?.label}</b> <span className="text-ink-2">· {failure.message}</span>
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
        <div className="rounded-lg border border-line p-3">
          <div className="text-[12px] text-ink-3">Charged this attempt</div>
          <Amount value={failure.charged} className="mt-1 block text-lg font-semibold" />
        </div>
        <div className="rounded-lg border border-line p-3">
          <div className="text-[12px] text-ink-3">Not charged</div>
          <Amount value={failure.notCharged} className="mt-1 block text-lg font-semibold" />
        </div>
      </div>
      {failure.refunded && failure.refunded !== "0" && (
        <div className="mt-2 rounded-lg border border-good/30 bg-good/5 p-3 text-[13px]" data-testid="failure-refunded">
          Sent back: <Amount value={failure.refunded} className="font-semibold" /> USDC. It reaches you when the job closes.
        </div>
      )}
      {line && (
        <div className="num mt-2 text-[12px] text-ink-3">
          Step so far: {fmt(line.actual)} of {fmt(line.approved)} USDC to {line.payeeName}
        </div>
      )}
      <div className="mt-5 space-y-2">
        {failure.options.map((a) => (
          <button
            key={a}
            disabled={!!busy}
            onClick={() => act(a)}
            data-testid={`failure-${a}`}
            className={`pressable tap flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors ${
              a === "cancel" ? "border-bad/30 text-bad hover:bg-bad/5" : "border-line hover:bg-surface"
            }`}
          >
            <span className="font-medium">{busy === a ? "Working…" : ACTION[a].label}</span>
            <span className="text-[12px] text-ink-3">{ACTION[a].hint}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function CancelModal({ run, open, onClose }: { run: Run; open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const spent = run.lines.reduce((a, l) => a + BigInt(l.actual), 0n);
  return (
    <Modal open={open} onClose={onClose} title="Cancel job?" tone="bad">
      <div className="grid grid-cols-2 gap-3 text-[13px]">
        <div className="rounded-lg border border-line p-3">
          <div className="text-[12px] text-ink-3">Charged</div>
          <Amount value={spent} className="mt-1 block text-lg font-semibold" />
        </div>
        <div className="rounded-lg border border-line p-3">
          <div className="text-[12px] text-ink-3">Returned to you</div>
          <Amount value={run.status === "draft" ? 0n : BigInt(run.cap) - spent} className="mt-1 block text-lg font-semibold" />
        </div>
      </div>
      <p className="mt-3 text-[12.5px] text-ink-3">The vault closes; pending authorizations become invalid.</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Keep going
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            // Optimistic: the vault closes in the background; the receipt shows the refund.
            onClose();
            toast("Cancelling · unspent funds return to you");
            post(`/api/runs/${run.id}/cancel`).catch((e) => toast(`Cancel failed: ${(e as Error).message}`, "bad"));
          }}
        >
          {busy ? "Closing vault…" : "Cancel job"}
        </Button>
      </div>
    </Modal>
  );
}
