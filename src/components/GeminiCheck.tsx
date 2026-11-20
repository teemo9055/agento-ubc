"use client";
import { useState } from "react";
import { Button, Spinner } from "./ui";
import { contractName } from "@/lib/contract-name";

type Order = { orderId: string; symbol: string; side: "buy" | "sell"; outcome: "yes" | "no"; price: number; quantity: number; filled: number; status: string; createdAt?: string };
type Check = {
  venue: string;
  venueName: string;
  connected: boolean;
  account?: { name: string; shortName: string; type?: string };
  masterKey: boolean;
  accounts?: { name: string; shortName: string }[];
  accountSetting?: string;
  termsAccepted?: boolean;
  open: Order[];
  recent: Order[];
  positions: { symbol: string; outcome: string; quantity: number }[];
  error?: string;
};

const cents = (x: number) => `${Math.round(x * 100)}¢`;
const envName = (venue: string) => (venue === "gemini" ? "GEMINI_LIVE_ACCOUNT" : "GEMINI_SANDBOX_ACCOUNT");

/**
 * Which Gemini account Agento's key trades on, and the prediction orders on it, read from Gemini.
 * If the website shows a different account, that's why orders seem to be missing.
 */
export function GeminiCheck() {
  const [c, setC] = useState<Check | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setC(await fetch("/api/settings/gemini-check", { cache: "no-store" }).then((r) => r.json()));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 border-t border-line pt-3" data-testid="gemini-check">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-3">Which Gemini account do Agento&apos;s orders go to?</span>
        <Button variant="ghost" className="h-8 shrink-0 text-[12.5px]" disabled={busy} onClick={run} data-testid="gemini-check-run">
          {busy ? <Spinner /> : "Check my Gemini connection"}
        </Button>
      </div>
      {c && (
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
          <Tile label="TRADES ON" title={c.account ? `${c.account.name || "Account"} (${c.account.shortName})` : c.masterKey ? "No account picked" : "Unknown"} tone={c.account ? "good" : "warn"}>
            {c.account
              ? `${c.venueName}. On Gemini's site, pick “${c.account.name}” in the account menu at the top to see these orders.`
              : c.error ?? "Gemini didn't say which account this key belongs to."}
          </Tile>
          <Tile label="KEY" title={c.masterKey ? "Master key" : "Account key"} tone={c.termsAccepted === false ? "warn" : "good"}>
            {c.masterKey
              ? `It can trade any account in the group, so it must be told which. ${c.accountSetting ? `Set to “${c.accountSetting}”.` : `Add ${envName(c.venue)}=<shortname> to .env.local and restart.`}${c.accounts?.length ? ` Accounts: ${c.accounts.map((a) => `${a.name} (${a.shortName})`).join(", ")}.` : ""}`
              : "It trades only its own account."}{" "}
            {c.termsAccepted === false ? "Prediction-market terms aren't accepted yet." : c.termsAccepted ? "Prediction-market terms accepted." : ""}
          </Tile>
          <Tile label="ON THIS ACCOUNT NOW" title={`${c.open.length} waiting · ${c.positions.length} held`} tone="good">
            Waiting orders are in ActiveTrader → Open orders. Filled ones become positions under Predictions.
          </Tile>
          <Tile label="LAST ORDERS ON THIS ACCOUNT" title={c.recent.length ? `${c.recent.length} recent` : "None yet"} tone={c.recent.length ? "good" : "warn"}>
            {c.recent.length ? (
              <span className="mt-1 grid gap-1">
                {c.recent.slice(0, 5).map((o) => (
                  <span key={o.orderId} className="block">
                    <span className="num">#{o.orderId}</span> · {contractName(o.symbol)} · {o.outcome.toUpperCase()} {o.filled}/{o.quantity} at {cents(o.price)} · {o.status}
                  </span>
                ))}
              </span>
            ) : (
              "No prediction orders on this account. If Agento placed some, the key belongs to another account."
            )}
          </Tile>
        </div>
      )}
    </div>
  );
}

function Tile({ label, title, tone, children }: { label: string; title: string; tone: "good" | "warn"; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border-[1.5px] px-3 py-2.5 ${tone === "good" ? "border-ink" : "border-warn/60 bg-warn/5"}`}>
      <div className="text-[11px] font-semibold tracking-wide text-ink-3">{label}</div>
      <div className="mt-0.5 text-[14px] font-semibold">{title}</div>
      <div className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{children}</div>
    </div>
  );
}
