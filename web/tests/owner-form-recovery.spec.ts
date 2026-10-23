import {
  test,
  expect,
  type Page,
  type Route,
  type Dialog,
} from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:4317\//, () => {});
});

const recordedAt = "2026-10-23T09:30:00.000Z";
const initialMachine = () => ({
  id: "phomemo_form_fixture",
  name: "Owner form printer",
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
  reason: "Fixture only; no real device",
  mediaRemaining: 42,
  material: "thermal-paper",
  priceCard: { consumables: 20, machine: 10, handling: 30, platform: 15 },
  hours: { start: 0, end: 24 },
  maxJobSeconds: 120,
  collectionPoint: "East collection counter",
  policy: { authorizedArtwork: true, maxQuantity: 10 },
  ownerAddress: "",
});
const initialEconomics = () => ({
  consumablesCents: 20,
  machineSeconds: 8,
  handlingSeconds: 12,
  failedAttempts: 0,
  apiCostCents: 2,
  machineCostCents: 5,
  ownerNetCents: 35,
  platformMarginCents: 13,
  ownerEarningsPerHandlingMinuteCents: 175,
  recordedAt,
});
const initialJob = () => ({
  id: "owner_form_job",
  specVersion: 1,
  version: 1,
  createdAt: recordedAt,
  updatedAt: recordedAt,
  spec: {
    assetIds: [],
    intent: "Owner forms isolated recovery fixture",
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
  economics: initialEconomics(),
  quote: {
    id: "owner_form_quote",
    version: 1,
    expiresAt: "2026-10-23T10:30:00.000Z",
    items: [],
    totalCents: 75,
    ownerCents: 60,
    platformCents: 15,
    currency: "USD",
    paymentMode: "testnet",
    collectionPoint: "Fixture collection counter",
  },
});
async function fixture(
  page: Page,
  custom?: (route: Route, path: string) => Promise<boolean>,
) {
  const machine = initialMachine();
  const job = initialJob();
  let revision = 1;
  await page.addInitScript(() => {
    const listeners: Array<() => void> = [];
    class OwnerFormEvents {
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onerror: (() => void) | null = null;
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
      value: OwnerFormEvents,
    });
    (window as any).refreshOwnerFormFixture = () =>
      listeners.forEach((listener) => listener());
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (custom && (await custom(route, path))) return;
    const body =
      path === "/api/health"
        ? {
            mode: "simulation",
            paymentMode: "testnet",
            store: "owner-form-ui-fixture",
          }
        : path === "/api/session"
          ? { role: "owner", id: "owner_form_fixture" }
          : path === "/api/owner/dashboard"
            ? {
                revision,
                machines: [machine],
                jobs: [job],
                ledger: [
                  {
                    id: "saved_release_fixture",
                    jobId: job.id,
                    mode: "testnet",
                    kind: "release",
                    status: "pending",
                    receipt: { status: "pending" },
                  },
                ],
              }
            : null;
    await route.fulfill({
      status: body ? 200 : 405,
      contentType: "application/json",
      body: JSON.stringify(
        body || {
          error: { message: "Only isolated form fixture requests are allowed" },
        },
      ),
    });
  });
  await page.goto("/owner");
  await expect(
    page.getByRole("heading", {
      name: "Keep the counter moving.",
      exact: true,
    }),
  ).toBeVisible();
  return {
    machine,
    job,
    refresh: async () => {
      revision++;
      await page.evaluate(() => (window as any).refreshOwnerFormFixture());
    },
  };
}
async function machineForm(page: Page) {
  await page
    .getByRole("tab", { name: "Machines & policy", exact: true })
    .click();
  await page
    .getByText("Media, prices, hours & policy", { exact: true })
    .click();
  return page.locator(".machine-settings form");
}
async function documentIdentity(page: Page) {
  return page.evaluate(() => {
    const target = window as Window & { __ownerFormDocument?: string };
    target.__ownerFormDocument ??= crypto.randomUUID();
    return target.__ownerFormDocument;
  });
}
async function cancelledOwnerNavigation(page: Page) {
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
  await expect(page.locator(".machine-settings form")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByRole("button", { name: "Discard machine edits", exact: true }),
  ).toHaveCount(0);
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

test("failed machine saves keep all changes through owner view switches and allow an exact retry", async ({
  page,
}) => {
  const attempts: any[] = [];
  const state = await fixture(page, async (route, path) => {
    if (!path.endsWith("/machines/phomemo_form_fixture")) return false;
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            message:
              "Settings were not saved. Retry after the fixture service recovers.",
          },
        }),
      });
    else {
      Object.assign(state.machine, attempts.at(-1));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ machine: state.machine }),
      });
    }
    return true;
  });
  const form = await machineForm(page);
  await form
    .getByLabel("Collection point", { exact: true })
    .fill("West counter — unsaved draft");
  await form.getByLabel("Consumables", { exact: true }).fill("37");
  await form.getByLabel("Maximum quantity per job", { exact: true }).fill("4");
  await form
    .getByLabel("List this machine for requester discovery", { exact: true })
    .uncheck();
  await form
    .getByRole("button", { name: "Save machine settings", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Settings were not saved",
  );
  await cancelledOwnerNavigation(page);
  await expect(
    form.getByLabel("Collection point", { exact: true }),
  ).toHaveValue("West counter — unsaved draft");
  await page.getByRole("tab", { name: "Payment records", exact: true }).click();
  await page
    .getByRole("tab", { name: "Orders & handling", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Machines & policy", exact: true })
    .click();
  await expect(
    form.getByLabel("Collection point", { exact: true }),
  ).toBeVisible();
  await expect(
    form.getByLabel("Collection point", { exact: true }),
  ).toHaveValue("West counter — unsaved draft");
  await expect(form.getByLabel("Consumables", { exact: true })).toHaveValue(
    "37",
  );
  await expect(
    form.getByLabel("List this machine for requester discovery", {
      exact: true,
    }),
  ).not.toBeChecked();
  await form
    .getByRole("button", { name: "Save machine settings", exact: true })
    .click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[1].priceCard.consumables).toBe(37);
  expect(attempts[1].policy.maxQuantity).toBe(4);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await reloadWithoutWarning(page);
});

test("owner numeric fields support keyboard clear and type without turning an empty value into zero", async ({
  page,
}) => {
  let mutations = 0;
  await fixture(page, async (route, path) => {
    if (!path.endsWith("/machines/phomemo_form_fixture")) return false;
    mutations++;
    await route.fulfill({ status: 405, body: "No mutation expected" });
    return true;
  });
  const form = await machineForm(page);
  for (const [label, value] of [
    ["Media remaining (estimated)", "12"],
    ["Maximum job time (seconds)", "75"],
    ["Maximum quantity per job", "3"],
    ["Consumables", "0"],
    ["Machine", "4"],
    ["Handling", "5"],
    ["Platform", "6"],
  ]) {
    const input = form.getByLabel(label, { exact: true });
    await input.focus();
    await input.press("ControlOrMeta+A");
    await input.press("Backspace");
    await expect(input).toHaveValue("");
    await form
      .getByRole("button", { name: "Save machine settings", exact: true })
      .click();
    expect(mutations).toBe(0);
    await input.pressSequentially(value);
    await expect(input).toHaveValue(value);
  }
});

test("payment and trial drafts survive view switches without authorizing or saving anything", async ({
  page,
}) => {
  const mutationPaths: string[] = [];
  await fixture(page, async (route, path) => {
    if (route.request().method() === "GET") return false;
    mutationPaths.push(path);
    await route.fulfill({ status: 405, body: "No mutation expected" });
    return true;
  });
  const recovery = page.getByRole("form", {
    name: "Resolve pending test payment",
    exact: true,
  });
  await recovery
    .getByLabel("Pending test payment operation", { exact: true })
    .selectOption("saved_release_fixture");
  const hash = "0x" + "a".repeat(64);
  await recovery
    .getByLabel("Confirmed Base Sepolia transaction hash", { exact: true })
    .fill(hash);
  await recovery
    .getByLabel("Payment recovery reason", { exact: true })
    .fill("Observed reference retained while checking payment records.");
  await page.getByText("Trial costs & handling time", { exact: true }).click();
  const trial = page.getByRole("form", {
    name: "Record trial costs and handling",
    exact: true,
  });
  await trial.getByLabel("Consumables (USD cents)", { exact: true }).fill("31");
  await page.getByRole("tab", { name: "Payment records", exact: true }).click();
  await expect(trial).toBeHidden();
  await page.getByRole("tab", { name: "Payment records", exact: true }).focus();
  for (let step = 0; step < 14; step++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => document.activeElement?.closest('[role="tabpanel"]')?.id || "",
      ),
    ).not.toMatch(/^owner-(queue|machines)$/);
  }
  await page
    .getByRole("tab", { name: "Machines & policy", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Orders & handling", exact: true })
    .click();
  await expect(
    recovery.getByLabel("Confirmed Base Sepolia transaction hash", {
      exact: true,
    }),
  ).toHaveValue(hash);
  await expect(
    recovery.getByLabel("Payment recovery reason", { exact: true }),
  ).toHaveValue("Observed reference retained while checking payment records.");
  await expect(
    trial.getByLabel("Consumables (USD cents)", { exact: true }),
  ).toBeVisible();
  await expect(
    trial.getByLabel("Consumables (USD cents)", { exact: true }),
  ).toHaveValue("31");
  expect(mutationPaths).toEqual([]);
});

test("a newer saved trial does not overwrite in-progress measured edits", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByText("Trial costs & handling time", { exact: true }).click();
  const input = page.getByLabel("Consumables (USD cents)", { exact: true });
  await input.fill("31");
  state.job.economics = {
    ...state.job.economics,
    consumablesCents: 44,
    ownerNetCents: 14,
    recordedAt: "2026-10-23T09:31:00.000Z",
  };
  await state.refresh();
  await expect(page.locator(".trial-summary")).toContainText("$0.14");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(input).toHaveValue("31");
});

test("a pending machine save locks submitted fields so late typing cannot disappear after confirmation", async ({
  page,
}) => {
  let pending: Route | null = null;
  let payload: any;
  const state = await fixture(page, async (route, path) => {
    if (!path.endsWith("/machines/phomemo_form_fixture")) return false;
    payload = route.request().postDataJSON();
    pending = route;
    return true;
  });
  const form = await machineForm(page);
  const collection = form.getByLabel("Collection point", { exact: true });
  await collection.fill("Submitted collection desk");
  await form
    .getByRole("button", { name: "Save machine settings", exact: true })
    .click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(collection).toBeDisabled();
  await cancelledOwnerNavigation(page);
  Object.assign(state.machine, payload);
  await pending!.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ machine: state.machine }),
  });
  await expect(collection).toBeEnabled();
  await expect(collection).toHaveValue("Submitted collection desk");
  await reloadWithoutWarning(page);
});

test("discarding machine edits restores saved values and disarms document navigation protection", async ({
  page,
}) => {
  await fixture(page);
  const form = await machineForm(page);
  const collection = form.getByLabel("Collection point", { exact: true });
  await collection.fill("Keep this unsaved desk until discarded");
  await cancelledOwnerNavigation(page);
  await expect(collection).toHaveValue(
    "Keep this unsaved desk until discarded",
  );
  await form
    .getByRole("button", { name: "Discard machine edits", exact: true })
    .click();
  await expect(collection).toHaveValue("East collection counter");
  await reloadWithoutWarning(page);
});

test("clearing a configured test payout address sends an explicit removal and stays blank after refresh", async ({
  page,
}) => {
  let submitted: any;
  const state = await fixture(page, async (route, path) => {
    if (!path.endsWith("/machines/phomemo_form_fixture")) return false;
    submitted = route.request().postDataJSON();
    Object.assign(state.machine, submitted, { ownerAddress: "" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ machine: state.machine }),
    });
    return true;
  });
  state.machine.ownerAddress = "0x" + "1".repeat(40);
  await state.refresh();
  const form = await machineForm(page);
  const address = form.getByLabel("Owner test payout address", { exact: true });
  await expect(address).toHaveValue(state.machine.ownerAddress);
  await address.focus();
  await address.press("ControlOrMeta+A");
  await address.press("Backspace");
  await form
    .getByRole("button", { name: "Save machine settings", exact: true })
    .click();
  await expect.poll(() => submitted?.ownerAddress).toBe(null);
  await expect(address).toHaveValue("");
  await reloadWithoutWarning(page);
  const refreshed = await machineForm(page);
  await expect(
    refreshed.getByLabel("Owner test payout address", { exact: true }),
  ).toHaveValue("");
});

test("a committed machine save survives a failed dashboard refresh without reverting to old values", async ({
  page,
}) => {
  let readsUnavailable = false;
  let saves = 0;
  const state = await fixture(page, async (route, path) => {
    if (path === "/api/owner/dashboard" && readsUnavailable) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Saved dashboard is temporarily unavailable" },
        }),
      });
      return true;
    }
    if (!path.endsWith("/machines/phomemo_form_fixture")) return false;
    saves++;
    Object.assign(state.machine, route.request().postDataJSON());
    readsUnavailable = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ machine: state.machine }),
    });
    return true;
  });
  const form = await machineForm(page);
  const collection = form.getByLabel("Collection point", { exact: true });
  await collection.fill("Accepted west-side collection desk");
  await form
    .getByRole("button", { name: "Save machine settings", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Workshop updates are disconnected",
  );
  await expect(collection).toHaveValue("Accepted west-side collection desk");
  await expect(
    page.getByRole("status").filter({ hasText: "accepted" }),
  ).toContainText("latest workshop state could not be loaded");
  expect(saves).toBe(1);
  readsUnavailable = false;
  await state.refresh();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(collection).toHaveValue("Accepted west-side collection desk");
  expect(saves).toBe(1);
});
