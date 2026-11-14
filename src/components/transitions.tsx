"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Card-to-page morph using the View Transitions API. The old view is captured,
 * we navigate, and the new view is captured once the destination says it is ready.
 */
let pending: (() => void) | null = null;
let waitForReady = false;

function finish() {
  pending?.();
  pending = null;
}

/** Destination pages call this once their content (and shared elements) are on screen. */
export function transitionReady() {
  if (waitForReady) {
    waitForReady = false;
    requestAnimationFrame(finish);
  }
}

export function useTransitionNav() {
  const router = useRouter();
  return (href: string, opts: { waitForPage?: boolean } = {}) => {
    const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => unknown };
    if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      router.push(href);
      return;
    }
    doc.startViewTransition(
      () =>
        new Promise<void>((resolve) => {
          pending = resolve;
          waitForReady = Boolean(opts.waitForPage);
          router.push(href);
          setTimeout(finish, 900); // never hold the screen longer than this
        }),
    );
  };
}

/** Pages without a ready signal finish the transition when the route changes. */
export function TransitionResolver() {
  const path = usePathname();
  useEffect(() => {
    if (!waitForReady) requestAnimationFrame(finish);
  }, [path]);
  return null;
}
