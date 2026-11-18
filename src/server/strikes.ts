import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * How sellers have been delivering, kept so a seller that keeps failing is skipped for a while.
 * Fair by design:
 * - only a failed published check counts, never a lost connection or our own error;
 * - two failures within a day are needed;
 * - a strike fades after a day, and one good delivery clears it.
 */
export const STRIKE_LIMIT = 2;
export const STRIKE_HOURS = 24;

export interface DeliveryEvent {
  vendor: string;
  ok: boolean;
  at: string;
  reason?: string;
  /** Settlement transaction or answer fingerprint: what the strike rests on. */
  evidence?: string;
}

type Db = import("node:sqlite").DatabaseSync;
let db: Db | null | undefined;
const memory: DeliveryEvent[] = [];

function open(): Db | null {
  if (db !== undefined) return db;
  if (process.env.PERSIST === "false" || process.env.VITEST) return (db = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const dir = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
    mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(path.join(dir, "agento.db"));
    db.exec("CREATE TABLE IF NOT EXISTS deliveries (vendor TEXT NOT NULL, ok INTEGER NOT NULL, at TEXT NOT NULL, reason TEXT, evidence TEXT)");
  } catch (e) {
    console.warn("delivery record off:", (e as Error).message);
    db = null;
  }
  return db;
}

const key = (vendor: string) => vendor.toLowerCase();

export function recordDelivery(e: Omit<DeliveryEvent, "at"> & { at?: string }) {
  const ev: DeliveryEvent = { ...e, vendor: key(e.vendor), at: e.at ?? new Date().toISOString() };
  const d = open();
  try {
    if (d) d.prepare("INSERT INTO deliveries (vendor, ok, at, reason, evidence) VALUES (?, ?, ?, ?, ?)").run(ev.vendor, ev.ok ? 1 : 0, ev.at, ev.reason ?? null, ev.evidence ?? null);
    else memory.push(ev);
  } catch (err) {
    console.warn("delivery not recorded:", (err as Error).message);
  }
}

function recent(vendor: string, now: number): DeliveryEvent[] {
  const since = new Date(now - STRIKE_HOURS * 3_600_000).toISOString();
  const d = open();
  if (!d) return memory.filter((e) => e.vendor === key(vendor) && e.at >= since).sort((a, b) => a.at.localeCompare(b.at));
  try {
    return (d.prepare("SELECT vendor, ok, at, reason, evidence FROM deliveries WHERE vendor = ? AND at >= ? ORDER BY at").all(key(vendor), since) as unknown as (Omit<DeliveryEvent, "ok"> & { ok: number })[]).map((r) => ({ ...r, ok: Boolean(r.ok) }));
  } catch {
    return [];
  }
}

/** Whether a seller is being skipped now, and why. */
export function standing(vendor: string, now = Date.now()): { skipped: boolean; failures: DeliveryEvent[]; until?: string } {
  const evs = recent(vendor, now);
  const lastGood = evs.map((e) => e.ok).lastIndexOf(true);
  const failures = evs.slice(lastGood + 1).filter((e) => !e.ok);
  if (failures.length < STRIKE_LIMIT) return { skipped: false, failures };
  const until = new Date(Date.parse(failures[failures.length - STRIKE_LIMIT].at) + STRIKE_HOURS * 3_600_000).toISOString();
  return { skipped: true, failures, until };
}

/** For tests. */
export const resetDeliveries = () => void memory.splice(0);
