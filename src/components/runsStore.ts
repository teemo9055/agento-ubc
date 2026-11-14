"use client";
import { useSyncExternalStore } from "react";
import type { RunSummary } from "@/lib/summary";

/** One shared live stream of job summaries for the whole tab. */
type State = { runs: RunSummary[] | null; connection: "connecting" | "live" | "reconnecting" };

let state: State = { runs: null, connection: "connecting" };
const subs = new Set<() => void>();
let es: EventSource | null = null;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const s of subs) s();
}

function connect() {
  if (es || typeof window === "undefined") return;
  es = new EventSource("/api/runs/stream");
  es.addEventListener("snapshot", (m) => set({ runs: JSON.parse((m as MessageEvent).data), connection: "live" }));
  es.addEventListener("upsert", (m) => {
    const r = JSON.parse((m as MessageEvent).data) as RunSummary;
    const list = state.runs ?? [];
    const i = list.findIndex((x) => x.id === r.id);
    set({ runs: i < 0 ? [r, ...list] : list.map((x, j) => (j === i ? r : x)) });
  });
  es.onopen = () => set({ connection: "live" });
  es.onerror = () => set({ connection: "reconnecting" }); // EventSource retries on its own
}

export function useRuns() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      connect();
      return () => subs.delete(cb);
    },
    () => state,
    () => state,
  );
}
