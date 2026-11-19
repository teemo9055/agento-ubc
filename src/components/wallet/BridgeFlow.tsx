"use client";
import { useEffect, useRef, useState } from "react";
import { formatUnits, type EIP1193Provider } from "viem";
import type { BridgeKit, BridgeResult, EstimateResult } from "@circle-fin/bridge-kit";
import type { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { Button, Spinner } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { NETWORKS, type Net } from "@/lib/networks";

type Adapter = Awaited<ReturnType<typeof createViemAdapterFromProvider>>;
type StepName = "approve" | "burn" | "fetchAttestation" | "mint";
type StepState = { state: "waiting" | "pending" | "success" | "error" | "noop"; txHash?: string; explorerUrl?: string; error?: string };

const STEPS: StepName[] = ["approve", "burn", "fetchAttestation", "mint"];

/** The browser wallet the page can see (EIP-1193), if any. */
export function browserWallet(): EIP1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
}

const AMOUNT_RE = /^(?:\d+)(?:\.\d{1,6})?$/;
const usd = (v: number) => (Math.round(v * 1e6) / 1e6).toString();

function stepLabel(s: StepName, from: string) {
  return {
    approve: `Allow the transfer on ${from}`,
    burn: `Send from ${from}`,
    fetchAttestation: "Circle confirms the transfer",
    mint: "Circle delivers it on Arc",
  }[s];
}

/**
 * Bring USDC from another chain with CCTP via Circle's Bridge Kit. The user's browser wallet signs on
 * the source chain; Circle's Forwarding Service mints on Arc, so no Arc gas or Arc wallet is needed.
 * The kit and adapter load only when the user connects.
 */
export function BridgeFlow({ net, recipient, onSent, arrived, onClose }: { net: Net; recipient: string; onSent: () => void; arrived: string | null; onClose: () => void }) {
  const n = NETWORKS[net];
  const eth = browserWallet();
  const kitRef = useRef<{ kit: BridgeKit; adapter: Adapter } | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [source, setSource] = useState(n.bridgeFrom[0].id);
  const [amount, setAmount] = useState("");
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [sending, setSending] = useState(false);
  const [steps, setSteps] = useState<Record<StepName, StepState> | null>(null);
  const [result, setResult] = useState<BridgeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const from = n.bridgeFrom.find((c) => c.id === source) ?? n.bridgeFrom[0];

  useEffect(() => setEstimate(null), [source, amount]);

  /** Steps light up from the kit's events as they happen. Only uses the state setter, so one copy serves for the panel's life. */
  const stepEvent = useRef((payload: unknown) => {
    const p = payload as { method?: string; values?: { name?: string; state?: StepState["state"]; txHash?: string; explorerUrl?: string; errorMessage?: string } };
    const name = (p.values?.name ?? p.method) as StepName | undefined;
    if (!name || !STEPS.includes(name)) return;
    setSteps((s) => (s ? { ...s, [name]: { state: p.values?.state ?? "success", txHash: p.values?.txHash, explorerUrl: p.values?.explorerUrl, error: p.values?.errorMessage } } : s));
  }).current;

  // Stop listening to the kit when the panel closes.
  useEffect(
    () => () => {
      kitRef.current?.kit.off("*", stepEvent);
      kitRef.current = null;
    },
    [stepEvent],
  );

  async function connect() {
    if (!eth) return;
    setConnecting(true);
    setErr(null);
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const [{ BridgeKit }, { createViemAdapterFromProvider }] = await Promise.all([import("@circle-fin/bridge-kit"), import("@circle-fin/adapter-viem-v2")]);
      const adapter = await createViemAdapterFromProvider({ provider: eth });
      const kit = new BridgeKit();
      kit.on("*", stepEvent);
      kitRef.current = { kit, adapter };
      setAccount(accounts[0] ?? null);
    } catch (e) {
      setErr(plain(e, "The wallet didn't connect."));
    } finally {
      setConnecting(false);
    }
  }

  const params = () => {
    const k = kitRef.current!;
    return {
      from: { adapter: k.adapter, chain: source as never },
      to: { recipientAddress: recipient, chain: n.bridgeName as never, useForwarder: true as const },
      amount,
    };
  };

  async function checkFees() {
    if (!kitRef.current || !AMOUNT_RE.test(amount) || Number(amount) <= 0) return;
    setEstimating(true);
    setErr(null);
    try {
      setEstimate(await kitRef.current.kit.estimate(params()));
    } catch (e) {
      setErr(plain(e, "Couldn't work out the fees."));
    } finally {
      setEstimating(false);
    }
  }

  async function send() {
    if (!kitRef.current) return;
    setSending(true);
    setErr(null);
    setResult(null);
    setSteps(Object.fromEntries(STEPS.map((s) => [s, { state: "waiting" }])) as Record<StepName, StepState>);
    onSent();
    try {
      track(await kitRef.current.kit.bridge(params()));
    } catch (e) {
      setErr(plain(e, "The transfer didn't start."));
    } finally {
      setSending(false);
    }
  }

  async function retry() {
    if (!kitRef.current || !result) return;
    setSending(true);
    setErr(null);
    try {
      track(await kitRef.current.kit.retry(result, { from: kitRef.current.adapter }));
    } catch (e) {
      setErr(plain(e, "The retry didn't go through."));
    } finally {
      setSending(false);
    }
  }

  function track(r: BridgeResult) {
    setResult(r);
    setSteps((s) => {
      const next = { ...(s ?? (Object.fromEntries(STEPS.map((x) => [x, { state: "waiting" }])) as Record<StepName, StepState>)) };
      for (const st of r.steps) if (STEPS.includes(st.name as StepName)) next[st.name as StepName] = { state: st.state, txHash: st.txHash, explorerUrl: st.explorerUrl, error: st.errorMessage };
      return next;
    });
  }

  const fee = (t: "provider" | "forwarder") => {
    const a = estimate?.fees.find((f) => f.type === t)?.amount;
    return a == null ? 0 : Number(a);
  };
  const receive = estimate ? Math.max(0, Number(amount) - fee("provider") - fee("forwarder")) : null;
  const gas = (estimate?.gasFees ?? []).filter((g) => g.fees).map((g) => ({ name: g.name, token: g.token, fee: Number(formatUnits(BigInt(g.fees!.fee), 18)) }));
  const gasTotal = gas.reduce((a, g) => a + g.fee, 0);
  const sourceTx = steps?.burn.explorerUrl ?? steps?.approve.explorerUrl;
  const current = steps && STEPS.find((s) => steps[s].state !== "success" && steps[s].state !== "noop");
  const failed = result?.state === "error";
  const amountOk = AMOUNT_RE.test(amount) && Number(amount) > 0;

  return (
    <section aria-labelledby="bridge-title" className="rounded-2xl border-[1.5px] border-ink bg-panel shadow-[4px_4px_0_0_var(--color-ink)]" data-testid="bridge-panel">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 id="bridge-title" className="font-pixel text-[18px] leading-tight">
            Bring USDC from another chain
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-3">
            Circle&apos;s CCTP moves your USDC; its Forwarding Service delivers it on {n.name}, so you need no Arc gas.
          </p>
        </div>
        <Button variant="quiet" className="h-9 px-2" onClick={onClose} aria-label="Close the transfer">
          <Icon name="x" size={16} />
        </Button>
      </div>
      <div className="flex flex-col gap-4 px-4 py-4">
        {!eth ? (
          <p className="text-[14px] text-ink-2" data-testid="no-browser-wallet">
            No browser wallet found in this browser. Install one (for example MetaMask) holding USDC on another chain, or use one of the other ways above.
          </p>
        ) : !account ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={connect} disabled={connecting} data-testid="bridge-connect">
              {connecting ? <Spinner /> : <Icon name="wallet" size={16} />} Connect your wallet
            </Button>
            <span className="text-[13px] text-ink-3">Your wallet signs on the chain you send from. Agento never holds your keys or your money.</span>
          </div>
        ) : (
          <>
            <p className="text-[13px] text-ink-3">
              Sending from <span className="num text-ink">{account.slice(0, 6)}…{account.slice(-4)}</span> to <span className="num text-ink">{recipient.slice(0, 6)}…{recipient.slice(-4)}</span> on {n.name}
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
              <label className="block">
                <span className="block text-[13px] font-medium">From</span>
                <select value={source} onChange={(e) => setSource(e.target.value)} disabled={sending} className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-ink/40" data-testid="bridge-source">
                  {n.bridgeFrom.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-[13px] font-medium">Amount (USDC)</span>
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} disabled={sending} placeholder="10.00" className="num mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-ink/40" data-testid="bridge-amount" />
              </label>
              <Button variant="ghost" onClick={checkFees} disabled={!amountOk || estimating || sending} data-testid="bridge-estimate">
                {estimating ? <Spinner /> : null} Check fees
              </Button>
            </div>
            {amount && !amountOk && <p className="text-[13px] text-bad">Enter an amount like 10 or 2.50 (up to 6 decimals).</p>}

            {estimate && (
              <div className="rounded-xl border border-line bg-surface px-3 py-3 text-[13.5px]" data-testid="bridge-fees">
                <ul className="space-y-1">
                  <li className="flex justify-between gap-3">
                    <span>You send from {from.name}</span>
                    <span className="num">{amount} USDC</span>
                  </li>
                  <li className="flex justify-between gap-3 text-ink-2">
                    <span>Circle&apos;s fast-transfer fee (CCTP)</span>
                    <span className="num">−{usd(fee("provider"))} USDC</span>
                  </li>
                  <li className="flex justify-between gap-3 text-ink-2">
                    <span>Forwarding fee (Circle delivers on Arc for you)</span>
                    <span className="num">−{usd(fee("forwarder"))} USDC</span>
                  </li>
                  <li className="flex justify-between gap-3 border-t border-line pt-1 font-semibold">
                    <span>Arrives on {n.name}</span>
                    <span className="num">about {usd(receive ?? 0)} USDC</span>
                  </li>
                </ul>
                <p className="mt-2 text-[12.5px] text-ink-3">
                  {gas.length ? `Plus ${from.name}'s network fee, paid by your wallet: about ${gasTotal.toPrecision(2)} in its gas token (${gas.map((g) => g.name).join(", ")}).` : `Plus ${from.name}'s network fee, paid by your wallet in its gas token.`}
                </p>
              </div>
            )}

            {estimate && !steps && (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={send} disabled={sending || !amountOk} data-testid="bridge-send">
                  <Icon name="send" size={16} /> Send {amount} USDC to Arc
                </Button>
                <span className={`text-[13px] ${n.realMoney ? "font-semibold text-bad" : "text-ink-3"}`}>{n.realMoney ? "This moves real USDC. It can't be undone." : "Testnet USDC only; nothing real moves."}</span>
              </div>
            )}

            {steps && (
              <ol className="space-y-2" data-testid="bridge-steps">
                {STEPS.map((s) => {
                  const st = steps[s];
                  const on = sending && current === s;
                  return (
                    <li key={s} className="flex items-center gap-2 text-[14px]">
                      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-[5px] border ${st.state === "success" || st.state === "noop" ? "border-good bg-good/10 text-good" : st.state === "error" ? "border-bad bg-bad/5 text-bad" : "border-line text-ink-3"}`}>
                        {st.state === "success" || st.state === "noop" ? <Icon name="check" size={12} stroke={2.6} /> : st.state === "error" ? <Icon name="x" size={12} stroke={2.6} /> : on ? <Spinner /> : null}
                      </span>
                      <span className={st.state === "waiting" && !on ? "text-ink-3" : ""}>{stepLabel(s, from.name)}</span>
                      {st.explorerUrl && (
                        <a href={st.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[12.5px] text-ink-3 underline underline-offset-2 hover:text-ink">
                          tx <Icon name="external" size={11} />
                        </a>
                      )}
                      {st.state === "error" && st.error && <span className="text-[12.5px] text-bad">{st.error}</span>}
                    </li>
                  );
                })}
              </ol>
            )}
            {sourceTx && (
              <a href={sourceTx} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium underline underline-offset-2">
                See the transfer on {from.name}&apos;s explorer <Icon name="external" size={12} />
              </a>
            )}
            {arrived ? (
              <p className="inline-flex items-center gap-2 rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-[14px] font-semibold text-good" role="status">
                <Icon name="check" size={16} stroke={2.6} /> Arrived: +{arrived} USDC
              </p>
            ) : result?.state === "success" ? (
              <p className="flex items-center gap-2 text-[13.5px] text-ink-2" role="status">
                <Spinner /> Delivered by Circle. Waiting to see it in your balance…
              </p>
            ) : null}
            {failed && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost" onClick={retry} disabled={sending} data-testid="bridge-retry">
                  {sending ? <Spinner /> : <Icon name="refund" size={16} />} Try the failed step again
                </Button>
                <span className="text-[13px] text-ink-3">Steps already done aren&apos;t repeated, and nothing is sent twice.</span>
              </div>
            )}
          </>
        )}
        {err && (
          <p className="rounded-lg border border-bad/40 bg-bad/5 px-3 py-2 text-[13.5px] text-bad" role="alert">
            {err}
          </p>
        )}
      </div>
    </section>
  );
}

function plain(e: unknown, fallback: string) {
  const m = (e as { message?: string })?.message ?? "";
  if (/user rejected|denied|rejected the request/i.test(m)) return "You declined in your wallet. Nothing was sent.";
  if (/insufficient|balance/i.test(m)) return `Not enough USDC (or gas) in your wallet on that chain. ${m}`.trim();
  return m ? `${fallback} ${m}` : fallback;
}
