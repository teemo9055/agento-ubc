import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * The town's storage: the same SQLite file as jobs and sales (.data/agento.db), or plain memory
 * when PERSIST=false and under tests. Every table holds one JSON document per row, keyed by id,
 * with the few columns that are filtered on.
 */
type Db = import("node:sqlite").DatabaseSync;
let db: Db | null | undefined;

export const TABLES = ["town_hall", "town_posts", "town_listings", "town_library", "town_log"] as const;
export type Table = (typeof TABLES)[number];

// On globalThis so every route of the server shares one town when nothing is persisted.
const memory = ((globalThis as unknown as { __agentoTown?: Record<Table, Map<string, { at: string; body: string }>> }).__agentoTown ??= Object.fromEntries(TABLES.map((t) => [t, new Map()])) as never);

function open(): Db | null {
  if (db !== undefined) return db;
  if (process.env.PERSIST === "false" || process.env.VITEST) return (db = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const dir = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
    mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(path.join(dir, "agento.db"));
    for (const t of TABLES) db.exec(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, at TEXT NOT NULL, body TEXT NOT NULL)`);
  } catch (e) {
    console.warn("town store off:", (e as Error).message);
    db = null;
  }
  return db;
}

export function put<T extends { id: string }>(table: Table, row: T, at = new Date().toISOString()) {
  const body = JSON.stringify(row);
  const d = open();
  if (!d) {
    const prev = memory[table].get(row.id);
    memory[table].set(row.id, { at: prev?.at ?? at, body });
    return row;
  }
  d.prepare(`INSERT INTO ${table} (id, at, body) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body`).run(row.id, at, body);
  return row;
}

export function get<T>(table: Table, id: string): T | undefined {
  const d = open();
  if (!d) {
    const r = memory[table].get(id);
    return r ? (JSON.parse(r.body) as T) : undefined;
  }
  const r = d.prepare(`SELECT body FROM ${table} WHERE id = ?`).get(id) as { body: string } | undefined;
  return r ? (JSON.parse(r.body) as T) : undefined;
}

/** Newest first. */
export function all<T>(table: Table, limit = 1000): T[] {
  const d = open();
  if (!d)
    return [...memory[table].values()]
      .reverse()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit)
      .map((r) => JSON.parse(r.body) as T);
  return (d.prepare(`SELECT body FROM ${table} ORDER BY at DESC, rowid DESC LIMIT ?`).all(limit) as { body: string }[]).map((r) => JSON.parse(r.body) as T);
}

/** For tests: forget everything the town kept in memory. */
export const resetTown = () => {
  for (const t of TABLES) memory[t].clear();
};
