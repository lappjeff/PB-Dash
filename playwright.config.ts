import { defineConfig, devices } from "@playwright/test";

const PORT = 3322;

/** E2E runs against the production build in demo mode (embedded DB + fixture PB client). */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/opportunities`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: { DEMO_MODE: "true", DATABASE_URL: "", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "", CLERK_SECRET_KEY: "" },
  },
});
