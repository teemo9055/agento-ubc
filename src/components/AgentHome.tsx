"use client";
import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { NotPossibleCard } from "./NotPossible";
import { Mascot } from "./Mascot";
import { Icon } from "./Icon";
import { Button, Spinner } from "./ui";
import { useAgentTheme } from "./useRun";
import { useRuns } from "./runsStore";
import { useStartJob } from "./useStartJob";
import { Band, Card } from "./JobCard";
import { Catalog } from "./JobCatalog";
import { usePrefs } from "@/lib/prefs";
import { THEMES } from "@/lib/themes";
import type { AgentId } from "@/lib/types";

const HERO: Record<AgentId, { line: string; placeholder: string }> = {
  inso: { line: "Insure the things that could go wrong, with Gemini's prediction markets.", placeholder: "e.g. my rides cost double when it's freezing in Boston" },
  trado: { line: "", placeholder: "" },
  worko: { line: "Errands done for you: researched, planned and checked.", placeholder: "e.g. plan a drive from Austin to Denver in 3 days" },
};

/**
 * An agent's home: ready-made jobs that are known to work, grouped the way people think about
 * them, each a card that opens a job built from live data. "Create your own" is there for anything
 * else; the agent then shapes it in the job's chat.
 */
export function AgentHome({ agent }: { agent: AgentId }) {
  useAgentTheme(agent);
  const t = THEMES[agent];
  const h = HERO[agent];
  const [prefs] = usePrefs();
  const { start, startJob, busy, err, blocked } = useStartJob();
  const [own, setOwn] = useState(false);
  const [text, setText] = useState("");
  const { runs } = useRuns();
  const mine = (runs ?? []).filter((r) => r.agent === agent && !r.parentId).slice(0, 8);

  return (
    <div className="flex flex-col gap-8" data-agent={agent} data-testid={`agent-home-${agent}`}>
      <Band single />
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <motion.span initial={{ scale: 0.85, rotate: -6, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 18 }} className="pix-shadow inline-flex rounded-2xl border-[1.5px] border-ink bg-agent-soft p-1.5">
            <Mascot agent={agent} mood="happy" size={68} />
          </motion.span>
          <div className="min-w-0">
            <h1 className="font-pixel text-[32px] leading-none text-agent-ink sm:text-[38px]">{t.name}</h1>
            <p className="mt-1.5 max-w-md text-[14.5px] leading-snug text-ink-2">{h.line}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOwn((x) => !x)}
          aria-expanded={own}
          className="pressable inline-flex h-11 items-center gap-2 self-start rounded-full border-[1.5px] border-ink bg-panel px-4 text-[14px] font-semibold shadow-[3px_3px_0_0_var(--agent)] hover:bg-agent-soft sm:self-auto"
          data-testid="create-own"
        >
          <Icon name={own ? "x" : "plus"} size={16} stroke={2.2} /> {own ? "Close" : "Create your own"}
        </button>
      </header>

      <AnimatePresence initial={false}>
        {own && (
          <motion.form
            key="own"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
            onSubmit={(e) => {
              e.preventDefault();
              void start(agent, text, "ask");
            }}
          >
            <div className="rounded-[22px] border-[1.5px] border-ink bg-panel p-4 shadow-[5px_5px_0_0_var(--agent)] sm:p-5">
              <label htmlFor="agent-ask" className="text-[13px] font-semibold text-ink-2">
                Describe it in your own words. {t.name} shapes it with you before anything is paid.
              </label>
              <div className="mt-2.5 flex gap-2">
                <input id="agent-ask" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={h.placeholder} maxLength={1000} className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-[15px] outline-none focus:border-ink/50" data-testid="agent-ask" />
                <Button type="submit" variant="agent" className="h-12 px-5" disabled={text.trim().length < 3 || Boolean(busy)}>
                  {busy === "ask" ? <Spinner /> : <Icon name="arrow" size={16} />} Ask
                </Button>
              </div>
              {blocked && (
                <NotPossibleCard
                  info={blocked}
                  busy={Boolean(busy)}
                  onPick={(x) => {
                    setText(x);
                    void start("auto", x, x);
                  }}
                />
              )}
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {err && (
        <p className="rounded-2xl border border-bad/40 bg-bad/5 px-4 py-3 text-[13.5px] text-bad" role="alert" data-testid="start-error">
          {err}
        </p>
      )}

      <Catalog agent={agent} venue={prefs.venue} onStart={(id, choice) => void startJob(id, choice)} busy={busy} />

      {mine.length > 0 && (
        <section aria-labelledby="yours" className="min-w-0">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 id="yours" className="font-pixel text-[20px] leading-tight">
              Your jobs with {t.name}
            </h2>
            <Link href={`/home?folder=${agent}`} className="text-[13px] font-medium underline underline-offset-2">
              All of them
            </Link>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mine.map((r) => (
              <Card key={r.id} r={r} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
