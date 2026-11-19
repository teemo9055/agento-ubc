"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, erc20Abi, http, isAddress, type Address } from "viem";
import { arc, arcTestnet } from "viem/chains";
import { NETWORKS, type Net } from "@/lib/networks";

/** How often the balance is read while the page is open. */
export const BALANCE_EVERY_MS = 10_000;

const clients = new Map<Net, ReturnType<typeof createPublicClient>>();
function client(net: Net) {
  let c = clients.get(net);
  if (!c) {
    c = createPublicClient({ chain: net === "mainnet" ? arc : arcTestnet, transport: http(NETWORKS[net].rpc) }) as ReturnType<typeof createPublicClient>;
    clients.set(net, c);
  }
  return c;
}

/**
 * USDC balance of one address on one Arc network, read in the browser through the ERC-20
 * interface (6 decimals) and refreshed every 10 seconds while the tab is visible.
 */
export function useArcBalance(net: Net, address: string | null | undefined) {
  const [value, setValue] = useState<bigint | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const key = useRef("");

  const read = useCallback(async () => {
    if (!address || !isAddress(address)) return;
    const k = `${net}:${address.toLowerCase()}`;
    try {
      const v = await client(net).readContract({ address: NETWORKS[net].usdc, abi: erc20Abi, functionName: "balanceOf", args: [address as Address] });
      if (key.current !== k) return;
      setValue(v);
      setFailed(false);
    } catch {
      if (key.current === k) setFailed(true);
    } finally {
      if (key.current === k) setLoading(false);
    }
  }, [net, address]);

  useEffect(() => {
    const valid = Boolean(address && isAddress(address));
    key.current = valid ? `${net}:${address!.toLowerCase()}` : "";
    setValue(null);
    setFailed(false);
    setLoading(valid);
    if (!valid) return;
    void read();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, BALANCE_EVERY_MS);
    return () => window.clearInterval(t);
  }, [net, address, read]);

  return { value, failed, loading, refresh: read };
}
