"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

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
  const bar = tone === "warn" ? "bg-warn" : tone === "bad" ? "bg-bad" : "bg-ink";
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-ink/25 backdrop-blur-md"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] w-full overflow-auto rounded-t-3xl border border-line bg-panel shadow-2xl outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
                style={{ maxWidth: width }}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                exit={reduce ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
                transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
              >
                <div className={`h-1 w-full ${bar}`} />
                <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden />
                <div className="p-6">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <Dialog.Title className="text-lg font-semibold tracking-tight">{title}</Dialog.Title>
                    <Dialog.Close className="rounded-md px-2 text-ink-3 hover:bg-ink/5 hover:text-ink" aria-label="Close">
                      ✕
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
