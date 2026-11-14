"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AgentIcon } from "@/components/AgentIcon";
import { Button } from "@/components/ui";
import { post, useAgentTheme } from "@/components/useRun";
import { THEMES } from "@/lib/themes";
import type { AgentId, FailureCode, Run } from "@/lib/types";
import { OUTFIT_LABEL, outfitFor } from "@/lib/outfit";
import { WalletPanel } from "@/components/passkey/WalletPanel";
import { usePasskeyWallet } from "@/components/passkey/usePasskey";

const FAULTS: { code: FailureCode; label: string }[] = [
  { code: "price_increase", label: "Seller raises price" },
  { code: "seller_402_timeout", label: "Seller times out" },
  { code: "payment_rejected", label: "Payment rejected" },
  { code: "settle_fails", label: "Settlement fails" },
  { code: "insufficient_balance", label: "Vault runs dry" },
  { code: "policy_block", label: "Agent tries off-plan spend" },
  { code: "model_error", label: "Analysis crashes" },
  { code: "approval_timeout", label: "Re-approval times out" },
];

interface Config {
  live: boolean;
  factory: string | null;
  explorer: string;
  faultsEnabled: boolean;
  liveNeedsCode?: boolean;
  agents: { id: AgentId; examples: string[] }[];
}

const STEPS = [
  { k: "Explore", v: "free lookups" },
  { k: "Move", v: "“Buy if…?”" },
  { k: "Approve", v: "vault funded once" },
  { k: "Act", v: "only what you approved" },
];

function FlowStrip() {
  return (
    <div className="mt-8 hidden items-center gap-2 sm:flex" aria-hidden>
      {STEPS.map((s, i) => (
        <div key={s.k} className="flex items-center gap-2">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.08 }}
            className="rounded-xl border border-line bg-panel/80 px-3 py-2"
          >
            <div className="text-[12.5px] font-semibold">{s.k}</div>
            <div className="text-[11px] text-ink-3">{s.v}</div>
          </motion.div>
          {i < STEPS.length - 1 && (
            <svg width="44" height="10" className="text-agent">
              <line x1="0" y1="5" x2="44" y2="5" stroke="var(--color-line)" strokeWidth="1.5" />
              <circle r="2.5" cy="5" fill="currentColor" className="motion-reduce:hidden">
                <animate attributeName="cx" from="0" to="44" dur="1.6s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
              </circle>
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [agent, setAgent] = useState<AgentId>("inso");
  const [task, setTask] = useState("");
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [testMode, setTestMode] = useState(false);
  const [faults, setFaults] = useState<FailureCode[]>([]);
  const [busy, setBusy] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [payFrom, setPayFrom] = useState<"passkey" | "app">("passkey");
  const pk = usePasskeyWallet();
  const usePasskey = mode === "live" && pk.supported && payFrom === "passkey";
  const [err, setErr] = useState("");
  useAgentTheme(agent);

  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("agent");
    if (a && a in THEMES) setAgent(a as AgentId);
  }, []);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: Config) => {
        setCfg(c);
        if (c.live && !c.liveNeedsCode) setMode("live");
      });
  }, []);

  const examples = cfg?.agents.find((a) => a.id === agent)?.examples ?? [];
  const theme = THEMES[agent];

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (task.trim().length < 3) return;
    setBusy(true);
    setErr("");
    try {
      const run = await post<Run>("/api/runs", { agent, task, mode, faults: testMode ? faults : [], accessCode: mode === "live" && !usePasskey ? accessCode : undefined, payerAddress: usePasskey ? pk.wallet?.address : undefined });
      router.push(`/runs/${run.id}`);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl pt-2 sm:pt-8">
      <AnimatePresence>
        {testMode && faults.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            role="status"
            className="mb-6 overflow-hidden rounded-xl border border-warn bg-warn/15 px-4 py-2 text-sm text-[#7a5000]"
          >
            <b>Test mode on.</b> {faults.length} fault {faults.length === 1 ? "switch" : "switches"} will fire once during the run.
          </motion.div>
        )}
      </AnimatePresence>

      <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-[34px] font-semibold leading-[1.05] tracking-tight sm:text-5xl">
        Agents that only spend
        <br />
        <span className="text-agent transition-colors duration-500">what you approved.</span>
      </motion.h1>
      <p className="mt-4 max-w-xl text-[15px] text-ink-2">
        Ask freely: the agent looks things up for you at no cost. When there's a move worth making, it proposes one, priced. Approve once and it pays for research in USDC on Arc from a vault that only pays what you approved, then acts.
      </p>
      <FlowStrip />

      <div className="mt-10 grid grid-cols-3 gap-2 sm:gap-3" role="tablist" aria-label="Agent">
        {(Object.keys(THEMES) as AgentId[]).map((id) => {
          const on = agent === id;
          return (
            <motion.button
              key={id}
              role="tab"
              aria-selected={on}
              onClick={() => setAgent(id)}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              data-agent={id}
              className={`pressable relative rounded-2xl border p-3 text-left transition-colors sm:p-4 ${on ? "border-agent bg-panel shadow-[0_8px_30px_-12px_var(--agent)]" : "border-line bg-panel/60 hover:bg-panel"}`}
            >
              <AgentIcon agent={id} size={36} className={on ? "float" : ""} />
              <div className="mt-3 font-semibold">{THEMES[id].name}</div>
              <div className="text-[11.5px] text-ink-3">{THEMES[id].domain}</div>
              {on && <motion.span layoutId="agent-dot" className="absolute right-3 top-3 h-2 w-2 rounded-full bg-agent" />}
            </motion.button>
          );
        })}
      </div>

      <form onSubmit={submit} className="ring-agent mt-3 rounded-2xl border border-line bg-panel p-4 shadow-sm transition-shadow sm:p-5">
        <AnimatePresence mode="wait">
          <motion.div key={agent} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} className="flex items-center gap-3">
            <AgentIcon agent={agent} size={52} outfit={outfitFor(agent, task)} mood={busy ? "working" : "idle"} />
            <label htmlFor="task" className="block text-[12.5px] font-medium text-ink-3">
              <span className="font-pixel text-[13px] text-agent">{theme.name}</span>
              <span className="block">{theme.tagline}</span>
              {OUTFIT_LABEL[outfitFor(agent, task)] && <span className="block text-[11px] text-ink-3">Dressed for it: {OUTFIT_LABEL[outfitFor(agent, task)].toLowerCase()}</span>}
            </label>
          </motion.div>
        </AnimatePresence>
        <textarea
          id="task"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && submit()}
          rows={3}
          maxLength={280}
          placeholder={examples[0] ?? "Describe the task"}
          className="mt-2 w-full resize-none bg-transparent text-[16px] outline-none placeholder:text-ink-3"
        />
        <div className="mt-1 flex flex-wrap gap-2">
          {examples.map((x, i) => (
            <motion.button
              key={x}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.05 }}
              type="button"
              onClick={() => setTask(x)}
              className="pressable tap rounded-full border border-line px-3 py-1 text-xs text-ink-2 transition-colors hover:border-agent hover:text-ink"
            >
              {x}
            </motion.button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-0.5 text-xs" role="radiogroup" aria-label="Payment rail">
            {(["live", "demo"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                disabled={m === "live" && !cfg?.live}
                onClick={() => setMode(m)}
                title={m === "live" && !cfg?.live ? "Live mode needs funded wallets and a deployed factory" : undefined}
                className={`tap relative rounded-lg px-3 py-1.5 transition-colors ${mode === m ? "text-white" : "text-ink-2 disabled:text-ink-3/60"}`}
              >
                {mode === m && <motion.span layoutId="rail" className="absolute inset-0 rounded-lg bg-ink" transition={{ type: "spring", duration: 0.35 }} />}
                <span className="relative">{m === "live" ? "Arc testnet" : "Demo rail"}</span>
              </button>
            ))}
          </div>
          <Button type="submit" disabled={busy || task.trim().length < 3 || (usePasskey && !pk.wallet)} className="bg-agent hover:opacity-90">
            {busy ? "Starting…" : "Ask →"}
          </Button>
        </div>
        {mode === "live" && pk.supported && (
          <div className="mt-3 space-y-3 rounded-xl border border-line bg-surface p-3">
            <div className="flex gap-1 text-[12px]" role="radiogroup" aria-label="Pay from">
              {(["passkey", "app"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={payFrom === p}
                  onClick={() => setPayFrom(p)}
                  className={`pressable tap rounded-lg border px-3 py-1.5 ${payFrom === p ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink-2"}`}
                >
                  {p === "passkey" ? "Pay from my passkey wallet" : "App wallet"}
                </button>
              ))}
            </div>
            {payFrom === "passkey" && <WalletPanel />}
          </div>
        )}
        {mode === "live" && !usePasskey && cfg?.liveNeedsCode && (
          <input
            type="password"
            value={accessCode}
            onChange={(e) => setAccessCode(e.target.value)}
            placeholder="Access code for Arc testnet jobs"
            aria-label="Access code"
            className="mt-3 h-9 w-full rounded-xl border border-line bg-surface px-3 text-sm outline-none focus:border-ink/40"
          />
        )}
        {err && <p className="mt-3 text-sm text-bad">{err}</p>}
      </form>
      <p className="mt-3 text-xs text-ink-3">
        {mode === "demo" ? "Demo rail: real market data, simulated settlement, no transaction hashes." : "Arc testnet: real USDC payments from a fresh vault per work order."}
        {cfg?.factory && (
          <>
            {" "}
            Factory{" "}
            <a className="font-mono underline decoration-line underline-offset-2 hover:text-ink" href={`${cfg.explorer}/address/${cfg.factory}`} target="_blank" rel="noreferrer">
              {cfg.factory.slice(0, 8)}…
            </a>
          </>
        )}
      </p>

      {cfg?.faultsEnabled && (
        <div className="mt-10 rounded-2xl border border-line bg-panel/70 p-4">
          <button type="button" onClick={() => setTestMode((v) => !v)} aria-expanded={testMode} className="flex w-full items-center justify-between text-left">
            <span>
              <span className="text-sm font-semibold">Test mode</span>
              <span className="ml-2 text-xs text-ink-3">Inject failures and watch the agent ask before anything changes.</span>
            </span>
            <span className={`relative h-5 w-9 rounded-full transition-colors ${testMode ? "bg-warn" : "bg-line"}`}>
              <motion.span layout className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow ${testMode ? "right-0.5" : "left-0.5"}`} />
            </span>
          </button>
          <AnimatePresence initial={false}>
            {testMode && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mt-4 flex flex-wrap gap-2">
                  {FAULTS.map((f) => {
                    const on = faults.includes(f.code);
                    return (
                      <label
                        key={f.code}
                        className={`pressable tap inline-flex cursor-pointer select-none items-center rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${on ? "border-warn bg-warn/15 text-[#7a5000]" : "border-line text-ink-2 hover:border-ink/30"}`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={on}
                          onChange={(e) => setFaults((xs) => (e.target.checked ? [...xs, f.code] : xs.filter((x) => x !== f.code)))}
                        />
                        {on ? "✓ " : ""}
                        {f.label}
                      </label>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
