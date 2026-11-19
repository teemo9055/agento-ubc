"use client";
import { useEffect, useRef, useState } from "react";
import { formatUnits, isAddress } from "viem";
import { Band } from "@/components/JobCard";
import { Icon, type IconName } from "@/components/Icon";
import { Button, Spinner } from "@/components/ui";
import { usePasskeyWallet } from "@/components/passkey/usePasskey";
import { useArcBalance } from "@/components/wallet/useArcBalance";
import { OnrampFlow } from "@/components/wallet/OnrampFlow";
import { BridgeFlow, browserWallet } from "@/components/wallet/BridgeFlow";
import { usePrefs } from "@/lib/prefs";
import { NETS, NETWORKS, addressLink, txLink, type Net } from "@/lib/networks";

const ADDRESS_KEY = "agento:fund-address";
type Way = "onramp" | "bridge";

const fmtUsdc = (v: bigint) => {
  const s = formatUnits(v, 6);
  const [i, d = ""] = s.split(".");
  return `${Number(i).toLocaleString("en-US")}.${(d + "00").slice(0, Math.max(2, d.replace(/0+$/, "").length))}`;
};

/**
 * Add money: get USDC onto Arc, on testnet (free, nothing real) or mainnet (real money), to an
 * address the person controls. Three ways side by side: buy with a card or bank (Arc Onramp),
 * bring USDC from another chain (CCTP with Circle's Forwarding Service), or free test USDC.
 */
export default function AddMoney() {
  const [prefs, setPrefs, ready] = usePrefs();
  const net: Net = prefs.network === "mainnet" ? "mainnet" : "testnet";
  const n = NETWORKS[net];
  const pk = usePasskeyWallet();
  const [typed, setTyped] = useState("");
  const [useOther, setUseOther] = useState(false);
  const [way, setWay] = useState<Way | null>(null);
  const [hasWallet, setHasWallet] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTyped(localStorage.getItem(ADDRESS_KEY) ?? "");
    setHasWallet(Boolean(browserWallet()));
  }, []);

  // The passkey wallet is set up for Arc testnet in this app, so mainnet always takes an address you paste.
  const passkeyAddress = net === "testnet" && !useOther ? (pk.wallet?.address ?? null) : null;
  const clean = typed.trim();
  const typedOk = isAddress(clean);
  const address = passkeyAddress ?? (typedOk ? clean : null);
  const bal = useArcBalance(net, address);

  // "Arrived" = the balance went up after a purchase or transfer was sent (the reliable signal).
  const [watch, setWatch] = useState<{ key: string; base: bigint | null } | null>(null);
  const key = `${net}:${address?.toLowerCase() ?? ""}`;
  const startWatch = () => setWatch({ key, base: bal.value });
  useEffect(() => {
    if (watch && watch.key === key && watch.base == null && bal.value != null) setWatch({ ...watch, base: bal.value });
  }, [watch, key, bal.value]);
  const arrived = watch && watch.key === key && watch.base != null && bal.value != null && bal.value > watch.base ? fmtUsdc(bal.value - watch.base) : null;

  useEffect(() => {
    setWay(null);
    setWatch(null);
  }, [key]);

  const open = (w: Way) => {
    setWay(w);
    requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="flex flex-col gap-6" data-testid="add-money" data-network={net}>
      <Band />
      <header className="max-w-2xl">
        <h1 className="font-pixel text-[30px] leading-tight sm:text-[34px]">Add money</h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">Get USDC onto Arc, where your agents pay for things. Pick a network, check the address it goes to, then choose a way in.</p>
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
              onClick={() => setPrefs({ network: x })}
              className={`pressable tap rounded-xl border-[1.5px] px-3 py-2.5 text-left transition-colors ${on ? (real ? "border-bad bg-bad text-white shadow-[3px_3px_0_0_var(--color-ink)]" : "border-ink bg-ink text-white shadow-[3px_3px_0_0_var(--agent)]") : "border-line bg-panel text-ink-2 hover:border-ink/40"}`}
            >
              <span className="block text-[15px] font-semibold">{real ? "Mainnet" : "Testnet"}</span>
              <span className={`block text-[12.5px] ${on ? "text-white/80" : "text-ink-3"}`}>{real ? "Real money" : "Free test USDC, nothing real"}</span>
            </button>
          );
        })}
      </div>

      {n.realMoney && (
        <div className="flex items-start gap-3 rounded-2xl border-[1.5px] border-bad bg-bad/5 px-4 py-3 text-bad" role="note" data-testid="real-money">
          <Icon name="shield" size={20} className="mt-0.5 shrink-0" />
          <p className="text-[14px] leading-relaxed">
            <b>Arc mainnet: this is real money.</b> USDC you buy or bring here is real, and transfers can&apos;t be undone. Check the address below is one you control.
          </p>
        </div>
      )}

      <section aria-labelledby="addr-title" className={`rounded-2xl border bg-panel p-4 ${n.realMoney ? "border-bad/40" : "border-line"}`}>
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
          Three ways in
        </h2>
        <ul className={`grid grid-cols-1 gap-4 ${n.realMoney ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
          <WayCard
            testId="onramp-card"
            icon="card"
            title="Buy with card or bank"
            who="Anyone with a debit card, Apple Pay or Google Pay, or a bank account in supported US states and EU countries. You verify your identity once with the provider."
            cost={n.realMoney ? "The provider's fee, shown in the widget before you pay. Credit cards aren't accepted." : "Nothing: this is Circle's sandbox. Use test card data only; it sends testnet USDC."}
          >
            <Button onClick={() => open("onramp")} disabled={!address} data-testid="onramp-start">
              <Icon name="card" size={16} /> {n.realMoney ? "Buy USDC" : "Try a test purchase"}
            </Button>
          </WayCard>
          <WayCard
            testId="bridge-card"
            icon="send"
            title="Bring USDC from another chain"
            who={`People who already hold USDC on ${n.bridgeFrom.map((c) => c.name).join(", ")} in a browser wallet.`}
            cost="Circle's fast-transfer fee and a small forwarding fee, both in USDC and shown before you send, plus the source chain's network fee. No Arc gas needed."
          >
            <Button variant={hasWallet ? "primary" : "ghost"} onClick={() => open("bridge")} disabled={!address} data-testid="bridge-start">
              <Icon name="send" size={16} /> Start a transfer
            </Button>
            {!hasWallet && <p className="text-[12.5px] text-ink-3">No browser wallet found here. {n.realMoney ? "Buying with a card works without one." : "Try the free test USDC or a test purchase instead."}</p>}
          </WayCard>
          {!n.realMoney && <FaucetCard address={address} onSent={() => { startWatch(); void bal.refresh(); }} />}
        </ul>
        {!address && <p className="mt-3 text-[13px] text-ink-3">Add an address above first; that&apos;s where the USDC goes.</p>}
      </section>

      <div ref={panel} className="scroll-mt-24">
        {way === "onramp" && address && <OnrampFlow key={key} net={net} address={address} onSubmitted={startWatch} arrived={arrived} onClose={() => setWay(null)} />}
        {way === "bridge" && address && <BridgeFlow key={key} net={net} recipient={address} onSent={startWatch} arrived={arrived} onClose={() => setWay(null)} />}
      </div>

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
