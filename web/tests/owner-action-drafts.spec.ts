import { test, expect, type Page, type Dialog } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:(4317|4519)\//, () => {});
});
const at = "2026-10-23T10:30:00.000Z";
const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
function job(index: number) {
  return {
    id: `owner_action_${index}`,
    version: 1,
    specVersion: 1,
    machineId: "isolated_action_printer",
    attemptId: `isolated_attempt_${index}`,
    approvedSpecHash: `approved_spec_${index}`,
    createdAt: new Date(Date.parse(at) - index * 1000).toISOString(),
    updatedAt: at,
    spec: {
      assetIds: [],
      intent: `Action draft order ${index}`,
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    productionState: "produced",
    fulfillmentState: index === 1 ? "ready_for_pickup" : "awaiting_owner",
    paymentState: "released",
    pickup:
      index === 1
        ? {
            code: "ACTIVE_FIXTURE_CODE",
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          }
        : undefined,
    evidence: {
      url: pixel,
      capturedAt: at,
      machineId: "isolated_action_printer",
      jobId: `owner_action_${index}`,
      result: "pass",
      reason: "Isolated simulated visible-output evidence",
      source: "simulation",
      completionCredible: true,
    },
    history: [] as Array<{ at: string; event: string; reason?: string }>,
  };
}
async function fixture(page: Page) {
  const jobs = Array.from({ length: 12 }, (_, index) => job(index));
  jobs[2].productionState = "needs_review";
  jobs[2].evidence.result = "review";
  jobs[3].productionState = "failed";
  jobs[3].evidence.result = "fail";
  const state = {
    jobs,
    revision: 1,
    mutations: [] as Array<{ path: string; body: any }>,
    accept: false,
    fail: false,
    owner: true,
  };
  await page.addInitScript(() => {
    const listeners: Array<() => void> = [];
    class Events {
      onopen: (() => void) | null = null;
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
      value: Events,
    });
    (window as any).refreshOwnerActions = () =>
      listeners.forEach((listener) => listener());
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      state.mutations.push({ path, body: route.request().postDataJSON() });
      if (state.fail)
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              message:
                "Isolated action reply unavailable; inspect the saved order before retrying.",
            },
          }),
        });
      return route.fulfill({
        status: state.accept ? 200 : 405,
        contentType: "application/json",
        body: JSON.stringify(
          state.accept
            ? { job: jobs[0] }
            : { error: { message: "Unexpected fixture mutation" } },
        ),
      });
    }
    if (path === "/api/owner/dashboard" && !state.owner)
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Owner fixture session ended" },
        }),
      });
    const body =
      path === "/api/health"
        ? {
            mode: "simulation",
            paymentMode: "mock",
            store: "isolated-owner-action-fixture",
          }
        : path === "/api/session"
          ? { role: "owner", id: "isolated_owner_action_identity" }
          : path === "/api/owner/dashboard"
            ? { revision: state.revision, machines: [], jobs, ledger: [] }
            : null;
    return route.fulfill({
      status: body ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(
        body || { error: { message: "No external fixture reads" } },
      ),
    });
  });
  await page.goto("/owner");
  await expect(orderFor(page, 0)).toBeVisible();
  return Object.assign(state, {
    refresh: async () => {
      state.revision++;
      const response = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/owner/dashboard",
      );
      await page.evaluate(() => (window as any).refreshOwnerActions());
      await response;
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    },
  });
}
function orderFor(page: Page, index: number) {
  return page.locator(`[data-owner-order="owner_action_${index}"]`);
}
async function allOrders(page: Page) {
  await page.getByLabel("Show orders", { exact: true }).selectOption("all");
}
async function pageAwayAndBack(page: Page) {
  await page.getByRole("button", { name: "Next orders", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Order pages" }),
  ).toContainText("Page 2 of 2");
  await page
    .getByRole("button", { name: "Previous orders", exact: true })
    .click();
}
async function checklist(page: Page, index = 0) {
  const order = orderFor(page, index);
  for (const name of [
    "Output removed",
    "Order label attached",
    "Item stored safely",
    "Machine cleared",
  ])
    await order.getByRole("checkbox", { name, exact: true }).check();
}

test("handling checklist survives explicit queue paging without marking anything ready", async ({
  page,
}) => {
  const state = await fixture(page);
  await checklist(page);
  await pageAwayAndBack(page);
  await expect(
    orderFor(page, 0).getByRole("button", {
      name: "Mark ready for pickup",
      exact: true,
    }),
  ).toBeEnabled();
  expect(state.mutations).toEqual([]);
});

test("pickup code survives a filter round trip and remains private to its order", async ({
  page,
}) => {
  const state = await fixture(page);
  await allOrders(page);
  await orderFor(page, 1)
    .getByLabel("Pickup code", { exact: true })
    .fill("private-code-A7");
  await page
    .getByLabel("Show orders", { exact: true })
    .selectOption("production");
  await expect(orderFor(page, 1)).toHaveCount(0);
  await allOrders(page);
  await expect(
    orderFor(page, 1).getByLabel("Pickup code", { exact: true }),
  ).toHaveValue("private-code-A7");
  expect(state.mutations).toEqual([]);
});

test("operator review result and exact reason survive search hiding the order", async ({
  page,
}) => {
  const state = await fixture(page);
  const order = orderFor(page, 2);
  await order
    .getByLabel("Reviewed result", { exact: true })
    .selectOption("fail");
  await order
    .getByLabel("Reason for decision", { exact: true })
    .fill("  The output is visibly incomplete at the label edge.  ");
  await page
    .getByLabel("Find an order", { exact: true })
    .fill("Action draft order 9");
  await expect(order).toHaveCount(0);
  await page.getByLabel("Find an order", { exact: true }).fill("");
  await expect(
    order.getByLabel("Reviewed result", { exact: true }),
  ).toHaveValue("fail");
  await expect(
    order.getByLabel("Reason for decision", { exact: true }),
  ).toHaveValue("  The output is visibly incomplete at the label edge.  ");
  expect(state.mutations).toEqual([]);
});

test("failed-execution inspection and reason survive queue paging without clearing the machine", async ({
  page,
}) => {
  const state = await fixture(page);
  const order = orderFor(page, 3);
  await order
    .getByRole("checkbox", {
      name: "I inspected and cleared the output area.",
      exact: true,
    })
    .check();
  await order
    .getByLabel("Clearance reason", { exact: true })
    .fill("Cleared the failed fixture output after an inspection.");
  await pageAwayAndBack(page);
  await expect(
    order.getByRole("checkbox", {
      name: "I inspected and cleared the output area.",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    order.getByLabel("Clearance reason", { exact: true }),
  ).toHaveValue("Cleared the failed fixture output after an inspection.");
  expect(state.mutations).toEqual([]);
});

async function fillReview(page: Page) {
  const order = orderFor(page, 2);
  await order
    .getByLabel("Reviewed result", { exact: true })
    .selectOption("fail");
  await order
    .getByLabel("Reason for decision", { exact: true })
    .fill("Visible output needs an operator decision before release.");
}
async function fillClearance(page: Page) {
  const order = orderFor(page, 3);
  await order
    .getByRole("checkbox", {
      name: "I inspected and cleared the output area.",
      exact: true,
    })
    .check();
  await order
    .getByLabel("Clearance reason", { exact: true })
    .fill("The failed fixture output was inspected and cleared.");
}
async function expectNoPreparation(page: Page) {
  const order = orderFor(page, 0);
  await expect(order.locator(".preparation input:checked")).toHaveCount(0);
  await expect(
    order.getByRole("button", { name: "Mark ready for pickup", exact: true }),
  ).toBeDisabled();
}
async function documentIdentity(page: Page) {
  return page.evaluate(() => {
    const target = window as Window & { __ownerActionDocument?: string };
    target.__ownerActionDocument ??= crypto.randomUUID();
    return target.__ownerActionDocument;
  });
}
async function cancelDocumentChange(page: Page) {
  const previous = await documentIdentity(page);
  const dialogs: string[] = [];
  const handle = async (dialog: Dialog) => {
    dialogs.push(dialog.type());
    await dialog.dismiss();
  };
  page.on("dialog", handle);
  try {
    await page
      .getByRole("link", { name: "Make something", exact: true })
      .click();
    await expect.poll(() => dialogs).toEqual(["beforeunload"]);
    expect(await documentIdentity(page)).toBe(previous);
  } finally {
    page.off("dialog", handle);
  }
}
async function reloadWithoutWarning(page: Page) {
  const previous = await documentIdentity(page);
  const dialogs: string[] = [];
  const handle = async (dialog: Dialog) => {
    dialogs.push(dialog.type());
    await dialog.accept();
  };
  page.on("dialog", handle);
  try {
    await page.reload();
    await expect.poll(() => documentIdentity(page)).not.toBe(previous);
    expect(dialogs).toEqual([]);
  } finally {
    page.off("dialog", handle);
  }
}

test("unrelated payment and dashboard changes preserve each current action draft", async ({
  page,
}) => {
  const state = await fixture(page);
  await allOrders(page);
  await checklist(page);
  await orderFor(page, 1)
    .getByLabel("Pickup code", { exact: true })
    .fill("private-current-code");
  await fillReview(page);
  await fillClearance(page);
  state.jobs.forEach((job) => {
    job.version++;
    job.updatedAt = "2026-10-23T10:32:00.000Z";
    job.paymentState = "refunded";
  });
  await state.refresh();
  await expect(
    orderFor(page, 0).getByRole("button", {
      name: "Mark ready for pickup",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    orderFor(page, 1).getByLabel("Pickup code", { exact: true }),
  ).toHaveValue("private-current-code");
  await expect(
    orderFor(page, 2).getByLabel("Reviewed result", { exact: true }),
  ).toHaveValue("fail");
  await expect(
    orderFor(page, 2).getByLabel("Reason for decision", { exact: true }),
  ).toHaveValue("Visible output needs an operator decision before release.");
  await expect(
    orderFor(page, 3).getByRole("checkbox", {
      name: "I inspected and cleared the output area.",
      exact: true,
    }),
  ).toBeChecked();
  expect(state.mutations).toEqual([]);
});

test("a changed execution clears preparation confirmations, even when the old attempt later reappears", async ({
  page,
}) => {
  const state = await fixture(page);
  await checklist(page);
  const oldAttempt = state.jobs[0].attemptId;
  state.jobs[0].attemptId = "new_execution_requires_fresh_inspection";
  await state.refresh();
  await expectNoPreparation(page);
  state.jobs[0].attemptId = oldAttempt;
  await state.refresh();
  await expectNoPreparation(page);
  await pageAwayAndBack(page);
  await expectNoPreparation(page);
  expect(state.mutations).toEqual([]);
});

test("changed evidence invalidates an off-screen review result and reason without carrying a decision to the new frame", async ({
  page,
}) => {
  const state = await fixture(page);
  await fillReview(page);
  await page
    .getByLabel("Find an order", { exact: true })
    .fill("Action draft order 9");
  state.jobs[2].evidence.capturedAt = "2026-10-23T10:33:00.000Z";
  state.jobs[2].evidence.reason =
    "New frame requires a fresh operator decision";
  await state.refresh();
  await page.getByLabel("Find an order", { exact: true }).fill("");
  const order = orderFor(page, 2);
  await expect(
    order.getByLabel("Reviewed result", { exact: true }),
  ).toHaveValue("pass");
  await expect(
    order.getByLabel("Reason for decision", { exact: true }),
  ).toHaveValue("");
  await expect(
    order.getByText("New frame requires a fresh operator decision", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    orderFor(page, 4).getByRole("checkbox", {
      name: "Output removed",
      exact: true,
    }),
  ).not.toBeChecked();
  await reloadWithoutWarning(page);
  expect(state.mutations).toEqual([]);
});

test("renewed pickup expiry clears a hidden private code and its document warning", async ({
  page,
}) => {
  const state = await fixture(page);
  await allOrders(page);
  await orderFor(page, 1)
    .getByLabel("Pickup code", { exact: true })
    .fill("old-private-code");
  await page
    .getByLabel("Show orders", { exact: true })
    .selectOption("production");
  await cancelDocumentChange(page);
  state.jobs[1].pickup!.expiresAt = new Date(
    Date.now() + 7200000,
  ).toISOString();
  await state.refresh();
  await allOrders(page);
  await expect(
    orderFor(page, 1).getByLabel("Pickup code", { exact: true }),
  ).toHaveValue("");
  await reloadWithoutWarning(page);
  expect(state.mutations).toEqual([]);
});

test("completed clearance cannot rearm old inspection or reason when a failed execution returns", async ({
  page,
}) => {
  const state = await fixture(page);
  await allOrders(page);
  await fillClearance(page);
  state.jobs[3].history.push({
    at,
    event: "owner_recovery",
    reason: "Cleared in another owner view",
  });
  await state.refresh();
  await expect(
    orderFor(page, 3).getByLabel("Clearance reason", { exact: true }),
  ).toHaveCount(0);
  state.jobs[3].history = [];
  state.jobs[3].attemptId = "new_failed_execution";
  await state.refresh();
  await expect(
    orderFor(page, 3).getByRole("checkbox", {
      name: "I inspected and cleared the output area.",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    orderFor(page, 3).getByLabel("Clearance reason", { exact: true }),
  ).toHaveValue("");
  await reloadWithoutWarning(page);
  expect(state.mutations).toEqual([]);
});

test("failed review keeps its exact draft and warns while hidden; explicit discard disarms every action draft", async ({
  page,
}) => {
  const state = await fixture(page);
  await allOrders(page);
  await fillReview(page);
  state.fail = true;
  await orderFor(page, 2)
    .getByRole("button", { name: "Record reviewed result", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Isolated action reply unavailable",
  );
  await pageAwayAndBack(page);
  await expect(
    orderFor(page, 2).getByLabel("Reviewed result", { exact: true }),
  ).toHaveValue("fail");
  await expect(
    orderFor(page, 2).getByLabel("Reason for decision", { exact: true }),
  ).toHaveValue("Visible output needs an operator decision before release.");
  await page
    .getByLabel("Find an order", { exact: true })
    .fill("Action draft order 9");
  await cancelDocumentChange(page);
  await page.getByLabel("Find an order", { exact: true }).fill("");
  await checklist(page);
  await orderFor(page, 1)
    .getByLabel("Pickup code", { exact: true })
    .fill("discard-this-code");
  await fillClearance(page);
  await orderFor(page, 0)
    .getByRole("button", { name: "Reset preparation checks", exact: true })
    .click();
  await orderFor(page, 1)
    .getByRole("button", { name: "Discard pickup code", exact: true })
    .click();
  await orderFor(page, 2)
    .getByRole("button", { name: "Discard review draft", exact: true })
    .click();
  await orderFor(page, 3)
    .getByRole("button", { name: "Discard clearance draft", exact: true })
    .click();
  await expectNoPreparation(page);
  await reloadWithoutWarning(page);
  expect(state.mutations).toHaveLength(1);
});

test("accepted review clears only its decision draft while unrelated preparation remains unsaved", async ({
  page,
}) => {
  const state = await fixture(page);
  await checklist(page);
  await fillReview(page);
  state.accept = true;
  await orderFor(page, 2)
    .getByRole("button", { name: "Record reviewed result", exact: true })
    .click();
  await expect(
    orderFor(page, 2).getByRole("button", {
      name: "Discard review draft",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    orderFor(page, 2).getByLabel("Reason for decision", { exact: true }),
  ).toHaveValue("");
  await expect(
    orderFor(page, 0).getByRole("button", {
      name: "Mark ready for pickup",
      exact: true,
    }),
  ).toBeEnabled();
  await pageAwayAndBack(page);
  await cancelDocumentChange(page);
  await orderFor(page, 0)
    .getByRole("button", { name: "Reset preparation checks", exact: true })
    .click();
  await reloadWithoutWarning(page);
  expect(state.mutations).toEqual([
    {
      path: "/api/owner/jobs/owner_action_2/review",
      body: {
        result: "fail",
        reason: "Visible output needs an operator decision before release.",
      },
    },
  ]);
});

test("cached handoff and review drafts reflow at320px with usable discard controls", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 664 });
  const state = await fixture(page);
  await allOrders(page);
  await orderFor(page, 1)
    .getByLabel("Pickup code", { exact: true })
    .fill("CODE-KEEP-72");
  await fillReview(page);
  await pageAwayAndBack(page);
  const pickup = orderFor(page, 1).getByLabel("Pickup code", { exact: true });
  await pickup.focus();
  await expect(pickup).toHaveValue("CODE-KEEP-72");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await orderFor(page, 1)
    .getByRole("button", { name: "Discard pickup code", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("overnight-owner-action-drafts-320.png"),
  });
  await orderFor(page, 1)
    .getByRole("button", { name: "Discard pickup code", exact: true })
    .click();
  await expect(pickup).toHaveValue("");
  expect(state.mutations).toEqual([]);
});
