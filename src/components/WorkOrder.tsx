"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { fmt, fmtFee, sum } from "@/lib/money";
import { short, addrUrl } from "@/lib/format";
import { offVault, paidInUsdc, type Card, type CostLine, type Run } from "@/lib/types";
import { Modal } from "./Modal";
import { Amount, Button, Spinner } from "./ui";
import { post } from "./useRun";
import { toast } from "./Toaster";
import { AgentIcon } from "./AgentIcon";
import { Icon } from "./Icon";
import { WalletPanel } from "./passkey/WalletPanel";
import { usePasskeyWallet } from "./passkey/usePasskey";
import { fundCalls, sendCalls } from "./passkey/wallet";
import type { Hex } from "viem";

// Read left to right like the job itself: what you get, how it's done, its limits, what it costs.
const CARD_ORDER: Card["kind"][] = ["deliverable", "method", "risk", "price"];
const CARD_LABEL: Record<Card["kind"], string> = { price: "Price", deliverable: "Deliverable", method: "Method", risk: "Risk" };
const CARD_STEP: Record<Card["kind"], string> = { deliverable: "What you get", method: "How", risk: "Limits", price: "Cost" };

/**
 * The plan's four cards as a step-by-step row. Hover (or keyboard focus) widens a card and shows all its points;
 * clicking hands it to the chat and keeps it open. Phones stack the row and expand the tapped card.
 */
export function Cards({ run, onEdit, focused }: { run: Run; onEdit?: (k: Card["kind"]) => void; focused?: Card["kind"] | null }) {
  const cards = CARD_ORDER.map((k) => run.cards.find((c) => c.kind === k)).filter(Boolean) as Card[];
  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:gap-2.5" aria-label="Plan cards">
      {cards.map((c, i) => {
        const on = focused === c.kind;
        const dim = Boolean(focused) && !on;
        const price = c.kind === "price";
        return (
          <motion.li
            key={c.kind}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
            className={`group/card relative min-w-0 transition-[flex-grow,opacity] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] sm:flex-1 sm:basis-0 ${
              on ? "sm:grow-[2.2]" : ""
            } ${dim ? "opacity-60 hover:opacity-100" : ""} ${on ? "" : "sm:h-[208px] sm:hover:z-20 sm:focus-within:z-20"}`}
          >
            {/* Step marker and the rail that joins the cards. */}
            <div className="mb-2 flex items-center gap-2" aria-hidden>
              <span
                className={`num inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] text-[11px] font-semibold ${
                  on ? "border-[1.5px] border-ink bg-agent text-agent-on" : price ? "bg-agent text-agent-on" : "border-[1.5px] border-[#d5d4ce] bg-panel text-ink-2"
                }`}
              >
                {i + 1}
              </span>
              <span className="whitespace-nowrap text-[12px] font-semibold uppercase tracking-wide text-ink-3">{CARD_STEP[c.kind]}</span>
              {i < cards.length - 1 && <span className="hidden h-px flex-1 border-t border-dashed border-[#c9c8c2] sm:block" />}
            </div>
            <button
              type="button"
              disabled={!onEdit}
              onClick={() => onEdit?.(c.kind)}
              aria-pressed={onEdit ? on : undefined}
              aria-expanded={on}
              aria-label={onEdit ? `${CARD_LABEL[c.kind]}: ${c.title}. Edit in chat` : undefined}
              data-testid={`card-${c.kind}`}
              className={`pressable flex w-full flex-col overflow-hidden rounded-2xl p-4 text-left transition-[border-color,box-shadow] duration-200 disabled:cursor-default ${
                on ? "relative sm:h-full" : "relative sm:absolute sm:inset-x-0 sm:top-[30px] sm:min-h-[178px] sm:group-hover/card:shadow-[0_12px_28px_-12px_rgb(11_11_11/0.28)] sm:group-focus-within/card:shadow-[0_12px_28px_-12px_rgb(11_11_11/0.28)]"
              } ${
                on
                  ? "border-[1.5px] border-ink shadow-[3px_3px_0_0_var(--agent)]"
                  : `border ${onEdit ? "enabled:hover:border-ink" : ""}`
              } ${price ? "border-agent/30 bg-agent-soft" : "border-line bg-panel"} ${on ? "!border-ink" : ""}`}
            >
              {/* A short wash of the agent colour when the card's content changes (an applied edit). */}
              <AnimatePresence initial={false}>
                <motion.span
                  key={`${c.title}|${c.points.join("|")}`}
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-2xl bg-agent/25"
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.9, ease: "easeOut" }}
                />
              </AnimatePresence>
              <span className="relative flex items-start justify-between gap-2">
                <span className={`text-[12px] font-semibold ${price ? "text-agent-ink" : "text-ink-3"}`}>{CARD_LABEL[c.kind]}</span>
                {onEdit &&
                  (on ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      <Icon name="chat" size={11} /> In chat
                    </span>
                  ) : (
                    <span className="reveal inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-ink-2 opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100">
                      <Icon name="edit" size={12} /> Edit
                    </span>
                  ))}
              </span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={c.title}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className={`num mt-1 block font-semibold leading-snug ${price ? "text-[20px]" : "text-[16px]"} ${on ? "" : "line-clamp-2"}`}
                >
                  {c.title}
                </motion.span>
              </AnimatePresence>
              {/* The first point always shows; the rest open on hover, focus or click. */}
              {c.points[0] && <span className={`mt-1.5 block text-[13px] leading-snug text-ink-2 ${on ? "" : "line-clamp-2"}`}>{c.points[0]}</span>}
              {c.points.length > 1 && (
                <span
                  className={`grid transition-[grid-template-rows,opacity] duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    on ? "grid-rows-[1fr] opacity-100" : "grid-rows-[1fr] opacity-100 sm:grid-rows-[0fr] sm:opacity-0 group-hover/card:grid-rows-[1fr] group-hover/card:opacity-100 group-focus-within/card:grid-rows-[1fr] group-focus-within/card:opacity-100"
                  }`}
                >
                  <span className="min-h-0 overflow-hidden">
                    <span className="mt-2 block space-y-1 border-t border-black/5 pt-2 text-[13px] leading-snug text-ink-2">
                      {c.points.slice(1).map((p) => (
                        <span key={p} className="flex gap-1.5">
                          <span aria-hidden className="text-ink-3">
                            ·
                          </span>
                          {p}
                        </span>
                      ))}
                    </span>
                  </span>
                </span>
              )}
              {c.points.length > 1 && !on && (
                <span className="mt-auto hidden pt-2 text-[12px] text-ink-3 transition-opacity duration-200 sm:block group-hover/card:hidden group-focus-within/card:hidden" aria-hidden>
                  +{c.points.length - 1} more
                </span>
              )}
            </button>
          </motion.li>
        );
      })}
    </ol>
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
  const approved = sum(run.lines.filter((l) => paidInUsdc(l.rail)).map((l) => l.approved));
  const actual = sum(run.lines.filter((l) => paidInUsdc(l.rail)).map((l) => l.actual));
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
          <div className="mt-2 h-2 overflow-hidden rounded-[2px] bg-[#f1f0ec]">
            <motion.div className="h-full rounded-[2px] bg-agent" animate={{ width: `${Math.min(100, pct)}%` }} transition={{ duration: 0.5 }} />
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[340px] text-[13px]">
        <thead className="border-b border-line text-left text-[12px] text-ink-3">
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
              const sub = offVault(l.rail);
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
                    {l.bigSpend && l.rail !== "exchange" && <span className="mt-0.5 inline-block rounded-md bg-warn/20 px-1.5 py-px text-[10.5px] font-medium text-warn-ink">Big spend · approved up front</span>}
                  </td>
                  <td className="px-2 py-2.5 text-ink-2">
                    {l.payeeName}
                    {!sub && (
                      <a href={addrUrl(l.payee)} target="_blank" rel="noreferrer" className="hidden font-mono text-[10.5px] text-ink-3 hover:text-ink sm:block">
                        {short(l.payee)}
                      </a>
                    )}
                  </td>
                  {!compact && <td className="hidden px-2 py-2.5 text-ink-3 sm:table-cell">{l.rail === "exchange" ? "Order" : l.rail === "gateway" || l.rail === "x402" ? "Per request" : l.rail}</td>}
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
    </div>
  );
}

export function ApproveModal({ run, open, onClose }: { run: Run; open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState<"" | "sign" | "fund">("");
  const passkey = run.payer === "passkey" && run.mode === "live";
  const pk = usePasskeyWallet();
  const [err, setErr] = useState("");
  const total = sum(run.lines.filter((l) => !offVault(l.rail)).map((l) => l.approved));
  const big = run.lines.filter((l) => l.bigSpend);

  // Server-signed: optimistic, close at once; the step graph shows "Funding vault" from the server's own event.
  // Passkey: the user signs approve + open in one batched operation, then the server verifies it onchain.
  async function approve() {
    setErr("");
    if (!passkey || BigInt(run.cap) === 0n) {
      onClose();
      toast(BigInt(run.cap) === 0n ? "Approved · no research to pay for, so no vault" : `Approved · funding vault with ${fmt(run.cap)} USDC`, "good");
      post(`/api/runs/${run.id}/approve`).catch((e) => toast(`Funding failed: ${(e as Error).message}`, "bad"));
      return;
    }
    try {
      setBusy("sign");
      const info = await fetch(`/api/runs/${run.id}/funding`).then((r) => r.json());
      if (info.error) throw new Error(info.error);
      const txHash: Hex = await sendCalls(fundCalls(info));
      setBusy("fund");
      onClose();
      toast(`Signed with your passkey · vault funded with ${fmt(run.cap)} USDC`, "good");
      post(`/api/runs/${run.id}/approve`, { txHash }).catch((e) => toast(`Couldn't confirm funding: ${(e as Error).message}`, "bad"));
      void pk.refresh();
    } catch (e) {
      setErr((e as Error).message.split("\n")[0].slice(0, 200));
    } finally {
      setBusy("");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Approve plan" width={520}>
      <div className="text-[13px] text-ink-3">Total for this work order</div>
      <Amount value={total} className="text-[44px] font-semibold leading-none tracking-tight" />
      <div className="mt-2 text-[13px] text-ink-2">
        {BigInt(run.cap) === 0n ? (
          "No paid research, so no vault is funded."
        ) : (
          <>
            Funds a vault with <b className="num">{fmt(run.cap)} USDC</b>. Unspent funds come back when the job ends. Network fees ~<span className="num">{fmtFee(run.estFees)}</span>.
          </>
        )}
        {run.lines.some((l) => l.rail === "exchange") && <> The order limit is paid on the exchange, not from the vault.</>}
      </div>

      <ul className="mt-5 divide-y divide-line overflow-hidden rounded-xl border border-line text-[13px]">
        {run.lines.map((l, i) => (
          <motion.li key={l.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span>
              {l.purpose}
              <span className="text-ink-3"> · {l.payeeName}</span>
              {l.bigSpend && <span className="ml-2 rounded-md bg-warn/20 px-1.5 py-0.5 text-[10.5px] font-medium text-warn-ink">Big spend</span>}
            </span>
            <span className="num">{fmt(l.approved)}</span>
          </motion.li>
        ))}
      </ul>

      <div className="mt-4 grid gap-2 text-[12.5px] text-ink-2">
        <div className="flex gap-2.5 rounded-xl bg-surface p-3">
          <Icon name="check" size={16} className="mt-px text-agent-ink" />
          <span>
            {big.length ? `${big.length} big spend${big.length > 1 ? "s" : ""} over ${fmt(run.threshold)} USDC approved now. No pause mid-run.` : `No spend over the ${fmt(run.threshold)} USDC threshold.`}
          </span>
        </div>
        <div className="flex gap-2.5 rounded-xl bg-surface p-3">
          <Icon name="refund" size={16} className="mt-px text-agent-ink" />
          <span>You&apos;re asked again only if a price, payee or step changes.</span>
        </div>
        <div className="flex gap-2.5 rounded-xl bg-surface p-3">
          <Icon name="shield" size={16} className="mt-px text-agent-ink" />
          <span>
            Vault rule: up to <b className="num">{fmt(total)}</b> across {run.lines.filter((l) => !offVault(l.rail)).length} lines, only to{" "}
            {[...new Set(run.lines.filter((l) => !offVault(l.rail)).map((l) => l.payeeName))].join(", ")}. Enforced onchain.
          </span>
        </div>
        <div className="num flex justify-between rounded-xl border border-dashed border-line px-3 py-2 text-[12px] text-ink-3">
          <span>Your wallet → vault</span>
          <span>
            −{fmt(run.cap)} now · +{fmt(BigInt(run.cap) - total)} or more back at the end
          </span>
        </div>
      </div>

      {passkey && (
        <div className="mt-4 rounded-xl border border-line p-3">
          <WalletPanel need={BigInt(run.cap)} />
        </div>
      )}
      {err && <p className="mt-3 text-sm text-bad">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Not yet
        </Button>
        <Button
          onClick={approve}
          disabled={!!busy || (passkey && (!pk.wallet || (pk.balance != null && pk.balance < BigInt(run.cap))))}
          data-testid="approve"
          variant="agent"
        >
          {busy === "sign" ? (
            <>
              <Spinner /> Confirm with your passkey…
            </>
          ) : busy === "fund" ? (
            <>
              <Spinner /> Funding vault…
            </>
          ) : passkey ? (
            `Approve with passkey · fund ${fmt(run.cap)}`
          ) : (
            `Approve & fund ${fmt(run.cap)}`
          )}
        </Button>
      </div>
    </Modal>
  );
}
