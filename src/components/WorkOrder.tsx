"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { fmt, fmtFee, sum } from "@/lib/money";
import { short, addrUrl } from "@/lib/format";
import type { Card, CostLine, Method, Run } from "@/lib/types";
import { Modal } from "./Modal";
import { Amount, Button, Spinner } from "./ui";
import { post } from "./useRun";

const CARD_ORDER: Card["kind"][] = ["price", "deliverable", "method", "risk"];
const CARD_LABEL: Record<Card["kind"], string> = { price: "Price", deliverable: "Deliverable", method: "Method", risk: "Risk" };
const CARD_ICON: Record<Card["kind"], string> = { price: "◎", deliverable: "◇", method: "↯", risk: "△" };

export function Cards({ run, onEdit }: { run: Run; onEdit?: (k: Card["kind"]) => void }) {
  const cards = CARD_ORDER.map((k) => run.cards.find((c) => c.kind === k)).filter(Boolean) as Card[];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c, i) => (
        <motion.button
          key={c.kind}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          whileHover={onEdit ? { y: -2 } : undefined}
          disabled={!onEdit}
          onClick={() => onEdit?.(c.kind)}
          data-testid={`card-${c.kind}`}
          className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition-colors disabled:cursor-default ${
            c.kind === "price" ? "border-agent/30 bg-agent-soft/60" : "border-line bg-panel enabled:hover:border-ink/25"
          }`}
        >
          <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-ink-3">
            <span>
              <span className="mr-1 text-agent">{CARD_ICON[c.kind]}</span>
              {CARD_LABEL[c.kind]}
            </span>
            {onEdit && <span className="rounded-full bg-ink/5 px-2 py-0.5 normal-case tracking-normal opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Edit ✎</span>}
          </div>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={c.title} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="num mt-1.5 text-[16px] font-semibold">
              {c.title}
            </motion.div>
          </AnimatePresence>
          <ul className="mt-2 space-y-1 text-[12.5px] text-ink-2">
            {c.points.map((p) => (
              <li key={p} className="flex gap-1.5">
                <span className="text-ink-3">·</span>
                {p}
              </li>
            ))}
          </ul>
        </motion.button>
      ))}
    </div>
  );
}

const SELLERS: { id: Method["seller"]; name: string; note: string }[] = [
  { id: "primary", name: "Data Feed", note: "Base price · x402" },
  { id: "mirror", name: "Data Mirror", note: "+50% · backup seller" },
];
const ANALYSIS: { id: Method["analysis"]; name: string; note: string }[] = [
  { id: "builtin", name: "Built-in analysis", note: "Free · runs here" },
  { id: "ide", name: "Your AI IDE", note: "0 USDC · uses your subscription" },
];

function Segment<T extends string>({ value, options, onChange, disabled, label }: { value: T; options: { id: T; name: string; note: string }[]; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => !on && onChange(o.id)}
            className="relative rounded-lg px-3 py-2 text-left disabled:cursor-not-allowed"
          >
            {on && <motion.span layoutId={`seg-${label}`} className="absolute inset-0 rounded-lg border border-line bg-panel shadow-sm" transition={{ type: "spring", duration: 0.35 }} />}
            <span className="relative block text-[13px] font-medium">{o.name}</span>
            <span className="relative block text-[11px] text-ink-3">{o.note}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Pick how the work gets done. Changing it re-prices the order. */
export function MethodPicker({ run }: { run: Run }) {
  const [busy, setBusy] = useState(false);
  const set = async (m: Partial<Method>) => {
    setBusy(true);
    try {
      await post(`/api/runs/${run.id}/method`, m);
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || run.status !== "draft";
  return (
    <section className="rounded-2xl border border-line bg-panel p-4" aria-label="How it gets done">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold">How it gets done</h2>
        {busy && (
          <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
            <Spinner /> Repricing
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">Data</div>
          <Segment label="Data seller" value={run.method.seller} options={SELLERS} onChange={(seller) => set({ seller })} disabled={disabled} />
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">Analysis</div>
          <Segment label="Analysis" value={run.method.analysis} options={ANALYSIS} onChange={(analysis) => set({ analysis })} disabled={disabled} />
        </div>
      </div>
    </section>
  );
}

function rowState(run: Run, l: CostLine) {
  const phase = run.phases.find((p) => p.id === l.phaseId);
  if (phase?.status === "skipped") return "skipped";
  if (run.status === "draft" || run.status === "funding") return "planned";
  if (phase?.status === "done" || run.status === "done") return "settled";
  return BigInt(l.actual) > 0n || phase?.status === "active" ? "progress" : "planned";
}

export function CostTable({ run, compact = false }: { run: Run; compact?: boolean }) {
  const approved = sum(run.lines.map((l) => l.approved));
  const actual = sum(run.lines.map((l) => l.actual));
  const live = run.status !== "draft" && run.status !== "funding";
  const pct = approved > 0n ? Number((actual * 1000n) / approved) / 10 : 0;
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel">
      {live && (
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-baseline justify-between text-[12px] text-ink-3">
            <span>Spent vs approved</span>
            <span className="num">
              <span className="font-semibold text-ink">{fmt(actual)}</span> / {fmt(approved)} USDC
            </span>
          </div>
          <div className="mt-2 h-1.5 pix-bar overflow-hidden bg-line">
            <motion.div className="h-full rounded-full bg-agent" animate={{ width: `${Math.min(100, pct)}%` }} transition={{ duration: 0.5 }} />
          </div>
        </div>
      )}
      <table className="w-full text-[13px]">
        <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
          <tr>
            <th className="px-4 py-2.5 font-medium">Step</th>
            <th className="px-2 py-2.5 font-medium">Payee</th>
            {!compact && <th className="hidden px-2 py-2.5 font-medium sm:table-cell">Rail</th>}
            <th className="px-4 py-2.5 text-right font-medium">{live ? "Actual / approved" : "Approved"}</th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false}>
            {run.lines.map((l) => {
              const st = rowState(run, l);
              const diff = BigInt(l.actual) - BigInt(l.approved);
              const sub = l.rail === "subscription";
              return (
                <motion.tr
                  key={l.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={`border-b border-line/70 last:border-0 ${st === "skipped" ? "opacity-50" : ""}`}
                  data-testid={`line-${l.id}`}
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{l.purpose}</div>
                    {l.bigSpend && <span className="mt-0.5 inline-block rounded-md bg-warn/20 px-1.5 py-px text-[10.5px] font-medium text-[#7a5000]">Big spend · approved up front</span>}
                  </td>
                  <td className="px-2 py-2.5 text-ink-2">
                    {l.payeeName}
                    {!sub && (
                      <a href={addrUrl(l.payee)} target="_blank" rel="noreferrer" className="hidden font-mono text-[10.5px] text-ink-3 hover:text-ink sm:block">
                        {short(l.payee)}
                      </a>
                    )}
                  </td>
                  {!compact && <td className="hidden px-2 py-2.5 text-ink-3 sm:table-cell">{sub ? "your subscription" : l.rail}</td>}
                  <td className="num px-4 py-2.5 text-right">
                    {st === "planned" && <span>{fmt(l.approved)}</span>}
                    {st === "progress" && (
                      <span>
                        {fmt(l.actual)} <span className="text-ink-3">/ {fmt(l.approved)}</span>
                      </span>
                    )}
                    {st === "settled" && (
                      <span>
                        {fmt(l.actual)} <span className="block text-[11px] text-ink-3">{diff === 0n ? "on budget" : `${fmt(-diff)} under`}</span>
                      </span>
                    )}
                    {st === "skipped" && (
                      <span>
                        0.00 <span className="block text-[11px] text-ink-3">{fmt(l.approved)} released</span>
                      </span>
                    )}
                  </td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
        <tfoot className="border-t border-line bg-surface/60 text-[12.5px]">
          <tr>
            <td className="px-4 py-2.5 font-medium" colSpan={compact ? 2 : 3}>
              Total
            </td>
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
            <td className="px-4 pb-1" colSpan={compact ? 2 : 3}>
              Network fees, est. (gas in USDC)
            </td>
            <td className="num px-4 pb-1 text-right">~{fmtFee(run.estFees)}</td>
          </tr>
          <tr className="text-ink-3">
            <td className="px-4 pb-2.5" colSpan={compact ? 2 : 3}>
              Vault cap · big-spend threshold {fmt(run.threshold)}
            </td>
            <td className="num px-4 pb-2.5 text-right">{fmt(run.cap)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

interface Preview {
  ok: boolean;
  message: string;
  alternatives?: string[];
  before?: { total: string; lines: { purpose: string; approved: string }[] };
  after?: { total: string; lines: { purpose: string; approved: string }[] };
}

export function EditCardModal({ run, kind, onClose }: { run: Run; kind: Card["kind"] | null; onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<(Preview & { prompt: string }) | null>(null);
  const card = run.cards.find((c) => c.kind === kind);

  async function check(text = prompt) {
    if (!kind || !text.trim()) return;
    setBusy(true);
    try {
      const p = await post<Preview>(`/api/runs/${run.id}/preview`, { card: kind, prompt: text });
      setPreview({ ...p, prompt: text });
      setPrompt(text);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!kind || !preview?.ok) return;
    setBusy(true);
    try {
      await post<Run>(`/api/runs/${run.id}/edit`, { card: kind, prompt: preview.prompt });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const delta = preview?.ok && preview.before && preview.after ? BigInt(preview.after.total) - BigInt(preview.before.total) : 0n;
  return (
    <Modal open={!!kind} onClose={onClose} title={kind ? `Edit ${CARD_LABEL[kind].toLowerCase()}` : ""}>
      {card && (
        <div className="mb-4 rounded-xl border border-line bg-surface p-3 text-[13px]">
          <div className="font-semibold">{card.title}</div>
          <div className="text-ink-2">{card.points.join(" · ")}</div>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (preview?.ok && preview.prompt === prompt) apply();
          else check();
        }}
      >
        <div className="ring-agent flex items-center gap-2 rounded-xl border border-line bg-panel px-3">
          <span className="text-agent">✎</span>
          <input
            autoFocus
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              if (preview && e.target.value !== preview.prompt) setPreview(null);
            }}
            maxLength={200}
            placeholder={kind === "price" ? "e.g. big-spend threshold 0.5" : "Say what to change"}
            className="h-11 w-full bg-transparent text-sm outline-none"
          />
        </div>

        <AnimatePresence mode="wait">
          {preview && !preview.ok && (
            <motion.div key="no" role="alert" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 rounded-xl border border-bad/30 bg-bad/5 p-3 text-[13px]">
              <div className="font-medium text-bad">Can&apos;t do that</div>
              <div className="mt-0.5 text-ink-2">{preview.message}</div>
              {preview.alternatives && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="text-[12px] text-ink-3">Try:</span>
                  {preview.alternatives.map((a) => (
                    <button key={a} type="button" onClick={() => check(a)} className="rounded-full border border-line bg-panel px-2.5 py-1 text-xs transition-colors hover:border-agent">
                      {a}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
          {preview?.ok && preview.before && preview.after && (
            <motion.div key="yes" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 rounded-xl border border-line p-3 text-[13px]" data-testid="edit-preview">
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{preview.message}</span>
                <span className="num">
                  {fmt(preview.before.total)} → <b>{fmt(preview.after.total)}</b>
                  {delta !== 0n && <span className={`ml-1.5 text-[11.5px] ${delta < 0n ? "text-good" : "text-ink-3"}`}>{delta < 0n ? `−${fmt(-delta)}` : `+${fmt(delta)}`}</span>}
                </span>
              </div>
              <ul className="mt-2 space-y-0.5 text-[12px] text-ink-2">
                {preview.after.lines.map((l) => (
                  <li key={l.purpose} className="flex justify-between">
                    <span>{l.purpose}</span>
                    <span className="num">{fmt(l.approved)}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {preview?.ok && preview.prompt === prompt ? (
            <Button type="button" onClick={apply} disabled={busy} className="bg-agent hover:opacity-90" data-testid="apply-edit">
              {busy ? "Applying…" : "Apply change"}
            </Button>
          ) : (
            <Button type="submit" disabled={busy || !prompt.trim()}>
              {busy ? "Checking…" : "Preview"}
            </Button>
          )}
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
      <div className="text-[13px] text-ink-3">Total for this work order</div>
      <Amount value={total} className="text-[44px] font-semibold leading-none tracking-tight" />
      <div className="mt-2 text-[13px] text-ink-2">
        Funds a vault with <b className="num">{fmt(run.cap)} USDC</b>. Unspent funds come back when the job ends. Network fees ~<span className="num">{fmtFee(run.estFees)}</span>.
      </div>

      <ul className="mt-5 divide-y divide-line overflow-hidden rounded-xl border border-line text-[13px]">
        {run.lines.map((l, i) => (
          <motion.li key={l.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span>
              {l.purpose}
              <span className="text-ink-3"> · {l.payeeName}</span>
              {l.bigSpend && <span className="ml-2 rounded-md bg-warn/20 px-1.5 py-0.5 text-[10.5px] font-medium text-[#7a5000]">Big spend</span>}
            </span>
            <span className="num">{fmt(l.approved)}</span>
          </motion.li>
        ))}
      </ul>

      <div className="mt-4 grid gap-2 text-[12.5px] text-ink-2">
        <div className="flex gap-2 rounded-xl bg-surface p-3">
          <span className="text-agent">✓</span>
          <span>
            {big.length ? `${big.length} big spend${big.length > 1 ? "s" : ""} over ${fmt(run.threshold)} USDC approved now. No pause mid-run.` : `No spend over the ${fmt(run.threshold)} USDC threshold.`}
          </span>
        </div>
        <div className="flex gap-2 rounded-xl bg-surface p-3">
          <span className="text-agent">↺</span>
          <span>You&apos;re asked again only if a price, payee or step changes.</span>
        </div>
        <div className="flex gap-2 rounded-xl bg-surface p-3">
          <span className="text-agent">⛨</span>
          <span>
            Vault rule: up to <b className="num">{fmt(total)}</b> across {run.lines.filter((l) => l.rail !== "subscription").length} lines, only to{" "}
            {[...new Set(run.lines.filter((l) => l.rail !== "subscription").map((l) => l.payeeName))].join(", ")}. Enforced onchain.
          </span>
        </div>
        <div className="num flex justify-between rounded-xl border border-dashed border-line px-3 py-2 text-[12px] text-ink-3">
          <span>Your wallet → vault</span>
          <span>
            −{fmt(run.cap)} now · +{fmt(BigInt(run.cap) - total)} or more back at the end
          </span>
        </div>
      </div>

      {err && <p className="mt-3 text-sm text-bad">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Not yet
        </Button>
        <Button onClick={approve} disabled={busy} data-testid="approve" className="bg-agent hover:opacity-90">
          {busy ? (
            <>
              <Spinner /> Funding vault…
            </>
          ) : (
            `Approve & fund ${fmt(run.cap)}`
          )}
        </Button>
      </div>
    </Modal>
  );
}
