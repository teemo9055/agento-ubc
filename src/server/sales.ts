import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

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
  own: boolean;
  at: string;
}

type Db = import("node:sqlite").DatabaseSync;
let db: Db | null | undefined;
const memory: Sale[] = [];

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
  } catch (e) {
    console.warn("sales store off:", (e as Error).message);
    db = null;
  }
  return db;
}

export function recordSale(s: Omit<Sale, "id" | "at">) {
  const sale: Sale = { ...s, id: randomUUID(), at: new Date().toISOString() };
  const d = open();
  try {
    if (d) d.prepare("INSERT INTO sales (id, product, payer, amount, tx, own, at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(sale.id, sale.product, sale.payer, sale.amount, sale.tx, sale.own ? 1 : 0, sale.at);
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
    return (d.prepare("SELECT id, product, payer, amount, tx, own, at FROM sales ORDER BY at DESC LIMIT 500").all() as unknown as (Omit<Sale, "own"> & { own: number })[]).map((r) => ({ ...r, own: Boolean(r.own) }));
  } catch {
    return [];
  }
}

/** Totals for the selling panel: what outside agents paid, what the app's own jobs paid, and the latest sales. */
export function salesSummary() {
  const all = allSales();
  const sum = (xs: Sale[]) => xs.reduce((a, s) => a + BigInt(s.amount), 0n).toString();
  const outside = all.filter((s) => !s.own);
  return {
    outside: { count: outside.length, total: sum(outside), buyers: new Set(outside.map((s) => s.payer.toLowerCase())).size },
    own: { count: all.length - outside.length, total: sum(all.filter((s) => s.own)) },
    recent: all.slice(0, 8),
  };
}
