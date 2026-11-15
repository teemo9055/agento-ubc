"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AgentIcon } from "@/components/AgentIcon";
import { Button } from "@/components/ui";
import { post, useAgentTheme } from "@/components/useRun";
import { THEMES } from "@/lib/themes";
import type { AgentId, Run, Venue } from "@/lib/types";
import { outfitFor } from "@/lib/outfit";
import { Icon } from "@/components/Icon";
import { KITS } from "@/lib/agentKit";
import { usePasskeyWallet } from "@/components/passkey/usePasskey";
import { usePrefs } from "@/lib/prefs";

interface Config {
  live: boolean;
  liveNeedsCode?: boolean;
  setup?: string[];
  agents: { id: AgentId; examples: string[] }[];
}

const ASK: Record<AgentId, string> = {
  inso: "What should Inso look into?",
  trado: "What should Trado trade?",
  travo: "Where should Travo route you?",
};

const VENUE_LINE: Record<Venue, string> = {
  paper: "orders are practice only",
  "gemini-sandbox": "orders go to Gemini's test exchange",
  gemini: "orders use real money on Gemini",
};

export default function NewJob() {
  const router = useRouter();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [agent, setAgent] = useState<AgentId>("inso");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [prefs, , ready] = usePrefs();
  const pk = usePasskeyWallet();
  useAgentTheme(agent);

  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("agent");
    if (a && a in THEMES) setAgent(a as AgentId);
    fetch("/api/config")
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => undefined);
    fetch("/api/trading")
      .then((r) => r.json())
      .then((s) => setVenue(s.venue))
      .catch(() => undefined);
  }, []);

  const mode = (prefs.mode ?? (cfg?.live && !cfg.liveNeedsCode ? "live" : "demo")) === "live" && cfg?.live ? "live" : "demo";
  const usePasskey = mode === "live" && pk.supported && prefs.payFrom === "passkey";
  const needsWallet = usePasskey && !pk.wallet;
  const examples = cfg?.agents.find((a) => a.id === agent)?.examples ?? [];
  const theme = THEMES[agent];
  const kit = KITS[agent];
  const trades = agent !== "travo";

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (task.trim().length < 3 || needsWallet) return;
    setBusy(true);
    setErr("");
    try {
      const run = await post<Run>("/api/runs", {
        agent,
        task,
        mode,
        faults: prefs.faults,
        accessCode: mode === "live" && !usePasskey ? prefs.accessCode : undefined,
        payerAddress: usePasskey ? pk.wallet?.address : undefined,
      });
      router.push(`/runs/${run.id}`);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="grid-paper -mx-4 -mt-6 px-4 pb-6 pt-8 sm:-mx-6 sm:-mt-8 sm:px-6 sm:pt-12">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={agent} initial={{ opacity: 0, scale: 0.85, rotate: -6 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ type: "spring", stiffness: 420, damping: 22 }}>
              <AgentIcon agent={agent} size={68} outfit={outfitFor(agent, task)} mood={busy ? "working" : "idle"} />
            </motion.span>
          </AnimatePresence>
          <h1 className="font-pixel text-[28px] leading-tight sm:text-[36px]">{ASK[agent]}</h1>
          <p className="max-w-lg text-[15px] leading-relaxed text-ink-2">Asking is free. Nothing is spent until you approve a plan with a price on it.</p>
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
            {examples.slice(0, 4).map((x, i) => (
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
            <p className="min-w-0 text-[12.5px] text-ink-3" data-testid="ask-status">
              {ready && cfg ? (
                <>
                  {mode === "live" ? "Pays in USDC on Arc testnet" : "Practice mode: nothing settles"}
                  {trades && venue ? ` · ${VENUE_LINE[venue]}` : ""}
                  {prefs.faults.length > 0 ? ` · test mode (${prefs.faults.length})` : ""} ·{" "}
                  <Link href="/settings" className="underline decoration-line underline-offset-2 hover:text-ink">
                    Settings
                  </Link>
                </>
              ) : (
                " "
              )}
            </p>
            <Button type="submit" disabled={busy || task.trim().length < 3 || needsWallet} variant="agent">
              {busy ? (
                "Starting…"
              ) : (
                <>
                  Ask <Icon name="arrow" size={16} stroke={2.2} />
                </>
              )}
            </Button>
          </div>
          {needsWallet && (
            <p className="mt-3 text-[13px] text-warn-ink">
              You chose to pay from a passkey wallet but haven&apos;t created one.{" "}
              <Link href="/settings" className="underline underline-offset-2">
                Set it up in Settings
              </Link>
              .
            </p>
          )}
          {err && <p className="mt-3 text-sm text-bad">{err}</p>}
          {cfg?.setup && cfg.setup.length > 0 && (
            <p className="mt-3 text-[12.5px] text-warn-ink" data-testid="setup-problems">
              This machine isn&apos;t fully set up ({cfg.setup.length} thing{cfg.setup.length > 1 ? "s" : ""}).{" "}
              <Link href="/settings" className="underline underline-offset-2">
                See Settings
              </Link>
            </p>
          )}
        </form>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={agent} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="grid gap-3 sm:grid-cols-2" data-agent={agent} data-testid="capabilities">
            <div className="rounded-xl border border-line bg-panel/80 p-3.5">
              <div className="text-[13px] font-semibold">{theme.name} can</div>
              <ul className="mt-1.5 space-y-1 text-[13px] text-ink-2">
                {kit.can.map((x) => (
                  <li key={x} className="flex gap-1.5">
                    <Icon name="check" size={13} stroke={2.4} className="mt-[3px] shrink-0 text-good" /> {x}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-line bg-panel/80 p-3.5">
              <div className="text-[13px] font-semibold">Can&apos;t do here</div>
              <ul className="mt-1.5 space-y-1 text-[13px] text-ink-2">
                {kit.cant.map((x) => (
                  <li key={x} className="flex gap-1.5">
                    <Icon name="x" size={13} stroke={2.4} className="mt-[3px] shrink-0 text-ink-3" /> {x}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12.5px] text-ink-3">Need more than one agent? Ask for it all at once (&ldquo;…, then …&rdquo;) and you get one plan.</p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
