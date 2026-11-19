"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { THEMES } from "@/lib/themes";
import { Toaster, toast } from "./Toaster";
import { useRuns } from "./runsStore";
import { TransitionResolver } from "./transitions";
import { Icon, type IconName } from "./Icon";

const NOTIFY_KEY = "agento:notify";

/** "(2) agento" in the tab title; a toast and opt-in notification when a job needs you or its order fills. */
function NeedsYouWatcher() {
  const { runs } = useRuns();
  const prev = useRef<Map<string, number> | null>(null);
  const fills = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    if (!runs) return;
    const before = fills.current;
    fills.current = new Map(runs.filter((r) => r.order).map((r) => [r.id, r.order!.filled ?? 0]));
    if (!before) return;
    const notify = localStorage.getItem(NOTIFY_KEY) === "on" && typeof Notification !== "undefined" && Notification.permission === "granted";
    for (const r of runs) {
      const o = r.order;
      if (!o || o.venue === "paper" || !before.has(r.id)) continue;
      const was = before.get(r.id) ?? 0;
      const got = o.filled ?? 0;
      if (got <= was) continue;
      const done = o.status === "filled";
      const text = done ? `Order filled: ${r.task}` : `Order partly filled (${got}${o.quantity ? ` of ${o.quantity}` : ""}): ${r.task}`;
      toast(text, "good");
      if (notify) {
        const n = new Notification(`${THEMES[r.agent].name}: ${done ? "order filled" : "partly filled"}`, { body: r.task, tag: `fill-${r.id}-${got}` });
        n.onclick = () => {
          window.focus();
          window.location.href = `/runs/${r.id}`;
        };
      }
    }
  }, [runs]);
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
      className={`pressable tap inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors ${on ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink-2 hover:border-[#c9c8c2]"}`}
      title="Get a notification when a job needs your approval or an order fills"
    >
      <Icon name="bell" size={16} /> {on ? "Notifications on" : "Notify me"}
    </button>
  );
}

/** Desktop: Jobs / Agents as a segmented control in the header. */
export function MainNav() {
  const path = usePathname();
  const items: { href: string; label: string; icon: IconName; active: boolean }[] = [
    { href: "/home", label: "Jobs", icon: "jobs", active: path === "/home" || path.startsWith("/runs") || path.startsWith("/projects") },
    { href: "/agents", label: "Agents", icon: "agents", active: path.startsWith("/agents") },
    { href: "/recipes", label: "Recipes", icon: "receipt", active: path.startsWith("/recipes") },
    { href: "/town", label: "Town", icon: "graph", active: path.startsWith("/town") },
    { href: "/wallet", label: "Add money", icon: "wallet", active: path.startsWith("/wallet") },
    { href: "/settings", label: "Settings", icon: "shield", active: path.startsWith("/settings") },
  ];
  return (
    <nav aria-label="Main" className="hidden gap-0.5 rounded-[9px] bg-[#f1f0ec] p-[3px] sm:flex">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          title={t.label}
          aria-current={t.active ? "page" : undefined}
          className={`inline-flex h-[34px] items-center gap-1.5 rounded-[7px] px-3 text-sm font-medium transition-colors ${t.active ? "bg-panel text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-2 hover:text-ink"}`}
        >
          <Icon name={t.icon} size={16} />
          {/* Six items fit with labels from lg up; between sm and lg the icons carry them (still read out). */}
          <span className="sr-only lg:not-sr-only">{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function TabBar() {
  const path = usePathname();
  const { runs } = useRuns();
  const needs = (runs ?? []).reduce((a, r) => a + r.needsYou, 0);
  const tabs: { href: string; label: string; icon: IconName; active: boolean; primary?: boolean }[] = [
    { href: "/home", label: "Jobs", icon: "jobs", active: path === "/home" || path.startsWith("/runs") || path.startsWith("/projects") },
    { href: "/new", label: "New job", icon: "plus", active: path === "/new", primary: true },
    { href: "/agents", label: "Agents", icon: "agents", active: path.startsWith("/agents") },
    { href: "/town", label: "Town", icon: "graph", active: path.startsWith("/town") },
    { href: "/settings", label: "Settings", icon: "shield", active: path.startsWith("/settings") },
  ];
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden">
      <div className="grid h-[60px] grid-cols-5">
        {tabs.map((t) =>
          t.primary ? (
            <Link key={t.href} href={t.href} aria-label={t.label} aria-current={t.active ? "page" : undefined} className="pressable flex items-center justify-center">
              <span className="pix-shadow inline-flex h-10 w-[52px] items-center justify-center rounded-[10px] border-[1.5px] border-ink bg-agent text-agent-on" aria-hidden>
                <Icon name="plus" size={22} stroke={2.4} />
              </span>
            </Link>
          ) : (
            <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined} className={`pressable relative flex flex-col items-center justify-center gap-0.5 text-[11px] ${t.active ? "font-semibold text-ink" : "font-medium text-ink-3"}`}>
              <Icon name={t.icon} size={22} />
              {t.label}
              {t.label === "Jobs" && needs > 0 && (
                <span className="absolute left-[calc(50%+6px)] top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] border-[1.5px] border-ink bg-warn px-0.5 text-[9px] font-bold text-ink">{needs}</span>
              )}
            </Link>
          ),
        )}
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
