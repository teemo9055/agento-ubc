"use client";
import { fmt, fmtFee } from "@/lib/money";
import { addrUrl, dateTime, time, txUrl } from "@/lib/format";
import { buildReceipt, receiptCsv } from "@/lib/receipt";
import type { Run } from "@/lib/types";
import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "./ui";
import { AgentIcon } from "./AgentIcon";
import { Icon } from "./Icon";
import { runOutfit } from "@/lib/summary";

function download(name: string, body: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Hash({ h }: { h?: string }) {
  const [copied, setCopied] = useState(false);
  if (!h) return null;
  return (
    <span className="group flex items-start gap-1">
      <a href={txUrl(h)} target="_blank" rel="noreferrer" className="break-all font-mono text-[10.5px] leading-snug text-ink-3 hover:text-ink">
        {h}
      </a>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(h);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="reveal hit no-print shrink-0 rounded px-1 text-[10px] text-ink-3 opacity-0 transition-opacity hover:bg-ink/5 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
        aria-label="Copy transaction hash"
      >
        {copied ? (
          <motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 18 }} className="inline-block font-semibold text-good">
            Copied
          </motion.span>
        ) : (
          "Copy"
        )}
      </button>
    </span>
  );
}

export function Check() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="text-good">
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.12" />
      <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="draw" />
    </svg>
  );
}

export function ReceiptView({ run }: { run: Run }) {
  const r = buildReceipt(run);
  const cancelled = r.status === "cancelled";
  // Outside vendors can't be simulated: even in practice mode they are paid from the agent's testnet balance.
  const vendorsPaid = r.lines.some((l) => l.rail === "gateway" && BigInt(l.amount) > 0n);
  return (
    <section id="receipt" className="paper relative rounded-2xl border border-line bg-panel p-5 sm:p-8" aria-label="Receipt">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="flex items-center gap-2">
            <AgentIcon agent={run.agent} size={30} outfit={runOutfit(run)} mood={cancelled ? "sad" : "happy"} />
            <span className="text-[20px] font-semibold tracking-tight">Receipt</span>
            <span className={`inline-flex h-[22px] items-center gap-1 rounded-md px-2 text-[12px] font-semibold ${cancelled ? "bg-[#f1f0ec] text-ink-2" : r.mode === "demo" ? "bg-warn/20 text-warn-ink" : "bg-good/10 text-good"}`}>
              {cancelled ? "Job cancelled" : r.mode === "demo" ? (vendorsPaid ? "Practice vault · vendors paid on testnet" : "Practice · not a real payment") : "Paid"}
            </span>
          </div>
          <div className="mt-3 text-[12px] text-ink-3">Total paid</div>
          <div className="num text-[40px] font-semibold leading-none tracking-tight" data-testid="receipt-total">
            {fmt(r.total)}
            <span className="ml-2 text-lg font-normal text-ink-3">USDC</span>
          </div>
        </div>
        <div className="text-right text-[12.5px]">
          <dl className="grid grid-cols-[auto_auto] justify-end gap-x-3 gap-y-0.5">
            <dt className="text-ink-3">Receipt no.</dt>
            <dd className="font-mono">{r.receiptId}</dd>
            <dt className="text-ink-3">Issued</dt>
            <dd>{dateTime(r.issuedAt)}</dd>
            <dt className="text-ink-3">Job</dt>
            <dd className="font-mono">{r.workOrderId}</dd>
          </dl>
          <div className="no-print mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" className="h-9" onClick={() => window.print()}>
              Print / PDF
            </Button>
            <Button variant="ghost" className="h-9" onClick={() => download(`${r.receiptId}.csv`, receiptCsv(r), "text/csv")}>
              CSV
            </Button>
            <Button variant="ghost" className="h-9" onClick={() => download(`${r.receiptId}.json`, JSON.stringify(r, null, 2), "application/json")}>
              JSON
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 text-[12.5px] sm:grid-cols-3">
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">Billed to</div>
          <div className="mt-1">Your wallet</div>
          <div className="break-all font-mono text-[10.5px] text-ink-3">{r.client.wallet}</div>
        </div>
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">Work done by</div>
          <div className="mt-1">{r.agent.name}, an agento agent</div>
          <div className="break-all font-mono text-[10.5px] text-ink-3">{r.agent.wallet}</div>
        </div>
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">Paid with</div>
          <div className="mt-1">USDC on {r.chain.name}</div>
          <div className="text-ink-3">{r.mode === "demo" ? (vendorsPaid ? "Practice mode: the vault is simulated; marketplace vendors were paid for real through Circle Gateway" : "Practice mode: nothing settled onchain") : "Pay-per-request (x402) from a spend-limited vault"}</div>
        </div>
      </div>

      <div className="mt-5 rounded-xl bg-agent-soft/70 p-3 text-[13px]">
        <div className="text-[12px] text-ink-3">For</div>
        <div className="font-medium">“{r.task}”</div>
        <div className="mt-1.5 text-ink-2">{r.deliverable.summary}</div>
        {run.deliverable?.notes && run.deliverable.notes.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12.5px] text-ink-2">
            {run.deliverable.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>

      {r.order && (
        <>
          <h3 className="mt-7 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Exchange order</h3>
          <div className="row mt-2 rounded-lg border border-line p-3 text-[12.5px]">
            <div className="font-medium">{r.order.record.detail}</div>
            <div className="num mt-0.5 text-ink-2">
              {r.order.record.venue === "gemini" ? "Gemini" : "Gemini test exchange"} · order #{r.order.record.orderId} · {r.order.status}
              {r.order.filled != null && r.order.record.quantity != null ? ` · ${r.order.filled} of ${r.order.record.quantity} filled` : ""}
            </div>
            <div className="mt-1 text-[11.5px] text-ink-3">Paid on the exchange, not from the vault, so it isn&apos;t in the total above.</div>
            {r.order.anchorTx && (
              <div className="mt-1 text-[11.5px] text-ink-3">
                Order fingerprint on Arc: <Hash h={r.order.anchorTx} />
              </div>
            )}
          </div>
        </>
      )}

      <h3 className="mt-7 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Items</h3>
      <table className="mt-2 w-full text-[12.5px]">
        <thead className="text-left text-[12px] text-ink-3">
          <tr className="border-b border-line">
            <th className="py-2 font-medium">Description</th>
            <th className="py-2 font-medium">Payee</th>
            <th className="hidden py-2 font-medium sm:table-cell">Rail</th>
            <th className="py-2 text-right font-medium">Approved</th>
            <th className="py-2 text-right font-medium">Paid</th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l, i) => (
            <tr key={i} className="row border-b border-line/70 align-top">
              <td className="py-2 pr-2">
                <div className="font-medium">{l.step}</div>
                <div className="text-ink-3">
                  {l.service} · {time(l.time)}
                </div>
                <Hash h={l.tx} />
              </td>
              <td className="py-2 pr-2">
                {l.payeeName}
                <a href={addrUrl(l.payee)} className="block break-all font-mono text-[10.5px] text-ink-3">
                  {l.payee}
                </a>
              </td>
              <td className="hidden py-2 sm:table-cell">{l.rail === "gateway" ? "Gateway nanopayment" : l.rail === "x402" ? "x402 from vault" : l.rail}</td>
              <td className="num py-2 text-right text-ink-2">{fmt(l.approved)}</td>
              <td className="num py-2 text-right font-medium">{fmt(l.amount)}</td>
            </tr>
          ))}
          {r.lines.length === 0 && (
            <tr>
              <td colSpan={5} className="py-3 text-ink-3">
                No paid data or services were used.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <dl className="num ml-auto mt-4 grid w-full max-w-xs grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-ink-3">Subtotal</dt>
        <dd className="text-right">{fmt(r.subtotal)}</dd>
        <dt className="text-ink-3">Network fees (agent gas)</dt>
        <dd className="text-right">{r.mode === "live" ? fmtFee(r.networkFees) : "—"}</dd>
        <dt className="font-semibold">Total paid</dt>
        <dd className="text-right font-semibold">{fmt(r.total)} USDC</dd>
      </dl>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          ["Approved", r.budget.approved],
          ["Spent", r.budget.spent],
          ["Returned to you", r.budget.returned],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line p-3">
            <div className="text-[12px] text-ink-3">{k}</div>
            <div className="num text-lg font-semibold">{fmt(v)}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 space-y-1 text-[11.5px] text-ink-3">
        {r.budget.fundingTx && (
          <div>
            Funding (vault cap {fmt(r.budget.cap)}): <Hash h={r.budget.fundingTx} />
          </div>
        )}
        {r.budget.refundTx && (
          <div>
            Refund: <Hash h={r.budget.refundTx} />
          </div>
        )}
      </div>

      <h3 className="mt-7 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Approval trail</h3>
      <ol className="mt-2 space-y-1.5 text-[12.5px]">
        {r.decisions.map((d) => (
          <li key={d.id} className="row flex flex-wrap gap-x-2">
            <span className="num text-ink-3">{time(d.at)}</span>
            <span className="font-medium">{d.what}</span>
            <span className="text-ink-2">
              · {d.outcome.replace("_", " ")} by {d.by}
            </span>
            {d.amount && <span className="num text-ink-3">· {d.previousAmount ? `${fmt(d.previousAmount)} → ` : ""}{fmt(d.amount)} USDC</span>}
            {d.why && <span className="w-full pl-[4.2rem] text-[11.5px] text-ink-3">{d.why}</span>}
          </li>
        ))}
      </ol>
      <div className="mt-3 text-[12px] text-ink-3">
        Policy: {r.policy.spendsOnPlan} spends on plan · {r.policy.bigSpendsPreApproved} big spends pre-approved · {r.policy.reapprovals} re-approvals · {r.policy.offPlanBlocked} blocked ·
        threshold {fmt(r.policy.threshold)} USDC
      </div>

      <dl className="mt-7 grid gap-x-6 gap-y-1 border-t border-line pt-4 text-[12px] sm:grid-cols-2">
        {[
          ["Client wallet", r.client.wallet],
          ["Agent wallet", r.agent.wallet],
          ["Work-order vault", r.vault ?? "—"],
          ["Plan hash", r.planHash ?? "—"],
        ].map(([k, v]) => (
          <div key={k} className="row">
            <dt className="text-ink-3">{k}</dt>
            <dd className="break-all font-mono text-[11px]">{v}</dd>
          </div>
        ))}
        <div>
          <dt className="text-ink-3">Chain</dt>
          <dd>
            {r.chain.name} · chain ID {r.chain.chainId} · {r.chain.asset}
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">AI</dt>
          <dd className="num">
            {run.ai ? `${run.ai.model} · ${run.ai.calls} calls · ${(run.ai.promptTokens + run.ai.completionTokens).toLocaleString()} tokens` : "Rule-based planner, no model calls"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Duration</dt>
          <dd className="num">{r.job.durationSec}s</dd>
        </div>
      </dl>
      <p className="mt-5 text-[11.5px] leading-relaxed text-ink-3">
        Amounts are in USDC. Built from this job&apos;s event log{r.mode === "live" ? "; every payment can be checked on the Arc explorer with the transaction hashes above" : ""}. Keep the CSV or JSON for your books.
      </p>
    </section>
  );
}
