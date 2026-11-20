"use client";
import { useEffect, useState } from "react";
import type { FailureCode } from "./types";

/** Choices that stay the same from job to job, kept in this browser and changed in Settings. */
export interface Prefs {
  /** Where jobs pay: Arc testnet (real testnet USDC) or the practice rail (nothing settles). */
  mode?: "live" | "demo";
  payFrom: "passkey" | "app";
  /** Failures to inject, for testing how the agent handles them. */
  faults: FailureCode[];
  accessCode?: string;
  /** Which Arc network jobs pay on, chosen in Settings (default testnet). */
  network?: "testnet" | "mainnet";
  /** Which Arc network the Add money page shows. Separate, so looking at mainnet there never moves jobs onto real money. */
  walletNetwork?: "testnet" | "mainnet";
  /** Where Inso's orders go: practice, Gemini's test exchange, or Gemini with real money. Unset: the server's default. */
  venue?: "paper" | "gemini-sandbox" | "gemini";
}

/** What /api/config says about each network, as far as choosing one goes. */
export type NetConfig = { networks?: Partial<Record<"testnet" | "mainnet", { live: boolean; setup?: string[] }>> } | null;

/**
 * The network a job actually pays on: mainnet only when it was chosen and this server can pay there.
 * Otherwise testnet, which never costs real money, and the page says why.
 */
export function jobNetwork(prefs: Prefs, cfg: NetConfig): "testnet" | "mainnet" {
  return prefs.network === "mainnet" && cfg?.networks?.mainnet?.live ? "mainnet" : "testnet";
}

/** Mainnet was chosen but this server can't pay there: the reason, to show before anyone presses Ask. */
export function mainnetHeldBack(prefs: Prefs, cfg: NetConfig): boolean {
  return prefs.network === "mainnet" && Boolean(cfg?.networks?.mainnet) && !cfg?.networks?.mainnet?.live;
}

const KEY = "agento:prefs";
const DEFAULTS: Prefs = { payFrom: "app", faults: [] };

export function readPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>) };
  } catch {
    return DEFAULTS;
  }
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void, boolean] {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setPrefs(readPrefs());
    setReady(true);
  }, []);
  const update = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  return [prefs, update, ready];
}
