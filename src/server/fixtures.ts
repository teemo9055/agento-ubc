import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Recorded market data for tests. MARKET_DATA=record saves every public market/map GET the server
 * makes; MARKET_DATA=replay serves them back, with dates shifted so contracts that were open when
 * recorded are still open now. Anything else goes to the network as usual.
 */

const HOSTS = ["api.gemini.com", "api.sandbox.gemini.com", "nominatim.openstreetmap.org", "router.project-osrm.org"];
const PRIVATE = /\/v1\/(prediction-markets\/(order|orders|positions|terms\/status|terms\/accept)|order\/|orders|balances)/;

interface Saved {
  status: number;
  body: string;
}
interface Store {
  recordedAt: number;
  calls: Record<string, Saved>;
}

const keyOf = (url: URL) => `${url.host}${url.pathname}${url.search}`;

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const MS = /\b1\d{12}\b/g;
const SECS = /("timestamp":\s*)(1\d{9})\b/g;

/** Moves every timestamp near the recording time forward by the time since. */
export function shiftTimes(body: string, recordedAt: number, now = Date.now()): string {
  const d = now - recordedAt;
  const year = 366 * 86_400_000;
  return body
    .replace(ISO, (s) => {
      const t = Date.parse(s);
      return Math.abs(t - recordedAt) < year ? new Date(t + d).toISOString() : s;
    })
    .replace(MS, (s) => {
      const t = Number(s);
      return Math.abs(t - recordedAt) < year ? String(t + d) : s;
    })
    .replace(SECS, (_, k: string, s: string) => k + String(Math.abs(Number(s) * 1000 - recordedAt) < year ? Number(s) + Math.round(d / 1000) : s));
}

export function installFixtures(mode = process.env.MARKET_DATA, file = process.env.MARKET_DATA_FILE ?? "e2e/fixtures/market.json") {
  if (mode !== "record" && mode !== "replay") return;
  // Recording starts fresh so every call shares one recording time.
  const store: Store = mode === "replay" && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { recordedAt: Date.now(), calls: {} };
  const real = globalThis.fetch;
  let pending: NodeJS.Timeout | undefined;
  const save = () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(store, null, 1));
    }, 300);
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET" || !HOSTS.includes(url.host) || PRIVATE.test(url.pathname)) return real(input, init);
    const key = keyOf(url);
    if (mode === "replay") {
      const hit = store.calls[key];
      if (!hit) {
        console.warn(`[market-data] no recording for ${key}`);
        return new Response(JSON.stringify({ reason: "NotRecorded" }), { status: 503, headers: { "content-type": "application/json" } });
      }
      return new Response(shiftTimes(hit.body, store.recordedAt), { status: hit.status, headers: { "content-type": "application/json" } });
    }
    const res = await real(input, init);
    const body = await res.clone().text();
    if (res.status < 500) {
      store.calls[key] = { status: res.status, body };
      save();
    }
    return res;
  }) as typeof fetch;
  console.log(`[market-data] ${mode} ${file} (${Object.keys(store.calls).length} calls)`);
}
