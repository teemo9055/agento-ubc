"use client";
import { useNet } from "./NetContext";
import { fmt, fmtFee } from "@/lib/money";
import { addrUrl, dateTime, time, txUrl } from "@/lib/format";
import { buildReceipt, receiptCsv } from "@/lib/receipt";
import type { Run } from "@/lib/types";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "./ui";
import { AgentIcon } from "./AgentIcon";
import { Icon } from "./Icon";
import { Fold } from "./Fold";
import { Point, Points } from "./Points";
import { runOutfit } from "@/lib/summary";

function download(name: string, body: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Hash({ h }: { h?: string }) {
  const net = useNet();
  const [copied, setCopied] = useState(false);
  if (!h) return null;
  return (
    <span className="group flex items-start gap-1">
      <a href={txUrl(h, net)} target="_blank" rel="noreferrer" className="break-all font-mono text-[10.5px] leading-snug text-ink-3 hover:text-ink">
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

/**
 * A Gateway payment's proof, from Circle: its transfer id and status, and once Circle settles its
 * batch on Arc, the transaction that did it, linked on the explorer.
 */
function GatewayProof({ ids, net }: { ids: string; net: "testnet" | "mainnet" }) {
  const [proofs, setProofs] = useState<{ id: string; status: string; txHash: string | null }[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/gateway/transfers?ids=${encodeURIComponent(ids)}&net=${net}`)
      .then((r) => r.json())
      .then((d) => live && setProofs(d.transfers ?? []))
      .catch(() => live && setProofs([]));
    return () => {
      live = false;
    };
  }, [ids, net]);
  const list = proofs ?? ids.split(",").map((id) => ({ id, status: "…", txHash: null }));
  return (
    <div className="mt-1 grid gap-0.5" data-testid="gateway-proof">
      {list.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-ink-3">
          <span>Circle transfer</span>
          <span className="font-mono">{p.id.slice(0, 8)}</span>
          <span className={`rounded px-1 font-medium ${p.txHash ? "bg-good/10 text-good" : "bg-[#f1f0ec] text-ink-2"}`}>{p.txHash ? "settled on Arc" : p.status === "…" ? "checking" : `${p.status}, waiting for Circle's batch`}</span>
          {p.txHash && (
            <a href={txUrl(p.txHash, net)} target="_blank" rel="noreferrer" className="font-mono underline decoration-line">
              {p.txHash.slice(0, 10)}…
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Where each part of the job can be checked outside this app. Not everything is an Arc transaction:
 * marketplace lookups are Gateway nanopayments Circle settles in batches, and orders live on Gemini.
 */
function CheckIt({ run, vendorsPaid }: { run: Run; vendorsPaid: boolean }) {
  const net = run.network ?? "testnet";
  const tiles: { key: string; label: string; title: string; body: string; href?: string; link?: string }[] = [];
  if (run.mode === "demo") tiles.push({ key: "arc", label: "Arc", title: "Nothing on Arc", body: "This job ran in practice mode: its vault was simulated, so there's no Arc transaction to find." });
  else if (run.vault) tiles.push({ key: "arc", label: `Arc ${net}`, title: "The job's vault", body: "Opening, each payment from it, and the refund when it closed are transactions on this address.", href: addrUrl(run.vault, net), link: "Open on the Arc explorer" });
  if (vendorsPaid)
    tiles.push({ key: "gw", label: "Circle Gateway", title: "Marketplace lookups", body: "Paid from the app's Gateway balance, not your wallet. Each lookup below shows its Circle transfer id and status, and the Arc transaction once Circle settles its batch." });
  const o = run.order;
  if (o && o.venue !== "paper")
    tiles.push({ key: "gem", label: o.venue === "gemini" ? "Gemini prediction market" : "Gemini prediction market · test", title: "Your prediction order", body: `${o.orderId ? `Order ${o.orderId}${o.symbol ? ` on ${o.symbol}` : ""}: ` : ""}placed with Gemini's prediction-market API. It's under Predictions in the Gemini account, not on Arc.`, href: o.venue === "gemini" ? "https://exchange.gemini.com/predictions" : "https://exchange.sandbox.gemini.com/predictions", link: "Open Predictions" });
  else if (o) tiles.push({ key: "gem", label: "Gemini", title: "Practice order", body: "Priced from Gemini's live market but never sent, so there's no order to find on Gemini." });
  if (!tiles.length) return null;
  return (
    <div className="mt-5" data-testid="check-it">
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">Check it yourself</div>
      <div className="mt-2 grid gap-2.5 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.key} className="rounded-xl border-[1.5px] border-ink bg-panel p-3 shadow-[2px_2px_0_0_var(--agent)]">
            <span className="text-[12px] font-semibold text-agent-ink">{t.label}</span>
            <div className="mt-1.5 text-[13.5px] font-semibold">{t.title}</div>
            <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{t.body}</p>
            {t.href && (
              <a href={t.href} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium underline decoration-line underline-offset-2 hover:text-ink">
                {t.link} <Icon name="external" size={11} />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReceiptView({ run }: { run: Run }) {
  const net = useNet();
  const r = buildReceipt(run);
  const cancelled = r.status === "cancelled";
  // Outside vendors can't be simulated: even in practice mode they are paid from the agent's testnet balance.
  const vendorsPaid = r.lines.some((l) => l.rail === "gateway" && BigInt(l.amount) > 0n);
  // Sample services (tests and the compose demo) answer from recordings: nothing was paid to anyone.
  const samples = JSON.stringify(r.lines).includes("(sample)");
  // Marketplace lookups are paid from the app's Gateway balance, not your wallet: say whose, with the address.
  const appPaid = r.lines.length > 0 && r.lines.every((l) => l.rail === "gateway") ? r.lines.find((l) => l.payer)?.payer : undefined;
  return (
    <section id="receipt" className="paper relative rounded-[22px] border-[1.5px] border-ink bg-panel p-5 shadow-[6px_6px_0_0_var(--agent)] sm:p-8" aria-label="Receipt">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <AgentIcon agent={run.agent} size={30} outfit={runOutfit(run)} mood={cancelled ? "sad" : "happy"} />
          <span className="font-pixel text-[13px] text-agent-ink">RECEIPT</span>
        </div>
        <span className={`inline-flex h-[24px] items-center gap-1 rounded-md px-2 text-[12px] font-bold ${cancelled ? "bg-[#f1f0ec] text-ink-2" : r.mode === "demo" ? "bg-warn/20 text-warn-ink" : "bg-good/10 text-good"}`}>
          {cancelled ? "Job cancelled" : r.mode === "demo" ? (samples ? "Practice · no money moved" : vendorsPaid ? "Practice vault · vendors paid on testnet" : "Practice · not a real payment") : "PAID"}
        </span>
      </div>
      <div className="mt-4 text-[14px] text-ink-2">“{r.task}”</div>
      <div className="mt-4 num text-[44px] font-bold leading-none tracking-tight" data-testid="receipt-total">
        {fmt(r.total)}
        <span className="ml-2 text-lg font-normal text-ink-3">USDC</span>
      </div>
      <div className="mt-1.5 text-[13.5px] text-ink-3">
        {BigInt(r.budget.returned) > 0n ? `${fmt(r.budget.returned)} USDC came back to you` : "Nothing left to return"}
      </div>

      {/* Just what was paid for: one line each. The full table is in the details. */}
      {r.lines.length > 0 && (
        <ul className="mt-5" aria-label="What was paid for">
          {r.lines.map((l, i) => (
            <li key={i} className="flex min-h-11 items-center justify-between gap-3 border-t border-[#ebe8e0] text-[14.5px]">
              <span className="min-w-0 truncate">{l.step}</span>
              <span className="num shrink-0 font-semibold">{fmt(l.amount)}</span>
            </li>
          ))}
        </ul>
      )}

      {(r.budget.fundingTx || r.budget.refundTx) && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2" data-testid="arc-txs">
          {r.budget.fundingTx && (
            <a href={txUrl(r.budget.fundingTx, net)} target="_blank" rel="noreferrer" className="flex min-h-[52px] items-center justify-between gap-3 rounded-xl bg-[#f7f6f2] px-4 hover:bg-agent-soft">
              <span className="flex flex-col">
                <span className="text-[14px] font-semibold">You paid · see it on Arc</span>
                <span className="font-mono text-[12px] text-ink-3">{r.budget.fundingTx.slice(0, 6)}…{r.budget.fundingTx.slice(-4)}</span>
              </span>
              <Icon name="external" size={14} />
            </a>
          )}
          {r.budget.refundTx && (
            <a href={txUrl(r.budget.refundTx, net)} target="_blank" rel="noreferrer" className="flex min-h-[52px] items-center justify-between gap-3 rounded-xl bg-[#f7f6f2] px-4 hover:bg-agent-soft">
              <span className="flex flex-col">
                <span className="text-[14px] font-semibold">Came back · see it on Arc</span>
                <span className="font-mono text-[12px] text-ink-3">{r.budget.refundTx.slice(0, 6)}…{r.budget.refundTx.slice(-4)}</span>
              </span>
              <Icon name="external" size={14} />
            </a>
          )}
        </div>
      )}

      <div className="mt-5">
      <Fold title="Details for the record" sub="Who paid whom, Circle's proof, the approval trail and downloads" testId="receipt-details">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="text-[12.5px]">
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
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">{appPaid ? "Paid from" : "Billed to"}</div>
          <div className="mt-1">{appPaid ? "The app's Circle Gateway balance" : "Your wallet"}</div>
          {appPaid ? (
            <a href={addrUrl(appPaid, run.network)} target="_blank" rel="noreferrer" className="break-all font-mono text-[10.5px] text-ink-3 underline decoration-line">
              {appPaid}
            </a>
          ) : (
            <div className="break-all font-mono text-[10.5px] text-ink-3">{r.client.wallet}</div>
          )}
        </div>
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">Work done by</div>
          <div className="mt-1">{r.agent.name}, an agento agent</div>
          <div className="break-all font-mono text-[10.5px] text-ink-3">{r.agent.wallet}</div>
        </div>
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">Paid with</div>
          <div className="mt-1">USDC on {r.chain.name}</div>
          <div className="text-ink-3">{r.mode === "demo" ? (samples ? "Practice mode with sample services: recorded answers, no money moved" : vendorsPaid ? "Practice mode: the vault is simulated; marketplace vendors were paid for real through Circle Gateway" : "Practice mode: nothing settled onchain") : "Pay-per-request (x402) from a spend-limited vault"}</div>
        </div>
      </div>

      <CheckIt run={run} vendorsPaid={vendorsPaid} />

      <div className="mt-5 rounded-xl bg-agent-soft/70 p-3 text-[13px]">
        <div className="text-[12px] text-ink-3">For</div>
        <div className="font-medium">“{r.task}”</div>
        <div className="mt-1.5 text-ink-2">{r.deliverable.summary}</div>
        {run.deliverable?.notes && run.deliverable.notes.length > 0 && (
          <Points as="ul" min={220} className="mt-2">
            {run.deliverable.notes.map((n) => (
              <Point key={n} as="li" size="sm" tone="agent">
                <span className="text-ink-2">{n}</span>
              </Point>
            ))}
          </Points>
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
            <th className="whitespace-nowrap py-2 pl-4 text-right font-medium">Approved</th>
            <th className="whitespace-nowrap py-2 pl-4 text-right font-medium">Paid</th>
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
                {l.transfer && <GatewayProof ids={l.transfer} net={run.network ?? "testnet"} />}
              </td>
              <td className="py-2 pr-2">
                {l.payeeName}
                <a href={addrUrl(l.payee, net)} className="block break-all font-mono text-[10.5px] text-ink-3">
                  {l.payee}
                </a>
              </td>
              <td className="hidden py-2 sm:table-cell">{l.rail === "gateway" ? "Gateway nanopayment" : l.rail === "x402" ? "x402 from vault" : l.rail}</td>
              <td className="num whitespace-nowrap py-2 pl-4 text-right text-ink-2">{fmt(l.approved)}</td>
              <td className="num whitespace-nowrap py-2 pl-4 text-right font-medium">{fmt(l.amount)}</td>
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
      </Fold>
      </div>
    </section>
  );
}
