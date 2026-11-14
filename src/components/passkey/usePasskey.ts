"use client";
import { useCallback, useEffect, useState } from "react";
import { passkeySupported, savedWallet, usdcBalance, type SavedWallet } from "./wallet";

/** The remembered passkey wallet and its USDC balance, refreshed on demand. */
export function usePasskeyWallet() {
  const [wallet, setWallet] = useState<SavedWallet | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [supported, setSupported] = useState(false);

  const refresh = useCallback(async () => {
    const w = savedWallet();
    setWallet(w);
    if (w) setBalance(await usdcBalance(w.address).catch(() => null));
    else setBalance(null);
  }, []);

  useEffect(() => {
    setSupported(passkeySupported());
    void refresh();
    const on = () => void refresh();
    window.addEventListener("agento:wallet", on);
    return () => window.removeEventListener("agento:wallet", on);
  }, [refresh]);

  return { wallet, balance, supported, refresh };
}
