"use client";
import { useCallback, useEffect, useState } from "react";
import { passkeySupported, savedWallet, type SavedWallet } from "./saved";

/**
 * The remembered passkey wallet and its USDC balance, refreshed on demand. The wallet library loads
 * only when a balance is wanted; pages that just need to know which wallet pays pass `false`.
 */
export function usePasskeyWallet(withBalance = true) {
  const [wallet, setWallet] = useState<SavedWallet | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [supported, setSupported] = useState(false);

  const refresh = useCallback(async () => {
    const w = savedWallet();
    setWallet(w);
    if (w && withBalance) setBalance(await import("./wallet").then((m) => m.usdcBalance(w.address)).catch(() => null));
    else setBalance(null);
  }, [withBalance]);

  useEffect(() => {
    setSupported(passkeySupported());
    void refresh();
    const on = () => void refresh();
    window.addEventListener("agento:wallet", on);
    return () => window.removeEventListener("agento:wallet", on);
  }, [refresh]);

  return { wallet, balance, supported, refresh };
}
