"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { THEMES } from "@/lib/themes";
import { Toaster } from "./Toaster";
import { useRuns } from "./runsStore";
import { TransitionResolver } from "./transitions";

const NOTIFY_KEY = "agento:notify";

/** "(2) agento" in the tab title, and an opt-in notification when a job starts waiting for you. */
function NeedsYouWatcher() {
  const { runs } = useRuns();
  const prev = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    if (!runs) return;
    const total = runs.reduce((a, r) => a + r.needsYou, 0);
    document.title = total ? `(${total}) agento` : "agento";
    const before = prev.current;
    const now = new Map(runs.map((r) => [r.id, r.needsYou]));
    prev.current = now;
    if (!before || localStorage.getItem(NOTIFY_KEY) !== "on" || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const r of runs) {
      if (r.needsYou > 0 && (before.get(r.id) ?? 0) === 0) {
        const n = new Notification(`${THEMES[r.agent].name} needs you`, { body: r.task, tag: `needs-${r.id}` });
        n.onclick = () => {
          window.focus();
          window.location.href = `/runs/${r.id}`;
        };
      }
    }
  }, [runs]);
  return null;
}

export function NotifyToggle() {
  const [on, setOn] = useState(false);
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    setSupported(typeof Notification !== "undefined");
    setOn(localStorage.getItem(NOTIFY_KEY) === "on" && typeof Notification !== "undefined" && Notification.permission === "granted");
  }, []);
  if (!supported) return null;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={async () => {
        if (on) {
          localStorage.setItem(NOTIFY_KEY, "off");
          setOn(false);
          return;
        }
        const p = await Notification.requestPermission();
        const ok = p === "granted";
        localStorage.setItem(NOTIFY_KEY, ok ? "on" : "off");
        setOn(ok);
      }}
      className={`pressable tap inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[12.5px] ${on ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink-2"}`}
      title="Get a notification when a job needs your approval"
    >
      <span aria-hidden>{on ? "◉" : "○"}</span> {on ? "Notifying you" : "Notify me"}
    </button>
  );
}

function TabBar() {
  const path = usePathname();
  const { runs } = useRuns();
  const needs = (runs ?? []).reduce((a, r) => a + r.needsYou, 0);
  const tabs = [
    { href: "/", label: "Jobs", icon: "▤", active: path === "/" || path.startsWith("/runs") },
    { href: "/new", label: "New", icon: "+", active: path === "/new", primary: true },
    { href: "/agents", label: "Agents", icon: "☺", active: path === "/agents" },
  ];
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/15 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden">
      <div className="grid h-[60px] grid-cols-3">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined} className="pressable relative flex flex-col items-center justify-center gap-0.5 text-[11px]">
            <span
              className={`flex h-7 min-w-7 items-center justify-center px-1.5 font-pixel text-[15px] leading-none ${
                t.primary ? "pix-shadow border border-ink bg-agent text-white" : t.active ? "text-ink" : "text-ink-3"
              }`}
              aria-hidden
            >
              {t.icon}
            </span>
            <span className={t.active ? "font-medium text-ink" : "text-ink-3"}>{t.label}</span>
            {t.label === "Jobs" && needs > 0 && (
              <span className="absolute right-[calc(50%-22px)] top-1.5 min-w-4 border border-ink bg-warn px-1 text-center font-pixel text-[9px] leading-[14px] text-ink">{needs}</span>
            )}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function AppShell() {
  return (
    <>
      <TransitionResolver />
      <NeedsYouWatcher />
      <TabBar />
      <Toaster />
    </>
  );
}
