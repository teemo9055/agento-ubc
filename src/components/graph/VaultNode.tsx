"use client";
import { fmt } from "@/lib/money";
import { addrUrl } from "@/lib/format";
import type { Run } from "@/lib/types";
import { useNet } from "../NetContext";

export const VAULT_W = 160;
export const VAULT_H = 88;

/** What the job may spend and has spent: its vault, plus marketplace lookups paid through Gateway. */
export function spendOf(run: Pick<Run, "lines">) {
  const paid = run.lines.filter((l) => l.rail !== "exchange");
  const cap = paid.reduce((a, l) => a + BigInt(l.calls?.unitPrice && l.approved === "0" ? "0" : l.approved), 0n);
  const spent = paid.reduce((a, l) => a + BigInt(l.actual), 0n);
  const sellers = new Set(paid.filter((l) => BigInt(l.actual) > 0n).map((l) => l.payee.toLowerCase())).size;
  return { cap, spent, sellers };
}

/** The money for this job, on the far left of the graph: the cap, what's spent, and a bar that fills. */
export function VaultNode({ run, x, y, draft }: { run: Run; x: number; y: number; draft: boolean }) {
  const net = useNet();
  const { cap, spent } = spendOf(run);
  const most = run.lines.filter((l) => l.rail !== "exchange").reduce((a, l) => a + BigInt(l.calls?.unitPrice && l.approved === "0" ? l.calls.unitPrice : l.approved), 0n);
  const pct = most > 0n ? Math.min(100, Number((spent * 1000n) / most) / 10) : 0;
  const Box = run.vault ? "a" : "div";
  return (
    <Box
      {...(run.vault ? { href: addrUrl(run.vault, net), target: "_blank", rel: "noreferrer" } : {})}
      className="absolute flex flex-col rounded-xl border-[1.5px] border-ink bg-panel px-3 py-2.5 shadow-[3px_3px_0_0_var(--agent)]"
      style={{ left: x, top: y, width: VAULT_W, height: VAULT_H }}
      data-testid="vault-node"
      aria-label={`${run.mode === "demo" ? "Practice vault" : "Your vault"}: ${draft ? `at most $${fmt(most.toString())}` : `$${fmt(spent.toString())} spent of $${fmt(cap.toString())}`}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[12.5px] font-semibold">{run.mode === "demo" ? "Practice vault" : "Your vault"}</span>
        {run.network === "mainnet" && run.mode === "live" && <span className="rounded bg-warn/25 px-1 text-[10px] font-semibold text-warn-ink">Real USDC</span>}
      </div>
      <span className="num mt-0.5 text-[12px] text-ink-2">{draft ? `At most $${fmt(most.toString())}` : `$${fmt(spent.toString())} spent`}</span>
      <div className="mt-auto h-[5px] overflow-hidden rounded-full bg-[#ecebe6]" aria-hidden>
        <div className="h-full bg-agent transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${draft ? 0 : pct}%` }} data-testid="vault-bar" />
      </div>
    </Box>
  );
}
