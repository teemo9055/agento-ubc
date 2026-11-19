"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { NETWORKS, txLink, type Net } from "@/lib/networks";

const USER_KEY = "agento:onramp-user";
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** A random id this browser keeps so the widget can recognise a returning buyer. No personal data. */
export function onrampUserId(): string {
  let v = localStorage.getItem(USER_KEY);
  if (!v || !ID_RE.test(v)) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    v = `u_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    localStorage.setItem(USER_KEY, v);
  }
  return v;
}

type Status =
  | { kind: "minting" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "submitted"; amount?: number; method?: string }
  | { kind: "settled"; tx?: string }
  | { kind: "stopped"; text: string; restart?: boolean }
  | { kind: "error"; text: string };

const NOT_COMPLETED: Record<string, { text: string; restart?: boolean }> = {
  SESSION_TIMEOUT: { text: "The purchase window ran out (each one lasts 30 minutes). Start again when you're ready.", restart: true },
  CANCELED_BY_CUSTOMER: { text: "You stopped the purchase. Nothing was charged.", restart: true },
  NO_PAYMENT_OPTIONS: { text: "No payment method is offered to you here yet. It depends on your country and, for cards, on the app finishing Circle's business checks." },
  CUSTOMER_PENDING_REVIEW: { text: "Your identity check is being reviewed. You can buy once it's approved." },
  CUSTOMER_REJECTED: { text: "The provider couldn't verify your identity, so this purchase can't go ahead." },
  PAYMENT_PROVIDER_ERROR: { text: "The payment provider had a problem. If nothing arrives, nothing was taken; try again later.", restart: true },
};

/**
 * Arc's Onramp widget in a panel: mints a session for this address on this network, mounts the
 * widget, and turns its events into plain status lines. The widget's events are hints; the page
 * confirms arrival by watching the balance go up.
 */
export function OnrampFlow({ net, address, onSubmitted, arrived, onClose }: { net: Net; address: string; onSubmitted: () => void; arrived: string | null; onClose: () => void }) {
  const n = NETWORKS[net];
  const box = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<unknown>(null);
  const [status, setStatus] = useState<Status>({ kind: "minting" });
  const [attempt, setAttempt] = useState(0);
  const minted = useRef(-1);
  const submitted = useRef(onSubmitted);
  submitted.current = onSubmitted;

  // One session per attempt (the ref keeps a dev double-render from minting twice).
  useEffect(() => {
    if (minted.current === attempt) return;
    minted.current = attempt;
    setSession(null);
    setStatus({ kind: "minting" });
    void (async () => {
      try {
        const res = await fetch("/api/onramp/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ network: net, destinationAddress: address, appUserId: onrampUserId() }),
        });
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        if (!res.ok) throw new Error(j.message ?? "Couldn't start the purchase. Try again in a moment.");
        setSession(j);
        setStatus({ kind: "loading" });
      } catch (e) {
        setStatus({ kind: "error", text: (e as Error).message });
      }
    })();
  }, [attempt, net, address]);

  useEffect(() => {
    if (!session || !box.current) return;
    let widget: { close: () => void } | undefined;
    let gone = false;
    void (async () => {
      try {
        const { createOnrampKit, parseOnrampSession } = await import("@circle-fin/onramp-kit");
        if (gone || !box.current) return;
        const kit = createOnrampKit({ widgetBaseUrl: n.onrampWidget });
        widget = kit.mountIframe({
          session: parseOnrampSession(session),
          container: box.current,
          title: "Buy USDC on Arc",
          onInitializationSuccess: () => setStatus((s) => (s.kind === "loading" ? { kind: "ready" } : s)),
          onInitializationError: ({ code, payload }) =>
            setStatus(
              code === "INVALID_SESSION_TOKEN"
                ? { kind: "stopped", text: "This purchase window is no longer valid. Start again.", restart: true }
                : { kind: "error", text: payload?.errorMessage ?? "The widget didn't load. Check your connection and try again." },
            ),
          onDepositSubmitted: ({ payload }) => {
            setStatus({ kind: "submitted", amount: payload.amount, method: payload.paymentMethod });
            submitted.current();
          },
          onDepositSettled: ({ payload }) => setStatus({ kind: "settled", tx: payload.transactionHash }),
          onDepositNotCompleted: ({ code, payload }) => {
            const m = NOT_COMPLETED[code] ?? { text: payload?.errorMessage ?? "The purchase didn't go through. Nothing was charged.", restart: true };
            setStatus({ kind: "stopped", ...m });
          },
          onSessionExpired: () => setStatus((s) => (s.kind === "stopped" ? s : { kind: "stopped", text: "The purchase window ran out (each one lasts 30 minutes). Start again when you're ready.", restart: true })),
        });
      } catch (e) {
        if (!gone) setStatus({ kind: "error", text: (e as Error).message || "The widget couldn't start." });
      }
    })();
    return () => {
      gone = true;
      widget?.close();
    };
  }, [session, n.onrampWidget]);

  const line = (() => {
    if (arrived) return null;
    switch (status.kind) {
      case "minting":
        return (
          <>
            <Spinner /> Starting a secure purchase window…
          </>
        );
      case "loading":
        return (
          <>
            <Spinner /> Loading the widget…
          </>
        );
      case "ready":
        return n.realMoney ? "Follow the steps in the widget. You'll see the price and fees before you pay." : "Sandbox: use test card data (never your real card). It sends testnet USDC.";
      case "submitted":
        return (
          <>
            <Spinner /> Payment sent{status.amount ? ` (${status.amount}${status.method ? ` by ${status.method.replace(/_/g, " ")}` : ""})` : ""}. Watching your balance for the USDC to arrive…
          </>
        );
      case "settled":
        return (
          <>
            <Spinner /> The provider says it&apos;s settled. Waiting to see it in your balance…{" "}
            {status.tx && (
              <a href={txLink(net, status.tx)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                transaction
              </a>
            )}
          </>
        );
      default:
        return null;
    }
  })();

  return (
    <section aria-labelledby="onramp-title" className="rounded-2xl border-[1.5px] border-ink bg-panel shadow-[4px_4px_0_0_var(--color-ink)]" data-testid="onramp-panel">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 id="onramp-title" className="font-pixel text-[18px] leading-tight">
            Buy with card or bank
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {n.realMoney ? "Real money, delivered as USDC on Arc mainnet" : "Sandbox: test card data only, sends testnet USDC"} · to <span className="num">{address.slice(0, 6)}…{address.slice(-4)}</span>
          </p>
        </div>
        <Button variant="quiet" className="h-9 px-2" onClick={onClose} aria-label="Close the purchase">
          <Icon name="x" size={16} />
        </Button>
      </div>
      <div className="px-4 py-3">
        {arrived && (
          <p className="mb-3 inline-flex items-center gap-2 rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-[14px] font-semibold text-good" role="status" data-testid="onramp-arrived">
            <Icon name="check" size={16} stroke={2.6} /> Arrived: +{arrived} USDC
          </p>
        )}
        {line && (
          <p className="mb-3 flex items-center gap-2 text-[13.5px] text-ink-2" role="status" data-testid="onramp-status">
            {line}
          </p>
        )}
        {(status.kind === "error" || status.kind === "stopped") && (
          <div className={`mb-3 rounded-lg border px-3 py-2 text-[13.5px] ${status.kind === "error" ? "border-bad/40 bg-bad/5 text-bad" : "border-warn bg-warn/10 text-warn-ink"}`} role="alert" data-testid="onramp-error">
            {status.text}
            {(status.kind === "error" || status.restart) && (
              <Button variant="ghost" className="ml-3 h-8 px-3 text-[13px]" onClick={() => setAttempt((a) => a + 1)}>
                Start again
              </Button>
            )}
          </div>
        )}
        {session != null && status.kind !== "error" && <div ref={box} className="h-[640px] w-full overflow-hidden rounded-xl border border-line bg-surface" data-testid="onramp-widget" />}
      </div>
    </section>
  );
}
