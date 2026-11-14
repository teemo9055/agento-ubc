"use client";
import { fmt, fmtFee } from "@/lib/money";
import { addrUrl, dateTime, time, txUrl } from "@/lib/format";
import { buildReceipt, receiptCsv } from "@/lib/receipt";
import type { Run } from "@/lib/types";
import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "./ui";

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
        className="no-print shrink-0 rounded px-1 text-[10px] text-ink-3 opacity-0 transition-opacity hover:bg-ink/5 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
        aria-label="Copy transaction hash"
      >
        {copied ? "✓" : "copy"}
      </button>
    </span>
  );
}

function Check() {
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
  return (
    <section id="receipt" className="paper relative rounded-2xl border border-line bg-panel p-5 sm:p-8" aria-label="Receipt">
      <div className="perf no-print absolute inset-x-6 -top-[7px] rotate-180" aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className={`flex items-center gap-2 text-[13px] font-medium ${cancelled ? "text-ink-2" : "text-good"}`}>
            {!cancelled && <Check />}
            {cancelled ? "Job cancelled" : "Transaction confirmed"}
          </div>
          <div className="mt-1 text-[12px] text-ink-3">Total paid</div>
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="num text-5xl font-semibold tracking-tight" data-testid="receipt-total">
            {fmt(r.total)}
            <span className="ml-2 text-lg font-normal text-ink-3">USDC</span>
          </motion.div>
          {r.mode === "demo" && <div className="mt-1 text-[12px] text-[#7a5000]">Demo rail: settlement simulated, no onchain transactions.</div>}
        </div>
        <div className="text-right text-[12px] text-ink-3">
          <div className="font-mono">{r.receiptId}</div>
          <div>{dateTime(r.issuedAt)}</div>
          <div className="no-print mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => window.print()}>
              Print / PDF
            </Button>
            <Button variant="ghost" onClick={() => download(`${r.receiptId}.json`, JSON.stringify(r, null, 2), "application/json")}>
              JSON
            </Button>
            <Button variant="ghost" onClick={() => download(`${r.receiptId}.csv`, receiptCsv(r), "text/csv")}>
              CSV
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-agent-soft/70 p-3 text-[13px]">
        <div>
          <div className="text-ink-3">{r.agent.name} delivered</div>
          <div className="font-medium">{r.deliverable.summary}</div>
          <div className="text-[12px] text-ink-3">
            {r.deliverable.method} · task: “{r.task}”
          </div>
        </div>
        {run.deliverable?.contextPack && (
          <Button
            variant="ghost"
            className="no-print"
            onClick={() => download(`context-pack-${r.workOrderId}.json`, JSON.stringify(run.deliverable!.contextPack, null, 2), "application/json")}
          >
            Context pack for your AI IDE ↓
          </Button>
        )}
      </div>

      <h3 className="mt-7 text-[11px] font-medium uppercase tracking-wide text-ink-3">Where your money went</h3>
      <table className="mt-2 w-full text-[12.5px]">
        <thead className="text-left text-[10.5px] uppercase tracking-wide text-ink-3">
          <tr className="border-b border-line">
            <th className="py-2 font-medium">Step · purpose</th>
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
              <td className="hidden py-2 sm:table-cell">{l.rail}</td>
              <td className="num py-2 text-right text-ink-2">{fmt(l.approved)}</td>
              <td className="num py-2 text-right font-medium">{fmt(l.amount)}</td>
            </tr>
          ))}
          {r.lines.length === 0 && (
            <tr>
              <td colSpan={5} className="py-3 text-ink-3">
                Nothing was paid.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <dl className="num ml-auto mt-4 grid max-w-xs grid-cols-2 gap-y-1 text-[13px]">
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
            <div className="text-[11px] uppercase tracking-wide text-ink-3">{k}</div>
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

      <h3 className="mt-7 text-[11px] font-medium uppercase tracking-wide text-ink-3">Approvals and decisions</h3>
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
          <dt className="text-ink-3">Duration</dt>
          <dd className="num">{r.job.durationSec}s</dd>
        </div>
      </dl>
    </section>
  );
}
