"use client";
import type { Hex } from "viem";

/**
 * The light half of the passkey wallet: whether one can be used here and the one this browser
 * remembers. Kept apart from the Circle SDK so pages that only need to know this stay small.
 */
const CLIENT_KEY = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY ?? "";
const STORE = "agento:passkey";

export interface SavedWallet {
  id: string;
  publicKey: Hex;
  username: string;
  address: Hex;
}

export const passkeyConfigured = () => Boolean(CLIENT_KEY);
export const passkeySupported = () => typeof window !== "undefined" && "PublicKeyCredential" in window && passkeyConfigured();

export function savedWallet(): SavedWallet | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "null");
  } catch {
    return null;
  }
}

