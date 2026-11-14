export const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://explorer.testnet.arc.io";
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;
export const short = (h?: string, n = 6) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "");
export const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
export const dateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");
