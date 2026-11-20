"use client";
import { useEffect, useState } from "react";
import { formatUnits, isAddress } from "viem";
import { Band } from "@/components/JobCard";
import { Icon, type IconName } from "@/components/Icon";
import { Button, Spinner } from "@/components/ui";
import { usePasskeyWallet } from "@/components/passkey/usePasskey";
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
 * Add money: get USDC onto Arc, on testnet (free, nothing real) or mainnet (real money), to an
 * address the person controls. Testnet: free test USDC from a faucet. Mainnet: send USDC on Arc to
 * the address from a wallet or exchange. The balance updates as soon as it lands.
 */
export default function AddMoney() {
  const [prefs, setPrefs, ready] = usePrefs();
  const net: Net = (prefs.walletNetwork ?? "testnet") === "mainnet" ? "mainnet" : "testnet";
  const n = NETWORKS[net];
  const pk = usePasskeyWallet();
  const [typed, setTyped] = useState("");
  const [useOther, setUseOther] = useState(false);

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
    <div className="flex flex-col gap-6" data-testid="add-money" data-network={net}>
      <Band />
      <header className="max-w-2xl">
        <h1 className="font-pixel text-[30px] leading-tight sm:text-[34px]">Add money</h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">USDC on Arc pays for your jobs. Deposit to your address, or withdraw to any Arc address.</p>
      </header>

      <div role="radiogroup" aria-label="Network" className="grid grid-cols-2 gap-2 sm:max-w-xl" data-testid="network-switch">
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
              className={`pressable tap rounded-xl border-[1.5px] px-3 py-2.5 text-left transition-colors ${on ? (real ? "border-bad bg-bad text-white shadow-[3px_3px_0_0_var(--color-ink)]" : "border-ink bg-ink text-white shadow-[3px_3px_0_0_var(--agent)]") : "border-line bg-panel text-ink-2 hover:border-ink/40"}`}
            >
              <span className="block text-[15px] font-semibold">{real ? "Mainnet" : "Testnet"}</span>
              <span className={`block text-[12.5px] ${on ? "text-white/80" : "text-ink-3"}`}>{real ? "Real money" : "Free test USDC, nothing real"}</span>
            </button>
          );
        })}
      </div>

      <section aria-labelledby="addr-title" className="rounded-2xl border border-line bg-panel p-4">
        <h2 id="addr-title" className="text-[15px] font-semibold">
          Your address on {n.name}
        </h2>
        {passkeyAddress ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="num break-all text-[14px]" data-testid="fund-address">
              {passkeyAddress}
            </span>
            <span className="rounded-md bg-agent-soft px-2 py-0.5 text-[12px] font-medium text-agent-ink">Your passkey wallet</span>
            <button type="button" onClick={() => setUseOther(true)} className="text-[13px] text-ink-2 underline underline-offset-2 hover:text-ink">
              Use a different address
            </button>
          </div>
        ) : (
          <div className="mt-2">
            <label htmlFor="fund-address" className="block text-[13px] text-ink-3">
              {net === "mainnet" && pk.wallet ? "Your passkey wallet is set up for Arc testnet in this app. For mainnet, paste an Arc address you control (from a wallet app)." : "Paste an Arc address you control (from a wallet app). It starts with 0x."}
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
                className={`num h-11 w-full max-w-xl rounded-lg border bg-surface px-3 text-[14px] outline-none ${clean && !typedOk ? "border-bad" : "border-line focus:border-ink/40"}`}
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
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[#f1f0ec] pt-3">
            <span className="text-[13px] text-ink-3">Balance on {n.name}</span>
            <span className="num text-[20px] font-semibold" data-testid="balance">
              {bal.value != null ? (
                <>
                  {fmtUsdc(bal.value)} <span className="text-[13px] font-normal text-ink-3">USDC</span>
                </>
              ) : bal.failed ? (
                <span className="text-[14px] font-normal text-ink-3">Couldn&apos;t read it right now</span>
              ) : (
                <Spinner />
              )}
            </span>
            <a href={addressLink(net, address)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-ink-2 underline underline-offset-2 hover:text-ink" data-testid="explorer-link">
              See it on the {n.name} explorer <Icon name="external" size={12} />
            </a>
            {arrived && (
              <span className="inline-flex items-center gap-1 rounded-md border border-good/40 bg-good/10 px-2 py-0.5 text-[13px] font-semibold text-good" role="status" data-testid="arrived">
                <Icon name="check" size={13} stroke={2.6} /> Arrived +{arrived} USDC
              </span>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="ways-title">
        <h2 id="ways-title" className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
          Deposit and withdraw
        </h2>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {n.realMoney ? (
            <WayCard testId="send-card" icon="send" title="Deposit: send USDC on Arc" who="Anyone who holds USDC on Arc in a wallet app or an exchange that supports Arc." cost="Only Arc's network fee, a fraction of a cent, paid in USDC.">
              <p className="text-[13px] text-ink-2">Send USDC on the Arc network to the address above. Check the network is Arc before you send: money sent on another network won&apos;t arrive here.</p>
              <Button variant="ghost" onClick={startWatch} disabled={!address} data-testid="watch-arrival">
                <Icon name="send" size={16} /> I&apos;ve sent it
              </Button>
            </WayCard>
          ) : (
            <FaucetCard address={address} onSent={() => { startWatch(); void bal.refresh(); }} />
          )}
          <WithdrawCard net={net} onSent={() => void bal.refresh()} />
        </ul>
        {!address && <p className="mt-3 text-[13px] text-ink-3">Add an address above first; that&apos;s where the USDC goes.</p>}
        {watch && !arrived && address && <p className="mt-3 text-[13px] text-ink-3" role="status">Watching your balance. It updates here as soon as the USDC lands.</p>}
      </section>

      <footer className="rounded-2xl border border-line bg-panel px-4 py-3 text-[13px] leading-relaxed text-ink-2" data-testid="money-footer">
        Fees on Arc are paid in USDC, and Arc settles in under a second. Whatever you add goes straight to the address shown above, which you control; Agento never holds it.
        {!n.realMoney && " On testnet nothing has real value."}
      </footer>
    </div>
  );
}

function WayCard({ testId, icon, title, who, cost, children }: { testId: string; icon: IconName; title: string; who: string; cost: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4 shadow-[3px_3px_0_0_var(--color-line)]" data-testid={testId}>
      <div className="flex items-center gap-2.5">
        <span className="pix-shadow inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border-[1.5px] border-ink bg-agent text-agent-on" aria-hidden>
          <Icon name={icon} size={18} />
        </span>
        <h3 className="font-pixel text-[16px] leading-tight">{title}</h3>
      </div>
      <dl className="space-y-2 text-[13.5px]">
        <div>
          <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">Who it&apos;s for</dt>
          <dd className="text-ink-2">{who}</dd>
        </div>
        <div>
          <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">What it costs</dt>
          <dd className="text-ink-2">{cost}</dd>
        </div>
      </dl>
      <div className="mt-auto flex flex-col items-start gap-2">{children}</div>
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
    <WayCard testId="faucet-card" icon="free" title="Free test USDC" who="Trying things out on testnet before using real money." cost="Free. Test USDC has no value and only works on Arc testnet.">
      <a href={faucet} target="_blank" rel="noreferrer" className="pix-press inline-flex h-10 items-center gap-2 rounded-lg border-[1.5px] border-ink bg-ink px-4 text-sm font-semibold text-white" data-testid="circle-faucet">
        Circle faucet <Icon name="external" size={14} />
      </a>
      <p className="text-[12.5px] text-ink-3">Pick &ldquo;Arc Testnet&rdquo; and paste your address.</p>
      <Button variant="ghost" onClick={drip} disabled={!address || busy} data-testid="app-faucet">
        {busy ? <Spinner /> : <Icon name="free" size={16} />} Send me 1 test USDC
      </Button>
      {msg && (
        <p className={`text-[12.5px] ${msg.ok ? "text-good" : "text-bad"}`} role={msg.ok ? "status" : "alert"}>
          {msg.text}{" "}
          {msg.tx && (
            <a href={txLink("testnet", msg.tx)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              transaction
            </a>
          )}
        </p>
      )}
    </WayCard>
  );
}

/** Withdraw: USDC from the Agento wallet to an address you give. You confirm the amount first. */
function WithdrawCard({ net, onSent }: { net: Net; onSent: () => void }) {
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ tx?: string; error?: string } | null>(null);
  useEffect(() => {
    fetch(`/api/wallet/withdraw?network=${net}`)
      .then((r) => r.json())
      .then((x: { address: string | null }) => setFrom(x.address))
      .catch(() => setFrom(null));
    setDone(null);
  }, [net]);
  const ok = isAddress(to.trim()) && /^\d+(\.\d{1,6})?$/.test(amount.trim()) && Number(amount) > 0;
  return (
    <WayCard testId="withdraw-card" icon="send" title="Withdraw" who={from ? `From your Agento wallet ${from.slice(0, 6)}…${from.slice(-4)}.` : "From your Agento wallet."} cost="Only Arc's network fee, a fraction of a cent, paid in USDC.">
      <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="To: 0x…" spellCheck={false} autoComplete="off" className="num h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13.5px] outline-none focus:border-ink/40" data-testid="withdraw-to" />
      <div className="flex items-center gap-2">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" inputMode="decimal" className="num h-10 w-32 rounded-lg border border-line bg-surface px-3 text-[13.5px] outline-none focus:border-ink/40" data-testid="withdraw-amount" />
        <span className="text-[13px] text-ink-3">USDC</span>
        <Button
          variant="ghost"
          disabled={!ok || busy || !from}
          onClick={async () => {
            if (!window.confirm(`Send ${amount.trim()} USDC on ${NETWORKS[net].name} to ${to.trim()}? This can't be undone.`)) return;
            setBusy(true);
            setDone(null);
            try {
              const r = await fetch("/api/wallet/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ network: net, to: to.trim(), amount: amount.trim() }) });
              const j = (await r.json()) as { txHash?: string; error?: string };
              setDone(r.ok ? { tx: j.txHash } : { error: j.error ?? "It didn't go through." });
              if (r.ok) onSent();
            } finally {
              setBusy(false);
            }
          }}
          data-testid="withdraw-send"
        >
          {busy ? <Spinner /> : "Withdraw"}
        </Button>
      </div>
      {done?.tx && (
        <a href={txLink(net, done.tx as `0x${string}`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-good underline underline-offset-2" data-testid="withdraw-tx">
          Sent · see it on the explorer <Icon name="external" size={12} />
        </a>
      )}
      {done?.error && <p className="text-[13px] text-bad">{done.error}</p>}
    </WayCard>
  );
}
