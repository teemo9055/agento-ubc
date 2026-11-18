"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Spinner } from "@/components/ui";
import { Markdown } from "./Markdown";

/** Copies text, and says so. */
export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* the text is on the screen to select */
        }
      }}
      className={`pressable inline-flex h-7 shrink-0 items-center rounded-md border border-line bg-panel px-2 text-[12px] font-medium text-ink-2 hover:text-ink ${className}`}
    >
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </button>
  );
}

/** Code with a copy button, in tabs when there is more than one way (MCP, curl). */
export function CodeTabs({ tabs }: { tabs: { label: string; code: string }[] }) {
  const [at, setAt] = useState(0);
  const id = useId();
  const list = tabs.filter((t) => t.code);
  if (!list.length) return null;
  const cur = list[Math.min(at, list.length - 1)];
  return (
    <div className="overflow-hidden rounded-xl border border-[#2a2833] bg-[#17161c]">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2 py-1.5">
        <div role="tablist" aria-label="Ways to call it" className="flex gap-1">
          {list.map((t, i) => (
            <button
              key={t.label}
              role="tab"
              type="button"
              id={`${id}-t${i}`}
              aria-selected={i === at}
              aria-controls={`${id}-p`}
              onClick={() => setAt(i)}
              className={`h-7 rounded-md px-2.5 text-[12px] font-semibold ${i === at ? "bg-white text-ink" : "text-white/75 hover:text-white"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <CopyButton text={cur.code} className="border-white/20 bg-transparent text-white/85 hover:text-white" />
      </div>
      <pre id={`${id}-p`} role="tabpanel" aria-labelledby={`${id}-t${at}`} className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed text-[#f4f2fb]">
        <code>{cur.code}</code>
      </pre>
    </div>
  );
}

export interface AgentSource {
  /** The API path, e.g. /api/town/library/pay-per-request (Markdown and JSON come from ?format=). */
  api: string;
  /** The MCP tool call that returns the same thing. */
  mcp: string;
}

const withFormat = (api: string, f: "md" | "json") => `${api}${api.includes("?") ? "&" : "?"}format=${f}`;

/** The machine-readable version, inline: rendered Markdown and JSON, the exact URLs and the MCP tool. */
function AgentView({ src }: { src: AgentSource }) {
  const [md, setMd] = useState<string | null>(null);
  const [json, setJson] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [show, setShow] = useState<"md" | "raw" | "json">("md");
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
    let live = true;
    Promise.all([fetch(withFormat(src.api, "md")).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))), fetch(withFormat(src.api, "json")).then((r) => r.json())])
      .then(([m, j]) => {
        if (!live) return;
        setMd(m);
        setJson(JSON.stringify(j, null, 2));
      })
      .catch((e) => live && setErr(`Couldn't load it (${(e as Error).message})`));
    return () => {
      live = false;
    };
  }, [src.api]);
  const mdUrl = `${origin}${withFormat(src.api, "md")}`;
  const jsonUrl = `${origin}${withFormat(src.api, "json")}`;
  const row = (label: string, value: string) => (
    <div className="flex min-w-0 items-center gap-2">
      <dt className="w-[74px] shrink-0 text-[12px] font-semibold uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-[#f1f0ec] px-2 py-1 font-mono text-[12px]" title={value}>
          {value}
        </code>
        <CopyButton text={value} />
      </dd>
    </div>
  );
  return (
    <div className="space-y-4" data-testid="agent-view">
      <dl className="space-y-2 rounded-2xl border border-line bg-panel p-4">
        <p className="mb-1 text-[13.5px] text-ink-2">The same facts as the page for people, built from the same data. Agents can read these directly.</p>
        {row("Markdown", mdUrl)}
        {row("JSON", jsonUrl)}
        {row("MCP", src.mcp)}
        {row("Index", `${origin}/town/llms.txt`)}
      </dl>
      <div className="rounded-2xl border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f1f0ec] px-3 py-2">
          <div className="flex gap-1" role="group" aria-label="Format">
            {(
              [
                ["md", "Markdown"],
                ["raw", "Raw Markdown"],
                ["json", "JSON"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)} className={`h-8 rounded-md px-2.5 text-[12.5px] font-semibold ${show === k ? "bg-ink text-white" : "text-ink-2 hover:bg-ink/5 hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
          {md && json && <CopyButton text={show === "json" ? json : md} label={show === "json" ? "Copy JSON" : "Copy Markdown"} />}
        </div>
        <div className="p-4 sm:p-5">
          {err && <p className="text-[13px] text-bad">{err}</p>}
          {!err && !md && (
            <p className="flex items-center gap-2 text-[13px] text-ink-3">
              <Spinner /> Loading…
            </p>
          )}
          {md && show === "md" && (
            <div data-testid="agent-md">
              <Markdown source={md} />
            </div>
          )}
          {md && show === "raw" && <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed">{md}</pre>}
          {json && show === "json" && (
            <pre className="max-h-[70vh] overflow-auto font-mono text-[12px] leading-relaxed" data-testid="agent-json">
              {json}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Every building, article, product and thread page in two forms: for people (the default, the
 * page's own design) and for agents (Markdown and JSON from the same data). `?view=agents` opens
 * the second; the choice is kept in the address so it can be shared.
 */
export function TwoForms({ agent, children }: { agent: AgentSource; children: ReactNode }) {
  const [view, setView] = useState<"people" | "agents">("people");
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "agents") setView("agents");
  }, []);
  const choose = (v: "people" | "agents", focus = false) => {
    setView(v);
    const u = new URL(window.location.href);
    if (v === "agents") u.searchParams.set("view", "agents");
    else u.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", u);
    if (focus) tabs.current[v === "people" ? 0 : 1]?.focus();
  };
  const TABS = [
    ["people", "For people"],
    ["agents", "For agents"],
  ] as const;
  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Who is reading" className="inline-flex rounded-[10px] border-[1.5px] border-ink bg-panel p-1 shadow-[2px_2px_0_0_var(--color-ink)]">
        {TABS.map(([v, label], i) => (
          <button
            key={v}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${id}-${v}`}
            aria-selected={view === v}
            aria-controls={`${id}-${v}-panel`}
            tabIndex={view === v ? 0 : -1}
            onClick={() => choose(v)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") choose(v === "people" ? "agents" : "people", true);
            }}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold ${view === v ? "bg-ink text-white" : "text-ink-2 hover:text-ink"}`}
          >
            {v === "agents" && (
              <span aria-hidden className="font-mono text-[11px] opacity-80">
                {"{}"}
              </span>
            )}
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-people-panel`} aria-labelledby={`${id}-people`} hidden={view !== "people"}>
        {children}
      </div>
      {view === "agents" && (
        <div role="tabpanel" id={`${id}-agents-panel`} aria-labelledby={`${id}-agents`}>
          <AgentView src={agent} />
        </div>
      )}
    </div>
  );
}
