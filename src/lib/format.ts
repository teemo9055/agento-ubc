import { NETWORKS, type Net } from "./networks";
export const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://explorer.testnet.arc.io";
/** Explorer links on the job's network; testnet when none is given. */
const explorerOf = (net?: Net) => (net === "mainnet" ? NETWORKS.mainnet.explorer : EXPLORER);
export const txUrl = (h: string, net?: Net) => `${explorerOf(net)}/tx/${h}`;
export const addrUrl = (a: string, net?: Net) => `${explorerOf(net)}/address/${a}`;
export const short = (h?: string, n = 6) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "");
export const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
export const dateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");
