"use client";
import { useEffect, useState } from "react";
import { NotPossibleCard, notPossibleOf } from "@/components/NotPossible";
import type { NotPossible as NotPossibleInfo } from "@/lib/impossible";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AgentIcon } from "@/components/AgentIcon";
import { Button, Spinner } from "@/components/ui";
import { post, useAgentTheme } from "@/components/useRun";
import { AGENT_LIST, THEMES } from "@/lib/themes";
import type { AgentId, Run, Venue } from "@/lib/types";
import { Icon } from "@/components/Icon";
import { CAPABILITIES, WHERE_LABEL, type Where } from "@/lib/capabilities";
import { Point, Points, type PointTone } from "@/components/Points";
import { usePasskeyWallet } from "@/components/passkey/usePasskey";
import { jobNetwork, mainnetHeldBack, usePrefs, type NetConfig } from "@/lib/prefs";

type Config = {
  live: boolean;
  liveNeedsCode?: boolean;
  setup?: string[];
} & NonNullable<NetConfig>;

type Who = "auto" | AgentId;

/**
 * Starting points by what the user wants done, not by which agent does it.
 * Each opens a conversation where the agent asks for the one thing it needs next.
 */
const GOALS: { title: string; sub: string; agent: AgentId; say: string }[] = [
  { title: "Protect against a cost", sub: "Pay a little now, get paid if the bad thing happens", agent: "inso", say: "I want to protect myself against a cost" },
  { title: "Bet on an outcome", sub: "Crypto, rates, weather, sports", agent: "inso", say: "I want to bet on something" },
  { title: "See what the odds say", sub: "What the market thinks will happen", agent: "inso", say: "What are the markets saying?" },
  { title: "Plan a road trip", sub: "A drive split into days, with places to stay", agent: "worko", say: "Plan a road trip for me" },
  { title: "Check what I hold", sub: "Your positions, and selling them", agent: "inso", say: "Show my positions" },
];

/** Each group of "what works" gets its own tone: works now, needs an exchange, needs mainnet, not offered. */
const WHERE_TONE: Record<Where, { tone: PointTone; head: string }> = {
  now: { tone: "good", head: "text-good" },
  exchange: { tone: "agent", head: "text-agent-ink" },
  mainnet: { tone: "warn", head: "text-warn-ink" },
  never: { tone: "muted", head: "text-ink-3" },
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
  const [who, setWho] = useState<Who>("auto");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [blocked, setBlocked] = useState<NotPossibleInfo | null>(null);
  const [prefs, , ready] = usePrefs();
  const pk = usePasskeyWallet();
  useAgentTheme(who === "auto" ? "inso" : who);

  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("agent");
    if (a && a in THEMES) setWho(a as AgentId);
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
  const network = jobNetwork(prefs, cfg);
  const heldBack = mode === "live" && mainnetHeldBack(prefs, cfg);

  async function start(text: string, agent: Who, key: string, template?: "showcase") {
    if (text.trim().length < 3 || (needsWallet && !template) || busy) return;
    setBusy(key);
    setErr("");
    setBlocked(null);
    try {
      const run = await post<Run>("/api/runs", {
        agent: template ? "inso" : agent,
        task: text,
        mode,
        network: mode === "live" ? jobNetwork(prefs, cfg) : undefined,
        template,
        faults: template ? [] : prefs.faults,
        // A plan is paid from the app's wallet, whichever wallet single jobs use.
        accessCode: mode === "live" && (!usePasskey || template) ? prefs.accessCode : undefined,
        payerAddress: usePasskey && !template ? pk.wallet?.address : undefined,
      });
      router.push(`/runs/${run.id}`);
    } catch (x) {
      const no = notPossibleOf(x);
      if (no) setBlocked(no);
      else setErr((x as Error).message);
      setBusy("");
    }
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-6 pt-2 sm:pt-8">
      <div className="text-center">
        <h1 className="font-pixel text-[26px] leading-tight sm:text-[32px]">What do you want done?</h1>
        <p className="mt-2 text-[15px] text-ink-2">Say it in your own words. Asking is free.</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void start(task, who, "ask");
        }}
        className="rounded-[14px] border-[1.5px] border-ink bg-panel p-4 shadow-[4px_4px_0_0_var(--color-ink)] transition-shadow focus-within:shadow-[4px_4px_0_0_var(--agent)]"
      >
        <label htmlFor="task" className="sr-only">
          What you want done
        </label>
        <textarea
          id="task"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void start(task, who, "ask");
            }
          }}
          rows={2}
          maxLength={1000}
          autoFocus
          placeholder="e.g. A cold snap would cost me $20 in rides tomorrow in NYC. Can I cover that?"
          style={{ outline: "none" }}
          className="w-full resize-none bg-transparent text-[17px] leading-relaxed placeholder:text-ink-3"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1 text-[12.5px]" role="tablist" aria-label="Who takes it">
            {(["auto", "inso", "worko"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={who === id}
                onClick={() => setWho(id)}
                title={id === "auto" ? "The agent that fits your request is picked for you" : THEMES[id].tagline}
                className={`pressable inline-flex h-8 items-center gap-1.5 rounded-lg px-2 font-medium transition-colors ${who === id ? "bg-ink text-white" : "text-ink-3 hover:bg-ink/5 hover:text-ink"}`}
              >
                {id === "auto" ? "Auto" : THEMES[id].name}
              </button>
            ))}
          </div>
          <Button type="submit" disabled={Boolean(busy) || task.trim().length < 3 || needsWallet} variant="agent" className="h-10 px-5">
            {busy === "ask" ? <Spinner /> : null} Ask <Icon name="arrow" size={16} stroke={2.2} />
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
        {heldBack && (
          <p className="mt-3 text-[13px] text-ink-2" data-testid="mainnet-held-back">
            You picked Arc mainnet, but this server can&apos;t pay there yet, so jobs run on Arc testnet with test USDC.{" "}
            <Link href="/settings#s-pay" className="underline underline-offset-2">
              Settings
            </Link>
          </p>
        )}
        {err && <p className="mt-3 text-sm text-bad">{err}</p>}
        {blocked && (
          <NotPossibleCard
            info={blocked}
            busy={Boolean(busy)}
            onPick={(t) => {
              setTask(t);
              void start(t, "auto", t);
            }}
          />
        )}
      </form>

      <nav aria-label="Agent homes" className="grid grid-cols-2 gap-2" data-testid="agent-homes">
        {AGENT_LIST.map((a) => (
          <Link key={a} href={`/${a}`} data-agent={a} className="pressable flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2.5 hover:border-ink">
            <AgentIcon agent={a} size={28} />
            <span className="min-w-0">
              <span className="block font-pixel text-[12px] text-agent-ink">{THEMES[a].name}</span>
              <span className="block truncate text-[12px] text-ink-3">{THEMES[a].domain}</span>
            </span>
          </Link>
        ))}
      </nav>

      <section aria-label="Start from a goal">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-ink-2">Or start from a goal</h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-2" data-testid="goals">
          {GOALS.map((g, i) => (
            <motion.button
              key={g.title}
              type="button"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              disabled={Boolean(busy) || needsWallet}
              onClick={() => start(g.say, g.agent, g.title)}
              data-agent={g.agent}
              className="pressable group flex min-w-0 items-center gap-3 rounded-xl border border-line bg-panel px-3.5 py-3 text-left transition-colors hover:border-ink disabled:opacity-60"
            >
              <AgentIcon agent={g.agent} size={30} mood={busy === g.title ? "working" : "idle"} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold">{g.title}</span>
                <span className="block truncate text-[12.5px] text-ink-3">{g.sub}</span>
              </span>
              {busy === g.title ? <Spinner /> : <Icon name="arrow" size={15} className="shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />}
            </motion.button>
          ))}
        </div>
        <p className="mt-2 text-[12.5px] text-ink-3">Need several things? Say them together (&ldquo;sell my calmest position, then plan a drive to Austin&rdquo;) and you get one plan.</p>
      </section>

      <details className="group rounded-xl border border-line bg-panel/70 px-3.5 py-2.5 text-[13px]" data-testid="limits-of-agents">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-ink-2 hover:text-ink">
          <Icon name="chevron" size={14} className="transition-transform group-open:rotate-90" /> What works today, and what doesn&apos;t yet
        </summary>
        {(["now", "exchange", "mainnet", "never"] as const).map((w) => (
          <div key={w} className="mt-3">
            <div className={`text-[12px] font-semibold uppercase tracking-wide ${WHERE_TONE[w].head}`}>{WHERE_LABEL[w]}</div>
            <Points as="ul" min={240} className="mt-1.5">
              {CAPABILITIES.filter((c) => c.where === w).map((c) => (
                <Point as="li" key={c.what} size="sm" tone={WHERE_TONE[w].tone} soft={w === "never"}>
                  {c.what}
                  <span className="num text-ink-3">
                    {c.cost ? ` · ${c.cost} USDC` : w === "now" ? " · free" : ""}
                    {c.note && w !== "now" ? ` · ${c.note}` : ""}
                  </span>
                </Point>
              ))}
            </Points>
          </div>
        ))}
        <p className="mt-3 text-ink-3">Without an exchange connected, orders are practice orders: everything else still runs for real. Ask for something that isn&apos;t possible and the agent says so, then offers the closest thing that works.</p>
      </details>

      <p className="text-center text-[12.5px] text-ink-3" data-testid="ask-status">
        {ready && cfg ? (
          <>
            {mode === "live" ? (network === "mainnet" ? "Pays in real USDC on Arc mainnet" : "Pays in test USDC on Arc testnet") : "Practice: nothing real is paid or sent"}
            {heldBack ? " (Arc mainnet isn't set up on this server yet)" : ""}
            {venue ? ` · ${VENUE_LINE[venue]}` : ""}
            {prefs.faults.length > 0 ? ` · test mode (${prefs.faults.length})` : ""}
            {cfg.setup && cfg.setup.length > 0 ? ` · setup incomplete (${cfg.setup.length})` : ""} ·{" "}
            <Link href="/settings" className="underline decoration-line underline-offset-2 hover:text-ink">
              Settings
            </Link>
          </>
        ) : (
          " "
        )}
      </p>
    </div>
  );
}
