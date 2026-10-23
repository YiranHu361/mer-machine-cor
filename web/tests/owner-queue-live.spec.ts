import { test, expect, type Page } from "@playwright/test";

const epoch = Date.UTC(2026, 9, 23, 8, 30);
function pickupJob(index: number) {
  const at = new Date(epoch - index * 1000).toISOString();
  return {
    id: `queue_live_${index}`,
    specVersion: 1,
    version: 1,
    createdAt: at,
    updatedAt: at,
    spec: {
      assetIds: [],
      intent: `Collection order ${index}`,
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    productionState: "produced",
    paymentState: "released",
    fulfillmentState: "ready_for_pickup",
    pickup: {
      code: index === 1 ? "READY-123" : `READY-${index}`,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    history: [],
  };
}
type QueueJob = ReturnType<typeof pickupJob>;

async function ownerQueue(page: Page, initial: QueueJob[]) {
  let jobs = initial;
  let revision = 1;
  await page.addInitScript(() => {
    const listeners: Array<() => void> = [];
    class QueueEvents {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      constructor() {
        queueMicrotask(() => this.onopen?.());
      }
      addEventListener(name: string, listener: () => void) {
        if (name === "refresh") listeners.push(listener);
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: QueueEvents,
    });
    (window as any).refreshQueueFixture = () =>
      listeners.forEach((listener) => listener());
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let status = 200;
    let body: unknown = {};
    if (path === "/api/health")
      body = {
        mode: "simulation",
        paymentMode: "mock",
        store: "owner-live-queue-fixture",
      };
    else if (path === "/api/session")
      body = { role: "owner", id: "live_queue_owner" };
    else if (path === "/api/owner/dashboard")
      body = { revision, machines: [], jobs, ledger: [] };
    else if (path.endsWith("/redeem")) {
      const id = path.split("/").at(-2);
      jobs = jobs.map((job) =>
        job.id === id
          ? {
              ...job,
              fulfillmentState: "collected",
              version: job.version + 1,
              pickup: {
                ...job.pickup,
                redeemedAt: new Date().toISOString(),
              },
            }
          : job,
      );
      revision++;
      body = { job: jobs.find((job) => job.id === id) };
    } else {
      status = 405;
      body = {
        error: { message: "Only isolated queue fixture requests are allowed" },
      };
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("/owner");
  await expect(
    page.getByRole("heading", {
      name: "Keep the counter moving.",
      exact: true,
    }),
  ).toBeVisible();
  return async (next: QueueJob[]) => {
    jobs = next;
    revision++;
    await page.evaluate(() => (window as any).refreshQueueFixture());
    await expect(
      page
        .getByLabel("Show orders", { exact: true })
        .locator("option[value='all']"),
    ).toHaveText(`All orders (${jobs.length})`);
  };
}
const order = (page: Page, intent: string) =>
  page
    .locator(".owner-job")
    .filter({ has: page.getByText(intent, { exact: true }) });

test("a queue page clamps permanently when live work shrinks, without jumping back when work returns", async ({
  page,
}) => {
  const jobs = Array.from({ length: 25 }, (_, index) => pickupJob(index + 1));
  const update = await ownerQueue(page, jobs);
  const next = page.getByRole("button", { name: "Next orders", exact: true });
  for (let index = 0; index < 3; index++) await next.click();
  await expect(page.getByText("Page 4 of 4", { exact: true })).toBeVisible();
  await update(jobs.slice(0, 16));
  await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  await update(jobs);
  await expect(page.getByText("Page 2 of 4", { exact: true })).toBeVisible();
  await expect(order(page, "Collection order 9")).toBeVisible();
});

test("live insertion keeps a focused eighth-order handoff draft reachable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 664 });
  const jobs = Array.from({ length: 8 }, (_, index) => pickupJob(index + 1));
  const update = await ownerQueue(page, jobs);
  const last = order(page, "Collection order 8");
  const code = last.getByLabel("Pickup code", { exact: true });
  await code.fill("KEEP-THIS-DRAFT");
  await expect(code).toBeFocused();
  const inserted = pickupJob(0);
  await update([inserted, ...jobs]);
  await expect(code).toBeVisible();
  await expect(code).toHaveValue("KEEP-THIS-DRAFT");
  await expect(code).toBeFocused();
  await expect
    .poll(async () => {
      const box = await code.boundingBox();
      return Boolean(box && box.y >= 0 && box.y + box.height <= 664);
    })
    .toBe(true);
  await expect(page.locator(".owner-job")).toHaveCount(8);
  await expect(page.locator(".queue-count")).toContainText(
    "Your selected order stays on this page.",
  );
  const width = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(width.page).toBe(width.viewport);
  await page.screenshot({
    path: testInfo.outputPath("overnight-owner-queue-retained-draft-320.png"),
  });
  await page.getByRole("button", { name: "Next orders", exact: true }).click();
  await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  await expect(code).toHaveValue("KEEP-THIS-DRAFT");
  await page
    .getByRole("button", { name: "Previous orders", exact: true })
    .click();
  await expect(order(page, "Collection order 7")).toBeVisible();
});

test("a completed handoff moves to history and returns keyboard focus to queue controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 664 });
  await ownerQueue(page, [pickupJob(1), pickupJob(2)]);
  const first = order(page, "Collection order 1");
  await first.getByLabel("Pickup code", { exact: true }).fill("READY-123");
  const redeem = first.getByRole("button", {
    name: "Redeem & record collection",
    exact: true,
  });
  await redeem.focus();
  await page.keyboard.press("Enter");
  await expect(first).toHaveCount(0);
  await expect(order(page, "Collection order 2")).toBeVisible();
  await expect(
    page.getByRole("search", { name: "Find workshop orders", exact: true }),
  ).toBeFocused();
  await page
    .getByLabel("Show orders", { exact: true })
    .selectOption("completed");
  await expect(first).toBeVisible();
  await expect(first.getByLabel("Pickup code", { exact: true })).toHaveCount(0);
  await expect(first.locator(".job-states")).toContainText(
    "Collection: collected",
  );
});

test("a settled follow-up leaves the active search safely and remains reachable in history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 664 });
  const followUp = {
    ...pickupJob(1),
    fulfillmentState: "collected",
    paymentState: "release_pending",
  };
  const pendingPickup = pickupJob(2);
  const update = await ownerQueue(page, [followUp, pendingPickup]);
  const search = page.getByLabel("Find an order", { exact: true });
  await search.fill("Collection order 1");
  const first = order(page, "Collection order 1");
  await first.getByText("Recovery & order history", { exact: true }).click();
  await first
    .getByRole("button", { name: "Reconcile saved outcome", exact: true })
    .focus();
  await update([
    { ...followUp, paymentState: "released", version: 2 },
    pendingPickup,
  ]);
  await expect(first).toHaveCount(0);
  await expect(
    page.getByRole("search", { name: "Find workshop orders", exact: true }),
  ).toBeFocused();
  await expect(search).toHaveValue("Collection order 1");
  await expect(page.getByLabel("Show orders", { exact: true })).toHaveValue(
    "action",
  );
  await expect(
    page.getByRole("heading", { name: "No orders match.", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".queue-count")).toHaveText("0 of 2 orders shown");
  await page
    .getByRole("button", { name: "Show all orders", exact: true })
    .click();
  await expect(first).toBeVisible();
  await expect(first.locator(".job-states")).toContainText("Payment: released");
  await expect(order(page, "Collection order 2")).toBeVisible();
  await expect(search).toHaveValue("");
});

test("a deferred page-change focus respects an owner who moved to search", async ({
  page,
}) => {
  await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:4317\//, () => {});
  await ownerQueue(
    page,
    Array.from({ length: 10 }, (_, index) => pickupJob(index + 1)),
  );
  await page.evaluate(() => {
    const original = window.requestAnimationFrame.bind(window);
    const held: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (callback) => {
      held.push(callback);
      return held.length;
    };
    (
      window as Window & { releaseOwnerPageFrames?: () => void }
    ).releaseOwnerPageFrames = () => {
      window.requestAnimationFrame = original;
      for (const callback of held.splice(0)) callback(performance.now());
    };
  });
  await page.getByRole("button", { name: "Next orders", exact: true }).click();
  const search = page.getByLabel("Find an order", { exact: true });
  await search.focus();
  await page.evaluate(() =>
    (
      window as Window & { releaseOwnerPageFrames: () => void }
    ).releaseOwnerPageFrames(),
  );
  await expect(search).toBeFocused();
  await page.keyboard.insertText("Collection order 10");
  await expect(search).toHaveValue("Collection order 10");
  await expect(order(page, "Collection order 10")).toBeVisible();
});
