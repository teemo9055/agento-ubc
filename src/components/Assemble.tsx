"use client";
import { useLayoutEffect, useRef } from "react";

/**
 * Rise and press: when something new appears, its blocks rise a few pixels into place one after
 * another, top to bottom and left to right, and land with their hard shadow, like a button being
 * set down. It plays only on the blocks themselves (every element marked data-block, or the whole
 * child), takes about half a second, and leaves the content readable throughout.
 *
 * `play` names the appearance: the animation runs when it is first set and whenever it changes.
 * People who ask for less motion get the content straight away.
 */
const RISE_MS = 420;
const PRESS_MS = 200;
const STAGGER_MS = 70;
/** After this many blocks the rest rise together, so long lists don't take long. */
const MAX_STAGGERED = 8;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export function Assemble({ play, children, className = "" }: { play: string | number | null | undefined; children: React.ReactNode; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const played = useRef<string | number | null | undefined>(undefined);

  // Before paint, so nothing flashes ahead of its entrance. It depends on `play` alone: re-renders
  // of what's inside never restart or cut short a run in progress.
  useLayoutEffect(() => {
    const el = host.current;
    if (play == null || played.current === play || !el) return;
    played.current = play;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof el.animate !== "function") return;

    const marked = [...el.querySelectorAll<HTMLElement>("[data-block]")];
    const targets = (marked.length ? marked : ([el.firstElementChild].filter(Boolean) as HTMLElement[])).filter((n) => {
      const r = n.getBoundingClientRect();
      // Only what is on screen moves; what's below the fold is simply there when you scroll to it.
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    });
    // Reading order: rows first, then left to right.
    const order = targets
      .map((n) => ({ n, r: n.getBoundingClientRect() }))
      .sort((a, b) => (Math.abs(a.r.top - b.r.top) > 12 ? a.r.top - b.r.top : a.r.left - b.r.left));

    const running: Animation[] = [];
    order.forEach(({ n }, i) => {
      const delay = Math.min(i, MAX_STAGGERED) * STAGGER_MS;
      running.push(n.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: RISE_MS, delay, easing: EASE, fill: "backwards" }));
      // A block with a hard shadow lands with it: the shadow grows in as it touches down.
      const shadow = getComputedStyle(n).boxShadow;
      if (shadow && shadow !== "none")
        running.push(n.animate([{ boxShadow: "0 0 0 0 transparent" }, { boxShadow: shadow }], { duration: PRESS_MS, delay: delay + RISE_MS - 60, easing: "ease-out", fill: "backwards" }));
    });
    return () => {
      // Cut short (a new appearance, or the component going away): allow it to run again.
      const cut = running.some((a) => a.playState !== "finished");
      for (const a of running) a.cancel();
      if (cut) played.current = undefined;
    };
  }, [play]);

  return (
    <div ref={host} className={`relative ${className}`}>
      {children}
    </div>
  );
}
