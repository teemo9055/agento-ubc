import { fmt, fmtFee, sum } from "./money";
import { NETWORKS } from "./networks";
import { THEMES } from "./themes";
import { paidInUsdc, type Decision, type Hex, type Run } from "./types";
import { orderDigest, orderRecord } from "./order-record";

export interface ReceiptLine {
  step: string;
  purpose: string;
  service: string;
  rail: string;
  payeeName: string;
  payee: Hex;
  approved: string;
  amount: string;
  networkFee: string;
  tx?: Hex;
  time?: string;
}

export interface Receipt {
  receiptId: string;
  workOrderId: string;
  status: "confirmed" | "cancelled";
  mode: "demo" | "live";
  issuedAt: string;
  task: string;
  client: { wallet: Hex };
  agent: { name: string; wallet: Hex };
  chain: { name: string; chainId: number; asset: "USDC" };
  deliverable: { summary: string; method: string };
  planHash?: Hex;
  vault?: Hex;
  lines: ReceiptLine[];
  subtotal: string;
  networkFees: string;
  total: string;
  budget: { approved: string; cap: string; spent: string; returned: string; fundingTx?: Hex; refundTx?: Hex };
  decisions: Decision[];
  policy: { spendsOnPlan: number; bigSpendsPreApproved: number; reapprovals: number; offPlanBlocked: number; threshold: string };
  job: { started?: string; finished?: string; durationSec: number };
  /** The exchange order, as fingerprinted on Arc: keccak256 of JSON.stringify(record) = digest. */
  order?: { record: ReturnType<typeof orderRecord>; status: string; filled?: number; digest: Hex; anchorTx?: string };
}

/** One row per settled payment. Amounts in USDC base units; fees in 18-decimal native units. */
export function buildReceipt(run: Run): Receipt {
  const o = run.order && run.order.venue !== "paper" && run.order.orderId ? run.order : undefined;
  const lines: ReceiptLine[] = run.phases.flatMap((p) =>
    p.payments
      .filter((x) => x.txState === "settled")
      .map((x) => {
        const l = run.lines.find((l) => l.id === x.lineId)!;
        return {
          step: p.label,
          purpose: l.purpose,
          service: l.service,
          rail: l.rail,
          payeeName: l.payeeName,
          payee: l.payee,
          approved: l.calls?.unitPrice ?? l.approved,
          amount: x.amount ?? "0",
          networkFee: x.networkFee ?? "0",
          tx: x.txHash,
          time: x.at,
        };
      }),
  );
  const subtotal = sum(lines.map((l) => l.amount));
  const fees = sum(lines.map((l) => l.networkFee));
  const reapprovals = run.decisions.filter((d) => d.kind === "reapproval");
  const started = run.startedAt ?? run.createdAt;
  return {
    receiptId: `R-${run.id}`,
    workOrderId: run.id,
    status: run.status === "cancelled" ? "cancelled" : "confirmed",
    mode: run.mode,
    issuedAt: run.finishedAt ?? new Date().toISOString(),
    task: run.task,
    client: { wallet: run.client },
    agent: { name: THEMES[run.agent].name, wallet: run.agentWallet },
    chain: { name: NETWORKS[run.network ?? "testnet"].name, chainId: NETWORKS[run.network ?? "testnet"].chainId, asset: "USDC" },
    deliverable: { summary: run.deliverable?.summary ?? "Not delivered", method: run.deliverable?.method ?? "" },
    planHash: run.planHash,
    vault: run.vault,
    lines,
    subtotal: subtotal.toString(),
    networkFees: fees.toString(),
    total: subtotal.toString(),
    budget: {
      approved: sum(run.lines.filter((l) => paidInUsdc(l.rail)).map((l) => l.approved)).toString(),
      cap: run.cap,
      spent: subtotal.toString(),
      returned: run.refunded ?? "0",
      fundingTx: run.fundingTx,
      refundTx: run.refundTx,
    },
    decisions: run.decisions,
    policy: {
      spendsOnPlan: lines.length,
      bigSpendsPreApproved: run.lines.filter((l) => l.bigSpend).length,
      reapprovals: reapprovals.length,
      offPlanBlocked: reapprovals.filter((d) => d.outcome !== "approved").length,
      threshold: run.threshold,
    },
    job: {
      started,
      finished: run.finishedAt,
      durationSec: run.finishedAt ? Math.round((Date.parse(run.finishedAt) - Date.parse(started)) / 1000) : 0,
    },
    order: o && { record: orderRecord(run, o), status: o.status, filled: o.filledQuantity, digest: orderDigest(run, o), anchorTx: o.anchor?.tx },
  };
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function receiptCsv(r: Receipt): string {
  const head = ["time", "step", "purpose", "service", "rail", "payee_name", "payee", "approved_usdc", "amount_usdc", "network_fee_usdc", "tx"];
  const rows = r.lines.map((l) => [l.time ?? "", l.step, l.purpose, l.service, l.rail, l.payeeName, l.payee, fmt(l.approved), fmt(l.amount), fmtFee(l.networkFee), l.tx ?? ""]);
  return [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
