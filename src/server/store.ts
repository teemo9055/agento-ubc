import { mkdirSync } from "node:fs";
import path from "node:path";
import type { SeqEvent } from "@/lib/events";

/**
 * Append-only event log in SQLite. A run is rebuilt by replaying its events,
 * so the database holds exactly what the screen shows.
 */
type Db = import("node:sqlite").DatabaseSync;

let db: Db | null | undefined;

function open(): Db | null {
  if (db !== undefined) return db;
  if (process.env.PERSIST === "false" || process.env.VITEST) return (db = null);
  try {
    // Loaded lazily so tests and edge runtimes never touch it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const dir = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
    mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(path.join(dir, "agento.db"));
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS events (run_id TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (run_id, seq));
      CREATE TABLE IF NOT EXISTS meta (run_id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
  } catch (e) {
    console.warn("persistence off:", (e as Error).message);
    db = null;
  }
  return db;
}

export interface RunMeta {
  options: Record<string, unknown>;
  funded: string;
  seller: Record<string, "primary">;
}

export function appendEvent(runId: string, e: SeqEvent, meta: RunMeta, createdAt: string) {
  const d = open();
  if (!d) return;
  d.prepare("INSERT OR REPLACE INTO events (run_id, seq, body) VALUES (?, ?, ?)").run(runId, e.seq, JSON.stringify(e));
  d.prepare("INSERT INTO meta (run_id, body, created_at) VALUES (?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET body = excluded.body").run(runId, JSON.stringify(meta), createdAt);
}

export function loadAll(): { runId: string; meta: RunMeta; events: SeqEvent[] }[] {
  const d = open();
  if (!d) return [];
  const metas = d.prepare("SELECT run_id, body FROM meta ORDER BY created_at").all() as { run_id: string; body: string }[];
  const q = d.prepare("SELECT body FROM events WHERE run_id = ? ORDER BY seq");
  return metas.map((m) => ({
    runId: m.run_id,
    meta: JSON.parse(m.body) as RunMeta,
    events: (q.all(m.run_id) as { body: string }[]).map((r) => JSON.parse(r.body) as SeqEvent),
  }));
}
