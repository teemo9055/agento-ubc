"use client";
import { useState } from "react";
import { fmt } from "@/lib/money";
import { short, addrUrl } from "@/lib/format";
import { Button, Spinner } from "../ui";
import { toast } from "../Toaster";
import { usePasskeyWallet } from "./usePasskey";
import { createWallet, forgetWallet, signInWallet } from "./wallet";

/** Create / sign in to the user's passkey wallet, see its balance, top it up with test USDC. */
export function WalletPanel({ need }: { need?: bigint }) {
  const { wallet, balance, supported, refresh } = usePasskeyWallet();
  const [busy, setBusy] = useState<"" | "create" | "signin" | "faucet">("");
  const [name, setName] = useState("");

  if (!supported)
    return <p className="text-[12.5px] text-ink-3">Passkey wallets need a browser with passkeys and a configured Circle client key. The app wallet is used instead.</p>;

  if (!wallet)
    return (
      <div className="space-y-2" data-testid="wallet-panel">
        <div className="text-[14px] font-semibold">Your passkey wallet</div>
        <p className="text-[12.5px] text-ink-2">A Circle smart wallet you unlock with Face ID, Touch ID or a security key. You approve and fund jobs from it; nobody else can.</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Wallet name (e.g. your name)"
            aria-label="Wallet name"
            maxLength={40}
            className="tap h-10 min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 text-sm outline-none focus:border-ink/40"
          />
          <Button
            type="button"
            data-testid="create-wallet"
            disabled={!!busy}
            onClick={async () => {
              setBusy("create");
              try {
                const w = await createWallet(name.trim() || "agento user");
                toast(`Wallet ready · ${short(w.address)}`, "good");
              } catch (e) {
                toast(`Couldn't create the passkey: ${(e as Error).message}`, "bad");
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "create" ? (
              <>
                <Spinner /> Waiting for passkey…
              </>
            ) : (
              "Create passkey wallet"
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!!busy}
            onClick={async () => {
              setBusy("signin");
              try {
                const w = await signInWallet();
                toast(`Signed in · ${short(w.address)}`, "good");
              } catch (e) {
                toast(`Sign-in failed: ${(e as Error).message}`, "bad");
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "signin" ? "Waiting…" : "I have one"}
          </Button>
        </div>
      </div>
    );

  const low = balance != null && need != null && balance < need;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid="wallet-panel">
      <div className="text-[12.5px]">
        <div className="text-[12px] text-ink-3">Your passkey wallet</div>
        <a href={addrUrl(wallet.address)} target="_blank" rel="noreferrer" className="font-mono text-[11.5px] text-ink-3 hover:text-ink" data-testid="wallet-address">
          {short(wallet.address, 8)}
        </a>
        <span className={`num block text-[18px] font-semibold ${low ? "text-bad" : "text-ink"}`} data-testid="wallet-balance">
          {balance == null ? "…" : `${fmt(balance)} USDC`}
        </span>
      </div>
      <div className="flex gap-2">
        {(balance ?? 0n) < 1_000_000n && (
          <Button
            type="button"
            variant="ghost"
            disabled={!!busy}
            onClick={async () => {
              setBusy("faucet");
              try {
                const r = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: wallet.address }) });
                const j = await r.json();
                if (!r.ok) throw new Error(j.error);
                toast("Added 1 test USDC", "good");
                await refresh();
              } catch (e) {
                toast((e as Error).message, "bad");
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "faucet" ? "Sending…" : "Get 1 test USDC"}
          </Button>
        )}
        <Button type="button" variant="quiet" className="text-[12px]" onClick={() => forgetWallet()}>
          Forget
        </Button>
      </div>
      {low && <p className="w-full text-[12px] text-bad">Needs {fmt(need)} USDC to fund this job. Top up at faucet.circle.com (Arc Testnet) or use the button.</p>}
    </div>
  );
}
