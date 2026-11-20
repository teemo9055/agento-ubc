"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { Point, Points } from "@/components/Points";
import { toast } from "@/components/Toaster";
import { NotifyToggle } from "@/components/AppShell";
import { ExchangePanel } from "@/components/ExchangePanel";
import dynamic from "next/dynamic";
import { usePasskeyWallet } from "@/components/passkey/usePasskey";
import { jobMode, jobNetwork, usePrefs } from "@/lib/prefs";
import type { FailureCode } from "@/lib/types";
import { Marketplace } from "@/components/Marketplace";
import { Selling } from "@/components/Selling";

// The passkey wallet library is big: it loads only when someone pays with their passkey.
const WalletPanel = dynamic(() => import("@/components/passkey/WalletPanel").then((m) => m.WalletPanel), { ssr: false, loading: () => <div className="h-24 animate-pulse rounded-xl bg-[#f6f5f1]" /> });

const FAULTS: { code: FailureCode; label: string }[] = [
  { code: "price_increase", label: "Seller raises price" },
  { code: "seller_402_timeout", label: "Seller times out" },
  { code: "payment_rejected", label: "Payment rejected" },
  { code: "settle_fails", label: "Settlement fails" },
  { code: "insufficient_balance", label: "Vault runs dry" },
  { code: "policy_block", label: "Agent tries off-plan spend" },
  { code: "model_error", label: "Analysis crashes" },
  { code: "approval_timeout", label: "Re-approval times out" },
  { code: "bad_delivery", label: "Seller sends an empty answer" },
];

interface Limits {
  bigSpendUsdc: number;
  maxOrderUsd: number;
  maxJobUsdc: number;
  maxPlanUsd: number;
}
interface Config {
  venues?: { id: "paper" | "gemini-sandbox" | "gemini"; name: string }[];
  defaultVenue?: "paper" | "gemini-sandbox" | "gemini";
  practice?: boolean;
  live: boolean;
  faultsEnabled: boolean;
  liveNeedsCode?: boolean;
  setup?: string[];
  gateway?: { balance: number; depositedToday: number; dailyCap: number } | null;
  /** Both Arc networks: whether live jobs can run on each, and what's missing if not. */
  networks?: Record<"testnet" | "mainnet", { name: string; live: boolean; setup: string[]; maxJobUsd: number | null }>;
}

function Block({ title, sub, children, id }: { title: string; sub?: string; children: React.ReactNode; id: string }) {
  return (
    <section className="rounded-2xl border-[1.5px] border-ink bg-panel" aria-labelledby={id}>
      <div className="border-b-[1.5px] border-ink/10 px-5 py-3.5">
        <h2 id={id} className="text-[16px] font-semibold">
          {title}
        </h2>
        {sub && <p className="mt-0.5 text-[13px] text-ink-3">{sub}</p>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

const LIMIT_FIELDS: { key: keyof Limits; label: string; help: string; unit: string; step: number }[] = [
  { key: "maxOrderUsd", label: "Largest single order", help: "Never placed above this", unit: "USD", step: 1 },
  { key: "maxJobUsdc", label: "Most a job spends on data", help: "Per job", unit: "USDC", step: 0.5 },
  { key: "maxPlanUsd", label: "Most a plan costs in total", help: "All its steps together", unit: "USD", step: 5 },
  { key: "bigSpendUsdc", label: "Point out purchases above", help: "Before you approve", unit: "USDC", step: 0.05 },
];

/** Where jobs pay: practice (nothing settles), Arc testnet (test USDC) or Arc mainnet (real USDC). */
const RAILS: { label: string; sub: string; mode: "demo" | "live"; network?: "testnet" | "mainnet" }[] = [
  { label: "Practice", sub: "Nothing settles", mode: "demo" },
  { label: "Arc testnet", sub: "Test USDC", mode: "live", network: "testnet" },
  { label: "Arc mainnet", sub: "USDC", mode: "live", network: "mainnet" },
];

export default function Settings() {
  const [prefs, setPrefs, ready] = usePrefs();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [saving, setSaving] = useState(false);
  const pk = usePasskeyWallet(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => undefined);
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => setLimits(j.limits))
      .catch(() => undefined);
  }, []);

  async function saveLimits() {
    if (!limits) return;
    setSaving(true);
    try {
      const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limits }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setLimits(j.limits);
      toast("Limits saved · they apply to every new job", "good");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setSaving(false);
    }
  }

  const mode = jobMode(prefs, cfg);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="font-pixel text-[30px] leading-tight">Settings</h1>
        <p className="mt-1 text-[15px] text-ink-2">
          Every job follows these.{" "}
          <Link href="/safety" className="font-medium underline underline-offset-2">
            How it stays safe
          </Link>
        </p>
      </div>

      <Block id="s-limits" title="Spending limits">
        {!limits ? (
          <Spinner />
        ) : (
          <div className="space-y-3">
            {LIMIT_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium">{f.label}</span>
                  <span className="block text-[12.5px] text-ink-3">{f.help}</span>
                </span>
                <span className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    step={f.step}
                    value={limits[f.key]}
                    onChange={(e) => setLimits({ ...limits, [f.key]: Number(e.target.value) })}
                    className="num h-10 w-24 rounded-lg border-[1.5px] border-line bg-surface px-3 text-right text-sm outline-none focus:border-ink"
                    data-testid={`limit-${f.key}`}
                  />
                  <span className="w-10 text-[12.5px] text-ink-3">{f.unit}</span>
                </span>
              </label>
            ))}
            <div className="flex justify-end pt-1">
              <Button onClick={saveLimits} disabled={saving} className="h-9" data-testid="save-limits">
                {saving ? <Spinner /> : null} Save limits
              </Button>
            </div>
          </div>
        )}
      </Block>

      <Block id="s-pay" title="Paying">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Network">
          {RAILS.filter((r) => r.mode === "live" || cfg?.practice || !cfg?.live).map((r) => {
            const net = r.network ? cfg?.networks?.[r.network] : undefined;
            const off = r.mode === "live" && !(r.network === "mainnet" ? net?.live : cfg?.live);
            const on = ready && mode === r.mode && (r.mode === "demo" || jobNetwork(prefs, cfg ?? null) === r.network);
            return (
              <button
                key={r.label}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={off}
                onClick={() => setPrefs(r.network ? { mode: r.mode, network: r.network } : { mode: r.mode })}
                title={off ? (r.network === "mainnet" ? (net?.setup?.join(" · ") ?? "Arc mainnet isn't set up on this server") : (cfg?.setup?.join(" · ") ?? "Arc testnet isn't set up on this machine")) : undefined}
                className={`pressable tap rounded-lg border px-3 py-2 text-left text-[13px] disabled:opacity-50 ${on ? (r.network === "mainnet" ? "border-ink bg-warn text-ink shadow-[2px_2px_0_0_var(--color-ink)]" : "border-ink bg-ink text-white") : "border-line bg-panel text-ink-2"}`}
                data-testid={`rail-${r.network ?? "practice"}`}
              >
                <span className="block font-semibold">{r.label}</span>
                <span className={`block text-[12px] ${on ? (r.network === "mainnet" ? "text-ink-2" : "text-white/70") : "text-ink-3"}`}>
                  {r.network === "mainnet" && net?.maxJobUsd ? `${r.sub}, up to $${net.maxJobUsd} a job` : r.sub}
                </span>
              </button>
            );
          })}
        </div>
        {cfg?.networks?.mainnet && !cfg.networks.mainnet.live && (
          <p className="mt-2 text-[12.5px] text-ink-3" data-testid="mainnet-setup">
            Mainnet isn&apos;t switched on here yet: {cfg.networks.mainnet.setup[0]}.
          </p>
        )}
        {mode === "live" && pk.supported && (
          <div className="mt-3 space-y-3">
            <div className="flex gap-1 text-[12.5px]" role="radiogroup" aria-label="Pay from">
              {(["app", "passkey"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={prefs.payFrom === p}
                  onClick={() => setPrefs({ payFrom: p })}
                  className={`pressable tap rounded-lg border px-3 py-1.5 font-medium ${prefs.payFrom === p ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink-2"}`}
                >
                  {p === "passkey" ? "My passkey wallet" : "App wallet"}
                </button>
              ))}
            </div>
            {prefs.payFrom === "passkey" ? <WalletPanel /> : <p className="text-[12.5px] text-ink-3">The app&apos;s wallet funds each job. Plans need it.</p>}
          </div>
        )}
        {mode === "live" && prefs.payFrom !== "passkey" && cfg?.liveNeedsCode && (
          <input
            type="password"
            value={prefs.accessCode ?? ""}
            onChange={(e) => setPrefs({ accessCode: e.target.value })}
            placeholder="Access code for Arc testnet jobs"
            aria-label="Access code"
            className="mt-3 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-ink/40"
          />
        )}
        {cfg?.gateway && (
          <p className="num mt-3 text-[12.5px] text-ink-3">
            Marketplace balance {cfg.gateway.balance.toFixed(4)} USDC · {cfg.gateway.depositedToday} of {cfg.gateway.dailyCap} topped up today
          </p>
        )}
        {cfg?.setup && cfg.setup.length > 0 && (
          <details className="group mt-3 rounded-lg border-[1.5px] border-warn bg-warn/10 px-3 py-2 text-[12.5px] text-warn-ink" data-testid="setup-problems">
            <summary className="cursor-pointer list-none font-semibold">
              {cfg.setup.length} {cfg.setup.length === 1 ? "thing isn't" : "things aren't"} set up on this machine <span className="font-normal underline underline-offset-2 group-open:hidden">Show</span>
            </summary>
            <Points as="ul" layout="stack" className="mt-1.5">
              {cfg.setup.map((x) => (
                <Point as="li" key={x} size="sm" tone="warn">
                  {x}
                </Point>
              ))}
            </Points>
          </details>
        )}
      </Block>

      <Block id="s-exchange" title="Exchange">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Where orders go" data-testid="venue-choice">
          {(
            [
              { id: "paper", label: "Practice", sub: "Priced live, never sent" },
              { id: "gemini-sandbox", label: "Gemini test exchange", sub: "Real orders, test money" },
              { id: "gemini", label: "Gemini", sub: "Real orders, real money" },
            ] as const
          )
            // Practice is only offered until a Gemini account is connected.
            .filter((v) => v.id !== "paper" || !cfg?.venues || cfg.venues.some((x) => x.id === "paper"))
            .map((v) => {
            const ok = !cfg?.venues || cfg.venues.some((x) => x.id === v.id);
            const on = ready && (prefs.venue ?? cfg?.defaultVenue ?? "paper") === v.id;
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!ok}
                onClick={() => setPrefs({ venue: v.id })}
                title={ok ? undefined : "Not connected on this server: add its Gemini API key"}
                className={`pressable tap rounded-lg border px-3 py-2 text-left text-[13px] disabled:opacity-45 ${on ? (v.id === "gemini" ? "border-ink bg-bad text-white shadow-[2px_2px_0_0_var(--color-ink)]" : "border-ink bg-ink text-white") : "border-line bg-panel text-ink-2"}`}
                data-testid={`venue-${v.id}`}
              >
                <span className="block font-semibold">{v.label}</span>
                <span className={`block text-[12px] ${on ? "text-white/75" : "text-ink-3"}`}>{ok ? v.sub : "Not connected here yet"}</span>
              </button>
            );
          })}
        </div>
        {cfg?.venues && !cfg.venues.some((v) => v.id === "gemini") && (
          <div className="mt-3 rounded-xl border-[1.5px] border-ink bg-agent-soft/50 p-3 shadow-[3px_3px_0_0_var(--agent)]" data-testid="connect-gemini">
            <p className="text-[13.5px] font-semibold">Connect Gemini to place real orders</p>
            <p className="mt-1 text-[12.5px] leading-snug text-ink-2">
              Add <code className="rounded bg-panel px-1">GEMINI_LIVE_KEY</code> and <code className="rounded bg-panel px-1">GEMINI_LIVE_SECRET</code> to <code className="rounded bg-panel px-1">.env.local</code>, then restart.
            </p>
          </div>
        )}
        <div className="mt-3">
          <ExchangePanel />
        </div>
      </Block>

      <Block id="s-notify" title="Notifications">
        <NotifyToggle />
      </Block>

      {cfg?.faultsEnabled && (
        <Block id="s-test" title="Test mode" sub="Make things go wrong on purpose in new jobs.">
          <div className="flex flex-wrap gap-2">
            {FAULTS.map((f) => {
              const on = prefs.faults.includes(f.code);
              return (
                <label
                  key={f.code}
                  className={`pressable tap inline-flex cursor-pointer select-none items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${on ? "border-warn bg-warn/15 text-warn-ink" : "border-line text-ink-2 hover:border-ink/30"}`}
                >
                  <input type="checkbox" className="sr-only" checked={on} onChange={(e) => setPrefs({ faults: e.target.checked ? [...prefs.faults, f.code] : prefs.faults.filter((x) => x !== f.code) })} />
                  {on && <Icon name="check" size={13} stroke={2.4} />}
                  {f.label}
                </label>
              );
            })}
          </div>
          {prefs.faults.length > 0 && (
            <button type="button" className="mt-3 text-[12.5px] underline decoration-line underline-offset-2" onClick={() => setPrefs({ faults: [] })}>
              Clear all
            </button>
          )}
        </Block>
      )}
      {/* The other side of the marketplace: services the agents buy from, and what this app sells to other agents. */}
      <Selling />
      <Marketplace />
    </div>
  );
}
