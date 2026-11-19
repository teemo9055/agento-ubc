import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Capability } from "./types";

/**
 * A small sample catalog with recorded answers, for the browser tests and the "See it compose"
 * demo, so neither depends on live discovery or spends anything. Every provider is labelled
 * "(sample)" and lives on a .test host; nothing here is a real seller and no money moves.
 * On only when replaying recorded data (MARKET_DATA) or with DEMO_CATALOG=on.
 */
interface Fixture {
  services: { capability: Capability; answer: unknown }[];
}

const HOST = /\.demo\.agento\.test$/;
export const demoOn = () => Boolean(process.env.MARKET_DATA) || process.env.DEMO_CATALOG === "on";
export const isDemoResource = (url: string) => {
  try {
    return HOST.test(new URL(url).host);
  } catch {
    return false;
  }
};

let loaded: Fixture | null | undefined;
function fixture(): Fixture | null {
  if (loaded !== undefined) return loaded;
  const file = process.env.DEMO_CATALOG_FILE ?? path.join(process.cwd(), "e2e/fixtures/catalog.json");
  loaded = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Fixture) : null;
  return loaded;
}

/** The sample services, for the capability map to include while the demo is on. */
export const demoServices = (): Capability[] => (demoOn() ? (fixture()?.services ?? []).map((s) => s.capability) : []);

export const demoCapability = (url: string) => fixture()?.services.find((s) => s.capability.resource === url.replace(/\/$/, ""))?.capability;
export const demoAnswer = (url: string) => fixture()?.services.find((s) => s.capability.resource === url.replace(/\/$/, ""))?.answer;
