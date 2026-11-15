"use client";
import { useEffect, useState } from "react";
import type { Venue } from "@/lib/types";
import { VenueBadge } from "./Chat";
import { Button, Spinner } from "./ui";
import { toast } from "./Toaster";
import { Icon } from "./Icon";

interface Status {
  venue: Venue;
  connected: boolean;
  note: string;
  termsAccepted?: boolean;
  usdAvailable?: number;
  error?: string;
}

/** Where approved orders go, and what's still needed before they can be placed. */
export function ExchangePanel() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [terms, setTerms] = useState<string | null>(null);
  const [check, setCheck] = useState<{ step: string; ok: boolean; detail: string }[] | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    fetch("/api/trading")
      .then((r) => r.json())
      .then(setS)
      .catch(() => undefined);
  }, []);
  if (!s) return null;

  async function accept() {
    setBusy(true);
    try {
      const r = await fetch("/api/trading", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "accept-terms" }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setS(j);
      toast("Gemini prediction-market terms accepted", "good");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  }

  async function runCheck() {
    setChecking(true);
    setCheck(null);
    try {
      const r = await fetch("/api/trading", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "self-test" }) });
      setCheck((await r.json()).steps ?? []);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-panel px-3.5 py-3 text-[13px]" data-testid="exchange-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Orders go to</span>
        <VenueBadge venue={s.venue} />
      </div>
      <p className="mt-1 text-ink-3">{s.note}.</p>
      {s.venue === "paper" && (
        <p className="mt-1 text-ink-2">
          Agents can still research and propose moves. To place real test orders, add Gemini sandbox API keys (<code>GEMINI_TRADING_KEY</code>, <code>GEMINI_TRADING_SECRET</code>) to
          <code> .env.local</code> and restart.
        </p>
      )}
      {s.venue !== "paper" && !s.connected && <p className="mt-1 text-bad">Couldn&apos;t reach your Gemini account: {s.error}</p>}
      {s.connected && (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="num text-ink-2">{s.usdAvailable != null ? `$${s.usdAvailable.toLocaleString()} available` : "Balance unavailable"}</span>
          {s.termsAccepted ? (
            <span className="inline-flex items-center gap-1 font-semibold text-good">
              <Icon name="check" size={13} stroke={2.6} /> Prediction-market terms accepted
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <button
                type="button"
                className="underline decoration-line underline-offset-2"
                onClick={() =>
                  fetch("/api/trading?terms=1")
                    .then((r) => r.json())
                    .then((t) => setTerms(t.content ?? t.error ?? "Couldn't load the terms"))
                }
              >
                Read Gemini&apos;s terms
              </button>
              <Button variant="ghost" className="h-8 text-[12.5px]" disabled={busy} onClick={accept} data-testid="accept-terms">
                {busy ? <Spinner /> : "I accept"}
              </Button>
            </span>
          )}
        </div>
      )}
      {s.venue === "gemini-sandbox" && s.connected && (
        <div className="mt-2 border-t border-line pt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-3">Places a 1-contract order at 1¢, then cancels it.</span>
            <Button variant="ghost" className="h-8 shrink-0 text-[12.5px]" disabled={checking} onClick={runCheck} data-testid="exchange-check">
              {checking ? <Spinner /> : "Test the connection"}
            </Button>
          </div>
          {check && (
            <ul className="mt-1.5 space-y-0.5">
              {check.map((c) => (
                <li key={c.step} className="flex gap-1.5">
                  <span className={c.ok ? "text-good" : "text-bad"}>{c.ok ? "✓" : "✗"}</span>
                  <span>
                    <span className="font-medium">{c.step}</span> <span className="text-ink-3">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {terms && <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-panel p-2 text-[11.5px] text-ink-2">{terms}</div>}
    </div>
  );
}
