import { openDb, type Db } from "../sqlite";
import type { Capability, Reliability } from "./types";
import { demoServices } from "./demo";

/**
 * Where the capability map lives: the same SQLite file as jobs, or memory when persistence is off.
 * Reads go through an in-memory copy that is refreshed on every write, so search never touches disk.
 */
let db: Db | null | undefined;
const mem = new Map<string, Capability>();
const stats = new Map<string, Reliability>();
let loaded = false;
let cache: Capability[] | null = null;

function open(): Db | null {
  if (db !== undefined) return db;
  db = openDb(
    "catalog",
    `CREATE TABLE IF NOT EXISTS capabilities (resource TEXT PRIMARY KEY, data TEXT NOT NULL, schema_hash TEXT NOT NULL, tagged_at TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS capability_stats (resource TEXT PRIMARY KEY, delivered INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, last_fail_at TEXT);
     CREATE TABLE IF NOT EXISTS capability_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
     INSERT OR IGNORE INTO capability_meta (k, v) VALUES ('version', 0);`,
  );
  return db;
}

/**
 * The crawler and the request handlers can run as separate copies of this module (Next.js bundles
 * them apart), so each keeps a version number from the database and reloads when another copy wrote.
 */
let version = -1;
let checkedAt = 0;
const dbVersion = (d: Db) => Number((d.prepare("SELECT v FROM capability_meta WHERE k = 'version'").get() as { v: number } | undefined)?.v ?? 0);
function bump(d: Db) {
  d.prepare("UPDATE capability_meta SET v = v + 1 WHERE k = 'version'").run();
  version = dbVersion(d);
}

function load() {
  const d = open();
  if (loaded) {
    if (!d || Date.now() - checkedAt < 5_000) return;
    checkedAt = Date.now();
    try {
      if (dbVersion(d) === version) return;
    } catch {
      return;
    }
    mem.clear();
    stats.clear();
    cache = null;
  }
  loaded = true;
  checkedAt = Date.now();
  // Sample services with recorded answers, while replaying recorded data or with DEMO_CATALOG=on.
  for (const c of demoServices()) mem.set(c.resource, c);
  if (!d) return;
  try {
    version = dbVersion(d);
    for (const r of d.prepare("SELECT data FROM capabilities").all() as { data: string }[]) {
      const c = JSON.parse(r.data) as Capability;
      mem.set(c.resource, c);
    }
    for (const r of d.prepare("SELECT resource, delivered, failed, last_fail_at FROM capability_stats").all() as { resource: string; delivered: number; failed: number; last_fail_at: string | null }[]) {
      stats.set(r.resource, { resource: r.resource, delivered: r.delivered, failed: r.failed, lastFailAt: r.last_fail_at ?? undefined });
    }
  } catch (e) {
    console.warn("catalog load:", (e as Error).message);
  }
}


export function upsertCapability(c: Capability) {
  load();
  mem.set(c.resource, c);
  cache = null;
  const d = open();
  if (!d) return;
  try {
    d.prepare("INSERT INTO capabilities (resource, data, schema_hash, tagged_at) VALUES (?, ?, ?, ?) ON CONFLICT(resource) DO UPDATE SET data = excluded.data, schema_hash = excluded.schema_hash, tagged_at = excluded.tagged_at").run(
      c.resource,
      JSON.stringify(c),
      c.schemaHash,
      c.taggedAt,
    );
    bump(d);
  } catch (e) {
    console.warn("capability not saved:", (e as Error).message);
  }
}

/** Every capability in the map. Cached; refreshed on write. */
export function allCapabilities(): Capability[] {
  load();
  return (cache ??= [...mem.values()]);
}

/** Drops listings that are no longer in the catalog. */
export function pruneCapabilities(keep: Set<string>) {
  load();
  const gone = [...mem.keys()].filter((r) => !keep.has(r));
  for (const r of gone) mem.delete(r);
  if (gone.length) cache = null;
  const d = open();
  if (!d || !gone.length) return gone.length;
  try {
    const del = d.prepare("DELETE FROM capabilities WHERE resource = ?");
    for (const r of gone) del.run(r);
    bump(d);
  } catch (e) {
    console.warn("catalog prune:", (e as Error).message);
  }
  return gone.length;
}

export const getCapability =(resource: string): Capability | undefined => {
  load();
  return mem.get(resource) ?? mem.get(resource.replace(/\/$/, "")) ?? mem.get(`${resource}/`);
};

/** How a paid call to this listing ended: delivered and passed its checks, or not. */
export function recordOutcome(resource: string, ok: boolean, at = new Date().toISOString()) {
  load();
  const s = stats.get(resource) ?? { resource, delivered: 0, failed: 0 };
  if (ok) s.delivered++;
  else {
    s.failed++;
    s.lastFailAt = at;
  }
  stats.set(resource, s);
  const d = open();
  if (!d) return;
  try {
    d.prepare(
      "INSERT INTO capability_stats (resource, delivered, failed, last_fail_at) VALUES (?, ?, ?, ?) ON CONFLICT(resource) DO UPDATE SET delivered = excluded.delivered, failed = excluded.failed, last_fail_at = excluded.last_fail_at",
    ).run(resource, s.delivered, s.failed, s.lastFailAt ?? null);
    bump(d);
  } catch (e) {
    console.warn("capability outcome not saved:", (e as Error).message);
  }
}

export const reliability = (resource: string): Reliability => {
  load();
  return stats.get(resource) ?? { resource, delivered: 0, failed: 0 };
};

/** A reliability score in [0, 1): delivered / (delivered + failed + 2). New listings start at 0. */
export const reliabilityScore = (resource: string) => {
  const r = reliability(resource);
  return r.delivered / (r.delivered + r.failed + 2);
};

/** For tests. */
export function resetCatalog() {
  mem.clear();
  stats.clear();
  cache = null;
}
