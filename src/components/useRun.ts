"use client";
import { useEffect, useReducer, useState } from "react";
import type { SeqEvent } from "@/lib/events";
import { reduce } from "@/lib/reducer";
import type { Run } from "@/lib/types";

/** Streams orchestrator events and folds them into state. */
export function useRun(id: string) {
  const [run, dispatch] = useReducer((s: Run | null, e: SeqEvent) => reduce(s, e), null);
  const [missing, setMissing] = useState(false);
  const [lastEvent, setLastEvent] = useState<SeqEvent | null>(null);

  useEffect(() => {
    let seq = -1;
    const es = new EventSource(`/api/runs/${id}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as SeqEvent;
      if (e.seq <= seq) return; // replayed on reconnect
      seq = e.seq;
      dispatch(e);
      setLastEvent(e);
    };
    es.addEventListener("missing", () => {
      setMissing(true);
      es.close();
    });
    return () => es.close();
  }, [id]);

  return { run, missing, lastEvent };
}

export async function post<T = unknown>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "request failed");
  return j as T;
}

/** Sets the page accent to the agent's colour. */
export function useAgentTheme(agent?: string) {
  useEffect(() => {
    if (!agent) return;
    document.body.dataset.agent = agent;
  }, [agent]);
}
