import { test, expect, devices, type Page, type Route } from "@playwright/test";

const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
const longReference = "WorkshopInspectionReference_" + "A".repeat(140);
const now = new Date().toISOString();
const longMachine = {
  id: "phomemo_01",
  name: "Thermal label counter at the north entrance collection desk",
  model: "Phomemo M02Pro",
  outputType: "sticker",
  adapterVersion: "fixture",
  mode: "simulation",
  paired: true,
  configured: true,
  calibrated: true,
  listed: true,
  ready: false,
  paused: true,
  reason: longReference,
  mediaRemaining: 42,
  material: "thermal-paper",
  priceCard: { consumables: 20, machine: 10, handling: 30, platform: 15 },
  hours: { start: 0, end: 24 },
  maxJobSeconds: 120,
  collectionPoint: longReference,
};
const longJob = {
  id: "touch_fixture_order",
  specVersion: 1,
  version: 1,
  machineId: longMachine.id,
  spec: {
    assetIds: ["touch_artwork"],
    intent:
      "Labels for the community workshop collection counter. " + longReference,
    outputType: "sticker",
    widthMm: 53,
    heightMm: 50,
    quantity: 1,
    material: "thermal-paper",
    permission: "authorized",
    crop: "contain",
  },
  artifact: { id: "touch_artwork", url: pixel, sha256: "touch_fixture" },
  productionState: "needs_review",
  paymentState: "held",
  fulfillmentState: "unprepared",
  history: [{ at: now, event: "evidence_uncertain", reason: longReference }],
  createdAt: now,
  updatedAt: now,
  evidence: {
    url: pixel,
    capturedAt: now,
    machineId: longMachine.id,
    jobId: "touch_fixture_order",
    result: "review",
    reason: longReference,
    source: "simulation",
    completionCredible: false,
  },
  quote: {
    id: "touch_quote",
    version: 1,
    expiresAt: new Date(Date.now() + 120000).toISOString(),
    items: [
      { label: "Consumables", cents: 20 },
      { label: "Machine time", cents: 10 },
      { label: "Owner handling", cents: 30 },
      { label: "Platform fee", cents: 15 },
    ],
    totalCents: 75,
    ownerCents: 60,
    platformCents: 15,
    currency: "USD",
    paymentMode: "mock",
    collectionPoint: longReference,
  },
};

async function fixture(
  page: Page,
  role: "owner" | "requester",
  jobs: unknown[] = [],
  custom?: (route: Route, path: string) => Promise<boolean>,
) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (custom && (await custom(route, path))) return;
    const body =
      path === "/api/health"
        ? { mode: "simulation", paymentMode: "mock", store: "touch-ui-fixture" }
        : path === "/api/session"
          ? { role, id: "touch_fixture_" + role }
          : path === "/api/jobs"
            ? { jobs }
            : path === "/api/machines"
              ? { machines: [longMachine] }
              : path === "/api/catalog"
                ? { models: [] }
                : path === "/api/owner/dashboard"
                  ? { machines: [longMachine], jobs, ledger: [] }
                  : null;
    if (path === "/api/events")
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": Isolated touch layout fixture\n\n",
      });
    await route.fulfill({
      status: body ? 200 : 405,
      contentType: "application/json",
      body: JSON.stringify(
        body || {
          error: { message: "This touch fixture allows no service mutations" },
        },
      ),
    });
  });
}
async function reflow(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(
    dimensions.content,
    label + " must not require horizontal page scrolling",
  ).toBeLessThanOrEqual(dimensions.viewport + 1);
}
async function readable(page: Page, selector: string, label: string) {
  const sizes = await page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => ({
      text: element.textContent?.slice(0, 80),
      content: element.scrollWidth,
      visible: element.clientWidth,
    })),
  );
  expect(sizes.length, label + " must be present").toBeGreaterThan(0);
  for (const size of sizes)
    expect(size.content, `${label}: ${size.text}`).toBeLessThanOrEqual(
      size.visible + 1,
    );
}

// Mobile contexts exercise WebKit touch events and visual viewport behavior. Firefox
// also runs the layout checks, with desktop-mode touch because it has no isMobile emulation.
test("touch intake keeps controls reachable in portrait and short landscape with reduced motion", async ({
  browser,
  browserName,
  baseURL,
}, testInfo) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    isMobile: browserName !== "firefox",
    reducedMotion: "reduce",
    baseURL,
  });
  const page = await context.newPage();
  let health: Route | null = null;
  await fixture(page, "requester", [], async (route, path) => {
    if (path !== "/api/health") return false;
    health = route;
    return true;
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("Opening the workshop…", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".loading-shell .spinner")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect.poll(() => Boolean(health)).toBe(true);
  await health!.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      mode: "simulation",
      paymentMode: "mock",
      store: "touch-ui-fixture",
    }),
  });
  await expect(
    page.getByRole("heading", { name: "What are we making?", exact: true }),
  ).toBeVisible();
  for (const viewport of [
    { width: 390, height: 664 },
    { width: 844, height: 320 },
  ]) {
    await page.setViewportSize(viewport);
    await reflow(page, `${viewport.width}x${viewport.height} touch intake`);
    await page
      .locator(".output-choice")
      .filter({ has: page.getByRole("radio", { name: /Instant photo/ }) })
      .tap();
    await expect(
      page.getByRole("radio", { name: /Instant photo/ }),
    ).toBeChecked();
    await page
      .locator(".output-choice")
      .filter({ has: page.getByRole("radio", { name: /Thermal sticker/ }) })
      .tap();
    await page.getByLabel("What is it for?", { exact: true }).tap();
    await page
      .getByLabel("What is it for?", { exact: true })
      .fill("Touch input stays available in a short viewport");
    const input = await page
      .getByLabel("What is it for?", { exact: true })
      .evaluate((element) => ({
        font: parseFloat(getComputedStyle(element).fontSize),
        scale: window.visualViewport?.scale || 1,
      }));
    expect(
      input.font,
      "Touch text entry must avoid small-font focus zoom",
    ).toBeGreaterThanOrEqual(16);
    expect(input.scale).toBe(1);
    await page
      .getByRole("checkbox", {
        name: "Automatically accept a quote within my budget",
        exact: true,
      })
      .tap();
    await expect(
      page.getByLabel("Budget cap (USD)", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", {
        name: "Automatically accept a quote within my budget",
        exact: true,
      })
      .tap();
    const navigationTargets = await page
      .locator(".site-header nav a")
      .evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().height),
      );
    for (const height of navigationTargets)
      expect(
        height,
        "Main navigation must offer a 44px touch target",
      ).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: testInfo.outputPath(
        `overnight-touch-${browserName}-intake-${viewport.width}x${viewport.height}.png`,
      ),
    });
  }
  await context.close();
});

test("long collection and machine status text remains readable under touch and 200 percent equivalent reflow", async ({
  browser,
  browserName,
  baseURL,
}, testInfo) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    isMobile: browserName !== "firefox",
    baseURL,
  });
  const page = await context.newPage();
  await page.addInitScript(() =>
    localStorage.setItem("fabrary-current-job", "touch_fixture_order"),
  );
  await fixture(page, "requester", [longJob]);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your production file", exact: true }),
  ).toBeVisible();
  for (const viewport of [
    { width: 390, height: 664 },
    { width: 844, height: 320 },
    { width: 320, height: 500 },
  ]) {
    await page.setViewportSize(viewport);
    await reflow(page, `${viewport.width}px long requester content`);
    await readable(
      page,
      ".collection-line strong",
      "The entire collection reference",
    );
    await readable(page, ".public-machine p", "The entire machine status");
    await page.locator(".collection-line").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(
        `overnight-touch-${browserName}-collection-${viewport.width}.png`,
      ),
    });
  }
  // A 640px layout narrowed by 200% browser zoom has a 320px CSS viewport.
  // This checks equivalent reflow, not native zoom, pinch gestures or an iOS keyboard.
  await page.getByRole("button", { name: "New order", exact: true }).tap();
  await expect(
    page.getByRole("heading", { name: "What are we making?", exact: true }),
  ).toBeVisible();
  await context.close();
});

test("long owner evidence and machine reasons remain readable and disclosures accept touch", async ({
  browser,
  browserName,
  baseURL,
}, testInfo) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    isMobile: browserName !== "firefox",
    baseURL,
  });
  const page = await context.newPage();
  await fixture(page, "owner", [longJob]);
  await page.goto("/owner");
  await expect(
    page.getByRole("heading", {
      name: "Keep the counter moving.",
      exact: true,
    }),
  ).toBeVisible();
  let settingsVisited = false;
  for (const viewport of [
    { width: 390, height: 664 },
    { width: 844, height: 320 },
    { width: 320, height: 500 },
  ]) {
    await page.setViewportSize(viewport);
    await reflow(page, `${viewport.width}px owner evidence`);
    await readable(page, ".evidence-review p", "The entire evidence reason");
    const summary = page.getByText("Recovery & order history", { exact: true });
    const target = await summary.boundingBox();
    expect(
      target!.height,
      "A touch disclosure must offer a 44px target",
    ).toBeGreaterThanOrEqual(44);
    await summary.tap();
    await expect(
      page.getByRole("button", {
        name: "Reconcile saved outcome",
        exact: true,
      }),
    ).toBeVisible();
    await summary.tap();
    await page
      .getByRole("tab", { name: "Machines & policy", exact: true })
      .tap();
    await readable(page, ".machine-reason", "The entire saved machine reason");
    const settings = page.locator(".machine-settings");
    if (!settingsVisited) {
      await settings
        .getByText("Media, prices, hours & policy", { exact: true })
        .tap();
      settingsVisited = true;
    } else {
      // Owner panels now preserve drafts and disclosure state across views.
      await expect(settings).toHaveAttribute("open", "");
    }
    await expect(
      page.getByLabel("Collection point", { exact: true }),
    ).toBeVisible();
    await reflow(page, `${viewport.width}px owner machine settings`);
    await page.screenshot({
      path: testInfo.outputPath(
        `overnight-touch-${browserName}-machine-${viewport.width}.png`,
      ),
    });
    await page
      .getByRole("tab", { name: "Orders & handling", exact: true })
      .tap();
  }
  await page.getByRole("tab", { name: "Machines & policy", exact: true }).tap();
  await page.getByText("Media, prices, hours & policy", { exact: true }).tap();
  await expect(
    page.getByLabel("Collection point", { exact: true }),
  ).toBeHidden();
  await context.close();
});
