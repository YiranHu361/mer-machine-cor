import { openHandlingSteps } from "./provider-controls";
import { test, expect, type Page, type Route } from "@playwright/test";

const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
function fixtureJob() {
  const at = new Date().toISOString();
  return {
    id: "job_a111111",
    machineId: "phomemo_01",
    specVersion: 1,
    version: 1,
    createdAt: at,
    updatedAt: at,
    spec: {
      assetIds: ["fixture_art"],
      intent: "Refresh ordering fixture artwork",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    artifact: { id: "fixture_art", url: pixel, sha256: "a".repeat(64) },
    productionState: "specified",
    paymentState: "unpaid",
    fulfillmentState: "unprepared",
    history: [],
  };
}
function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve: () => resolve(),
  };
}
async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}
async function fixtures(
  page: Page,
  role: "owner" | "requester",
  custom: (route: Route, path: string) => Promise<boolean>,
) {
  // A deterministic EventSource boundary lets each test trigger overlapping
  // refreshes without relying on reconnect timing or polling delays.
  await page.addInitScript(() => {
    const sources = new Set<{ handler?: () => void }>();
    (window as any).__fixtureRefresh = () => {
      for (const source of sources) source.handler?.();
    };
    (window as any).EventSource = class {
      handler?: () => void;
      constructor() {
        sources.add(this);
      }
      addEventListener(name: string, handler: () => void) {
        if (name === "refresh") this.handler = handler;
      }
      close() {
        sources.delete(this);
      }
    };
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (await custom(route, path)) return;
    if (path === "/api/health")
      return json(route, {
        mode: "simulation",
        paymentMode: "mock",
        store: "ui-fixture",
      });
    if (path === "/api/session")
      return json(route, {
        role,
        id: role === "owner" ? "team_owner" : "fixture_requester",
      });
    if (path === "/api/machines") return json(route, { machines: [] });
    if (path === "/api/catalog") return json(route, { models: [] });
    return json(
      route,
      {
        error: {
          message: "External calls are disabled in this interface fixture.",
        },
      },
      404,
    );
  });
}
async function refresh(page: Page) {
  await page.evaluate(() => (window as any).__fixtureRefresh());
}
async function renderNetworkResult(page: Page) {
  // Wait beyond fulfillment until the response has had an opportunity to run
  // React's update; an immediate negative assertion can miss a stale callback.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test("an old owner refresh cannot restore preparation after a confirmed handling action (UI fixture)", async ({
  page,
}) => {
  let state: ReturnType<typeof fixtureJob> & {
    pickup?: { code: string; expiresAt: string };
  } = {
    ...fixtureJob(),
    productionState: "produced",
    paymentState: "released",
    fulfillmentState: "awaiting_owner",
  };
  const delayed = deferred();
  let hold = false,
    entered = false,
    returned = false;
  await fixtures(page, "owner", async (route, path) => {
    if (path === "/api/owner/dashboard") {
      const snapshot = structuredClone(state);
      if (hold) {
        hold = false;
        entered = true;
        await delayed.promise;
        await json(route, { machines: [], jobs: [snapshot], ledger: [] });
        returned = true;
      } else await json(route, { machines: [], jobs: [snapshot], ledger: [] });
      return true;
    }
    if (path === `/api/owner/jobs/${state.id}/prepare`) {
      state = {
        ...state,
        version: 2,
        fulfillmentState: "ready_for_pickup",
        pickup: {
          code: "PREPARED-PICKUP-FIXTURE",
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      };
      await json(route, { job: state });
      return true;
    }
    return false;
  });
  try {
    await page.goto("/owner");
    const prepare = page.getByRole("button", {
      name: "Mark ready for pickup",
      exact: true,
    });
    await expect(prepare).toBeVisible();
    hold = true;
    await refresh(page);
    await expect.poll(() => entered).toBe(true);
    await openHandlingSteps(page.locator(".owner-job"));
    for (const label of [
      "Output removed",
      "Order label attached",
      "Item stored safely",
      "Machine cleared",
    ])
      await page.getByLabel(label, { exact: true }).check();
    await prepare.click();
    await expect(prepare).toHaveCount(0);
    delayed.resolve();
    await expect.poll(() => returned).toBe(true);
    await renderNetworkResult(page);
    expect(state.fulfillmentState).toBe("ready_for_pickup");
    expect(await prepare.count()).toBe(0);
    await expect(
      page.getByRole("heading", { name: "Confirm handoff", exact: true }),
    ).toBeVisible();
  } finally {
    delayed.resolve();
  }
});

test("an old requester refresh cannot roll a newer order back when its row is selected (UI fixture)", async ({
  page,
}) => {
  let state = fixtureJob();
  const delayed = deferred();
  let hold = false,
    entered = false,
    returned = false;
  await page.addInitScript(
    (id) => localStorage.setItem("fabrary-current-job", id),
    state.id,
  );
  await fixtures(page, "requester", async (route, path) => {
    if (path !== "/api/jobs") return false;
    const snapshot = structuredClone(state);
    if (hold) {
      hold = false;
      entered = true;
      await delayed.promise;
      await json(route, { jobs: [snapshot] });
      returned = true;
    } else await json(route, { jobs: [snapshot] });
    return true;
  });
  try {
    await page.goto("/");
    await expect(page.locator(".ticket-title")).toHaveText(
      "Review your preview",
    );
    hold = true;
    await refresh(page);
    await expect.poll(() => entered).toBe(true);
    state = { ...state, version: 2, productionState: "approved" };
    await refresh(page);
    await expect(page.locator(".ticket-title")).toHaveText("Preview approved");
    delayed.resolve();
    await expect.poll(() => returned).toBe(true);
    await renderNetworkResult(page);
    await page.locator(".order-row").click();
    expect(await page.locator(".ticket-title").textContent()).toBe(
      "Preview approved",
    );
    expect(await page.locator(".order-row .badge").textContent()).toBe(
      "approved",
    );
  } finally {
    delayed.resolve();
  }
});

test("an old owner authentication error cannot end a successfully reopened session (UI fixture)", async ({
  page,
}) => {
  const delayed = deferred();
  let holdError = false,
    entered = false,
    returned = false,
    expired = false,
    successfulLogins = 0;
  await fixtures(page, "owner", async (route, path) => {
    if (path === "/api/session" && route.request().method() === "POST") {
      expired = false;
      successfulLogins++;
      await json(route, { role: "owner", id: "team_owner" });
      return true;
    }
    if (path !== "/api/owner/dashboard") return false;
    if (holdError) {
      holdError = false;
      entered = true;
      await delayed.promise;
      await json(
        route,
        {
          error: {
            code: "AUTH_REQUIRED",
            message: "Old fixture session expired",
          },
        },
        401,
      );
      returned = true;
    } else if (expired)
      await json(
        route,
        {
          error: { code: "AUTH_REQUIRED", message: "Fixture session expired" },
        },
        401,
      );
    else await json(route, { machines: [], jobs: [], ledger: [] });
    return true;
  });
  try {
    await page.goto("/owner");
    const clear = page.getByRole("heading", {
      name: "You’re all caught up",
      exact: true,
    });
    await expect(clear).toBeVisible();
    holdError = true;
    await refresh(page);
    await expect.poll(() => entered).toBe(true);
    expired = true;
    await refresh(page);
    const code = page.getByLabel("Owner access code", { exact: true });
    await expect(code).toBeVisible();
    await code.fill("isolated-fixture-owner-code");
    await page
      .getByRole("button", { name: "Open owner workshop", exact: true })
      .click();
    await expect(clear).toBeVisible();
    delayed.resolve();
    await expect.poll(() => returned).toBe(true);
    await renderNetworkResult(page);
    expect(successfulLogins).toBe(1);
    expect(await code.count()).toBe(0);
    await expect(clear).toBeVisible();
  } finally {
    delayed.resolve();
  }
});

test("authoritative revisions win when an earlier request reads the newer snapshot (UI fixture)", async ({
  page,
}) => {
  const initial = fixtureJob();
  let newerRequest = false,
    held = false,
    returned = false;
  const delayed = deferred();
  await page.addInitScript(
    (id) => localStorage.setItem("fabrary-current-job", id),
    initial.id,
  );
  await fixtures(page, "requester", async (route, path) => {
    if (path !== "/api/jobs") return false;
    if (newerRequest) {
      newerRequest = false;
      held = true;
      // This request started earlier but its authoritative read takes place
      // after the other response: start order alone cannot establish freshness.
      await delayed.promise;
      await json(route, {
        revision: 12,
        jobs: [{ ...initial, version: 3, productionState: "produced" }],
      });
      returned = true;
    } else
      await json(route, {
        revision: held ? 11 : 10,
        jobs: [
          {
            ...initial,
            version: held ? 2 : 1,
            productionState: held ? "approved" : "specified",
          },
        ],
      });
    return true;
  });
  try {
    await page.goto("/");
    await expect(page.locator(".ticket-title")).toHaveText(
      "Review your preview",
    );
    newerRequest = true;
    await refresh(page);
    await expect.poll(() => held).toBe(true);
    await refresh(page);
    await expect(page.locator(".ticket-title")).toHaveText("Preview approved");
    delayed.resolve();
    await expect.poll(() => returned).toBe(true);
    await renderNetworkResult(page);
    await expect(page.locator(".ticket-title")).toHaveText(
      "Production is complete",
    );
    await expect(page.locator(".order-row .badge")).toHaveText("produced");
  } finally {
    delayed.resolve();
  }
});

for (const failure of [
  {
    name: "unavailable",
    status: 503,
    body: {
      error: {
        code: "STORE_UNAVAILABLE",
        message:
          "The session store is temporarily unavailable. Retry this lookup.",
      },
    },
  },
  { name: "malformed successful", status: 200, body: {} },
]) {
  test(`${failure.status === 503 ? "an" : "a"} ${failure.name} session lookup offers retry without replacing the original requester or orders (UI fixture)`, async ({
    page,
  }) => {
    const original = fixtureJob();
    original.spec.intent =
      "Existing requester artwork survives a failed session lookup";
    let lookups = 0,
      replacements = 0;
    await page.addInitScript(
      (id) => localStorage.setItem("fabrary-current-job", id),
      original.id,
    );
    await fixtures(page, "requester", async (route, path) => {
      if (path === "/api/session") {
        if (route.request().method() === "POST") {
          replacements++;
          await json(route, {
            role: "requester",
            id: "unwanted_replacement_requester",
          });
        } else if (++lookups === 1)
          await json(route, failure.body, failure.status);
        else await json(route, { role: "requester", id: "original_requester" });
        return true;
      }
      if (path === "/api/jobs") {
        await json(route, {
          revision: 17,
          jobs: replacements ? [] : [original],
        });
        return true;
      }
      return false;
    });
    await page.goto("/");
    const retry = page.getByRole("button", { name: "Try again", exact: true });
    await expect(retry).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      failure.status === 503
        ? "session store is temporarily unavailable"
        : "saved session could not be checked",
    );
    expect(replacements).toBe(0);
    expect(lookups).toBe(1);
    await retry.click();
    await expect(page.locator(".order-intent")).toHaveText(
      original.spec.intent,
    );
    await expect(page.locator(".order-row")).toHaveCount(1);
    expect(lookups).toBe(2);
    expect(replacements).toBe(0);
  });
}
