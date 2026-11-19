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
  /** Which Arc network the Add money page works on (default testnet). */
  network?: "testnet" | "mainnet";
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
