"use client";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { AgentIcon } from "@/components/AgentIcon";
import { Mascot } from "@/components/Mascot";
import { CancelModal, FailureModal, ReapprovalModal } from "@/components/RunPopups";
import { transitionReady } from "@/components/transitions";
import { ApproveModal, CostTable } from "@/components/WorkOrder";
import { Chat, stepTarget, targetKey, type EditTarget } from "@/components/Chat";
import { OrderStatus } from "@/components/OrderStatus";
import { Details, ReviewCard, ReviewCards, ReviewTotal, StatusCard } from "@/components/JobBrief";
import { ReceiptView } from "@/components/ReceiptView";
import { LiveMarket } from "@/components/Live";
import { PlanBoard, planOf } from "@/components/PlanBoard";
import { BriefCard, briefOf } from "@/components/BriefCard";
import { ProjectReview } from "@/components/ProjectReview";
import { markOpened } from "@/lib/opened";
import { usePathname, useRouter } from "next/navigation";
import { Assemble } from "@/components/Assemble";
import { Stages, Workspace } from "@/components/Workspace";
import { FinishCard } from "@/components/Celebrate";
import { AgentScene } from "@/components/AgentScene";
import { KITS } from "@/lib/agentKit";
import { TEMPLATE_LABEL, templateOf } from "@/lib/templates";
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

/** The name of the project a job belongs to, for the "Part of" link. */
function useParentTitle(id?: string) {
  const [title, setTitle] = useState<string>();
  useEffect(() => {
    if (!id) return;
    fetch(`/api/runs/${id}`)
      .then((r) => (r.ok ? (r.json() as Promise<Run>) : null))
      .then((r) => r && setTitle(r.plan?.title ?? r.proposal?.title ?? r.task))
      .catch(() => undefined);
  }, [id]);
  return title;
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

/** Where the job's money was kept, with a link to its funding on Arc. */
function VaultNote({ run }: { run: Run }) {
  return (
    <p className="text-[12px] text-ink-3">
      {run.vault ? (
        <>
          Money held on Arc in this job&apos;s own account{" "}
          {run.fundingTx && (
            <a className="ml-1 inline-flex items-center gap-0.5 underline decoration-line underline-offset-2 hover:text-ink" href={txUrl(run.fundingTx)} target="_blank" rel="noreferrer" title={`Vault ${short(run.vault)}`}>
              see it on Arc <Icon name="external" size={11} />
            </a>
          )}
        </>
      ) : run.mode === "demo" ? (
        "Practice: no real money was set aside"
      ) : (
        "Nothing was set aside: this job bought no data"
      )}
    </p>
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

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { run, missing, lastEvent, connection, isLive } = useRun(id);
  const [focus, setFocus] = useState<EditTarget | null>(null);
  const [tab, setTab] = useState<"plan" | "chat" | null>(null);
  const [approving, setApproving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [finish, setFinish] = useState<"done" | "cancelled" | null>(null);
  const [details, setDetails] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; n: number } | null>(null);
  useAgentTheme(run?.agent);
  const wide = useWide();
  const parentTitle = useParentTitle(run?.parentId);
  // Remembered on this device so the home grid shows the most recently opened first.
  useEffect(() => markOpened(id), [id]);
  const pathname = usePathname();
  const router = useRouter();
  const hasPlan = Boolean(run && planOf(run));
  // Several jobs together are a project: they live at /projects, a single job at /runs.
  useEffect(() => {
    if (hasPlan && pathname?.startsWith("/runs/")) router.replace(`/projects/${id}`);
  }, [hasPlan, pathname, router, id]);

  useEffect(() => {
    if (run) transitionReady();
  }, [run]);

  const status = run?.status;
  const planId = run ? planOf(run)?.id : undefined;
  // A plan arriving turns the conversation into a board; on phones that means showing the board tab.
  useEffect(() => {
    if (planId) setTab("plan");
  }, [planId]);
  // Phones open on the chat while exploring and on the plan afterwards, unless the user picked a tab.
  const shownTab = tab ?? (status === "exploring" ? "chat" : "plan");

  // Focus only makes sense on a draft; drop it once the plan moves on.
  useEffect(() => {
    if (status !== "draft") setFocus(null);
  }, [status]);

  // After approval the layout changes from plan to progress; bring the progress into view.
  const [live, setLive] = useState(false);
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "draft" && (status === "funding" || status === "running")) setLive(true);
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

  if (missing)
    return (
      <div className="mx-auto max-w-md pt-16 text-center">
        <div className="text-lg font-semibold">This job isn&apos;t on this server anymore</div>
        <p className="mt-1 text-sm text-ink-2">It may have been cleared when the server restarted. Any money set aside for it can still be taken back from your wallet.</p>
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
  // Charts and maps only where the job produced one; orders with no research have nothing to draw.
  const hasVisual = Object.keys(run.feed ?? {}).some((k) => /^(history|candles|tape|route):/.test(k)) || run.proposal?.action?.kind === "itinerary" || !run.proposal;
  // A job that never had a conversation (a plan step, a repeat) doesn't need an empty chat beside it.
  const hasChat = (run.chat?.length ?? 0) > 0 || exploring || run.status === "draft";
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

  // The user's own passkey wallet has to sign the funding; the app wallet doesn't, so approval is one click.
  const needsSignature = run.payer === "passkey" && run.mode === "live" && BigInt(run.cap) > 0n;
  function approveNow() {
    if (needsSignature) return setApproving(true);
    toast(BigInt(run!.cap) === 0n ? "Approved · starting" : `Approved · setting aside $${fmt(run!.cap)}`, "good");
    post(`/api/runs/${run!.id}/approve`).catch((e) => toast((e as Error).message, "bad"));
  }

  const tags = (
    <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-ink-3">
      <span className="font-pixel text-[13px] text-agent-ink">{theme.name}</span>
      {run.mode === "demo" && (
        <span className="inline-flex h-[22px] items-center rounded-md bg-[#f1f0ec] px-2 text-[12px] font-semibold text-ink-2" title="Practice mode: real data; the vault and orders are simulated (marketplace vendors are still paid from the agent's testnet balance). Change it in Settings.">
          Practice
        </span>
      )}
      {connection === "reconnecting" && (
        <span className="inline-flex h-[22px] items-center gap-1 rounded-md border border-warn bg-warn/15 px-2 text-[12px] text-warn-ink" role="status">
          <Spinner /> Reconnecting
        </span>
      )}
    </div>
  );

  const header = (
    <motion.header initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span style={{ viewTransitionName: `mascot-${run.id}` }}>
          <AgentIcon agent={run.agent} size={wide ? 52 : 44} outfit={runOutfit(run)} mood={moodFor(run.status, run.pendingReapprovals.length + run.pendingFailures.length)} />
        </span>
        <div className="min-w-0">
          {tags}
          {run.parentId && (
            <Link href={`/projects/${run.parentId}`} className="mt-1 inline-flex items-center gap-1 text-[12.5px] text-ink-2 underline decoration-line underline-offset-2 hover:text-ink" data-testid="back-to-plan">
              Part of: {parentTitle ?? "a project"} <Icon name="chevron" size={11} />
            </Link>
          )}
          {/* While reviewing, the review banner carries the title; it isn't said twice. */}
          <h1 style={{ viewTransitionName: `task-${run.id}` }} className={draft ? "sr-only" : "mt-1 line-clamp-3 max-w-2xl text-[19px] font-semibold leading-tight tracking-tight sm:text-[24px]"}>
            {run.proposal?.title ?? run.task}
          </h1>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {wide && <Stages run={run} />}
        {wide && !exploring && !draft && (run.chat?.length ?? 0) > 0 && (
          <Button variant="quiet" className="h-9 text-[13px]" onClick={() => setShowChat((v) => !v)} aria-pressed={showChat} data-testid="toggle-chat">
            <Icon name="chat" size={15} /> {showChat ? "Hide conversation" : "Conversation"}
          </Button>
        )}
      </div>
    </motion.header>
  );

  const plan = (
    <div className="space-y-5">
      {planning && (
        <section className="space-y-5" aria-busy="true" aria-label="Planning">
          <div className="flex items-center gap-4 rounded-2xl border border-line bg-panel p-5">
            <Mascot agent={run.agent} outfit={runOutfit(run)} mood="working" size={64} />
            <div>
              <div className="font-pixel text-[15px] text-agent-ink">Building the plan</div>
              <p className="mt-1 text-sm text-ink-2">Pricing each step.</p>
            </div>
          </div>
          <div className="h-40 animate-pulse rounded-2xl border border-line bg-panel/60 motion-reduce:animate-none" />
        </section>
      )}

      {draft && (
        <>
          <Assemble play={run.proposal ? `review-${run.proposal.id}` : null}>
            <ReviewCard
              run={run}
              editable={editableSteps}
              onEditStep={run.status === "draft" ? editStep : undefined}
              focusedStep={focus?.kind === "step" ? focus.step : null}
              actions={
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-1 items-center justify-end gap-1.5 whitespace-nowrap sm:gap-2">
                    {run.status === "draft" && (
                      <Button variant="quiet" onClick={() => post(`/api/runs/${run.id}/back`).catch((e) => toast((e as Error).message, "bad"))} data-testid="back-to-chat">
                        <Icon name="back" size={14} /> Change it
                      </Button>
                    )}
                    <Button variant="quiet" onClick={() => setCancelling(true)}>
                      Discard
                    </Button>
                    <Button onClick={approveNow} disabled={run.status !== "draft"} data-testid="open-approve" variant="agent" className="px-6">
                      {run.status === "funding" ? (
                        <>
                          <Spinner /> Setting aside the money…
                        </>
                      ) : needsSignature ? (
                        "Approve with passkey"
                      ) : (
                        "Approve and start"
                      )}
                    </Button>
                  </div>
                </div>
              }
            />
          </Assemble>
          <AnimatePresence>
            {run.editNote && (
              <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`text-right text-[12.5px] ${run.editNote.ok ? "text-ink-2" : "text-bad"}`}>
                {run.editNote.message}
              </motion.p>
            )}
          </AnimatePresence>
          <ReviewCards run={run} onEdit={run.status === "draft" ? editCard : undefined} focused={focus?.kind === "card" ? focus.card : null} />
          <ReviewTotal run={run} onEdit={run.status === "draft" ? () => editCard("price") : undefined} focused={focus?.kind === "card" && focus.card === "price"} />
        </>
      )}

      {!draft && !planning && !exploring && !finished && (
        <>
          {/* Running: one line on what is happening now, then the steps as a graph. */}
          <Assemble play={live ? "status" : null}>
            <StatusCard run={run} steps={false} onNeedsYou={pending.length > 0 && dismissed === head?.id ? () => setDismissed(null) : undefined} onCancel={() => setCancelling(true)} />
          </Assemble>
          <section className="rounded-2xl border border-line bg-panel px-3 py-5 sm:px-5" aria-label="Steps">
            <PhaseGraph phases={run.phases} lines={run.lines} simulated={run.mode === "demo"} />
          </section>
          {run.proposal?.action?.kind === "prediction_order" && run.proposal.action.trade !== "sell" && (
            <LiveMarket action={run.proposal.action} hedge={run.proposal.hedge} venue={run.proposal.venue} settlement={run.settlement} held={run.order?.status === "simulated" ? run.proposal.action.quantity : run.order?.filledQuantity || undefined} />
          )}
          <div className="sr-only" aria-live="polite">
            {pending.length ? `${pending.length} needs your decision` : ""}
          </div>
          <Details label="Payments so far" open={details} onToggle={() => setDetails((v) => !v)}>
            {run.proposal && <OrderStatus run={run} />}
            <VaultNote run={run} />
            <CostTable run={run} compact />
          </Details>
        </>
      )}

      {finished && (
        <>
          {/* Done: the summary is the receipt, under one line on how it ended. */}
          <Assemble play={live ? "status" : null}>
            <StatusCard run={run} steps={false} />
          </Assemble>
          {run.proposal?.action?.kind === "prediction_order" && run.proposal.action.trade !== "sell" && run.status !== "cancelled" && (
            <LiveMarket action={run.proposal.action} hedge={run.proposal.hedge} venue={run.proposal.venue} settlement={run.settlement} held={run.order?.status === "simulated" ? run.proposal.action.quantity : run.order?.filledQuantity || undefined} />
          )}
          {hasVisual && (
            <section className="min-w-0 rounded-2xl border border-line bg-panel p-4" aria-label="Result">
              <AgentWidget run={run} />
            </section>
          )}
          <ReceiptView run={run} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-ink-2">
            <VaultNote run={run} />
            <Link href={`/runs/${run.id}/receipt`} className="inline-flex items-center gap-1 underline decoration-line underline-offset-2 hover:text-ink" data-testid="receipt-summary">
              Receipt on its own page <Icon name="external" size={12} />
            </Link>
          </div>
        </>
      )}
    </div>
  );

  const chatPanel = (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface`}>
      {!exploring && (
        <div className="flex items-center gap-2.5 border-b border-line bg-panel px-4 py-2.5">
          <AgentIcon agent={run.agent} size={26} outfit={runOutfit(run)} mood={run.thinking ? "working" : "idle"} />
          <div className="min-w-0 flex-1 text-[14px] font-semibold">{focus ? "Change this part" : `Conversation with ${theme.name}`}</div>
        </div>
      )}
      <Chat run={run} focus={focus} onFocusClear={() => setFocus(null)} onAdopted={() => setTab("plan")} onShowPlan={() => setTab("plan")} plan={planOf(run)} prefill={prefill} drawn={Boolean(wide) && (exploring || run.status === "draft")} />
    </div>
  );

  const boardPlan = exploring ? planOf(run) : undefined;
  const briefed = briefOf(run);
  const projectBar = boardPlan && (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3" data-testid="project-head">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/home" aria-label="All jobs" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 hover:bg-ink/5 hover:text-ink">
          <Icon name="back" size={16} />
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-medium text-ink-3">
            <span className="font-pixel text-[13px] text-agent-ink">Project</span>
            <span>
              {boardPlan.steps.length} {boardPlan.steps.length === 1 ? "job" : "jobs"}
            </span>
            {run.mode === "demo" && <span className="inline-flex h-[22px] items-center rounded-md bg-[#f1f0ec] px-2 text-[12px] font-semibold text-ink-2">Practice</span>}
          </div>
          <h1 className="mt-0.5 truncate text-[20px] font-semibold leading-tight tracking-tight sm:text-[24px]" data-testid="project-title">
            {boardPlan.title}
          </h1>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {wide && <Stages run={run} plan={boardPlan} />}
        {boardPlan.status === "proposed" && boardPlan.steps.length > 0 && (
          <Button variant="agent" className="h-10 px-5" onClick={() => post(`/api/runs/${run.id}/plan-start`, { planId: boardPlan.id }).then(() => toast("Started · each job runs in its turn", "good")).catch((e) => toast((e as Error).message, "bad"))} data-testid="start-all">
            Start all
          </Button>
        )}
        {boardPlan.status === "running" && (
          <Button variant="danger" className="h-10" onClick={() => post(`/api/runs/${run.id}/plan-stop`, {}).then(() => toast("Stopped · jobs already running will finish", "good")).catch((e) => toast((e as Error).message, "bad"))} data-testid="stop-all">
            Stop all
          </Button>
        )}
      </div>
    </div>
  );
  const projectBody = boardPlan && (
    <div className="space-y-4">
      {briefed?.plan?.id === boardPlan.id && <BriefCard {...briefed} />}
      <PlanBoard plan={boardPlan} run={run} />
      {boardPlan.status === "proposed" && boardPlan.steps.length > 0 && <ProjectReview plan={boardPlan} />}
    </div>
  );
  const talkBar = (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <Link href="/home" aria-label="All jobs" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 hover:bg-ink/5 hover:text-ink">
          <Icon name="back" size={16} />
        </Link>
        <AgentIcon agent={run.agent} size={30} outfit={runOutfit(run)} mood={run.thinking ? "working" : "idle"} />
        {tags}
      </div>
      {wide && boardPlan && <Stages run={run} plan={boardPlan} />}
    </div>
  );

  // The work is drawn on the left and talked about on the right, from the first message until
  // it is approved. Once it runs the chat is closed, so it steps aside unless asked for.
  const shaping = run.status === "draft" || run.status === "funding";
  const beside = wide && !exploring && hasChat && (shaping || Boolean(focus) || showChat);

  return (
    <div className={`pb-24 sm:pb-0 ${beside ? "lg:mx-[calc(50%-min(50vw-24px,720px))]" : ""}`}>
      <AnimatePresence>
        {run.faults.length > 0 && !finished && (
          <motion.div exit={{ opacity: 0, height: 0 }} role="status" className="mx-auto mb-5 max-w-3xl rounded-xl border border-warn bg-warn/15 px-4 py-2 text-sm text-warn-ink">
            <b>Test mode.</b> Fault switches on: {run.faults.join(", ").replaceAll("_", " ")}
          </motion.div>
        )}
      </AnimatePresence>

      {boardPlan ? (
        // A plan is bigger than a chat bubble: the board takes the page and the conversation sits beside it.
        <div className="lg:mx-[calc(50%-min(50vw-24px,760px))]" data-testid="plan-mode">
          {projectBar}
          {wide ? (
            <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-6">
              {projectBody}
              <aside className="sticky top-[84px] h-[calc(100dvh-170px)] min-h-[460px]" aria-label="Chat">
                {chatPanel}
              </aside>
            </div>
          ) : (
            <>
              <div role="tablist" aria-label="View" className="sticky top-16 z-20 -mx-4 mb-4 flex gap-1 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur-md">
                {(["plan", "chat"] as const).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={(tab ?? "plan") === t}
                    onClick={() => setTab(t)}
                    className={`pressable inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[14px] font-medium transition-colors ${(tab ?? "plan") === t ? "bg-panel text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-2"}`}
                  >
                    <Icon name={t === "plan" ? "graph" : "chat"} size={16} />
                    {t === "plan" ? "Plan" : "Chat"}
                  </button>
                ))}
              </div>
              {(tab ?? "plan") === "plan" ? (
                projectBody
              ) : <div className="h-[calc(100dvh-var(--tabbar-h)-200px)] min-h-[420px]">{chatPanel}</div>}
            </>
          )}
        </div>
      ) : exploring && wide ? (
        <div className="lg:mx-[calc(50%-min(50vw-24px,720px))]" data-testid="talk">
          {talkBar}
          <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-6">
            <Workspace
              run={run}
              onExample={(text) => setPrefill((p) => ({ text, n: (p?.n ?? 0) + 1 }))}
              onAdjust={(kind) => post(`/api/runs/${run.id}/adjust`, { kind }).catch((e) => toast((e as Error).message, "bad"))}
            />
            <aside className="sticky top-[84px] h-[calc(100dvh-170px)] min-h-[460px]" aria-label="Chat">
              {chatPanel}
            </aside>
          </div>
        </div>
      ) : exploring ? (
        <div className="mx-auto flex max-w-2xl flex-col" data-testid="talk">
          {talkBar}
          <div className="h-[calc(100dvh-var(--tabbar-h)-190px)] min-h-[420px]">{chatPanel}</div>
        </div>
      ) : beside ? (
        <>
          <Link href="/home" className="mb-3 inline-flex min-h-8 items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
            <Icon name="back" size={15} /> All jobs
          </Link>
          <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-6">
            <div className="min-w-0">
              {header}
              <div className="mt-6">{plan}</div>
            </div>
            <aside className="sticky top-[84px] h-[calc(100dvh-152px)] min-h-[480px]" aria-label="Chat">
              {chatPanel}
            </aside>
          </div>
        </>
      ) : (
        <div className="mx-auto max-w-3xl">
          <Link href="/home" className="mb-3 inline-flex min-h-8 items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
            <Icon name="back" size={15} /> All jobs
          </Link>
          {header}
          {/* Phones have no room for a side panel: the conversation is a tab. */}
          {!wide && hasChat && (
            <div role="tablist" aria-label="View" className="sticky top-16 z-20 -mx-4 mt-4 flex gap-1 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur-md">
              {(["plan", "chat"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={shownTab === t}
                  onClick={() => setTab(t)}
                  className={`pressable relative inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[14px] font-medium transition-colors ${shownTab === t ? "bg-panel text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-2"}`}
                >
                  <Icon name={t === "plan" ? "graph" : "chat"} size={16} />
                  {t === "plan" ? "Job" : "Chat"}
                  {t === "chat" && focus && <span className="absolute right-3 top-2 h-2 w-2 rounded-[2px] bg-agent" aria-label="editing" />}
                </button>
              ))}
            </div>
          )}
          <div className="mt-5">{!wide && hasChat && shownTab === "chat" ? <div className="h-[calc(100dvh-var(--tabbar-h)-170px)] min-h-[420px]">{chatPanel}</div> : plan}</div>
        </div>
      )}

      <FinishCard run={run} kind={finish} onClose={() => setFinish(null)} />
      <ApproveModal run={run} open={approving} onClose={() => setApproving(false)} />
      <CancelModal run={run} open={cancelling} onClose={() => setCancelling(false)} />
      {showPopup && reapproval && <ReapprovalModal key={reapproval.id} run={run} req={reapproval} onClose={() => setDismissed(reapproval.id)} />}
      {showPopup && failure && <FailureModal key={failure.id} run={run} failure={failure} onClose={() => setDismissed(failure.id)} />}
    </div>
  );
}
