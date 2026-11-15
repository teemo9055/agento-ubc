"use client";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { AgentIcon } from "@/components/AgentIcon";
import { Mascot } from "@/components/Mascot";
import { CancelModal, FailureModal, ReapprovalModal } from "@/components/RunPopups";
import { transitionReady } from "@/components/transitions";
import { ApproveModal, Cards, CostTable } from "@/components/WorkOrder";
import { Chat, MoveCard, actionText, stepTarget, targetKey, type EditTarget } from "@/components/Chat";
import { OrderStatus } from "@/components/OrderStatus";
import { Expect } from "@/components/Expect";
import { FinishCard } from "@/components/Celebrate";
import { AgentScene } from "@/components/AgentScene";
import { KITS } from "@/lib/agentKit";
import { Amount, Button, Spinner } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { post, useAgentTheme, useRun } from "@/components/useRun";
import { toast } from "@/components/Toaster";
import { fmt, sum } from "@/lib/money";
import { THEMES } from "@/lib/themes";
import { short, txUrl } from "@/lib/format";
import { paidInUsdc, type Card, type Run } from "@/lib/types";
import { moodFor } from "@/lib/outfit";
import { runOutfit } from "@/lib/summary";

// Heavy parts load only when the job reaches them.
const PhaseGraph = dynamic(() => import("@/components/PhaseGraph").then((m) => m.PhaseGraph), {
  ssr: false,
  loading: () => <div className="h-32 animate-pulse rounded-xl bg-line/40 motion-reduce:animate-none" />,
});
const AgentWidget = dynamic(() => import("@/components/widgets/AgentWidget").then((m) => m.AgentWidget), {
  ssr: false,
  loading: () => <div className="h-56 animate-pulse bg-line/40 motion-reduce:animate-none" />,
});
const ReceiptView = dynamic(() => import("@/components/ReceiptView").then((m) => m.ReceiptView), { ssr: false });

/** True at the desktop breakpoint (lg), where the chat is docked beside the plan. */
function useWide() {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)");
    const f = () => setWide(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return wide;
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6 motion-reduce:animate-none" aria-busy="true" aria-label="Loading job">
      <div className="h-4 w-48 rounded bg-line" />
      <div className="h-8 w-96 max-w-full rounded bg-line" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="h-72 rounded-2xl bg-line/60" />
        <div className="hidden h-[480px] rounded-2xl bg-line/60 lg:block" />
      </div>
    </div>
  );
}

function Section({ title, sub, aside, children, label }: { title: string; sub?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; label?: string }) {
  return (
    <section className="rounded-2xl border border-line bg-panel" aria-label={label ?? title}>
      <div className="flex min-h-[60px] items-center justify-between gap-3 border-b border-[#f1f0ec] px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
          {sub && <p className="num mt-0.5 truncate text-[12px] leading-tight text-ink-3">{sub}</p>}
        </div>
        {aside && <div className="flex shrink-0 items-center gap-3">{aside}</div>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Before a move is chosen: where the graph will appear, and the button that builds it. */
function NoGraphYet({ run, onBuilt }: { run: Run; onBuilt: () => void }) {
  const [busy, setBusy] = useState(false);
  const move = [...(run.chat ?? [])].reverse().find((m) => m.proposal)?.proposal;
  const name = THEMES[run.agent].name;
  const kit = KITS[run.agent];
  async function build() {
    if (!move) return;
    setBusy(true);
    try {
      await post(`/api/runs/${run.id}/adopt`, { proposalId: move.id });
      toast("Graph built · review the plan and approve", "good");
      onBuilt();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="grid-paper relative overflow-hidden rounded-2xl border border-line bg-panel" aria-label="Plan">
      <div className="flex justify-center px-6 pt-10">
        <AgentScene agent={run.agent} />
      </div>
      <div className="flex flex-col items-center gap-3 px-6 pb-8 pt-6 text-center">
        <AnimatePresence mode="wait" initial={false}>
          {move ? (
            <motion.div key={move.id} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 380, damping: 28 }} className="flex flex-col items-center gap-3">
              <div className="font-pixel text-[13px] text-agent-ink">Move ready</div>
              <div className="max-w-md text-[18px] font-semibold leading-snug">{move.title}</div>
              {move.action && <p className="max-w-md text-[13.5px] text-ink-2">{actionText(move.action)}</p>}
              <Button variant="agent" className="mt-1 h-11 px-5 text-[15px]" onClick={build} disabled={busy || run.status !== "exploring"} data-testid="build-graph">
                {busy ? <Spinner /> : <Icon name="graph" size={17} />} Build graph
              </Button>
              <p className="text-[12px] text-ink-3">Shows every step and its price. Nothing is spent until you approve.</p>
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-2">
              <div className="font-pixel text-[13px] text-ink-3">No plan yet</div>
              <p className="max-w-sm text-[14px] text-ink-2">Ask {name} anything in the chat. When it suggests a move you like, build the plan here.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <dl className="grid border-t border-line bg-panel text-left text-[13px] sm:grid-cols-3">
        <div className="border-line px-4 py-3 sm:border-r">
          <dt className="flex items-center gap-1.5 font-semibold">
            <Icon name="search" size={14} className="text-agent-ink" /> Free while you chat
          </dt>
          <dd className="mt-0.5 text-ink-2">{kit.free.join(", ")}</dd>
        </div>
        <div className="border-t border-line px-4 py-3 sm:border-r sm:border-t-0">
          <dt className="flex items-center gap-1.5 font-semibold">
            <Icon name="vault" size={14} className="text-agent-ink" /> Paid, after you approve
          </dt>
          <dd className="num mt-0.5 text-ink-2">{kit.paid.map((x) => `${x.label} ${x.price}`).join(", ")} USDC</dd>
        </div>
        <div className="border-t border-line px-4 py-3 sm:border-t-0">
          <dt className="flex items-center gap-1.5 font-semibold">
            <Icon name="bolt" size={14} className="text-agent-ink" /> Can do
          </dt>
          <dd className="mt-0.5 text-ink-2">{kit.acts}</dd>
        </div>
      </dl>
    </section>
  );
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { run, missing, lastEvent, connection, isLive } = useRun(id);
  const [focus, setFocus] = useState<EditTarget | null>(null);
  const [tab, setTab] = useState<"plan" | "chat" | null>(null);
  const [approving, setApproving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [finish, setFinish] = useState<"done" | "cancelled" | null>(null);
  useAgentTheme(run?.agent);
  const wide = useWide();

  useEffect(() => {
    if (run) transitionReady();
  }, [run]);

  const status = run?.status;
  // Phones open on the chat while exploring and on the plan afterwards, unless the user picked a tab.
  const shownTab = tab ?? (status === "exploring" ? "chat" : "plan");

  // Focus only makes sense on a draft; drop it once the plan moves on.
  useEffect(() => {
    if (status !== "draft") setFocus(null);
  }, [status]);

  // After approval the layout changes from plan to progress; bring the progress into view.
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "draft" && (status === "funding" || status === "running")) window.scrollTo({ top: 0, behavior: "smooth" });
    if (prevStatus.current === "exploring" && status === "draft") setTab("plan");
    prevStatus.current = status;
  }, [status]);

  // Toast the moments that matter, only when they happen live (not on replay).
  useEffect(() => {
    if (!lastEvent || !isLive(lastEvent)) return;
    // The finish card says it all; no toast on top of it.
    if (lastEvent.type === "run.done") setFinish("done");
    if (lastEvent.type === "run.cancelled") setFinish("cancelled");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);

  const pending = run ? [...run.pendingReapprovals.map((r) => ({ kind: "re" as const, id: r.id })), ...run.pendingFailures.map((f) => ({ kind: "fail" as const, id: f.id }))] : [];
  const head = pending[0];
  useEffect(() => {
    if (head && dismissed && dismissed !== head.id) setDismissed(null);
  }, [head, dismissed]);

  // Keyboard: A to review & approve on a draft (not while typing).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "a" && !e.metaKey && !e.ctrlKey && run?.status === "draft" && !(e.target as HTMLElement).closest("input,textarea")) setApproving(true);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [run?.status]);

  if (missing)
    return (
      <div className="mx-auto max-w-md pt-16 text-center">
        <div className="text-lg font-semibold">This job isn&apos;t on this server anymore</div>
        <p className="mt-1 text-sm text-ink-2">Jobs live in server memory. If it had a vault, the client wallet can still close it to recover funds.</p>
        <Link className="pix-press mt-4 inline-flex h-10 items-center rounded-lg border-[1.5px] border-ink bg-ink px-4 text-sm font-semibold text-white" href="/new">
          Start a new job
        </Link>
      </div>
    );
  if (!run || wide === null) return <Skeleton />;

  const theme = THEMES[run.agent];
  const planning = Boolean(run.planning);
  const exploring = run.status === "exploring";
  const draft = !planning && (run.status === "draft" || run.status === "funding");
  const finished = run.status === "done" || run.status === "cancelled";
  const done = run.phases.filter((p) => p.status === "done" || p.status === "skipped").length;
  const vaultLines = run.lines.filter((l) => paidInUsdc(l.rail));
  const total = sum(vaultLines.map((l) => l.approved));
  const actual = sum(vaultLines.map((l) => l.actual));
  const showPopup = head && dismissed !== head.id && !approving && !cancelling;
  const reapproval = head?.kind === "re" ? run.pendingReapprovals.find((r) => r.id === head.id) : undefined;
  const failure = head?.kind === "fail" ? run.pendingFailures.find((f) => f.id === head.id) : undefined;

  /** Edit on a card hands that card to the chat (and on phones, opens the chat). Pressing it again lets go. */
  /** Hand a card or a graph step to the chat; pressing the same one again lets go. Phones jump to the chat. */
  const focusOn = (t: EditTarget | null) => {
    const same = targetKey(t) === targetKey(focus);
    setFocus(same ? null : t);
    if (!wide && !same && t) setTab("chat");
  };
  const editCard = (k: Card["kind"]) => focusOn({ kind: "card", card: k });
  const editStep = (id: string) => focusOn(stepTarget(run, id));
  const editableSteps = run.status === "draft" ? run.phases.filter((p) => stepTarget(run, p.id)).map((p) => p.id) : [];

  const header = (
    <motion.header initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span style={{ viewTransitionName: `mascot-${run.id}` }}>
          <AgentIcon agent={run.agent} size={wide ? 56 : 44} outfit={runOutfit(run)} mood={moodFor(run.status, run.pendingReapprovals.length + run.pendingFailures.length)} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-ink-3">
            <span className="font-pixel text-[13px] text-agent-ink">{theme.name}</span>
            <span>· {theme.domain}</span>
            <span className={`inline-flex h-[22px] items-center rounded-md px-2 text-[12px] font-semibold ${run.mode === "live" ? "bg-ink text-white" : "bg-[#f1f0ec] text-ink-2"}`}>{run.mode === "live" ? "Arc testnet" : "Demo rail"}</span>
            {connection === "reconnecting" && (
              <span className="inline-flex h-[22px] items-center gap-1 rounded-md border border-warn bg-warn/15 px-2 text-[12px] text-warn-ink" role="status">
                <Spinner /> Reconnecting
              </span>
            )}
            <span className="inline-flex h-[22px] items-center rounded-md bg-agent-soft px-2 text-[12px] font-semibold text-agent-ink" title={run.ai ? `${run.ai.calls} model calls` : undefined}>
              {run.ai ? "AI agent" : "Rule-based agent"}
            </span>
          </div>
          <h1 style={{ viewTransitionName: `task-${run.id}` }} className="mt-1 max-w-2xl text-[19px] font-semibold leading-tight tracking-tight sm:text-[26px]">
            {run.task}
          </h1>
          <AnimatePresence mode="wait">
            <motion.p key={run.status} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-1 hidden text-sm text-ink-2 sm:block">
              {run.planning ? "Working out the plan and the price." : theme.copy[run.status]}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
      <div className="flex w-full items-baseline justify-between gap-3 border-t border-line pt-3 sm:block sm:w-auto sm:border-0 sm:pt-0 sm:text-right">
        <div className="text-[12px] text-ink-3">{exploring ? "Spent" : planning ? "Pricing…" : draft ? "Plan total" : finished ? "Paid" : "Spent so far"}</div>
        <div className="text-[22px] font-semibold leading-none tracking-tight sm:text-[36px]" data-testid="big-number">
          {planning ? <span className="inline-block h-9 w-32 animate-pulse rounded-md bg-line align-middle motion-reduce:animate-none" /> : <Amount key={exploring ? "explore" : draft ? "plan" : "run"} value={exploring ? 0n : draft ? total : actual} />}
        </div>
        <div className="num text-[12px] text-ink-3 sm:mt-1">{exploring ? "Exploring is free" : !draft && !planning ? `of ${fmt(total)} approved` : " "}</div>
      </div>
    </motion.header>
  );

  const plan = (
    <div className="space-y-5">
      {exploring && <NoGraphYet run={run} onBuilt={() => setTab("plan")} />}

      {planning && (
        <section className="space-y-5" aria-busy="true" aria-label="Planning">
          <div className="flex items-center gap-4 rounded-2xl border border-line bg-panel p-5">
            <Mascot agent={run.agent} outfit={runOutfit(run)} mood="working" size={64} />
            <div>
              <div className="font-pixel text-[15px] text-agent-ink">Building the plan</div>
              <p className="mt-1 text-sm text-ink-2">Pricing each step. Nothing is spent until you approve.</p>
            </div>
          </div>
          <div className="h-40 animate-pulse rounded-2xl border border-line bg-panel/60 motion-reduce:animate-none" />
        </section>
      )}

      {draft && (
        <>
          <Expect run={run} />
          <Section
            title="Steps"
            label="Plan graph"
            sub={`${run.phases.length} steps · nothing runs until you approve · click a step to change it`}
            aside={
              <>
                {run.status === "draft" && (
                  <Button variant="quiet" className="h-8 px-2.5 text-[12.5px]" onClick={() => post(`/api/runs/${run.id}/back`).catch((e) => toast((e as Error).message, "bad"))} data-testid="back-to-chat">
                    <Icon name="back" size={14} /> Change the move
                  </Button>
                )}
              </>
            }
          >
            <PhaseGraph
              phases={run.phases}
              lines={run.lines}
              simulated={run.mode === "demo"}
              editable={editableSteps}
              focusedId={focus?.kind === "step" ? focus.step : null}
              onEditStep={editStep}
            />
            {run.proposal && (
              <details className="group mt-3 border-t border-[#f1f0ec] pt-3">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink">
                  <Icon name="chevron" size={14} className="transition-transform group-open:rotate-90" /> The move you agreed in chat
                </summary>
                <MoveCard p={run.proposal} run={run} chosen />
              </details>
            )}
          </Section>

          <Cards run={run} onEdit={run.status === "draft" ? editCard : undefined} focused={focus?.kind === "card" ? focus.card : null} />
          <CostTable run={run} />
          <AnimatePresence>
            {run.editNote && (
              <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`text-right text-[12.5px] ${run.editNote.ok ? "text-ink-2" : "text-bad"}`}>
                {run.editNote.message}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Desktop: sticks to the bottom of the plan. Phones: a bar above the tab bar. */}
          <div className="fixed inset-x-0 bottom-[var(--tabbar-h)] z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-md sm:sticky sm:bottom-4 sm:rounded-2xl sm:border-[1.5px] sm:border-ink sm:bg-panel sm:px-4 sm:shadow-[4px_4px_0_0_var(--color-ink)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="hidden min-w-0 items-center gap-4 text-[13px] text-ink-2 sm:flex">
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="vault" size={16} className="text-agent-ink" /> Vault <b className="num text-ink">{fmt(run.cap)}</b>
                </span>
                <span className="hidden items-center gap-1.5 xl:inline-flex">
                  <Icon name="shield" size={16} className="text-agent-ink" /> Only these lines and payees
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="refund" size={16} className="text-agent-ink" /> Unspent comes back
                </span>
              </div>
              <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
                <Button variant="quiet" onClick={() => setCancelling(true)}>
                  Discard
                </Button>
                <span className="num text-sm text-ink-2 sm:hidden">{fmt(total)} USDC</span>
                <Button onClick={() => setApproving(true)} disabled={run.status !== "draft"} data-testid="open-approve" variant="agent" className="px-5">
                  {run.status === "funding" ? (
                    <>
                      <Spinner /> Funding vault…
                    </>
                  ) : (
                    <>
                      Review & approve <kbd className="ml-1 hidden rounded border border-current/40 px-1 text-[10px] opacity-70 sm:inline">A</kbd>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {!draft && !planning && !exploring && (
        <>
          {run.proposal && <OrderStatus run={run} />}
          <Section
            title={finished ? (run.status === "done" ? "All steps done" : "Stopped") : `Step ${Math.min(done + 1, run.phases.length)} of ${run.phases.length}`}
            label="Progress"
            aside={
              <div className="flex items-center gap-3 text-[13px]">
                <AnimatePresence>
                  {pending.length > 0 && dismissed === head?.id && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      onClick={() => setDismissed(null)}
                      className="inline-flex h-7 items-center rounded-md border border-warn bg-warn/15 px-2.5 text-[12px] font-semibold text-warn-ink"
                    >
                      {pending.length} needs you
                    </motion.button>
                  )}
                </AnimatePresence>
                <span className="num text-ink-3">{Math.round((done / run.phases.length) * 100)}%</span>
              </div>
            }
          >
            <div className="sr-only" aria-live="polite">
              {run.phases.filter((p) => p.status === "active").map((p) => `${p.label} running`).join(", ")}
              {pending.length ? ` · ${pending.length} needs your decision` : ""}
            </div>
            <div className="mb-4 h-1.5 overflow-hidden rounded-[2px] bg-[#f1f0ec]">
              <motion.div className="h-full rounded-[2px] bg-good" animate={{ width: `${(done / run.phases.length) * 100}%` }} transition={{ duration: 0.5 }} />
            </div>
            <PhaseGraph phases={run.phases} lines={run.lines} simulated={run.mode === "demo"} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#f1f0ec] pt-3 text-[12px] text-ink-3">
              <span>
                {run.vault ? (
                  <>
                    Vault <span className="font-mono">{short(run.vault)}</span>
                    {run.fundingTx && (
                      <a className="ml-2 inline-flex items-center gap-0.5 underline decoration-line underline-offset-2 hover:text-ink" href={txUrl(run.fundingTx)} target="_blank" rel="noreferrer">
                        funding tx <Icon name="external" size={11} />
                      </a>
                    )}
                  </>
                ) : (
                  "Vault simulated on demo rail"
                )}
              </span>
              {!finished && (
                <Button variant="quiet" className="h-8 text-[12.5px]" onClick={() => setCancelling(true)}>
                  Cancel job
                </Button>
              )}
            </div>
          </Section>

          <section className="min-w-0 rounded-2xl border border-line bg-panel p-4" aria-label="Result">
            <AgentWidget run={run} />
          </section>
          <CostTable run={run} compact />

          <AnimatePresence>
            {finished && (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}>
                <ReceiptView run={run} />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );

  const chatPanel = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center gap-2.5 border-b border-line bg-panel px-4 py-3">
        <AgentIcon agent={run.agent} size={28} outfit={runOutfit(run)} mood={run.thinking ? "working" : "idle"} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Chat with {theme.name}</div>
          <div className="truncate text-[12px] text-ink-3">{theme.domain}</div>
        </div>
      </div>
      {/* The agent's own toolkit: what it looks up for free and what it can do. */}
      <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line bg-panel px-4 py-2.5" aria-label={`${theme.name}'s tools`}>
        {KITS[run.agent].free.map((t) => (
          <span key={t} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-[#f1f0ec] px-2 text-[12px] text-ink-2">
            <Icon name="search" size={11} /> {t}
          </span>
        ))}
        {KITS[run.agent].paid.map((t) => (
          <span key={t.label} className="num inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-ink-2">
            {t.label} <span className="text-ink-3">{t.price}</span>
          </span>
        ))}
      </div>
      <Chat run={run} focus={focus} onFocusClear={() => setFocus(null)} onAdopted={() => setTab("plan")} />
    </div>
  );

  return (
    // Wider than the page column so the plan and the chat both get room.
    <div className="pb-24 sm:pb-0 lg:mx-[calc(50%-min(50vw-24px,720px))]">
      <AnimatePresence>
        {run.faults.length > 0 && !finished && (
          <motion.div exit={{ opacity: 0, height: 0 }} role="status" className="mb-5 rounded-xl border border-warn bg-warn/15 px-4 py-2 text-sm text-warn-ink">
            <b>Test mode.</b> Fault switches on: {run.faults.join(", ").replaceAll("_", " ")}
          </motion.div>
        )}
      </AnimatePresence>
      <Link href="/" className="mb-3 inline-flex min-h-8 items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <Icon name="back" size={15} /> All jobs
      </Link>
      {/* Desktop: the header sits over the plan only, so the chat starts at the top and its message box is on screen. */}
      {!wide && header}

      {wide ? (
        <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-6">
          <div className="min-w-0">
            {header}
            <div className="mt-6">{plan}</div>
          </div>
          <aside className="sticky top-[84px] h-[calc(100dvh-152px)] min-h-[480px]" aria-label="Chat">
            {chatPanel}
          </aside>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="View" className="sticky top-16 z-20 -mx-4 mt-5 flex gap-1 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur-md">
            {(["plan", "chat"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={shownTab === t}
                onClick={() => setTab(t)}
                className={`pressable relative inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[14px] font-medium transition-colors ${shownTab === t ? "bg-panel text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-2"}`}
              >
                <Icon name={t === "plan" ? "graph" : "chat"} size={16} />
                {t === "plan" ? "Plan" : "Chat"}
                {t === "chat" && focus && <span className="absolute right-3 top-2 h-2 w-2 rounded-[2px] bg-agent" aria-label="editing" />}
              </button>
            ))}
          </div>
          <div className="mt-4">{shownTab === "plan" ? plan : <div className="h-[calc(100dvh-var(--tabbar-h)-150px)] min-h-[420px]">{chatPanel}</div>}</div>
        </>
      )}

      <FinishCard run={run} kind={finish} onClose={() => setFinish(null)} />
      <ApproveModal run={run} open={approving} onClose={() => setApproving(false)} />
      <CancelModal run={run} open={cancelling} onClose={() => setCancelling(false)} />
      {showPopup && reapproval && <ReapprovalModal key={reapproval.id} run={run} req={reapproval} onClose={() => setDismissed(reapproval.id)} />}
      {showPopup && failure && <FailureModal key={failure.id} run={run} failure={failure} onClose={() => setDismissed(failure.id)} />}
    </div>
  );
}
