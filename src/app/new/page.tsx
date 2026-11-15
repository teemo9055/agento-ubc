"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AgentIcon } from "@/components/AgentIcon";
import { Button } from "@/components/ui";
import { post, useAgentTheme } from "@/components/useRun";
import { THEMES } from "@/lib/themes";
import type { AgentId, FailureCode, Run } from "@/lib/types";
import { outfitFor } from "@/lib/outfit";
import { Icon } from "@/components/Icon";
import { KITS } from "@/lib/agentKit";
import { WalletPanel } from "@/components/passkey/WalletPanel";
import { ExchangePanel } from "@/components/ExchangePanel";
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
  setup?: string[];
  agents: { id: AgentId; examples: string[] }[];
}

const STEPS = ["Ask for free", "Agree on a move", "Approve once", "Agent acts"];

const ASK: Record<AgentId, string> = {
  inso: "What should Inso look into?",
  trado: "What should Trado chart?",
  travo: "Where should Travo route you?",
};

function FlowStrip() {
  return (
    <ol className="flex flex-wrap items-center justify-center gap-2 text-[13px] text-ink-2" aria-label="How it works">
      {STEPS.map((s, i) => (
        <motion.li key={s} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.06 }} className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5">
            <b className="text-ink">{i + 1}</b> {s}
          </span>
          {i < STEPS.length - 1 && (
            <span aria-hidden className="text-[#c9c8c2]">
              →
            </span>
          )}
        </motion.li>
      ))}
    </ol>
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
    <div className="grid-paper -mx-4 -mt-6 px-4 pb-6 pt-8 sm:-mx-6 sm:-mt-8 sm:px-6 sm:pt-14">
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <AnimatePresence>
        {testMode && faults.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            role="status"
            className="overflow-hidden rounded-xl border border-warn bg-warn/15 px-4 py-2 text-sm text-warn-ink"
          >
            <b>Test mode on.</b> {faults.length} fault {faults.length === 1 ? "switch" : "switches"} will fire once during the run.
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col items-center gap-4 text-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={agent}
            initial={{ opacity: 0, scale: 0.85, rotate: -6 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 420, damping: 22 }}
          >
            <AgentIcon agent={agent} size={76} outfit={outfitFor(agent, task)} mood={busy ? "working" : "idle"} />
          </motion.span>
        </AnimatePresence>
        <h1 className="font-pixel text-[30px] leading-tight sm:text-[40px]">{ASK[agent]}</h1>
        <p className="max-w-xl text-[15px] leading-relaxed text-ink-2">
          Ask freely: lookups cost nothing. When there&apos;s a move worth making, the agent prices it. Nothing is spent until you approve, and the vault only pays what you approved.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3" role="tablist" aria-label="Agent">
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
              className={`pressable flex items-center gap-2.5 rounded-[10px] border-[1.5px] px-3 py-3 text-left transition-colors sm:px-4 ${on ? "border-ink bg-panel shadow-[3px_3px_0_0_var(--agent)]" : "border-line bg-panel/60 hover:bg-panel"}`}
            >
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[2px] border border-ink bg-agent" />
              <span className="min-w-0">
                <span className="block font-pixel text-[14px]">{THEMES[id].name}</span>
                <span className="block truncate text-[12px] text-ink-3">{THEMES[id].domain}</span>
              </span>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={agent}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.18 }}
          className="-mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 text-[13px] text-ink-2"
          data-agent={agent}
          aria-live="polite"
        >
          <span className="inline-flex items-center gap-1.5">
            <Icon name="search" size={14} className="text-agent-ink" /> Free: {KITS[agent].free.join(", ")}
          </span>
          <span className="num inline-flex items-center gap-1.5">
            <Icon name="vault" size={14} className="text-agent-ink" /> Paid after approval: {KITS[agent].paid.map((x) => `${x.label} ${x.price}`).join(", ")} USDC
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="bolt" size={14} className="text-agent-ink" /> {KITS[agent].acts}
          </span>
        </motion.div>
      </AnimatePresence>

      <form onSubmit={submit} className="rounded-[14px] border-[1.5px] border-ink bg-panel p-4 shadow-[4px_4px_0_0_var(--color-ink)] transition-shadow focus-within:shadow-[4px_4px_0_0_var(--agent)] sm:p-5">
        <label htmlFor="task" className="sr-only">
          Task for {theme.name}
        </label>
        <textarea
          id="task"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && submit()}
          rows={3}
          maxLength={280}
          placeholder={examples[0] ?? "Describe the task"}
          className="w-full resize-none bg-transparent text-[17px] leading-relaxed outline-none placeholder:text-ink-3"
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
              className="pressable tap rounded-lg border border-line bg-panel px-3 py-1.5 text-left text-[13px] text-ink-2 transition-colors hover:border-agent hover:bg-agent-soft hover:text-ink"
            >
              {x}
            </motion.button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#f1f0ec] pt-4">
          <div className="flex items-center gap-0.5 rounded-[9px] bg-[#f1f0ec] p-[3px] text-[13px] font-medium" role="radiogroup" aria-label="Payment rail">
            {(["live", "demo"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                disabled={m === "live" && !cfg?.live}
                onClick={() => setMode(m)}
                title={m === "live" && !cfg?.live ? (cfg?.setup?.join(" · ") ?? "Arc testnet isn't set up on this machine") : undefined}
                className={`tap relative rounded-[7px] px-3 py-1.5 transition-colors ${mode === m ? "text-ink" : "text-ink-2 disabled:text-ink-3/60"}`}
              >
                {mode === m && <motion.span layoutId="rail" className="absolute inset-0 rounded-[7px] bg-panel shadow-[0_1px_2px_rgb(11_11_11/0.12)]" transition={{ type: "spring", duration: 0.35 }} />}
                <span className="relative">{m === "live" ? "Arc testnet" : "Demo rail"}</span>
              </button>
            ))}
          </div>
          <Button type="submit" disabled={busy || task.trim().length < 3 || (usePasskey && !pk.wallet)} variant="agent">
            {busy ? (
              "Starting…"
            ) : (
              <>
                Ask <Icon name="arrow" size={16} stroke={2.2} />
              </>
            )}
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
                  className={`pressable tap rounded-lg border px-3 py-1.5 font-medium ${payFrom === p ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink-2"}`}
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
            className="mt-3 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-ink/40"
          />
        )}
        {(agent === "inso" || agent === "trado") && <ExchangePanel />}
        {err && <p className="mt-3 text-sm text-bad">{err}</p>}
        {cfg?.setup && cfg.setup.length > 0 && (
          <div className="mt-3 rounded-lg border border-warn bg-warn/10 px-3 py-2 text-[12.5px] text-warn-ink" data-testid="setup-problems">
            <b>Setup on this machine:</b>
            <ul className="mt-1 list-disc pl-4">
              {cfg.setup.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <span className="mt-1 block text-ink-3">Add these to .env.local and restart the app.</span>
          </div>
        )}
      </form>
      <FlowStrip />
      <p className="-mt-2 text-center text-xs text-ink-3">
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
        <div className="rounded-2xl border border-line bg-panel/80 p-4">
          <button type="button" onClick={() => setTestMode((v) => !v)} aria-expanded={testMode} className="flex w-full items-center justify-between text-left">
            <span>
              <span className="text-sm font-semibold">Test mode</span>
              <span className="ml-2 text-xs text-ink-3">Inject failures and watch the agent ask before anything changes.</span>
            </span>
            <span className={`relative h-5 w-9 shrink-0 rounded-[6px] transition-colors ${testMode ? "bg-warn" : "bg-line"}`}>
              <motion.span layout className={`absolute top-0.5 h-4 w-4 rounded-[4px] bg-white shadow ${testMode ? "right-0.5" : "left-0.5"}`} />
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
                        className={`pressable tap inline-flex cursor-pointer select-none items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${on ? "border-warn bg-warn/15 text-warn-ink" : "border-line text-ink-2 hover:border-ink/30"}`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={on}
                          onChange={(e) => setFaults((xs) => (e.target.checked ? [...xs, f.code] : xs.filter((x) => x !== f.code)))}
                        />
                        {on && <Icon name="check" size={13} stroke={2.4} />}
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
    </div>
  );
}
