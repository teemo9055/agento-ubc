import { defineConfig } from "@playwright/test";

// Tests never move real money: the test server is started with every mainnet setting blanked, so
// mainnet stays off there even when .env.local holds real mainnet wallets (set values win over the file).
const NO_MAINNET = { MAINNET_FACTORY_ADDRESS: "", MAINNET_DEPLOYER_PRIVATE_KEY: "", MAINNET_CLIENT_PRIVATE_KEY: "", MAINNET_AGENT_PRIVATE_KEY: "", MAINNET_SELLER_PRIVATE_KEY: "", CIRCLE_MAINNET_API_KEY: "" };

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: true,
  // Market and map data come from e2e/fixtures/market.json (MARKET_DATA=record to refresh it; =live for the real network).
  retries: process.env.MARKET_DATA === "live" ? 1 : 0,
  use: { baseURL: "http://localhost:3100", trace: "off" },
  webServer: {
    command: "npm run build && npx next start -p 3100",
    url: "http://localhost:3100/api/config",
    reuseExistingServer: true,
    timeout: 240_000,
    env: { ...NO_MAINNET, DEMO_DELAY_SCALE: "0.2", FAULT_TIMEOUT_MS: "1500", AI_DISABLED: "true", PERSIST: "false", ADMIN_KEY: "e2e-admin-key", MARKET_DATA: process.env.MARKET_DATA === "live" ? "" : (process.env.MARKET_DATA ?? "replay") },
  },
});
