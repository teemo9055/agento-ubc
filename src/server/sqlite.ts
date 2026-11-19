import { mkdirSync } from "node:fs";
import path from "node:path";

export type Db = import("node:sqlite").DatabaseSync;

/**
 * Opens the app's SQLite file (the same `agento.db` jobs and lessons live in) and runs `schema`.
 * Returns null when persistence is off (`PERSIST=false`, under tests) or the file can't be opened;
 * callers then keep their data in memory.
 */
export function openDb(label: string, schema: string): Db | null {
  if (process.env.PERSIST === "false" || process.env.VITEST) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const dir = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, "agento.db"));
    db.exec(schema);
    return db;
  } catch (e) {
    console.warn(`${label} store off:`, (e as Error).message);
    return null;
  }
}
