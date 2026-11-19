"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { toast } from "@/components/Toaster";
import { NotifyToggle } from "@/components/AppShell";
import { ExchangePanel } from "@/components/ExchangePanel";
import { WalletPanel } from "@/components/passkey/WalletPanel";
import { usePasskeyWallet } from "@/components/passkey/usePasskey";
import { jobNetwork, usePrefs } from "@/lib/prefs";
import type { FailureCode } from "@/lib/types";

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
  live: boolean;
  faultsEnabled: boolean;
  liveNeedsCode?: boolean;
  setup?: string[];
  gateway?: { balance: number; depositedToday: number; dailyCap: number } | null;
  /** Both Arc networks: whether live jobs can run on each, and what's missing if not. */
  networks?: Record<"testnet" | "mainnet", { name: string; live: boolean; setup: string[]; maxJobUsd: number | null }>;
}

function Block({ title, sub, children, id }: { title: string; sub: string; children: React.ReactNode; id: string }) {
  return (
    <section className="rounded-2xl border border-line bg-panel" aria-labelledby={id}>
      <div className="border-b border-[#f1f0ec] px-4 py-3">
        <h2 id={id} className="text-[15px] font-semibold">
          {title}
        </h2>
        <p className="mt-0.5 text-[13px] text-ink-3">{sub}</p>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

const LIMIT_FIELDS: { key: keyof Limits; label: string; help: string; unit: string; step: number }[] = [
  { key: "maxOrderUsd", label: "Largest single order", help: "An agent can never place an order above this.", unit: "USD", step: 1 },
  { key: "maxJobUsdc", label: "Most a job can spend on data", help: "The vault for one job never holds more than this.", unit: "USDC", step: 0.5 },
  { key: "maxPlanUsd", label: "Most a plan can cost in total", help: "Starting a plan approves its steps one by one; together they never go past this.", unit: "USD", step: 5 },
  { key: "bigSpendUsdc", label: "Flag purchases above", help: "Bigger purchases are pointed out before you approve.", unit: "USDC", step: 0.05 },
];

/** Where jobs pay: practice (nothing settles), Arc testnet (test USDC) or Arc mainnet (real USDC). */
const RAILS: { label: string; sub: string; mode: "demo" | "live"; network?: "testnet" | "mainnet" }[] = [
  { label: "Practice", sub: "Real data; vault and orders simulated", mode: "demo" },
  { label: "Arc testnet", sub: "Test USDC, onchain", mode: "live", network: "testnet" },
  { label: "Arc mainnet", sub: "Real USDC, onchain", mode: "live", network: "mainnet" },
];

export default function Settings() {
  const [prefs, setPrefs, ready] = usePrefs();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [saving, setSaving] = useState(false);
  const pk = usePasskeyWallet();

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

  const mode = prefs.mode ?? (cfg?.live && !cfg.liveNeedsCode ? "live" : "demo");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-2">
          Set these once. Every job follows them, whatever an agent proposes.{" "}
          <Link href="/safety" className="font-medium underline underline-offset-2">
            How it stays safe
          </Link>
        </p>
      </div>

      <Block id="s-limits" title="Spending limits" sub="Checked in code on every job. Nothing is ever spent without your approval either way.">
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
                    className="num h-10 w-24 rounded-lg border border-line bg-surface px-3 text-right text-sm outline-none focus:border-ink/40"
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

      <Block id="s-pay" title="Paying" sub="Where the USDC for data and services comes from.">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Network">
          {RAILS.map((r) => {
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
            Arc mainnet is ready in the app but not switched on here yet: {cfg.networks.mainnet.setup[0]}.
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
            {prefs.payFrom === "passkey" ? <WalletPanel /> : <p className="text-[12.5px] text-ink-3">The app&apos;s own Circle wallet funds each job&apos;s vault. Needed for plans, which approve each step for you.</p>}
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
            Marketplace balance (Circle Gateway): {cfg.gateway.balance.toFixed(4)} USDC · topped up {cfg.gateway.depositedToday} of {cfg.gateway.dailyCap} USDC today
          </p>
        )}
        {cfg?.setup && cfg.setup.length > 0 && (
          <div className="mt-3 rounded-lg border border-warn bg-warn/10 px-3 py-2 text-[12.5px] text-warn-ink" data-testid="setup-problems">
            <b>Setup on this machine:</b>
            <ul className="mt-1 list-disc pl-4">
              {cfg.setup.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
      </Block>

      <Block id="s-money" title="Add money" sub="Get USDC onto Arc testnet or mainnet: buy it with a card or bank, bring it from another chain, or get free test USDC.">
        <Link href="/wallet" className="pix-press inline-flex h-10 items-center gap-2 rounded-lg border-[1.5px] border-ink bg-ink px-4 text-sm font-semibold text-white" data-testid="settings-add-money">
          <Icon name="wallet" size={16} /> Add money
        </Link>
      </Block>

      <Block id="s-exchange" title="Exchange" sub="Where approved orders are placed.">
        <div className="-mt-3">
          <ExchangePanel />
        </div>
      </Block>

      <Block id="s-notify" title="Notifications" sub="Hear about it when a job needs you or an order fills.">
        <NotifyToggle />
      </Block>

      {cfg?.faultsEnabled && (
        <Block id="s-test" title="Test mode" sub="Make things go wrong on purpose and watch the agent ask before anything changes. Applies to new jobs until you clear it.">
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
    </div>
  );
}
