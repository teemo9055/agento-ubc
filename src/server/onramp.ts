import { createOnrampServerKit, createSessionRouteHandler } from "@circle-fin/onramp-kit/server";
import { isAddress } from "viem";
import { z } from "zod";
import { NETWORKS, type Net } from "@/lib/networks";

/**
 * Mints an Arc Onramp session for one address on one network. Testnet uses the sandbox (test card
 * data, sends testnet USDC) with the app's Circle test key; mainnet uses the production widget and
 * needs a separate production key. The two keys are never swapped: a mainnet request without the
 * production key is refused rather than quietly sent to the sandbox.
 */

/** Sandbox Onramp API (docs.arc.io/app-kit/references/onramp-hosting-requirements). Overridable for proxies and emulators. */
const SANDBOX_API = () => process.env.ONRAMP_SANDBOX_API_URL || "https://api-test.circle.com";

/** The widget lists only USDC on Arc ("arc" is the widget's network id; it follows the session's environment). */
export const ONRAMP_CHAIN = "arc";

export const MAINNET_KEY_MISSING = "Buying real USDC needs the app's production Circle key, which isn't set up yet";

const bodySchema = z.object({
  network: z.enum(["testnet", "mainnet"]),
  destinationAddress: z.string(),
  /** A random id the browser keeps; no personal data. */
  appUserId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Bare hostname of the page that embeds the widget, from the app's own config (never from the request). */
export function referrerDomain(): string | undefined {
  const url = process.env.APP_PUBLIC_URL;
  if (!url) return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

function apiKeyFor(net: Net): string | undefined {
  return (net === "mainnet" ? process.env.CIRCLE_MAINNET_API_KEY : process.env.CIRCLE_API_KEY) || undefined;
}

// Light per-IP limit: a session is cheap for us but each one is a call to Circle with our key.
const LIMIT = 10;
const WINDOW_MS = 60_000;
const g = globalThis as unknown as { __onrampHits?: Map<string, number[]> };
const hits = (g.__onrampHits ??= new Map<string, number[]>());

function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

function limited(ip: string, now = Date.now()) {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return false;
}

/** For tests. */
export function resetOnrampLimits() {
  hits.clear();
}

export async function mintOnrampSession(req: Request): Promise<Response> {
  if (limited(clientIp(req))) return json({ message: "Too many tries. Wait a minute and try again." }, 429);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ message: "Send network (testnet or mainnet), destinationAddress and appUserId." }, 400);
  const { network, destinationAddress, appUserId } = parsed.data;
  if (!isAddress(destinationAddress)) return json({ message: "That isn't a valid Arc address (0x followed by 40 hex characters)." }, 400);

  const apiKey = apiKeyFor(network);
  if (!apiKey) {
    return json({ message: network === "mainnet" ? MAINNET_KEY_MISSING : "Test purchases need the app's Circle test key (CIRCLE_API_KEY), which isn't set up yet" }, 503);
  }

  const net = NETWORKS[network];
  const server = createOnrampServerKit({
    apiKey,
    widgetBaseUrl: net.onrampWidget,
    ...(network === "testnet" ? { baseUrl: SANDBOX_API() } : {}),
    referrerDomain: referrerDomain(),
  });
  const handler = createSessionRouteHandler(server);

  // Hand the SDK's handler only the fields it knows, with the asset scope fixed server-side.
  const forwarded = new Request(req.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      appUserId,
      destinationAddress,
      destinationChain: ONRAMP_CHAIN,
      assets: { pairs: [{ token: "USDC", chain: ONRAMP_CHAIN }] },
    }),
  });
  const res = await handler(forwarded);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, headers });
}
