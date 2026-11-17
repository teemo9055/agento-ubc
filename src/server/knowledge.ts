import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentId, OrderResult, Run } from "@/lib/types";

/**
 * What agents know before they answer, shared by everyone using this app.
 * 1. Primers: hand-written domain notes (how markets are named, how orders behave).
 * 2. Lessons: learned automatically from how past moves turned out (fills, misses, refusals),
 *    kept in the same SQLite file as jobs. Nothing personal is stored: no chat text, no wallets.
 */

export const PRIMERS: Record<AgentId, string[]> = {
  inso: [
    "Gemini prediction tickers: BTC2611152200 = BTC price at 2026-11-15 22:00 UTC; contract suffix HI62500 = '$62,500 or above'. BTC05M… are 5-minute markets: too short for resting orders.",
    "Sports events look like NBA-2611152100-LAL-PHX-M (moneyline, each team is a contract). The test exchange lists only crypto and commodities.",
    "A contract's YES price is the market's probability. Wide spreads (ask − bid > 5¢) mean thin markets: limit orders inside the spread may wait a long time.",
    "Crypto contracts settle on a reference price at expiry; Chainlink and Gemini spot usually agree within 0.1%, so a big gap is a warning sign.",
  ],
  trado: [
    "Gemini spot symbols are lowercase pairs like btcusd, ethusd, solusd. Orders round to the symbol's tick and quote increment.",
    "A buy limit below the market waits on the book; above the market it fills at once at the best ask.",
    "Daily moves above ~5% on BTC/ETH are large; on SOL and smaller coins they're common.",
  ],
  travo: [
    "OSRM routes assume legal speeds and no traffic; real trips take 10-20% longer.",
    "Border crossings (e.g. Vancouver → Seattle) add 30-90 minutes and need documents.",
  ],
};

export interface Lesson {
  id: string;
  agent: AgentId;
  topic: string;
  kind: "order" | "rejection" | "outcome";
  data: Record<string, unknown>;
  createdAt: string;
}

type Db = import("node:sqlite").DatabaseSync;
let db: Db | null | undefined;
const memory: Lesson[] = [];

function open(): Db | null {
  if (db !== undefined) return db;
  if (process.env.PERSIST === "false" || process.env.VITEST) return (db = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const dir = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
    mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(path.join(dir, "agento.db"));
    db.exec(`CREATE TABLE IF NOT EXISTS lessons (id TEXT PRIMARY KEY, agent TEXT NOT NULL, topic TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, run_id TEXT, created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS lessons_once ON lessons (run_id, kind);`);
  } catch (e) {
    console.warn("knowledge store off:", (e as Error).message);
    db = null;
  }
  return db;
}

function save(l: Lesson, runId: string) {
  const d = open();
  if (!d) {
    if (!memory.some((m) => m.data.runId === runId && m.kind === l.kind)) memory.push({ ...l, data: { ...l.data, runId } });
    return;
  }
  d.prepare("INSERT OR IGNORE INTO lessons (id, agent, topic, kind, data, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(l.id, l.agent, l.topic, l.kind, JSON.stringify(l.data), runId, l.createdAt);
}

export function allLessons(agent?: AgentId): Lesson[] {
  const d = open();
  const rows = d
    ? (d.prepare("SELECT id, agent, topic, kind, data, created_at FROM lessons ORDER BY created_at DESC LIMIT 500").all() as { id: string; agent: AgentId; topic: string; kind: Lesson["kind"]; data: string; created_at: string }[]).map((r) => ({
        id: r.id,
        agent: r.agent,
        topic: r.topic,
        kind: r.kind,
        data: JSON.parse(r.data) as Record<string, unknown>,
        createdAt: r.created_at,
      }))
    : [...memory].reverse();
  return agent ? rows.filter((l) => l.agent === agent) : rows;
}

export function forgetLesson(id: string) {
  const d = open();
  if (d) d.prepare("DELETE FROM lessons WHERE id = ?").run(id);
  const i = memory.findIndex((m) => m.id === id);
  if (i >= 0) memory.splice(i, 1);
}

/** Market family from an event ticker: BTC2611152200 → BTC, NBA-2611… → NBA, BTC05M… → BTC05M. */
export const topicOf = (eventTicker: string) => eventTicker.match(/^[A-Z]+(?:05M|15M)?/)?.[0] ?? eventTicker.slice(0, 6);

/** Records how a move's order ended, once per job. Final states only. */
export function recordOrder(run: Run, o: OrderResult) {
  const a = run.proposal?.action;
  if (!a || a.kind === "itinerary" || o.venue === "paper") return;
  if (o.status === "rejected") {
    save({ id: randomUUID(), agent: run.agent, topic: a.kind === "prediction_order" ? topicOf(a.eventTicker) : a.symbol, kind: "rejection", data: { reason: o.detail.split(" · ").pop()?.slice(0, 160) }, createdAt: new Date().toISOString() }, run.id);
    return;
  }
  if (o.status !== "filled" && o.status !== "cancelled") return;
  const m = run.proposal?.market;
  save(
    {
      id: randomUUID(),
      agent: run.agent,
      topic: a.kind === "prediction_order" ? topicOf(a.eventTicker) : a.symbol,
      kind: "order",
      data: {
        orderType: a.kind === "prediction_order" ? a.orderType : "limit",
        filled: o.status === "filled" || (o.filledQuantity ?? 0) > 0,
        // How far below the cheapest seller the order was placed, in cents (prediction) or % (spot).
        gap: a.kind === "prediction_order" && m?.ask != null ? Math.round((m.ask - a.maxPrice) * 100) : undefined,
        minutesOpen: o.updatedAt && run.finishedAt ? Math.round((Date.parse(o.updatedAt) - Date.parse(run.finishedAt)) / 60_000) : undefined,
        venue: o.venue,
      },
      createdAt: new Date().toISOString(),
    },
    run.id,
  );
}

/** Records how a real position resolved, once per job. */
export function recordSettlement(run: Run, s: { won: boolean; practice: boolean; cost: number; paid: number }) {
  const a = run.proposal?.action;
  if (!a || a.kind !== "prediction_order" || s.practice) return;
  save({ id: randomUUID(), agent: run.agent, topic: a.combo ? "Combinations" : topicOf(a.eventTicker), kind: "outcome", data: { won: s.won, price: a.maxPrice, hedge: Boolean(run.proposal?.hedge) }, createdAt: new Date().toISOString() }, run.id);
}

/** Plain-language lessons for the agent's prompt, from aggregated outcomes. */
export function lessonLines(agent: AgentId, max = 6): string[] {
  const all = allLessons(agent);
  const out: string[] = [];
  const byTopic = new Map<string, Lesson[]>();
  for (const l of all.filter((x) => x.kind === "order")) byTopic.set(l.topic, [...(byTopic.get(l.topic) ?? []), l]);
  for (const [topic, ls] of byTopic) {
    const filled = ls.filter((l) => l.data.filled);
    const gaps = (xs: Lesson[]) => xs.map((l) => l.data.gap).filter((g): g is number => typeof g === "number");
    const fg = gaps(filled);
    const mg = gaps(ls.filter((l) => !l.data.filled));
    let line = `${topic}: ${filled.length} of ${ls.length} past orders filled`;
    if (fg.length) line += `; fills came ${Math.max(...fg) <= 0 ? "at or above the ask" : `up to ${Math.max(...fg)}¢ below the ask`}`;
    if (mg.length) line += `; orders ${Math.min(...mg)}¢+ below the ask were cancelled unfilled`;
    out.push(line);
  }
  const ends = new Map<string, Lesson[]>();
  for (const l of all.filter((x) => x.kind === "outcome")) ends.set(l.topic, [...(ends.get(l.topic) ?? []), l]);
  for (const [topic, ls] of ends) out.push(`${topic}: ${ls.filter((l) => l.data.won).length} of ${ls.length} past positions paid out at settlement`);
  const reasons = new Map<string, number>();
  for (const l of all.filter((x) => x.kind === "rejection")) reasons.set(`${l.topic}: ${l.data.reason}`, (reasons.get(`${l.topic}: ${l.data.reason}`) ?? 0) + 1);
  for (const [r, n] of reasons) out.push(`Exchange refused before (${n}×) — ${r}`);
  return out.slice(0, max);
}
