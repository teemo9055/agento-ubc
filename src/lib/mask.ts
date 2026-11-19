/**
 * Previews of personal data for the graph and run events: enough to recognise, never the whole value.
 * +1 604 ••• ••12 · j•••@gmail.com · 0x12…ab
 */
export function maskPreview(type: string | undefined, value: unknown): string {
  const s = String(typeof value === "object" ? JSON.stringify(value) : (value ?? "")).trim();
  if (!s) return "";
  if (type === "phone" || /^\+?[\d\s().-]{8,}$/.test(s)) {
    const d = s.replace(/\D/g, "");
    if (d.length >= 8) {
      const cc = s.startsWith("+") || d.length === 11 ? d.slice(0, d.length - 10) || "1" : "1";
      const local = d.slice(-10);
      return `+${cc} ${local.slice(0, 3)} ••• ••${local.slice(-2)}`;
    }
  }
  if (type === "email" || /^[^\s@]+@[^\s@]+$/.test(s)) {
    const [u, dom] = s.split("@");
    return `${u.charAt(0)}•••@${dom}`;
  }
  if (type === "wallet_address" || /^0x[0-9a-fA-F]{40}$/.test(s)) return `${s.slice(0, 4)}…${s.slice(-2)}`;
  if (type === "tx_hash" || /^0x[0-9a-fA-F]{64}$/.test(s)) return `${s.slice(0, 6)}…${s.slice(-4)}`;
  if (type === "person_name") return s.split(/\s+/).map((w, i) => (i === 0 ? w : `${w.charAt(0)}.`)).join(" ").slice(0, 24);
  if (/^https?:\/\//.test(s)) {
    try {
      return new URL(s).host;
    } catch {
      return s.slice(0, 24);
    }
  }
  return s.length > 24 ? `${s.slice(0, 23)}…` : s;
}

/** Whether a value should never appear whole in an event: phone, email, wallet. */
export const isPersonal = (type: string | undefined) => type === "phone" || type === "email" || type === "wallet_address" || type === "person_name" || type === "address";
