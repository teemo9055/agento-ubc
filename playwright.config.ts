import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: true,
  retries: 1, // tests use live third-party market data
  use: { baseURL: "http://localhost:3100", trace: "off" },
  webServer: {
    command: "npm run build && npx next start -p 3100",
    url: "http://localhost:3100/api/config",
    reuseExistingServer: true,
    timeout: 240_000,
    env: { DEMO_DELAY_SCALE: "0.2", FAULT_TIMEOUT_MS: "1500", AI_DISABLED: "true", PERSIST: "false" },
  },
});
