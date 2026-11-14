"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "framer-motion";
import { Icon } from "./Icon";

/** Focus popup: blurred backdrop, one thing on screen, focus trapped. */
export function Modal({
  open,
  onClose,
  title,
  children,
  tone = "default",
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  tone?: "default" | "warn" | "bad";
  width?: number;
}) {
  const reduce = useReducedMotion();
  const drag = useDragControls();
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 639px)");
    const f = () => setSheet(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  const bar = tone === "warn" ? "bg-warn" : tone === "bad" ? "bg-bad" : "bg-ink";
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] w-full overflow-auto rounded-t-[20px] border-t-[1.5px] border-ink bg-panel outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border-[1.5px] sm:shadow-[6px_6px_0_0_var(--color-ink)]"
                style={{ maxWidth: width }}
                // Phones: a bottom sheet that slides up and can be swiped down from its handle.
                drag={sheet ? "y" : false}
                dragListener={false}
                dragControls={drag}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 110 || info.velocity.y > 600) onClose();
                }}
                initial={reduce ? { opacity: 0 } : sheet ? { y: "100%" } : { opacity: 0, y: 16, scale: 0.98 }}
                animate={reduce ? { opacity: 1 } : sheet ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }}
                exit={reduce ? { opacity: 0, transition: { duration: 0.1 } } : sheet ? { y: "100%", transition: { duration: 0.18 } } : { opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
                transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
              >
                {tone !== "default" && <div className={`h-1 w-full ${bar}`} />}
                <div
                  className="flex h-6 cursor-grab touch-none items-center justify-center active:cursor-grabbing sm:hidden"
                  onPointerDown={(e) => drag.start(e)}
                  aria-hidden
                >
                  <div className="h-[5px] w-10 rounded-[3px] bg-[#d5d4ce]" />
                </div>
                <div className="p-6">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <Dialog.Title className="text-lg font-semibold tracking-tight">{title}</Dialog.Title>
                    <Dialog.Close className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line text-ink-2 transition-colors hover:border-[#c9c8c2] hover:text-ink" aria-label="Close">
                      <Icon name="x" size={16} stroke={2} />
                    </Dialog.Close>
                  </div>
                  {children}
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
