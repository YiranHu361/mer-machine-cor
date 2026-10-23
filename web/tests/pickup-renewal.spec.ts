import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}
function makeState() {
  const time = Date.now();
  const job: any = {
    id: "pickup_primary",
    requesterId: "pickup_requester",
    version: 7,
    specVersion: 1,
    machineId: "busy_elsewhere",
    attemptId: "pickup_attempt",
    createdAt: new Date(time - 7200000).toISOString(),
    updatedAt: new Date(time - 3600000).toISOString(),
    spec: {
      assetIds: ["pickup_art"],
      intent: "Stored item awaiting collection",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    artifact: { id: "pickup_art", url: pixel, sha256: "a".repeat(64) },
    productionState: "produced",
    paymentState: "released",
    fulfillmentState: "ready_for_pickup",
    history: [],
    pickup: {
      code: "ORIGINAL_CODE",
      expiresAt: new Date(time - 1000).toISOString(),
    },
    quote: {
      id: "pickup_quote",
      version: 1,
      expiresAt: new Date(time - 7000000).toISOString(),
      items: [],
      totalCents: 75,
      ownerCents: 60,
      platformCents: 15,
      currency: "USD",
      paymentMode: "mock",
      collectionPoint: "Offline collection desk",
    },
  };
  return {
    job,
    time,
    serverNow: time,
    revision: 1,
    jobs: [job] as any[],
    renewals: [] as any[],
    mutations: [] as string[],
    mode: "success" as
      "success" | "fail" | "lost" | "held" | "wrong-id" | "wrong-record",
    held: [] as Route[],
    failReads: false,
  };
}
type State = ReturnType<typeof makeState>;
function applyRenewal(state: State, body: any) {
  const j = state.job;
  const prior = j.pickupRenewals?.find(
    (r: any) => r.key === body.idempotencyKey,
  );
  if (prior) {
    if (
      prior.expectedVersion !== body.expectedVersion ||
      prior.expectedExpiresAt !== body.expectedExpiresAt
    )
      throw new Error("IDEMPOTENCY_CONFLICT");
    return;
  }
  if (j.fulfillmentState !== "ready_for_pickup" || j.pickup.redeemedAt)
    throw new Error("PICKUP_UNAVAILABLE");
  if (
    j.version !== body.expectedVersion ||
    j.pickup.expiresAt !== body.expectedExpiresAt
  )
    throw new Error("PICKUP_CHANGED");
  if (Date.parse(j.pickup.expiresAt) > state.serverNow)
    throw new Error("PICKUP_NOT_EXPIRED");
  j.version++;
  j.pickup = {
    code: `RENEWED_CODE_${j.version}`,
    expiresAt: new Date(state.serverNow + 3600000).toISOString(),
  };
  j.pickupRenewals ??= [];
  j.pickupRenewals.push({
    key: body.idempotencyKey,
    expectedVersion: body.expectedVersion,
    expectedExpiresAt: body.expectedExpiresAt,
    renewedAt: new Date(state.serverNow).toISOString(),
  });
  state.revision++;
}
async function finish(state: State, route: Route) {
  const body = route.request().postDataJSON();
  if (state.mode === "fail")
    return json(
      route,
      {
        error: {
          code: "TEMPORARILY_UNAVAILABLE",
          message: "Renewal reply unavailable",
        },
      },
      503,
    );
  try {
    applyRenewal(state, body);
  } catch (e) {
    return json(
      route,
      {
        error: {
          code: (e as Error).message,
          message: "The saved pickup state must be checked.",
        },
      },
      409,
    );
  }
  if (state.mode === "lost")
    return json(
      route,
      { error: { message: "Saved renewal acknowledgement unavailable" } },
      500,
    );
  const result = structuredClone(state.job);
  if (state.mode === "wrong-id") result.id = "some_other_job";
  if (state.mode === "wrong-record")
    result.pickupRenewals[0].key = "another_request_key";
  return json(route, { job: result });
}
async function mount(
  page: Page,
  state: State,
  role: "owner" | "requester" = "owner",
) {
  await page.addInitScript((id) => {
    localStorage.setItem("fabrary-current-job", id);
    const handlers: Array<() => void> = [];
    class Events {
      onopen: (() => void) | null = null;
      constructor() {
        queueMicrotask(() => this.onopen?.());
      }
      addEventListener(name: string, fn: () => void) {
        if (name === "refresh") handlers.push(fn);
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: Events });
    (window as any).refreshPickupFixture = () => handlers.forEach((fn) => fn());
  }, state.job.id);
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      state.mutations.push(path);
      if (path.endsWith("/renew-pickup")) {
        state.renewals.push(route.request().postDataJSON());
        if (state.mode === "held") {
          state.held.push(route);
          return;
        }
        return finish(state, route);
      }
      if (path.endsWith("/redeem")) {
        const code = route.request().postDataJSON().code;
        if (
          state.job.fulfillmentState !== "ready_for_pickup" ||
          state.job.pickup.redeemedAt
        )
          return json(
            route,
            { error: { code: "PICKUP_USED", message: "Already collected" } },
            409,
          );
        if (code !== state.job.pickup.code)
          return json(
            route,
            {
              error: { code: "PICKUP_INVALID", message: "Code does not match" },
            },
            403,
          );
        state.job.fulfillmentState = "collected";
        state.job.pickup.redeemedAt = new Date(state.serverNow).toISOString();
        state.job.version++;
        state.revision++;
        return json(route, { job: state.job });
      }
      return json(
        route,
        {
          error: {
            message: "No production, machine or payment mutations allowed",
          },
        },
        405,
      );
    }
    if (path === "/api/health")
      return json(route, {
        mode: "simulation",
        paymentMode: "mock",
        store: "pickup-renewal-isolated-ui",
      });
    if (path === "/api/session")
      return json(route, {
        role,
        id: role === "owner" ? "pickup_owner" : "pickup_requester",
      });
    if (path === "/api/owner/dashboard")
      return state.failReads
        ? json(
            route,
            { error: { message: "Saved pickup read unavailable" } },
            503,
          )
        : json(route, {
            revision: state.revision,
            machines: [],
            jobs: state.jobs,
            ledger: [],
          });
    if (path === "/api/jobs")
      return json(route, { revision: state.revision, jobs: [state.job] });
    if (path === "/api/machines")
      return json(route, { revision: 1, machines: [] });
    if (path === "/api/catalog") return json(route, { models: [] });
    return json(
      route,
      { error: { message: "No external reads in this fixture" } },
      404,
    );
  });
  await page.goto(role === "owner" ? "/owner" : "/");
  if (role === "owner") {
    await page.getByLabel("Show orders", { exact: true }).selectOption("all");
    await expect(order(page)).toBeVisible();
  } else await expect(page.locator(".pickup")).toBeVisible();
}
const order = (page: Page) =>
  page.locator('[data-owner-order="pickup_primary"]');
const panel = (page: Page) => order(page).locator(".owner-pickup");
const renew = (page: Page) =>
  panel(page).getByRole("button", {
    name: "Renew expired pickup code",
    exact: true,
  });
const recovery = (page: Page) => panel(page).locator(".pickup-recovery");
async function check(page: Page) {
  const button = recovery(page).getByRole("button", {
    name: "Check pickup status",
    exact: true,
  });
  await button.focus();
  await button.press("Enter");
}
async function refreshPage(page: Page) {
  await page.evaluate(() => (window as any).refreshPickupFixture());
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test("clock expiry equality hides requester code and exposes explicit owner renewal without an automatic mutation", async ({
  page,
  context,
}) => {
  const state = makeState();
  state.job.pickup.expiresAt = new Date(state.time + 1000).toISOString();
  await page.clock.install({ time: new Date(state.time) });
  await page.clock.setFixedTime(new Date(state.time));
  await mount(page, state);
  await expect(renew(page)).toHaveCount(0);
  await expect(
    panel(page).getByRole("button", {
      name: "Redeem & record collection",
      exact: true,
    }),
  ).toBeEnabled();
  const requester = await context.newPage();
  await requester.clock.install({ time: new Date(state.time) });
  await requester.clock.setFixedTime(new Date(state.time));
  await mount(requester, state, "requester");
  await expect(requester.locator(".pickup-code")).toHaveText("ORIGINAL_CODE");
  await page.clock.setFixedTime(new Date(state.time + 1000));
  await page.clock.runFor(1000);
  await requester.clock.setFixedTime(new Date(state.time + 1000));
  await requester.clock.runFor(1000);
  await expect(renew(page)).toBeEnabled();
  await expect(
    panel(page).getByRole("button", {
      name: "Redeem & record collection",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    requester.getByRole("heading", {
      name: "Pickup code expired",
      exact: true,
    }),
  ).toBeVisible();
  await expect(requester.locator(".pickup-code")).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});
test("owner renewal sends only the bound original intent and reveals the new code only in the requester pickup view", async ({
  page,
  context,
}) => {
  const state = makeState();
  await mount(page, state);
  await renew(page).focus();
  await renew(page).press("Enter");
  await expect(
    panel(page).getByLabel("Pickup code", { exact: true }),
  ).toBeEnabled();
  await expect(
    panel(page).getByLabel("Pickup code", { exact: true }),
  ).toBeFocused();
  expect(state.renewals).toHaveLength(1);
  expect(Object.keys(state.renewals[0]).sort()).toEqual([
    "expectedExpiresAt",
    "expectedVersion",
    "idempotencyKey",
  ]);
  expect(state.renewals[0].expectedVersion).toBe(7);
  expect(state.renewals[0].idempotencyKey.length).toBeGreaterThanOrEqual(8);
  await expect(panel(page)).not.toContainText(state.job.pickup.code);
  const requester = await context.newPage();
  await mount(requester, state, "requester");
  await expect(requester.locator(".pickup-code")).toHaveText(
    state.job.pickup.code,
  );
  expect(state.mutations).toEqual([
    "/api/owner/jobs/pickup_primary/renew-pickup",
  ]);
});
test("a lost committed renewal recovers by GET without another POST or an old entered code", async ({
  page,
}) => {
  const state = makeState();
  state.job.pickup.expiresAt = new Date(state.time + 1000).toISOString();
  await page.clock.install({ time: new Date(state.time) });
  await page.clock.setFixedTime(new Date(state.time));
  await mount(page, state);
  await panel(page)
    .getByLabel("Pickup code", { exact: true })
    .fill("OLD_ENTERED_CODE");
  await page.clock.setFixedTime(new Date(state.time + 1000));
  await page.clock.runFor(1000);
  state.serverNow = state.time + 1000;
  state.mode = "lost";
  await renew(page).click();
  await expect(recovery(page)).toContainText("Renewal could not be confirmed");
  expect(state.renewals).toHaveLength(1);
  await check(page);
  await expect(
    panel(page).getByLabel("Pickup code", { exact: true }),
  ).toBeEnabled();
  await expect(
    panel(page).getByLabel("Pickup code", { exact: true }),
  ).toHaveValue("");
  await expect(
    panel(page).getByLabel("Pickup code", { exact: true }),
  ).toBeFocused();
  expect(state.renewals).toHaveLength(1);
});
test("an ambiguous uncommitted intent survives queue filtering and only retries explicitly with the exact original body", async ({
  page,
}) => {
  const state = makeState();
  state.mode = "fail";
  await mount(page, state);
  await renew(page).click();
  await expect(recovery(page)).toBeVisible();
  const original = structuredClone(state.renewals[0]);
  await page
    .getByLabel("Show orders", { exact: true })
    .selectOption("production");
  await expect(order(page)).toHaveCount(0);
  await page.getByLabel("Show orders", { exact: true }).selectOption("all");
  await expect(recovery(page)).toBeVisible();
  await expect(renew(page)).toBeDisabled();
  expect(state.renewals).toHaveLength(1);
  await check(page);
  const retry = recovery(page).getByRole("button", {
    name: "Retry pickup code renewal",
    exact: true,
  });
  await expect(retry).toBeEnabled();
  state.mode = "success";
  await retry.focus();
  await retry.press("Enter");
  await expect(
    panel(page).getByLabel("Pickup code", { exact: true }),
  ).toBeEnabled();
  expect(state.renewals).toEqual([original, original]);
});
test("a validated newer version without the original renewal record permits a deliberate fresh intent, never an automatic retry", async ({
  page,
}) => {
  const state = makeState();
  state.mode = "fail";
  await mount(page, state);
  await renew(page).click();
  await expect(recovery(page)).toBeVisible();
  const first = structuredClone(state.renewals[0]);
  state.job.version++;
  state.job.history.push({
    at: new Date(state.serverNow).toISOString(),
    event: "economics_recorded",
    reason: "Another owner saved trial costs",
  });
  state.revision++;
  await check(page);
  await expect(renew(page)).toBeEnabled();
  expect(state.renewals).toHaveLength(1);
  state.mode = "success";
  await renew(page).click();
  await expect(
    panel(page).getByLabel("Pickup code", { exact: true }),
  ).toBeEnabled();
  expect(state.renewals).toHaveLength(2);
  expect(state.renewals[1].idempotencyKey).not.toBe(first.idempotencyKey);
  expect(state.renewals[1].expectedVersion).toBe(8);
  expect(state.renewals[1].expectedExpiresAt).toBe(first.expectedExpiresAt);
});
for (const mode of ["wrong-id", "wrong-record"] as const)
  test(`a ${mode} success reply remains uncertain until current saved pickup is checked`, async ({
    page,
  }) => {
    const state = makeState();
    state.mode = mode;
    await mount(page, state);
    await renew(page).click();
    await expect(recovery(page)).toContainText(
      "Renewal could not be confirmed",
    );
    await expect(renew(page)).toBeDisabled();
    expect(state.renewals).toHaveLength(1);
    await check(page);
    await expect(
      panel(page).getByLabel("Pickup code", { exact: true }),
    ).toBeEnabled();
    expect(state.renewals).toHaveLength(1);
  });
for (const result of ["success", "fail"] as const)
  test(`a held renewal ${result} respects a newer keyboard focus choice`, async ({
    page,
  }) => {
    const state = makeState();
    state.mode = "held";
    await mount(page, state);
    await renew(page).click();
    await expect.poll(() => state.held.length).toBe(1);
    const filter = page.getByLabel("Show orders", { exact: true });
    await filter.focus();
    const before = await page.evaluate(() => scrollY);
    state.mode = result;
    await finish(state, state.held[0]);
    if (result === "success")
      await expect(
        panel(page).getByLabel("Pickup code", { exact: true }),
      ).toBeEnabled();
    else await expect(recovery(page)).toBeVisible();
    await expect(filter).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(before);
    expect(state.renewals).toHaveLength(1);
  });
test("a stale renewal refusal after another owner renews removes expired controls and preserves current focus", async ({
  page,
}) => {
  const state = makeState();
  state.mode = "held";
  await mount(page, state);
  await renew(page).click();
  await expect.poll(() => state.held.length).toBe(1);
  applyRenewal(state, {
    ...state.renewals[0],
    idempotencyKey: "separate-owner-request",
  });
  await refreshPage(page);
  const input = panel(page).getByLabel("Pickup code", { exact: true });
  await expect(panel(page)).toContainText("Enter the requester’s pickup code");
  const filter = page.getByLabel("Show orders", { exact: true });
  await filter.focus();
  const before = await page.evaluate(() => scrollY);
  const response = page.waitForResponse((reply) =>
    reply.url().endsWith("/renew-pickup"),
  );
  state.mode = "success";
  await finish(state, state.held[0]);
  expect((await response).status()).toBe(409);
  await expect(panel(page).locator(".pickup-renewal")).toHaveCount(0);
  await expect(recovery(page)).toHaveCount(0);
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("");
  await expect(filter).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(before);
  expect(state.renewals).toHaveLength(1);
  expect(state.job.pickupRenewals).toHaveLength(1);
  expect(state.job.pickupRenewals[0].key).toBe("separate-owner-request");
});
test("an exact renewal replay returning current collected state never reopens pickup or restores a credential", async ({
  page,
}) => {
  const state = makeState();
  state.mode = "held";
  await mount(page, state);
  await renew(page).click();
  await expect.poll(() => state.held.length).toBe(1);
  const body = state.renewals[0];
  applyRenewal(state, body);
  state.job.fulfillmentState = "collected";
  state.job.pickup.redeemedAt = new Date(state.serverNow).toISOString();
  state.job.version++;
  state.revision++;
  state.mode = "success";
  await finish(state, state.held[0]);
  await expect(panel(page)).toHaveCount(0);
  const facts = order(page).locator(".provider-order-facts");
  await facts.getByText("Order details", { exact: true }).click();
  const collection = facts
    .locator("dl > div")
    .filter({ hasText: "Collection" })
    .locator("dd");
  await expect(collection).toBeVisible();
  await expect(collection).toHaveText("collected");
  await expect(
    order(page).getByLabel("Pickup code", { exact: true }),
  ).toHaveCount(0);
  await expect(order(page)).not.toContainText("ORIGINAL_CODE");
  await expect(order(page)).not.toContainText(state.job.pickup.code);
  expect(state.renewals).toHaveLength(1);
  expect(state.mutations).toEqual([
    "/api/owner/jobs/pickup_primary/renew-pickup",
  ]);
});
test("320px keyboard recovery survives repeated read failures with a visible local notice and no secret code", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 664 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = makeState();
  state.mode = "fail";
  await mount(page, state);
  await renew(page).focus();
  await renew(page).press("Enter");
  await expect(recovery(page)).toBeFocused();
  await expect
    .poll(async () => {
      const b = await recovery(page).boundingBox();
      return Boolean(b && b.y >= 0 && b.y + b.height <= 664);
    })
    .toBe(true);
  await expect(recovery(page)).not.toContainText("ORIGINAL_CODE");
  state.failReads = true;
  for (let i = 0; i < 2; i++) {
    await check(page);
    await expect(recovery(page)).toBeFocused();
  }
  state.failReads = false;
  await check(page);
  await expect(
    recovery(page).getByRole("button", {
      name: "Retry pickup code renewal",
      exact: true,
    }),
  ).toBeFocused();
  expect(state.renewals).toHaveLength(1);
  const audit = await new AxeBuilder({ page })
    .include(".owner-pickup")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await testInfo.attach("pickup-renewal-accessibility", {
    body: JSON.stringify({
      state: "pickup-renewal-recovery-320",
      rulesPassed: audit.passes.length,
      violations: audit.violations,
    }),
    contentType: "application/json",
  });
  expect(audit.violations).toEqual([]);
  await page.screenshot({ path: "evidence/overnight-pickup-renewal-320.png" });
});
test("an invalid expiry stays unknown and cannot expose a usable requester code or authorize owner renewal", async ({
  page,
  context,
}) => {
  const state = makeState();
  state.job.pickup.expiresAt = "invalid-time";
  await mount(page, state);
  await expect(renew(page)).toHaveCount(0);
  await expect(
    panel(page).getByLabel("Pickup code", { exact: true }),
  ).toBeDisabled();
  const requester = await context.newPage();
  await mount(requester, state, "requester");
  await expect(requester.locator(".pickup-code")).toHaveCount(0);
  await expect(
    requester.getByRole("heading", {
      name: "Pickup status needs checking",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.mutations).toEqual([]);
});

test("a server clock refusal preserves the current pickup and reports uncertainty without an automatic retry", async ({
  page,
}) => {
  const state = makeState();
  state.job.pickup.expiresAt = new Date(state.time + 60000).toISOString();
  const original = structuredClone(state.job.pickup);
  await page.clock.install({ time: new Date(state.time + 120000) });
  await page.clock.setFixedTime(new Date(state.time + 120000));
  await mount(page, state);
  await renew(page).click();
  await expect(recovery(page)).toContainText(
    "The workshop reports that the current code is still valid",
  );
  expect(state.job.pickup).toEqual(original);
  expect(state.renewals).toHaveLength(1);
  expect(state.mutations).toEqual([
    "/api/owner/jobs/pickup_primary/renew-pickup",
  ]);
  await expect(
    recovery(page).getByRole("button", {
      name: "Check pickup status",
      exact: true,
    }),
  ).toBeEnabled();
});
