"use client";
import { useState } from "react";
import { fmt, sum } from "@/lib/money";
import { short, addrUrl } from "@/lib/format";
import type { Card, CostLine, Run } from "@/lib/types";
import { Modal } from "./Modal";
import { Amount, Button } from "./ui";
import { post } from "./useRun";

const CARD_ORDER: Card["kind"][] = ["price", "deliverable", "method", "risk"];
const CARD_LABEL: Record<Card["kind"], string> = { price: "Price", deliverable: "Deliverable", method: "Method", risk: "Risk" };

export function Cards({ run, onEdit }: { run: Run; onEdit?: (k: Card["kind"]) => void }) {
  const cards = CARD_ORDER.map((k) => run.cards.find((c) => c.kind === k)).filter(Boolean) as Card[];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <button
          key={c.kind}
          disabled={!onEdit}
          onClick={() => onEdit?.(c.kind)}
          data-testid={`card-${c.kind}`}
          className="group rounded-xl border border-line bg-panel p-4 text-left transition-colors enabled:hover:border-ink/30 disabled:cursor-default"
        >
          <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-ink-3">
            {CARD_LABEL[c.kind]}
            {onEdit && <span className="opacity-0 transition-opacity group-hover:opacity-100">Edit</span>}
          </div>
          <div className="num mt-1.5 text-[15px] font-semibold">{c.title}</div>
          <ul className="mt-2 space-y-1 text-[12.5px] text-ink-2">
            {c.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </button>
      ))}
    </div>
  );
}

function rowState(run: Run, l: CostLine) {
  const phase = run.phases.find((p) => p.id === l.phaseId);
  if (phase?.status === "skipped") return "skipped";
  if (run.status === "draft" || run.status === "funding") return "planned";
  if (phase?.status === "done" || run.status === "done") return "settled";
  return BigInt(l.actual) > 0n || phase?.status === "active" ? "progress" : "planned";
}

export function CostTable({ run }: { run: Run }) {
  const approved = sum(run.lines.map((l) => l.approved));
  const actual = sum(run.lines.map((l) => l.actual));
  const live = run.status !== "draft" && run.status !== "funding";
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <table className="w-full text-[13px]">
        <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
          <tr>
            <th className="px-4 py-2.5 font-medium">Step</th>
            <th className="px-2 py-2.5 font-medium">Payee</th>
            <th className="hidden px-2 py-2.5 font-medium sm:table-cell">Rail</th>
            <th className="px-4 py-2.5 text-right font-medium">{live ? "Actual / approved" : "Approved"}</th>
          </tr>
        </thead>
        <tbody>
          {run.lines.map((l) => {
            const st = rowState(run, l);
            const diff = BigInt(l.actual) - BigInt(l.approved);
            return (
              <tr key={l.id} className="border-b border-line/70 last:border-0" data-testid={`line-${l.id}`}>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{l.purpose}</div>
                  {l.bigSpend && (
                    <span className="mt-0.5 inline-block rounded border border-ink/20 px-1 text-[10px] font-medium text-ink-2">Big spend · approved up front</span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-ink-2">
                  {l.payeeName}
                  <a href={addrUrl(l.payee)} target="_blank" rel="noreferrer" className="block font-mono text-[10.5px] text-ink-3 hover:text-ink">
                    {short(l.payee)}
                  </a>
                </td>
                <td className="hidden px-2 py-2.5 text-ink-3 sm:table-cell">{l.rail === "subscription" ? "your subscription" : l.rail}</td>
                <td className="num px-4 py-2.5 text-right">
                  {st === "planned" && <span>{fmt(l.approved)}</span>}
                  {st === "progress" && (
                    <span>
                      {fmt(l.actual)} <span className="text-ink-3">/ {fmt(l.approved)}</span>
                    </span>
                  )}
                  {st === "settled" && (
                    <span>
                      {fmt(l.actual)} <span className="text-[11px] text-ink-3">{diff === 0n ? "on budget" : `${fmt(-diff)} under`}</span>
                    </span>
                  )}
                  {st === "skipped" && (
                    <span>
                      0.00 <span className="text-[11px] text-ink-3">{fmt(l.approved) === "0.00" ? "released" : `${fmt(l.approved)} released`}</span>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t border-line bg-surface/60 text-[12.5px]">
          <tr>
            <td className="px-4 py-2.5 font-medium" colSpan={2}>
              Total
            </td>
            <td className="hidden sm:table-cell" />
            <td className="num px-4 py-2.5 text-right font-semibold">
              {live ? (
                <>
                  {fmt(actual)} <span className="font-normal text-ink-3">/ {fmt(approved)}</span>
                </>
              ) : (
                fmt(approved)
              )}
            </td>
          </tr>
          <tr className="text-ink-3">
            <td className="px-4 pb-2.5" colSpan={2}>
              Vault cap (incl. buffer) · big-spend threshold {fmt(run.threshold)}
            </td>
            <td className="hidden sm:table-cell" />
            <td className="num px-4 pb-2.5 text-right">{fmt(run.cap)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function EditCardModal({ run, kind, onClose }: { run: Run; kind: Card["kind"] | null; onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const card = run.cards.find((c) => c.kind === kind);
  const close = () => {
    setTried(false);
    onClose();
  };

  async function apply(text = prompt) {
    if (!kind || !text.trim()) return;
    setBusy(true);
    try {
      const next = await post<Run>(`/api/runs/${run.id}/edit`, { card: kind, prompt: text });
      setPrompt("");
      setTried(true);
      if (next.editNote?.ok) close();
    } finally {
      setBusy(false);
    }
  }

  const note = tried ? run.editNote : undefined;
  return (
    <Modal open={!!kind} onClose={close} title={kind ? `Edit ${CARD_LABEL[kind].toLowerCase()}` : ""}>
      {card && (
        <div className="mb-4 rounded-lg border border-line bg-surface p-3 text-[13px]">
          <div className="font-semibold">{card.title}</div>
          <div className="text-ink-2">{card.points.join(" · ")}</div>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <input
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={200}
          placeholder={kind === "price" ? "e.g. big-spend threshold 0.5" : "Say what to change"}
          className="w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-sm outline-none focus:border-ink/40"
        />
        {note && !note.ok && (
          <div role="alert" className="mt-4 rounded-lg border border-bad/30 bg-bad/5 p-3 text-[13px]">
            <div className="font-medium text-bad">Can&apos;t do that</div>
            <div className="mt-0.5 text-ink-2">{note.message}</div>
            {note.alternatives && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {note.alternatives.map((a) => (
                  <button key={a} type="button" onClick={() => apply(a)} className="rounded-full border border-line bg-panel px-2.5 py-1 text-xs hover:bg-surface">
                    {a}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !prompt.trim()}>
            {busy ? "Repricing…" : "Apply"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ApproveModal({ run, open, onClose }: { run: Run; open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const total = sum(run.lines.map((l) => l.approved));
  const big = run.lines.filter((l) => l.bigSpend);

  async function approve() {
    setBusy(true);
    setErr("");
    try {
      await post(`/api/runs/${run.id}/approve`);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Approve plan" width={520}>
      <div className="text-[13px] text-ink-3">Total</div>
      <Amount value={total} className="text-4xl font-semibold tracking-tight" />
      <div className="mt-1 text-[13px] text-ink-2">
        Vault funded with <b className="num">{fmt(run.cap)} USDC</b>. Unspent funds return when the job ends.
      </div>

      <ul className="mt-5 divide-y divide-line rounded-lg border border-line text-[13px]">
        {run.lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <span>
              {l.purpose}
              <span className="text-ink-3"> · {l.payeeName}</span>
              {l.bigSpend && <span className="ml-2 rounded bg-warn/20 px-1.5 py-0.5 text-[10.5px] font-medium text-[#7a5000]">Big spend</span>}
            </span>
            <span className="num">{fmt(l.approved)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-lg bg-surface p-3 text-[12.5px] text-ink-2">
        <div>
          Big-spend threshold <b className="num">{fmt(run.threshold)} USDC</b>. {big.length ? `${big.length} big spend${big.length > 1 ? "s" : ""} approved with this plan, no pause mid-run.` : "No big spends."}
        </div>
        <div className="mt-1">You&apos;re asked again only if a price, payee or step changes.</div>
      </div>

      {err && <p className="mt-3 text-sm text-bad">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Not yet
        </Button>
        <Button onClick={approve} disabled={busy} data-testid="approve">
          {busy ? "Funding vault…" : `Approve & fund ${fmt(run.cap)}`}
        </Button>
      </div>
    </Modal>
  );
}
