"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { post } from "@/components/useRun";
import { THEMES } from "@/lib/themes";
import type { AgentId, FailureCode, Run } from "@/lib/types";

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
  faultsEnabled: boolean;
  agents: { id: AgentId; examples: string[] }[];
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
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: Config) => {
        setCfg(c);
        if (c.live) setMode("live");
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
      const run = await post<Run>("/api/runs", { agent, task, mode, faults: testMode ? faults : [] });
      router.push(`/runs/${run.id}`);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl pt-6">
      {testMode && (
        <div role="status" className="mb-6 rounded-lg border border-warn bg-warn/15 px-4 py-2 text-sm text-[#7a5000]">
          <b>Test mode on.</b> Fault switches fire once each during the run.
        </div>
      )}

      <h1 className="text-3xl font-semibold tracking-tight">Bring a task.</h1>
      <p className="mt-2 text-ink-2">Get a priced work order. Approve it once. The agent spends only what you approved, then hands you a receipt.</p>

      <div className="mt-8 grid grid-cols-3 gap-2" role="tablist" aria-label="Agent">
        {(Object.keys(THEMES) as AgentId[]).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={agent === id}
            onClick={() => setAgent(id)}
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${agent === id ? "border-ink bg-panel shadow-sm" : "border-line bg-transparent hover:bg-panel"}`}
          >
            <div className="font-semibold">{THEMES[id].name}</div>
            <div className="text-xs text-ink-3">{THEMES[id].domain}</div>
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-4 rounded-2xl border border-line bg-panel p-4 shadow-sm">
        <label htmlFor="task" className="text-xs font-medium text-ink-3">
          {theme.name} · {theme.tagline}
        </label>
        <textarea
          id="task"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && submit()}
          rows={3}
          maxLength={280}
          placeholder={examples[0] ?? "Describe the task"}
          className="mt-2 w-full resize-none bg-transparent text-[15px] outline-none placeholder:text-ink-3"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {examples.map((x) => (
            <button key={x} type="button" onClick={() => setTask(x)} className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:bg-surface">
              {x}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
          <div className="flex items-center gap-1 rounded-lg border border-line p-0.5 text-xs" role="radiogroup" aria-label="Payment rail">
            {(["live", "demo"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                disabled={m === "live" && !cfg?.live}
                onClick={() => setMode(m)}
                title={m === "live" && !cfg?.live ? "Live mode needs funded wallets and a deployed factory" : undefined}
                className={`rounded-md px-2.5 py-1 ${mode === m ? "bg-ink text-white" : "text-ink-2 disabled:text-ink-3/60"}`}
              >
                {m === "live" ? "Arc testnet" : "Demo rail"}
              </button>
            ))}
          </div>
          <Button type="submit" disabled={busy || task.trim().length < 3}>
            {busy ? "Pricing…" : "Get work order"}
          </Button>
        </div>
        {err && <p className="mt-3 text-sm text-bad">{err}</p>}
      </form>

      {mode === "demo" && <p className="mt-3 text-xs text-ink-3">Demo rail: real market data, simulated settlement, no transaction hashes.</p>}

      {cfg?.faultsEnabled && (
        <details className="mt-8 rounded-xl border border-line bg-panel px-4 py-3" open={testMode} onToggle={(e) => setTestMode((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-sm font-medium">Test mode</summary>
          <p className="mt-2 text-xs text-ink-3">Inject failures to see how the agent asks you before anything changes.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {FAULTS.map((f) => (
              <label key={f.code} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={faults.includes(f.code)}
                  onChange={(e) => setFaults((xs) => (e.target.checked ? [...xs, f.code] : xs.filter((x) => x !== f.code)))}
                />
                {f.label}
              </label>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
