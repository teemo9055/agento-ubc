"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { formatUnits, isAddress, parseUnits, type Hex } from "viem";
import { Icon, type IconName } from "@/components/Icon";
import { Button, Spinner } from "@/components/ui";
import { usePasskeyWallet } from "@/components/passkey/usePasskey";
import { sendCalls, withdrawCalls } from "@/components/passkey/wallet";
import { useArcBalance } from "@/components/wallet/useArcBalance";
import { usePrefs } from "@/lib/prefs";
import { NETS, NETWORKS, addressLink, txLink, type Net } from "@/lib/networks";

const ADDRESS_KEY = "agento:fund-address";

const fmtUsdc = (v: bigint) => {
  const s = formatUnits(v, 6);
  const [i, d = ""] = s.split(".");
  return `${Number(i).toLocaleString("en-US")}.${(d + "00").slice(0, Math.max(2, d.replace(/0+$/, "").length))}`;
};

/**
 * Wallet: pick a network, see the address and its balance, then deposit USDC onto Arc or withdraw it.
 * Agento never holds the money. Withdrawing from here works for the passkey wallet on testnet; any
 * other address is moved from the wallet app that holds it.
 */
export default function WalletPage() {
  const [prefs, setPrefs, ready] = usePrefs();
  const net: Net = (prefs.walletNetwork ?? "testnet") === "mainnet" ? "mainnet" : "testnet";
  const n = NETWORKS[net];
  const pk = usePasskeyWallet();
  const [typed, setTyped] = useState("");
  const [useOther, setUseOther] = useState(false);
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");

  useEffect(() => {
    setTyped(localStorage.getItem(ADDRESS_KEY) ?? "");
  }, []);

  // The passkey wallet is set up for Arc testnet in this app, so mainnet always takes an address you paste.
  const passkeyAddress = net === "testnet" && !useOther ? (pk.wallet?.address ?? null) : null;
  const clean = typed.trim();
  const typedOk = isAddress(clean);
  const address = passkeyAddress ?? (typedOk ? clean : null);
  const bal = useArcBalance(net, address);

  // "Arrived" = the balance went up after money was sent (the reliable signal).
  const [watch, setWatch] = useState<{ key: string; base: bigint | null } | null>(null);
  const key = `${net}:${address?.toLowerCase() ?? ""}`;
  const startWatch = () => setWatch({ key, base: bal.value });
  useEffect(() => {
    if (watch && watch.key === key && watch.base == null && bal.value != null) setWatch({ ...watch, base: bal.value });
  }, [watch, key, bal.value]);
  const arrived = watch && watch.key === key && watch.base != null && bal.value != null && bal.value > watch.base ? fmtUsdc(bal.value - watch.base) : null;

  useEffect(() => {
    setWatch(null);
  }, [key]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6" data-testid="add-money" data-network={net}>
      <header>
        <h1 className="font-pixel text-[30px] leading-tight sm:text-[34px]">Wallet</h1>
        <p className="mt-1.5 text-[15px] text-ink-2">The USDC your agents pay with, on Arc. Agento never holds it.</p>
      </header>

      <div role="radiogroup" aria-label="Network" className="grid grid-cols-2 gap-3 sm:max-w-md" data-testid="network-switch">
        {NETS.map((x) => {
          const on = ready && net === x;
          const real = NETWORKS[x].realMoney;
          return (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setPrefs({ walletNetwork: x })}
              className={`pressable tap rounded-xl border-[1.5px] px-3.5 py-2.5 text-left transition-colors ${on ? "border-ink bg-ink text-white shadow-[3px_3px_0_0_var(--agent)]" : "border-line bg-panel text-ink-2 hover:border-ink/40"}`}
            >
              <span className="block text-[15px] font-semibold">{real ? "Mainnet" : "Testnet"}</span>
              <span className={`block text-[12.5px] ${on ? "text-white/80" : "text-ink-3"}`}>{real ? "USDC" : "Free test USDC"}</span>
            </button>
          );
        })}
      </div>

      {n.realMoney && (
        <p className="flex items-center gap-2 text-[13.5px] font-medium text-bad" role="note" data-testid="real-money">
          <Icon name="shield" size={16} className="shrink-0" /> This is real money, and transfers on Arc can&apos;t be undone.
        </p>
      )}

      <section aria-labelledby="addr-title" className="rounded-2xl border-[1.5px] border-ink bg-panel p-5 shadow-[4px_4px_0_0_var(--color-ink)]">
        <h2 id="addr-title" className="text-[13px] font-semibold text-ink-3">
          Your address on {n.name}
        </h2>
        {passkeyAddress ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="num break-all text-[14.5px]" data-testid="fund-address">
              {passkeyAddress}
            </span>
            <CopyButton text={passkeyAddress} />
            <button type="button" onClick={() => setUseOther(true)} className="text-[13px] text-ink-2 underline underline-offset-2 hover:text-ink">
              Use a different address
            </button>
          </div>
        ) : (
          <div className="mt-1.5">
            <label htmlFor="fund-address" className="block text-[13px] text-ink-3">
              {net === "mainnet" && pk.wallet ? "Your passkey wallet works on testnet here. For mainnet, paste an Arc address you control." : "Paste an Arc address you control. It starts with 0x."}
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                id="fund-address"
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  const v = e.target.value.trim();
                  if (isAddress(v)) localStorage.setItem(ADDRESS_KEY, v);
                }}
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={Boolean(clean) && !typedOk}
                aria-describedby={clean && !typedOk ? "address-error" : undefined}
                className={`num h-11 w-full max-w-xl rounded-lg border-[1.5px] bg-surface px-3 text-[14px] outline-none ${clean && !typedOk ? "border-bad" : "border-line focus:border-ink"}`}
                data-testid="address-input"
              />
              {useOther && pk.wallet && net === "testnet" && (
                <button type="button" onClick={() => setUseOther(false)} className="text-[13px] text-ink-2 underline underline-offset-2 hover:text-ink">
                  Use my passkey wallet
                </button>
              )}
            </div>
            {clean && !typedOk && (
              <p id="address-error" className="mt-1.5 text-[13px] text-bad" role="alert" data-testid="address-error">
                That isn&apos;t an Arc address. It should be 0x followed by 40 letters and numbers (0-9, a-f).
              </p>
            )}
          </div>
        )}
        {address && (
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t-[1.5px] border-ink/10 pt-4">
            <div>
              <div className="text-[13px] text-ink-3">Balance</div>
              <div className="num text-[28px] font-semibold leading-tight" data-testid="balance">
                {bal.value != null ? (
                  <>
                    {fmtUsdc(bal.value)} <span className="text-[14px] font-normal text-ink-3">USDC</span>
                  </>
                ) : bal.failed ? (
                  <span className="text-[14px] font-normal text-ink-3">Couldn&apos;t read it right now</span>
                ) : (
                  <Spinner />
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {arrived && (
                <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-good" role="status" data-testid="arrived">
                  <Icon name="check" size={13} stroke={2.6} /> Arrived +{arrived} USDC
                </span>
              )}
              <a href={addressLink(net, address)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-ink-2 underline underline-offset-2 hover:text-ink" data-testid="explorer-link">
                See it on the explorer <Icon name="external" size={12} />
              </a>
            </div>
          </div>
        )}
      </section>

      <div role="tablist" aria-label="Move money" className="inline-flex self-start rounded-xl border-[1.5px] border-ink bg-panel p-1" data-testid="wallet-tabs">
        {(["deposit", "withdraw"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`relative h-9 rounded-lg px-5 text-[14px] font-semibold transition-colors ${tab === t ? "text-white" : "text-ink-2 hover:text-ink"}`}
            data-testid={`tab-${t}`}
          >
            {tab === t && <motion.span layoutId="wallet-tab" className="absolute inset-0 rounded-lg bg-ink" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className="relative">{t === "deposit" ? "Deposit" : "Withdraw"}</span>
          </button>
        ))}
      </div>

      {tab === "deposit" ? (
        <section aria-label="Deposit" role="tabpanel">
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {n.realMoney ? (
              <WayCard testId="send-card" icon="send" title="Send USDC on Arc" line="Send USDC on the Arc network to the address above, from a wallet app or an exchange.">
                <Button variant="ghost" onClick={startWatch} disabled={!address} data-testid="watch-arrival">
                  <Icon name="send" size={16} /> I&apos;ve sent it
                </Button>
              </WayCard>
            ) : (
              <FaucetCard address={address} onSent={() => { startWatch(); void bal.refresh(); }} />
            )}
          </ul>
          {!address && <p className="mt-3 text-[13px] text-ink-3">Add an address above first; that&apos;s where the USDC goes.</p>}
          {watch && !arrived && address && <p className="mt-3 text-[13px] text-ink-3" role="status">Watching your balance. It updates here as soon as the USDC lands.</p>}
        </section>
      ) : (
        <section aria-label="Withdraw" role="tabpanel">
          {passkeyAddress ? (
            <WithdrawForm from={passkeyAddress as Hex} balance={bal.value} onDone={() => void bal.refresh()} />
          ) : (
            <div className="rounded-2xl border-[1.5px] border-ink bg-panel p-5" data-testid="withdraw-elsewhere">
              <h3 className="font-pixel text-[16px] leading-tight">Withdraw from your wallet app</h3>
              <p className="mt-2 text-[14px] text-ink-2">
                {net === "mainnet" ? "Mainnet money sits at an address you hold in your own wallet app, so you move it from there." : "This address is held in your own wallet app, so you move its USDC from there."} Withdrawing here works for your passkey wallet on testnet.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className="pressable inline-flex h-8 items-center gap-1.5 rounded-lg border-[1.5px] border-ink bg-panel px-3 text-[12.5px] font-semibold"
      data-testid="copy-address"
    >
      <Icon name={done ? "check" : "receipt"} size={13} stroke={2.4} /> {done ? "Copied" : "Copy"}
    </button>
  );
}

function WithdrawForm({ from, balance, onDone }: { from: Hex; balance: bigint | null; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);
  const toOk = isAddress(to.trim()) && to.trim().toLowerCase() !== from.toLowerCase();
  let units: bigint | null = null;
  try {
    units = /^\d*\.?\d{0,6}$/.test(amount.trim()) && Number(amount) > 0 ? parseUnits(amount.trim(), 6) : null;
  } catch {
    units = null;
  }
  const tooMuch = units != null && balance != null && units > balance;
  const ok = units != null && !tooMuch && toOk && !busy;

  async function send() {
    if (!ok || units == null) return;
    setBusy(true);
    setMsg(null);
    try {
      // Testnet only: the passkey wallet in this app never moves mainnet money.
      const tx = await sendCalls(withdrawCalls(NETWORKS.testnet.usdc as Hex, to.trim() as Hex, units), "testnet");
      setMsg({ ok: true, text: `Sent ${amount} test USDC.`, tx });
      setAmount("");
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || "The withdrawal didn't go through. Nothing was sent." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border-[1.5px] border-ink bg-panel p-5 shadow-[4px_4px_0_0_var(--agent)]"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      data-testid="withdraw-form"
    >
      <label className="block">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-agent-ink">Amount</span>
        <span className="mt-1.5 flex items-center gap-2 rounded-lg border-[1.5px] border-ink bg-surface px-3 focus-within:shadow-[2px_2px_0_0_var(--agent)]">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="num h-11 min-w-0 flex-1 bg-transparent text-[18px] outline-none" data-testid="withdraw-amount" />
          <span className="text-[13px] text-ink-3">USDC</span>
          <button type="button" disabled={balance == null} onClick={() => balance != null && setAmount(formatUnits(balance, 6))} className="rounded-md border-[1.5px] border-ink px-2 py-0.5 text-[12px] font-semibold disabled:opacity-40" data-testid="withdraw-max">
            Max
          </button>
        </span>
        {tooMuch && <span className="mt-1 block text-[12.5px] text-bad">That&apos;s more than the balance.</span>}
      </label>
      <label className="block">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-agent-ink">To address</span>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" className="num mt-1.5 h-11 w-full rounded-lg border-[1.5px] border-ink bg-surface px-3 text-[14px] outline-none focus:shadow-[2px_2px_0_0_var(--agent)]" data-testid="withdraw-to" />
        {to.trim() && !toOk && <span className="mt-1 block text-[12.5px] text-bad">Use an Arc address other than this wallet&apos;s, starting with 0x.</span>}
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t-[1.5px] border-ink/10 pt-4">
        <span className="text-[13px] text-ink-3">Network fee is covered on testnet</span>
        <button type="submit" disabled={!ok} className="pix-press inline-flex h-11 items-center gap-2 rounded-lg border-[1.5px] border-ink bg-ink px-5 text-[14.5px] font-semibold text-white disabled:opacity-40" data-testid="withdraw-send">
          {busy ? <Spinner /> : <Icon name="send" size={16} />} Withdraw{units != null && !tooMuch ? ` ${amount} USDC` : ""}
        </button>
      </div>
      {msg && (
        <p className={`text-[13px] ${msg.ok ? "text-good" : "text-bad"}`} role={msg.ok ? "status" : "alert"}>
          {msg.text}{" "}
          {msg.tx && (
            <a href={txLink("testnet", msg.tx)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              transaction
            </a>
          )}
        </p>
      )}
    </form>
  );
}

function WayCard({ testId, icon, title, line, children }: { testId: string; icon: IconName; title: string; line: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-ink bg-panel p-5" data-testid={testId}>
      <div className="flex items-center gap-2.5">
        <span className="pix-shadow inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border-[1.5px] border-ink bg-agent text-agent-on" aria-hidden>
          <Icon name={icon} size={18} />
        </span>
        <h3 className="font-pixel text-[16px] leading-tight">{title}</h3>
      </div>
      <p className="text-[13.5px] text-ink-2">{line}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2">{children}</div>
    </li>
  );
}

function FaucetCard({ address, onSent }: { address: string | null; onSent: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);
  const faucet = NETWORKS.testnet.faucet!;
  async function drip() {
    if (!address) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; amount?: string; txHash?: string; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? "The app's faucet didn't answer. Use Circle's faucet instead.");
      setMsg({ ok: true, text: `Sent ${j.amount ?? "1.00"} test USDC.`, tx: j.txHash });
      onSent();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <WayCard testId="faucet-card" icon="free" title="Free test USDC" line="Test USDC has no value and only works on Arc testnet.">
        <Button variant="ghost" onClick={drip} disabled={!address || busy} data-testid="app-faucet">
          {busy ? <Spinner /> : <Icon name="free" size={16} />} Send me 1 test USDC
        </Button>
        {msg && (
          <p className={`w-full text-[12.5px] ${msg.ok ? "text-good" : "text-bad"}`} role={msg.ok ? "status" : "alert"}>
            {msg.text}{" "}
            {msg.tx && (
              <a href={txLink("testnet", msg.tx)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                transaction
              </a>
            )}
          </p>
        )}
      </WayCard>
      <WayCard testId="circle-card" icon="external" title="Circle faucet" line={'Pick "Arc Testnet" and paste the address above.'}>
        <a href={faucet} target="_blank" rel="noreferrer" className="pix-press inline-flex h-10 items-center gap-2 rounded-lg border-[1.5px] border-ink bg-ink px-4 text-sm font-semibold text-white" data-testid="circle-faucet">
          Open Circle faucet <Icon name="external" size={14} />
        </a>
      </WayCard>
    </>
  );
}
