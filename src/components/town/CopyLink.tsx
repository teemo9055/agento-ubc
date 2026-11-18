"use client";
import { useState } from "react";

/** Copies this page's address, so the sender can come back to it or share it. */
export function CopyLink() {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          /* the address bar still has it */
        }
      }}
      className="pressable inline-flex h-8 items-center rounded-md border border-line bg-panel px-2.5 text-[12.5px] font-medium hover:border-[#c9c8c2]"
    >
      <span aria-live="polite">{done ? "Link copied" : "Copy the link to this page"}</span>
    </button>
  );
}
