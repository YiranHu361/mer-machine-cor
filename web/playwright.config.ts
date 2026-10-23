import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  use: {
    browserName: (() => {
      const engine = process.env.FABRARY_BROWSER_ENGINE || "chromium";
      if (!["chromium", "firefox", "webkit"].includes(engine))
        throw new Error(
          "FABRARY_BROWSER_ENGINE must be chromium, firefox or webkit",
        );
      return engine as "chromium" | "firefox" | "webkit";
    })(),
    baseURL: process.env.FABRARY_BROWSER_URL || "http://127.0.0.1:4317",
    trace: "off",
    actionTimeout: 20000,
    navigationTimeout: 20000,
    screenshot: "only-on-failure",
  },
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          process.env.FABRARY_BROWSER_REPORT || "evidence/browser-report.json",
      },
    ],
    ["html", { open: "never" }],
  ],
  outputDir: "test-results",
});
