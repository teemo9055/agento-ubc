import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Net } from "@/lib/networks";

/**
 * What this app earned by selling its own answers over x402, kept beside the jobs.
 * A sale to one of the app's own jobs is marked `own`, so what outside agents paid is told apart.
 */
export interface Sale {
  id: string;
  product: string;
  payer: string;
  /** USDC base units. */
  amount: string;
  tx: string;
  /** The Arc network it was paid on; missing on older sales, which were all on testnet. */
  network?: Net;
  own: boolean;
  at: string;
  /** The x402 authorization nonce, so the payer can ask for the answer again if it was lost. */
  nonce?: string;
  /** What was asked, as query parameters. */
  params?: Record<string, string>;
  /** Fingerprint of the answer sent, and the answer itself (capped), kept for refund claims and re-delivery. */
  answerHash?: string;
  answer?: string;
  /** Set once a refund was sent; "pending" while it is being sent, so a claim can't be paid twice. */
  refunded?: string;
  refundTx?: string;
}

type Db = import("node:sqlite").DatabaseSync;
let db: Db | null | undefined;
// On globalThis so every route of the server sees the same sales when nothing is persisted.
const memory: Sale[] = ((globalThis as unknown as { __agentoSales?: Sale[] }).__agentoSales ??= []);

function open(): Db | null {
  if (db !== undefined) return db;
  if (process.env.PERSIST === "false" || process.env.VITEST) return (db = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const dir = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
    mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(path.join(dir, "agento.db"));
    db.exec("CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, product TEXT NOT NULL, payer TEXT NOT NULL, amount TEXT NOT NULL, tx TEXT NOT NULL, own INTEGER NOT NULL, at TEXT NOT NULL)");
    for (const col of ["nonce", "params", "answerHash", "answer", "refunded", "refundTx", "network"]) {
      try {
        db.exec(`ALTER TABLE sales ADD COLUMN ${col} TEXT`);
      } catch {
        // already there
      }
    }
  } catch (e) {
    console.warn("sales store off:", (e as Error).message);
    db = null;
  }
  return db;
}

const COLS = "id, product, payer, amount, tx, own, at, nonce, params, answerHash, answer, refunded, refundTx, network";
type Row = Omit<Sale, "own" | "params"> & { own: number; params?: string | null };
const fromRow = (r: Row): Sale => {
  const out = { ...r, own: Boolean(r.own), params: r.params ? (JSON.parse(r.params) as Record<string, string>) : undefined } as Sale;
  for (const k of Object.keys(out) as (keyof Sale)[]) if (out[k] === null) delete out[k];
  return out;
};

export function recordSale(s: Omit<Sale, "id" | "at">) {
  const sale: Sale = { ...s, id: randomUUID(), at: new Date().toISOString() };
  const d = open();
  try {
    if (d)
      d.prepare(`INSERT INTO sales (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        sale.id, sale.product, sale.payer, sale.amount, sale.tx, sale.own ? 1 : 0, sale.at,
        sale.nonce ?? null, sale.params ? JSON.stringify(sale.params) : null, sale.answerHash ?? null, sale.answer ?? null, null, null, sale.network ?? null,
      );
    else memory.push(sale);
  } catch (e) {
    console.warn("sale not recorded:", (e as Error).message);
  }
  return sale;
}

export function allSales(): Sale[] {
  const d = open();
  if (!d) return [...memory].reverse();
  try {
    return (d.prepare(`SELECT ${COLS} FROM sales ORDER BY at DESC LIMIT 500`).all() as unknown as Row[]).map(fromRow);
  } catch {
    return [];
  }
}

/** One sale, by its id, its settlement transaction or its authorization nonce. */
export function findSale(by: { id?: string; tx?: string; nonce?: string }): Sale | undefined {
  const d = open();
  const match = (s: Sale) => (by.id ? s.id === by.id : by.tx ? s.tx.toLowerCase() === by.tx.toLowerCase() : by.nonce ? s.nonce?.toLowerCase() === by.nonce.toLowerCase() : false);
  if (!d) return memory.find(match);
  try {
    const r = by.id
      ? d.prepare(`SELECT ${COLS} FROM sales WHERE id = ?`).get(by.id)
      : by.tx
      ? d.prepare(`SELECT ${COLS} FROM sales WHERE lower(tx) = lower(?)`).get(by.tx)
      : by.nonce
        ? d.prepare(`SELECT ${COLS} FROM sales WHERE lower(nonce) = lower(?)`).get(by.nonce)
        : undefined;
    return r ? fromRow(r as unknown as Row) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Marks a sale as being refunded. Returns false when it already was, so two claims racing for the
 * same sale can't both be paid.
 */
export function lockRefund(id: string): boolean {
  const d = open();
  if (!d) {
    const s = memory.find((x) => x.id === id);
    if (!s || s.refunded) return false;
    s.refunded = "pending";
    return true;
  }
  return Number(d.prepare("UPDATE sales SET refunded = 'pending' WHERE id = ? AND refunded IS NULL").run(id).changes) === 1;
}

export function finishRefund(id: string, outcome: { tx?: string } | null) {
  const d = open();
  const at = outcome ? new Date().toISOString() : null;
  if (!d) {
    const s = memory.find((x) => x.id === id);
    if (s) Object.assign(s, { refunded: at ?? undefined, refundTx: outcome?.tx });
    return;
  }
  d.prepare("UPDATE sales SET refunded = ?, refundTx = ? WHERE id = ?").run(at, outcome?.tx ?? null, id);
}

/** A practice sale: recorded so it follows the same refund path, but no money moved. */
export const PRACTICE_TX = "practice";
export const isPractice = (s: Pick<Sale, "tx">) => s.tx.startsWith(PRACTICE_TX);

/** For tests: forget every sale kept in memory. */
export const resetSales = () => void memory.splice(0);

/** Totals for the selling panel: what outside agents paid, what the app's own jobs paid, and the latest sales. */
export function salesSummary() {
  // Practice deposits moved no money, so they aren't earnings.
  const all = allSales().filter((s) => !isPractice(s));
  const sum = (xs: Sale[]) => xs.reduce((a, s) => a + BigInt(s.amount), 0n).toString();
  const outside = all.filter((s) => !s.own);
  const refunds = all.filter((s) => s.refunded && s.refunded !== "pending");
  return {
    refunds: { count: refunds.length, total: sum(refunds) },
    outside: { count: outside.length, total: sum(outside), buyers: new Set(outside.map((s) => s.payer.toLowerCase())).size },
    own: { count: all.length - outside.length, total: sum(all.filter((s) => s.own)) },
    recent: all.slice(0, 8),
  };
}
