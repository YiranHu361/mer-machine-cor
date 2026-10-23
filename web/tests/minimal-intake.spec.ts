import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const width of [320, 1440]) {
  test(`minimal ${width}px intake offers pictures first and keyboard-accessible optional context`, async ({
    page,
    browserName,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const mutations: string[] = [];
    await page.addInitScript(() => {
      class QuietEvents {
        onopen: (() => void) | null = null;
        constructor() {
          queueMicrotask(() => this.onopen?.());
        }
        addEventListener() {}
        close() {}
      }
      Object.defineProperty(window, "EventSource", { value: QuietEvents });
    });
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== "GET") mutations.push(path);
      const body =
        path === "/api/health"
          ? {
              mode: "simulation",
              paymentMode: "mock",
              store: "isolated-minimal-fixture",
            }
          : path === "/api/session"
            ? { role: "requester", id: "minimal_requester" }
            : path === "/api/jobs"
              ? { jobs: [], revision: 1 }
              : path === "/api/machines"
                ? { machines: [], revision: 1 }
                : path === "/api/catalog"
                  ? { models: [] }
                  : {
                      error: {
                        message:
                          "No mutations or external services are allowed in this fixture.",
                      },
                    };
      await route.fulfill({
        status: request.method() === "GET" ? 200 : 405,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Upload your pictures", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Upload artwork", { exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "Your orders", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Preview your item", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Width (mm)", { exact: true })).toHaveCount(0);
    await expect(
      page.getByLabel("What is it for?", { exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByText("Simulation mode", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Mock payments · no money moves", { exact: true }),
    ).toBeVisible();
    const uploadBox = await page.locator(".picture-upload").boundingBox();
    expect(uploadBox).not.toBeNull();
    expect(
      Math.abs(uploadBox!.x + uploadBox!.width / 2 - width / 2),
    ).toBeLessThanOrEqual(1);
    if (width === 320) expect(uploadBox!.width).toBeGreaterThanOrEqual(280);
    const note = page.locator(".picture-context > summary");
    await note.focus();
    await note.press("Enter");
    const input = page.getByLabel("What is it for?", { exact: true });
    await note.press(
      browserName === "webkit" && process.platform === "darwin"
        ? "Alt+Tab"
        : "Tab",
    );
    await expect(input).toBeFocused();
    await input.fill("A label for my workshop");
    await note.press("Enter");
    await expect(input).not.toBeVisible();
    await note.press("Enter");
    await expect(input).toHaveValue("A label for my workshop");
    expect(mutations).toEqual([]);
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    await testInfo.attach(`minimal-intake-${width}-accessibility`, {
      body: JSON.stringify({
        state: `minimal-intake-${width}`,
        rulesPassed: audit.passes.length,
        violations: audit.violations,
      }),
      contentType: "application/json",
    });
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    await note.press("Enter");
    await page.screenshot({
      path: `evidence/minimal-ui-empty-${width}.png`,
      fullPage: true,
    });
  });
}
