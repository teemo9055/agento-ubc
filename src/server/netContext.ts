import { AsyncLocalStorage } from "node:async_hooks";
import type { Net } from "@/lib/networks";

/**
 * Which Arc network the work in progress is for. A job's chat turns and steps run inside
 * `withNet(job.network, …)`, so deep helpers (marketplace purchases, paid nodes, the catalog's
 * "payable here") follow the job's network without passing it through every call. Outside a job,
 * it's testnet.
 */
const store = new AsyncLocalStorage<Net>();

export const withNet = <T>(net: Net | undefined, fn: () => T): T => store.run(net ?? "testnet", fn);
export const currentNet = (): Net => store.getStore() ?? "testnet";

/** Mainnet is "on" for the work in progress: a mainnet job, or a server built for mainnet only. */
export const onMainnet = (): boolean => currentNet() === "mainnet" || process.env.NEXT_PUBLIC_NETWORK_MODE === "mainnet";
