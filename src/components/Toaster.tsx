"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type Tone = "default" | "good" | "bad";
interface Toast {
  id: number;
  text: string;
  tone: Tone;
}

let seq = 0;
/** Fire-and-forget confirmation; safe to call from anywhere on the client. */
export function toast(text: string, tone: Tone = "default") {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("agento:toast", { detail: { id: ++seq, text, tone } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<Toast>).detail;
      setItems((xs) => [...xs.slice(-2), t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.tone === "bad" ? 6000 : 3200);
    };
    window.addEventListener("agento:toast", on);
    return () => window.removeEventListener("agento:toast", on);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h)+12px)] z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" aria-live="polite" role="status">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className={`pix-shadow pointer-events-auto max-w-md border border-ink px-4 py-2.5 text-sm ${t.tone === "bad" ? "bg-bad text-white" : t.tone === "good" ? "bg-ink text-white" : "bg-panel text-ink"}`}
          >
            {t.tone === "good" && <span className="mr-1.5 text-good">✓</span>}
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
