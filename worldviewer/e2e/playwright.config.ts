import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 30_000,
  retries: 1,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
  },
  webServer: {
    command: "npm run dev:web",
    port: 5173,
    reuseExistingServer: true,
  },
});
