import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

test("requester and owner complete an honest simulated order, independent handling, refund and pickup", async ({
  browser,
  baseURL,
}) => {
  await mkdir(resolve("evidence"), { recursive: true });
  const owner = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const requester = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const ownerPage = await owner.newPage();
  const requestPage = await requester.newPage();
  const unique = Date.now();
  const artworkIntent = `Makers club workshop sticker ${unique}`;
  const cancellationIntent = `Cancellation before dispatch ${unique}`;
  const pageErrors: string[] = [];
  ownerPage.on("pageerror", (error) => pageErrors.push(error.message));
  requestPage.on("pageerror", (error) => pageErrors.push(error.message));
  const health = await (await owner.request.get("/api/health")).json();
  expect(
    health.mode,
    "Browser acceptance must never start a physical job",
  ).toBe("simulation");
  expect(
    health.paymentMode,
    "Browser acceptance requires labeled mock payments",
  ).toBe("mock");
  const credentials = JSON.parse(
    await readFile(resolve("../.data/local-credentials.json"), "utf8"),
  );
  await ownerPage.goto("/owner");
  await ownerPage
    .getByLabel("Owner access code", { exact: true })
    .fill(process.env.FABRARY_OWNER_CODE || credentials.ownerCode);
  await ownerPage
    .getByRole("button", { name: "Open owner workshop", exact: true })
    .click();
  await expect(
    ownerPage.getByRole("heading", { name: "Keep the counter moving." }),
  ).toBeVisible();
  await ownerPage.getByRole("tab", { name: "Machines & policy" }).click();
  const machine = ownerPage.locator(".owner-machine").filter({
    has: ownerPage.getByRole("heading", {
      name: "Sticker counter",
      exact: true,
    }),
  });
  await ownerPage
    .getByRole("button", { name: "Register supported device", exact: true })
    .click();
  await expect(machine.locator(".machine-reason")).toContainText("Registered;");
  await machine
    .getByLabel(
      "I inspected the output area, loaded media and cleared the machine.",
    )
    .check();
  await machine
    .getByRole("button", { name: "Run simulation calibration", exact: true })
    .click();
  await expect(machine.locator(".machine-reason")).toContainText(
    "Simulated calibration passed",
  );
  await machine
    .getByText("Media, prices, hours & policy", { exact: true })
    .click();
  await machine.getByLabel("List this machine for requester discovery").check();
  const saved = ownerPage.waitForResponse(
    (r) =>
      r.url().endsWith("/api/owner/machines/phomemo_01") &&
      r.request().method() === "PATCH",
  );
  await machine
    .getByRole("button", { name: "Save machine settings", exact: true })
    .click();
  expect((await saved).status()).toBe(200);
  await expect(ownerPage.getByRole("alert")).toHaveCount(0);
  await machine
    .getByRole("button", { name: "Resume machine", exact: true })
    .click();
  await expect(machine.locator(".machine-reason")).toContainText(
    "Owner inspected and cleared",
  );
  await requestPage.goto("/");
  await expect(
    requestPage.getByRole("heading", { name: "What are we making?" }),
  ).toBeVisible();
  await requestPage.screenshot({
    path: "evidence/requester-desktop.png",
    fullPage: true,
  });
  await requestPage
    .getByLabel("Upload artwork", { exact: true })
    .setInputFiles(resolve("tests/fixtures/makers.png"));
  await expect(
    requestPage.getByAltText("Uploaded original artwork"),
  ).toBeVisible();
  await requestPage
    .getByLabel("What is it for?", { exact: true })
    .fill(artworkIntent);
  await requestPage
    .getByRole("button", { name: "Make production preview", exact: true })
    .click();
  await expect(
    requestPage.getByAltText(/Actual production preview/),
  ).toBeVisible();
  await requestPage
    .getByRole("button", { name: "Approve production file", exact: true })
    .click();
  await requestPage
    .getByRole("button", { name: "Get a quote", exact: true })
    .click();
  await expect(requestPage.locator(".quote")).toContainText("Mock payment");
  await requestPage
    .getByRole("button", { name: /Confirm mock payment/ })
    .click();
  await expect(
    requestPage.getByRole("button", { name: "Start production", exact: true }),
  ).toBeVisible();
  await requestPage
    .getByRole("button", { name: "Start production", exact: true })
    .click();
  await expect(
    requestPage.getByRole("heading", {
      name: "Production is complete",
      exact: true,
    }),
  ).toBeVisible({ timeout: 45000 });
  await expect(
    requestPage.getByText("Simulated evidence", { exact: false }),
  ).toBeVisible();
  await expect(
    requestPage.getByText("Your item passed the output check.", {
      exact: false,
    }),
  ).toBeVisible();
  await ownerPage.getByRole("tab", { name: "Orders & handling" }).click();
  const order = ownerPage.locator(".owner-job").filter({
    has: ownerPage.getByText(artworkIntent, { exact: true }),
  });
  for (const label of [
    "Output removed",
    "Order label attached",
    "Item stored safely",
    "Machine cleared",
  ])
    await order.getByLabel(label, { exact: true }).check();
  await order
    .getByRole("button", { name: "Mark ready for pickup", exact: true })
    .click();
  await expect(
    requestPage.getByRole("heading", { name: "Ready for pickup", exact: true }),
  ).toBeVisible();
  const pickupCode = (await requestPage
    .locator(".pickup-code")
    .textContent())!.trim();
  await requestPage.screenshot({
    path: "evidence/requester-ready-desktop.png",
    fullPage: true,
  });
  await ownerPage.getByRole("tab", { name: "Machines & policy" }).click();
  await machine
    .getByLabel(
      "I inspected the output area, loaded media and cleared the machine.",
    )
    .check();
  await machine
    .getByRole("button", { name: "Resume machine", exact: true })
    .click();
  await expect(machine.locator(".machine-reason")).toContainText(
    "Owner inspected and cleared",
  );
  // A separate order can reserve and pay while the previous item remains uncollected.
  await requestPage
    .getByRole("button", { name: "New order", exact: true })
    .click();
  await requestPage
    .getByLabel("Upload artwork", { exact: true })
    .setInputFiles(resolve("tests/fixtures/makers.png"));
  await expect(
    requestPage.getByAltText("Uploaded original artwork"),
  ).toBeVisible();
  await requestPage
    .getByLabel("What is it for?", { exact: true })
    .fill(cancellationIntent);
  await requestPage
    .getByRole("button", { name: "Make production preview", exact: true })
    .click();
  await requestPage
    .getByRole("button", { name: "Approve production file", exact: true })
    .click();
  await requestPage
    .getByRole("button", { name: "Get a quote", exact: true })
    .click();
  await requestPage
    .getByRole("button", { name: /Confirm mock payment/ })
    .click();
  await requestPage
    .getByRole("button", { name: "Cancel order", exact: true })
    .click();
  await requestPage
    .getByRole("button", { name: "Cancel order", exact: true })
    .click();
  await expect(
    requestPage.getByRole("heading", {
      name: "This order was cancelled",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    requestPage.getByText("Mock refund recorded. No money moved.", {
      exact: true,
    }),
  ).toBeVisible();
  await requestPage
    .getByRole("button")
    .filter({ hasText: "ready for pickup" })
    .click();
  await ownerPage.getByRole("tab", { name: "Orders & handling" }).click();
  await order.getByLabel("Pickup code", { exact: true }).fill(pickupCode);
  await order
    .getByRole("button", { name: "Redeem & record collection", exact: true })
    .click();
  await expect(
    requestPage.getByText(
      "Collected. The owner redeemed your pickup code and recorded handoff.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    order.getByRole("button", {
      name: "Redeem & record collection",
      exact: true,
    }),
  ).toHaveCount(0);
  await requestPage
    .getByRole("button", {
      name: "View receipt & payment records",
      exact: true,
    })
    .click();
  await expect(requestPage.locator(".receipt")).toContainText("Mock receipt");
  await expect(requestPage.locator(".receipt")).toContainText("confirmed");
  await ownerPage.screenshot({
    path: "evidence/owner-desktop.png",
    fullPage: true,
  });
  await requestPage.setViewportSize({ width: 390, height: 844 });
  await expect(requestPage.locator("body")).toHaveJSProperty(
    "scrollWidth",
    390,
  );
  await requestPage.screenshot({
    path: "evidence/requester-mobile.png",
    fullPage: true,
  });
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await expect(ownerPage.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await ownerPage.screenshot({
    path: "evidence/owner-mobile.png",
    fullPage: true,
  });
  await requestPage.bringToFront();
  await requestPage.goto("/");
  await expect(
    requestPage.getByRole("heading", {
      name: "Your production file",
      exact: true,
    }),
  ).toBeVisible();
  // Respect macOS WebKit's native full-navigation shortcut rather than changing user preferences.
  await requestPage.keyboard.press(
    browser.browserType().name() === "webkit" && process.platform === "darwin"
      ? "Alt+Tab"
      : "Tab",
  );
  await expect(
    requestPage.getByRole("link", { name: "Skip to content", exact: true }),
  ).toBeFocused();
  await requestPage.keyboard.press("Enter");
  await expect(requestPage.locator("#main")).toBeFocused();
  expect(pageErrors).toEqual([]);
  await owner.close();
  await requester.close();
});

test("intake validates specifications, review returns to approval, and expired/offline states recover", async ({
  browser,
  baseURL,
}) => {
  const requester = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const owner = await browser.newContext({ baseURL });
  const page = await requester.newPage();
  const ownerPage = await owner.newPage();
  const health = await (await requester.request.get("/api/health")).json();
  expect(health.mode).toBe("simulation");
  expect(health.paymentMode).toBe("mock");
  const credentials = JSON.parse(
    await readFile(resolve("../.data/local-credentials.json"), "utf8"),
  );
  await page.goto("/");
  await page.getByRole("radio", { name: /Prepared 3D print/ }).check();
  await expect(
    page.getByText("No prepared models are configured.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Make production preview", exact: true }),
  ).toBeDisabled();
  await page.getByRole("radio", { name: /Thermal sticker/ }).check();
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill(`Permission review browser test ${Date.now()}`);
  await page
    .getByRole("button", { name: "Make production preview", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Add at least one image");
  await page
    .getByLabel("Upload artwork", { exact: true })
    .setInputFiles(resolve("tests/fixtures/makers.png"));
  await expect(page.getByAltText("Uploaded original artwork")).toBeVisible();
  await page.getByLabel("Width (mm)", { exact: true }).fill("17");
  await page
    .getByRole("button", { name: "Make production preview", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("15, 25 or 53 mm");
  await page.getByLabel("Width (mm)", { exact: true }).fill("53");
  await page
    .getByRole("button", { name: "Make production preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve production file", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Production file approved",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Edit artwork or specifications",
      exact: true,
    })
    .click();
  await page.getByLabel("Height (mm)", { exact: true }).fill("60");
  await page
    .getByLabel("Artwork permission", { exact: true })
    .selectOption("unclear");
  await page
    .getByLabel("Automatically accept a quote within my budget", {
      exact: true,
    })
    .check();
  await page.getByLabel("Budget cap (USD)", { exact: true }).fill("3.00");
  await page
    .getByRole("button", {
      name: "Save changes & rebuild preview",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "An owner review is needed",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("The owner needs to review artwork permission.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve production file", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("specification v2", { exact: false }),
  ).toBeVisible();
  const intent = (await page.locator(".order-intent").textContent())!;
  await ownerPage.goto("/owner");
  await ownerPage
    .getByLabel("Owner access code", { exact: true })
    .fill(process.env.FABRARY_OWNER_CODE || credentials.ownerCode);
  await ownerPage
    .getByRole("button", { name: "Open owner workshop", exact: true })
    .click();
  const order = ownerPage
    .locator(".owner-job")
    .filter({ has: ownerPage.getByText(intent, { exact: true }) });
  await expect(
    order.getByRole("heading", {
      name: "Review artwork permission",
      exact: true,
    }),
  ).toBeVisible();
  await order
    .getByLabel("Reviewed result", { exact: true })
    .selectOption("pass");
  await order
    .getByLabel("Reason for decision", { exact: true })
    .fill("Owner confirmed this is authorized makers club artwork.");
  await order
    .getByRole("button", { name: "Record reviewed result", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve production file", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("specification v3", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve production file", exact: true })
    .click();
  await page.getByRole("button", { name: "Get a quote", exact: true }).click();
  await expect(page.locator(".mandate-confirmation")).toContainText(
    "explicit budget of $3.00",
  );
  await expect(
    page.getByRole("button", { name: /Confirm mock payment/ }),
  ).toBeVisible();
  // Advance only the browser clock to exercise the expired quote presentation.
  // Server expiry and reservation races are covered by backend integration tests.
  await page.clock.setFixedTime(new Date(Date.now() + 125000));
  await expect(
    page.getByText("This quote expired.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh expired quote", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Confirm mock payment/ }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "evidence/expired-mobile.png",
    fullPage: true,
  });
  await page.clock.setFixedTime(new Date());
  await requester.setOffline(true);
  await expect(
    page.getByText("Live updates are disconnected.", { exact: false }),
  ).toBeVisible();
  await requester.setOffline(false);
  await page.getByRole("button", { name: "Refresh now", exact: true }).click();
  await expect(
    page.getByText("Live updates are disconnected.", { exact: false }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel order", exact: true }).click();
  await page.getByRole("button", { name: "Cancel order", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "This order was cancelled",
      exact: true,
    }),
  ).toBeVisible();
  await owner.close();
  await requester.close();
});

test("live subscription updates the open owner dashboard with polling disabled", async ({
  browser,
  baseURL,
}) => {
  await mkdir(resolve("evidence"), { recursive: true });
  const dashboard = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const operator = await browser.newContext({ baseURL });
  const page = await dashboard.newPage();
  type LiveProbe = { blockedIntervals: number[]; refreshEvents: number };
  await page.addInitScript(() => {
    const target = window as Window & {
      fabraryLiveProbe?: { blockedIntervals: number[]; refreshEvents: number };
    };
    const probe = { blockedIntervals: [] as number[], refreshEvents: 0 };
    target.fabraryLiveProbe = probe;
    const originalInterval = window.setInterval.bind(window);
    window.setInterval = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if ((timeout || 0) >= 2000) {
        probe.blockedIntervals.push(timeout!);
        return 0;
      }
      return originalInterval(handler, timeout, ...args);
    }) as typeof window.setInterval;
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        this.addEventListener("refresh", () => {
          probe.refreshEvents++;
        });
      }
    };
  });
  const health = await (await operator.request.get("/api/health")).json();
  expect(health.mode).toBe("simulation");
  expect(
    health.store,
    "This check requires the authoritative SpacetimeDB path",
  ).toBe("spacetimedb");
  const credentials = JSON.parse(
    await readFile(resolve("../.data/local-credentials.json"), "utf8"),
  );
  const ownerCode = process.env.FABRARY_OWNER_CODE || credentials.ownerCode;
  expect(
    (
      await operator.request.post("/api/session", {
        data: { role: "owner", accessCode: ownerCode },
      })
    ).status(),
  ).toBe(200);
  const state = await (
    await operator.request.get("/api/owner/dashboard")
  ).json();
  const target = state.machines.find(
    (m: { id: string }) => m.id === "phomemo_01",
  );
  expect(
    target.activeJobId,
    "Live-update test requires an idle device",
  ).toBeNull();
  expect(target.calibrated).toBe(true);
  expect(target.paused).toBe(false);
  let restoreRequired = false;
  const probe = () =>
    page.evaluate(
      () =>
        (window as Window & { fabraryLiveProbe: LiveProbe }).fabraryLiveProbe,
    );
  try {
    await page.goto("/owner");
    await page.getByLabel("Owner access code", { exact: true }).fill(ownerCode);
    await page
      .getByRole("button", { name: "Open owner workshop", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "Machines & policy", exact: true })
      .click();
    const machine = page.locator(".owner-machine").filter({
      has: page.getByRole("heading", {
        name: "Sticker counter",
        exact: true,
      }),
    });
    await expect(
      machine.getByRole("button", { name: "Pause machine", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await probe()).refreshEvents)
      .toBeGreaterThan(0);
    expect((await probe()).blockedIntervals).toContain(3000);
    expect((await probe()).blockedIntervals).toContain(15000);
    const beforePause = (await probe()).refreshEvents;
    const paused = await operator.request.patch(
      "/api/owner/machines/phomemo_01",
      { data: { paused: true } },
    );
    expect(paused.status()).toBe(200);
    restoreRequired = true;
    await expect(machine.locator(".machine-reason")).toHaveText(
      "Paused by owner.",
    );
    await expect(
      machine.getByRole("button", { name: "Resume machine", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await probe()).refreshEvents)
      .toBeGreaterThan(beforePause);
    await page.screenshot({
      path: "evidence/sse-live-dashboard.png",
      fullPage: true,
    });
    const beforeResume = (await probe()).refreshEvents;
    const resumed = await operator.request.patch(
      "/api/owner/machines/phomemo_01",
      { data: { paused: false, inspected: true, cleared: true } },
    );
    expect(resumed.status()).toBe(200);
    restoreRequired = false;
    await expect(machine.locator(".machine-reason")).toHaveText(
      "Owner inspected and cleared the machine.",
    );
    await expect(
      machine.getByRole("button", { name: "Pause machine", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await probe()).refreshEvents)
      .toBeGreaterThan(beforeResume);
  } finally {
    if (restoreRequired)
      expect(
        (
          await operator.request.patch("/api/owner/machines/phomemo_01", {
            data: { paused: false, inspected: true, cleared: true },
          })
        ).status(),
      ).toBe(200);
    await dashboard.close();
    await operator.close();
  }
});
