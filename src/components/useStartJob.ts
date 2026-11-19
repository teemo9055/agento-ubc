"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { post } from "./useRun";
import { usePrefs } from "@/lib/prefs";
import { usePasskeyWallet } from "./passkey/usePasskey";
import type { AgentId, Run } from "@/lib/types";

/** Starts a job for an agent the way the New job page does (practice or Arc testnet, app or passkey wallet), then opens it. */
export function useStartJob() {
  const router = useRouter();
  const [prefs] = usePrefs();
  const pk = usePasskeyWallet();
  const [cfg, setCfg] = useState<{ live: boolean; liveNeedsCode?: boolean } | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => undefined);
  }, []);
  const mode = (prefs.mode ?? (cfg?.live && !cfg.liveNeedsCode ? "live" : "demo")) === "live" && cfg?.live ? "live" : "demo";
  const usePasskey = mode === "live" && pk.supported && prefs.payFrom === "passkey";

  async function start(agent: AgentId, task: string, key = task) {
    if (task.trim().length < 3 || busy) return;
    if (usePasskey && !pk.wallet) return setErr("Set up your passkey wallet in Settings first, or pay from the app's wallet.");
    setBusy(key);
    setErr("");
    try {
      const run = await post<Run>("/api/runs", {
        agent,
        task,
        mode,
        network: mode === "live" ? (prefs.network ?? "testnet") : undefined,
        faults: prefs.faults,
        accessCode: mode === "live" && !usePasskey ? prefs.accessCode : undefined,
        payerAddress: usePasskey ? pk.wallet?.address : undefined,
      });
      router.push(`/runs/${run.id}`);
    } catch (x) {
      setErr((x as Error).message);
      setBusy("");
    }
  }
  return { start, busy, err, mode };
}
