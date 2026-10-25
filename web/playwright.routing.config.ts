import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "ui-routing.spec.ts",
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:4325", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: {
    command:
      "npm exec vite preview -- --host 127.0.0.1 --port 4325 --strictPort",
    url: "http://127.0.0.1:4325",
    reuseExistingServer: false,
  },
});
