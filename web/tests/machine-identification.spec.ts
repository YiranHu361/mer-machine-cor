import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openProviderDetails } from "./provider-controls";

// Every API request is intercepted: this checks the identification interface only.
async function workshop(page: Page, claude: string) {
  const posts: { contentType: string; body: string }[] = [];
  const replies: Record<string, unknown>[] = [];
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
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/health")
      return json({
        mode: "simulation",
        paymentMode: "mock",
        store: "fixture",
        integrations: { claude },
      });
    if (path === "/api/session")
      return json({ role: "owner", id: "identify_ui_owner" });
    if (path === "/api/owner/dashboard")
      return json({
        revision: 1,
        machines: [],
        jobs: [],
        ledger: [],
        connectors: [],
        setupCodes: [],
      });
    if (path === "/api/owner/machine-identification") {
      posts.push({
        contentType: request.headers()["content-type"] ?? "",
        body: (request.postDataBuffer() ?? Buffer.alloc(0)).toString("latin1"),
      });
      return json({ identification: replies.shift() });
    }
    return json(
      { error: { message: "No other requests in this fixture" } },
      405,
    );
  });
  return { posts, replies };
}

test("a provider identifies the machine by name or label photo before getting a setup command", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { posts, replies } = await workshop(page, "configured; not verified");
  await page.goto("/owner");
  await page.getByRole("tab", { name: "Machines", exact: true }).click();
  await openProviderDetails(page, "Add a machine");
  const identify = page.getByRole("button", { name: "Identify", exact: true });
  const model = page.getByLabel("Supported model", { exact: true });
  await expect(identify).toBeDisabled();
  await expect(model).toHaveValue("phomemo-m02pro");

  replies.push({
    status: "supported",
    model: "instax-mini-link-3",
    modelName: "Instax Mini Link 3",
    seen: "instax mini link 3",
    source: "description",
    provider: "local",
    message: "Identified as Instax Mini Link 3. It's selected below.",
  });
  await page
    .getByLabel("What machine is it?", { exact: true })
    .fill("instax mini link 3");
  await identify.click();
  await expect(page.getByRole("status")).toHaveText(
    "Identified as Instax Mini Link 3. It's selected below.",
  );
  await expect(model).toHaveValue("instax-mini-link-3");
  expect(posts[0].contentType).toMatch(/^multipart\/form-data/);
  expect(posts[0].body).toContain("instax mini link 3");
  expect(posts[0].body).not.toContain('name="photo"');

  // A photo is shrunk to a JPEG in the browser; an unsupported result changes nothing.
  replies.push({
    status: "unsupported",
    seen: "Phomemo M02S",
    source: "photo",
    provider: "claude",
    message: "Fabrary supports the Phomemo M02Pro, not “Phomemo M02S”.",
  });
  await page.getByLabel("What machine is it?", { exact: true }).fill("");
  await page
    .getByLabel("Or a photo of its label or box", { exact: true })
    .setInputFiles("tests/fixtures/makers.png");
  await expect(identify).toBeEnabled();
  await identify.click();
  await expect(page.getByRole("status")).toHaveText(
    "Fabrary supports the Phomemo M02Pro, not “Phomemo M02S”.",
  );
  await expect(model).toHaveValue("instax-mini-link-3");
  expect(posts[1].body).toContain('name="photo"; filename="label.jpg"');
  expect(posts[1].body).toContain("Content-Type: image/jpeg");

  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await testInfo.attach("machine-identification-accessibility", {
    body: JSON.stringify({
      state: "machine-identification-390",
      rulesPassed: audit.passes.length,
      violations: audit.violations,
    }),
    contentType: "application/json",
  });
  expect(audit.violations).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  // Choosing a different model by hand retires the stale identification.
  await model.selectOption("bambu-a1-mini");
  await expect(page.locator(".identify-result")).toHaveCount(0);
});

test("without a Claude key only the typed name is offered", async ({
  page,
}) => {
  await workshop(page, "not configured");
  await page.goto("/owner");
  await page.getByRole("tab", { name: "Machines", exact: true }).click();
  await openProviderDetails(page, "Add a machine");
  await expect(
    page.getByLabel("What machine is it?", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Or a photo of its label or box", { exact: true }),
  ).toHaveCount(0);
});
