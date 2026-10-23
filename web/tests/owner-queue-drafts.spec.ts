import { test, expect, type Page, type Dialog } from "@playwright/test";

async function fixture(page: Page) {
  const at = "2026-10-23T10:00:00.000Z";
  const jobs = Array.from({ length: 9 }, (_, index) => ({
    id: `queue_draft_${index}`,
    version: 1,
    specVersion: 1,
    createdAt: new Date(Date.parse(at) - index * 1000).toISOString(),
    updatedAt: at,
    spec: {
      assetIds: [],
      intent: `Draft order ${index}`,
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    productionState: "produced",
    paymentState: "release_pending",
    fulfillmentState: "awaiting_owner",
    history: [],
    economics: {
      consumablesCents: 20,
      machineSeconds: 8,
      handlingSeconds: 12,
      failedAttempts: 0,
      apiCostCents: 2,
      machineCostCents: 5,
      recordedAt: at,
    },
    quote: {
      id: `queue_quote_${index}`,
      version: 1,
      expiresAt: at,
      items: [],
      totalCents: 75,
      ownerCents: 60,
      platformCents: 15,
      currency: "USD",
      paymentMode: "testnet",
      collectionPoint: "Isolated desk",
    },
  }));
  const mutations: string[] = [];
  const state = {
    jobs,
    mutations,
    revision: 1,
    failReads: false,
    acceptSaves: false,
    legacyState: false,
    noEligibleOperation: false,
    owner: true,
    allowLogin: false,
    ownerId: "queue_draft_owner",
  };
  await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:4317\//, () => {});
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      mutations.push(path);
      if (path === "/api/session" && state.allowLogin) {
        state.owner = true;
        state.ownerId = "queue_reauthenticated_owner";
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ role: "owner", id: state.ownerId }),
        });
      }
      if (state.acceptSaves) {
        const body = route.request().postDataJSON();
        if (path.endsWith("/economics"))
          jobs[0].economics = {
            ...jobs[0].economics,
            ...body,
            recordedAt: "2026-10-23T10:01:00.000Z",
          };
        else if (path.endsWith("/payment-reference"))
          jobs[0].paymentState = "released";
        else
          return route.fulfill({
            status: 405,
            body: "Unknown fixture mutation.",
          });
        state.revision++;
        state.failReads = true;
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ job: jobs[0] }),
        });
      }
      return route.fulfill({
        status: 405,
        body: "No mutation allowed in queue draft fixture.",
      });
    }
    if (path === "/api/owner/dashboard" && (!state.owner || state.failReads))
      return route.fulfill({
        status: state.owner ? 503 : 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Isolated owner dashboard unavailable." },
        }),
      });
    const body =
      path === "/api/health"
        ? {
            mode: "simulation",
            paymentMode: "testnet",
            store: "queue-draft-fixture",
          }
        : path === "/api/session"
          ? { role: state.owner ? "owner" : null, id: state.ownerId }
          : path === "/api/owner/dashboard"
            ? {
                revision: state.revision,
                machines: [],
                jobs,
                ledger: state.noEligibleOperation
                  ? []
                  : jobs.map((job) => ({
                      id: `release_${job.id}`,
                      jobId: job.id,
                      mode: "testnet",
                      kind: "release",
                      ...(state.legacyState
                        ? { state: "pending" }
                        : { status: "pending" }),
                      receipt: { status: "pending" },
                    })),
              }
            : null;
    if (path === "/api/events")
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": queue draft fixture\n\n",
      });
    return route.fulfill({
      status: body ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(
        body || { error: { message: "Unknown isolated fixture read." } },
      ),
    });
  });
  await page.goto("/owner");
  await expect(
    page.locator('[data-owner-order="queue_draft_0"]'),
  ).toBeVisible();
  return state;
}
function orderFor(page: Page, index = 0) {
  return page.locator(`[data-owner-order="queue_draft_${index}"]`);
}
const hash = "0x" + "b".repeat(64);
async function fillDrafts(page: Page, { trial = true, payment = true } = {}) {
  const order = orderFor(page);
  if (trial) {
    await order
      .getByText("Trial costs & handling time", { exact: true })
      .click();
    const trial = order.getByLabel("Consumables (USD cents)", { exact: true });
    await trial.fill("31");
  }
  if (!payment) return;
  await order
    .getByLabel("Pending test payment operation", { exact: true })
    .selectOption("release_queue_draft_0");
  await order
    .getByLabel("Confirmed Base Sepolia transaction hash", { exact: true })
    .fill(hash);
  await order
    .getByLabel("Payment recovery reason", { exact: true })
    .fill("Observed reference remains an unsaved owner draft.");
}
async function expectDrafts(page: Page) {
  const order = orderFor(page);
  const observed = {
    trial: await order.locator(".trial-economics input").first().inputValue(),
    reference: await order
      .getByLabel("Confirmed Base Sepolia transaction hash", { exact: true })
      .inputValue(),
  };
  expect(observed).toEqual({ trial: "31", reference: hash });
}
async function identity(page: Page) {
  return page.evaluate(() => {
    const view = window as Window & { __queueDraftDocument?: string };
    return (view.__queueDraftDocument ??= crypto.randomUUID());
  });
}
async function cancelLeaving(page: Page) {
  const before = await identity(page);
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
    expect(dialogs).toEqual(["beforeunload"]);
    expect(await identity(page)).toBe(before);
  } finally {
    page.off("dialog", handle);
  }
}
async function reloadWithoutWarning(page: Page) {
  const before = await identity(page);
  const dialogs: string[] = [];
  const handle = async (dialog: Dialog) => {
    dialogs.push(dialog.type());
    await dialog.accept();
  };
  page.on("dialog", handle);
  try {
    await page.reload();
    await expect.poll(() => identity(page)).not.toBe(before);
    expect(dialogs).toEqual([]);
  } finally {
    page.off("dialog", handle);
  }
}

test("unsaved trial and payment references survive explicit queue paging without a mutation (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await fillDrafts(page);
  await page.getByRole("button", { name: "Next orders", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Order pages" }),
  ).toContainText("Page 2 of 2");
  await cancelLeaving(page);
  await page
    .getByRole("button", { name: "Previous orders", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Order pages" }),
  ).toContainText("Page 1 of 2");
  await expectDrafts(page);
  expect(state.mutations).toEqual([]);
});

test("queue search and filters preserve each order's own drafts (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await fillDrafts(page);
  const search = page.getByLabel("Find an order", { exact: true });
  await search.fill("Draft order 1");
  const other = orderFor(page, 1);
  await expect(
    other.getByLabel("Confirmed Base Sepolia transaction hash", {
      exact: true,
    }),
  ).toHaveValue("");
  await other.getByText("Trial costs & handling time", { exact: true }).click();
  await expect(
    other.getByLabel("Consumables (USD cents)", { exact: true }),
  ).toHaveValue("20");
  await other.getByLabel("Consumables (USD cents)", { exact: true }).fill("44");
  await search.fill("");
  await expectDrafts(page);
  await page
    .getByLabel("Show orders", { exact: true })
    .selectOption("completed");
  await expect(page.locator(".owner-job")).toHaveCount(0);
  await page.getByLabel("Show orders", { exact: true }).selectOption("all");
  await expectDrafts(page);
  await expect(other.locator(".trial-economics input").first()).toHaveValue(
    "44",
  );
  expect(state.mutations).toEqual([]);
});

test("discard clears only its draft and unmounted payment work still warns until discarded (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await fillDrafts(page);
  await orderFor(page)
    .getByRole("button", { name: "Discard trial edits", exact: true })
    .click();
  await page.getByRole("button", { name: "Next orders", exact: true }).click();
  await cancelLeaving(page);
  await page
    .getByRole("button", { name: "Previous orders", exact: true })
    .click();
  await orderFor(page)
    .getByRole("button", { name: "Discard payment draft", exact: true })
    .click();
  await expect(
    orderFor(page).locator(".trial-economics input").first(),
  ).toHaveValue("20");
  await reloadWithoutWarning(page);
  expect(state.mutations).toEqual([]);
});

test("accepted trial and payment saves survive failed refresh and remount without a false dirty warning (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  state.acceptSaves = true;
  await fillDrafts(page);
  await orderFor(page)
    .getByRole("button", { name: "Save trial measurements", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "accepted" }),
  ).toContainText("latest workshop state could not be loaded");
  await orderFor(page)
    .getByRole("button", {
      name: "Validate confirmed transaction reference",
      exact: true,
    })
    .click();
  await expect.poll(() => state.mutations.length).toBe(2);
  await expect(
    orderFor(page).getByLabel("Confirmed Base Sepolia transaction hash", {
      exact: true,
    }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "Next orders", exact: true }).click();
  await page
    .getByRole("button", { name: "Previous orders", exact: true })
    .click();
  await expect(
    orderFor(page).locator(".trial-economics input").first(),
  ).toHaveValue("31");
  await reloadWithoutWarning(page);
  expect(state.mutations).toHaveLength(2);
});

for (const resolution of ["settled", "ineligible"] as const)
  test(`unmounted ${resolution} payment draft no longer traps navigation (offline fixture)`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await fillDrafts(page, { trial: false });
    await page
      .getByRole("button", { name: "Next orders", exact: true })
      .click();
    if (resolution === "settled") state.jobs[0].paymentState = "released";
    else state.noEligibleOperation = true;
    state.revision++;
    await expect.poll(() => page.locator(".owner-job").count()).toBe(1);
    await page
      .getByRole("tab", { name: "Machines & policy", exact: true })
      .click();
    await expect
      .poll(() =>
        page.getByRole("button", { name: "Next orders", exact: true }).count(),
      )
      .toBe(0);
    // The normal owner refresh is bounded at three seconds; wait for its changed
    // records to reconcile the unmounted draft before testing actual navigation.
    await page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/owner/dashboard") &&
        response.status() === 200,
    );
    await reloadWithoutWarning(page);
    expect(state.mutations).toEqual([]);
  });

test("legacy pending record state keeps a valid unmounted payment draft after refresh (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await fillDrafts(page, { trial: false });
  await page.getByRole("button", { name: "Next orders", exact: true }).click();
  state.legacyState = true;
  state.revision++;
  await page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/owner/dashboard") &&
      response.status() === 200,
  );
  await page
    .getByRole("button", { name: "Previous orders", exact: true })
    .click();
  await expect(
    orderFor(page).getByLabel("Confirmed Base Sepolia transaction hash", {
      exact: true,
    }),
  ).toHaveValue(hash);
  await cancelLeaving(page);
  expect(state.mutations).toEqual([]);
});

test("a newer trial record preserves an unmounted edit until the owner explicitly uses the saved measurements (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await fillDrafts(page, { payment: false });
  await page.getByRole("button", { name: "Next orders", exact: true }).click();
  state.jobs[0].economics = {
    ...state.jobs[0].economics,
    consumablesCents: 44,
    recordedAt: "2026-10-23T10:02:00.000Z",
  };
  state.revision++;
  await page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/owner/dashboard") &&
      response.status() === 200,
  );
  await page
    .getByRole("button", { name: "Previous orders", exact: true })
    .click();
  const order = orderFor(page);
  await order.getByText("Trial costs & handling time", { exact: true }).click();
  await expect(
    order.getByLabel("Consumables (USD cents)", { exact: true }),
  ).toHaveValue("31");
  await expect(order.getByRole("status")).toContainText(
    "New saved measurements are available",
  );
  await order
    .getByRole("button", { name: "Use saved measurements", exact: true })
    .click();
  await expect(
    order.getByLabel("Consumables (USD cents)", { exact: true }),
  ).toHaveValue("44");
  await reloadWithoutWarning(page);
  expect(state.mutations).toEqual([]);
});

test("failed trial and payment saves retain dirty drafts over a queue remount without claiming saved state was unchanged (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await fillDrafts(page);
  const order = orderFor(page);
  await order
    .getByRole("button", { name: "Save trial measurements", exact: true })
    .click();
  await expect(order.getByRole("alert")).toContainText(
    "could not be confirmed here",
  );
  await order
    .getByRole("button", {
      name: "Validate confirmed transaction reference",
      exact: true,
    })
    .click();
  await expect(
    order.getByRole("alert").filter({ hasText: "reference" }),
  ).toContainText("was not confirmed here");
  await page.getByRole("button", { name: "Next orders", exact: true }).click();
  await cancelLeaving(page);
  await page
    .getByRole("button", { name: "Previous orders", exact: true })
    .click();
  await expectDrafts(page);
  expect(state.mutations).toHaveLength(2);
  expect(state.jobs[0].economics.consumablesCents).toBe(20);
  expect(state.jobs[0].paymentState).toBe("release_pending");
});

test("owner expiry removes cached private drafts before reauthentication and clears old dirty warnings (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await fillDrafts(page);
  await page.getByRole("button", { name: "Next orders", exact: true }).click();
  state.owner = false;
  await expect(
    page.getByLabel("Owner access code", { exact: true }),
  ).toBeVisible();
  state.allowLogin = true;
  await page
    .getByLabel("Owner access code", { exact: true })
    .fill("isolated-owner-reentry");
  await page
    .getByRole("button", { name: "Open owner workshop", exact: true })
    .click();
  const order = orderFor(page);
  await expect(order).toBeVisible();
  await order.getByText("Trial costs & handling time", { exact: true }).click();
  await expect(
    order.getByLabel("Consumables (USD cents)", { exact: true }),
  ).toHaveValue("20");
  await expect(
    order.getByLabel("Confirmed Base Sepolia transaction hash", {
      exact: true,
    }),
  ).toHaveValue("");
  await expect(
    order.getByLabel("Payment recovery reason", { exact: true }),
  ).toHaveValue("");
  await expect(
    order.getByLabel("Pending test payment operation", { exact: true }),
  ).toHaveValue("");
  await reloadWithoutWarning(page);
  expect(state.mutations).toEqual(["/api/session"]);
});
