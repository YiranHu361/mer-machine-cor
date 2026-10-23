import {
  useManualSettings,
  authorizePictures,
  recommendationFor,
} from "./requester-manual";
import {
  test,
  expect,
  type Page,
  type Route,
  type Dialog,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
test.beforeEach(async ({ page }) => {
  // Concurrent source edits must not hot-reload this deliberately interrupted
  // document. This mocks only Vite's dev socket; fixture API/SSE stay separate.
  await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:4317\//, () => {});
});
const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
async function documentIdentity(page: Page) {
  return page.evaluate(() => {
    const target = window as Window & { __navigationFixtureDocument?: string };
    target.__navigationFixtureDocument ??= crypto.randomUUID();
    // Some engines round/recompute timeOrigin within one document. This
    // document-owned UUID survives cancellation and changes on real reload.
    return target.__navigationFixtureDocument;
  });
}
async function changeDocument(page: Page, navigate: () => Promise<unknown>) {
  const previous = await documentIdentity(page);
  await navigate();
  await expect.poll(() => documentIdentity(page)).not.toBe(previous);
}
async function reloadDocument(page: Page) {
  const dialogs: string[] = [];
  const handleDialog = async (dialog: Dialog) => {
    dialogs.push(dialog.type());
    if (dialog.type() === "beforeunload") await dialog.accept();
    else await dialog.dismiss();
  };
  page.on("dialog", handleDialog);
  try {
    await changeDocument(page, () => page.reload());
    return dialogs;
  } finally {
    page.off("dialog", handleDialog);
  }
}
function order(id = "nav_saved_order") {
  const at = new Date().toISOString();
  return {
    id,
    creationRequestId: undefined as string | undefined,
    specVersion: 1,
    version: 1,
    createdAt: at,
    updatedAt: at,
    spec: {
      assetIds: ["nav_art"],
      intent: "Saved navigation fixture artwork",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    artifact: { id: "nav_preview", url: pixel, sha256: "a".repeat(64) },
    productionState: "approved",
    paymentState: "unpaid",
    fulfillmentState: "unprepared",
    approvedSpecHash: "approved_navigation_spec",
    history: [] as unknown[],
    quote: undefined as
      | undefined
      | {
          id: string;
          version: number;
          expiresAt: string;
          items: unknown[];
          totalCents: number;
          ownerCents: number;
          platformCents: number;
          currency: string;
          paymentMode: string;
          collectionPoint: string;
        },
  };
}
async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
async function seedSelectionOnce(page: Page, id: string) {
  await page.addInitScript((initialId) => {
    const sentinel = "fabrary-navigation-selection-initialized";
    if (sessionStorage.getItem(sentinel)) return;
    localStorage.setItem("fabrary-current-job", initialId);
    sessionStorage.setItem(sentinel, "yes");
  }, id);
}
async function fixture(page: Page, initial = [order()]) {
  const state = {
    jobs: initial,
    sessionPosts: 0,
    creates: 0,
    edits: 0,
    quotes: 0,
    lost: "" as "" | "create" | "edit" | "quote",
    quoteGate: null as Promise<void> | null,
  };
  if (initial[0]) await seedSelectionOnce(page, initial[0].id);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/health")
      return json(route, {
        mode: "simulation",
        paymentMode: "mock",
        store: "navigation-ui-fixture",
      });
    if (path === "/api/session") {
      if (method === "POST") state.sessionPosts++;
      return json(route, { role: "requester", id: "navigation_requester" });
    }
    if (path === "/api/recommendations")
      return json(route, recommendationFor(route.request().postDataJSON()));
    if (path === "/api/machines") return json(route, { machines: [] });
    if (path === "/api/catalog") return json(route, { models: [] });
    if (path === "/api/events")
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": navigation fixture only\n\n",
      });
    if (path === "/api/jobs" && method === "GET")
      return json(route, {
        revision: 1 + state.creates + state.edits + state.quotes,
        jobs: state.jobs,
      });
    if (path === "/api/uploads")
      return json(route, {
        assets: [{ id: "nav_art", url: pixel, sha256: "b".repeat(64) }],
      });
    if (path === "/api/jobs" && method === "POST") {
      state.creates++;
      const created = order("nav_created_order");
      created.spec = route.request().postDataJSON();
      created.creationRequestId = route.request().headers()["idempotency-key"];
      created.productionState = "specified";
      created.approvedSpecHash = "";
      state.jobs.push(created);
      if (state.lost === "create") return route.abort("failed");
      return json(route, { job: created });
    }
    if (path.endsWith("/spec") && method === "PATCH") {
      state.edits++;
      const current = state.jobs[0];
      current.spec = route.request().postDataJSON();
      current.specVersion++;
      current.version++;
      current.productionState = "specified";
      current.approvedSpecHash = "";
      current.quote = undefined;
      if (state.lost === "edit") return route.abort("failed");
      return json(route, { job: current });
    }
    if (path.endsWith("/quote") && method === "POST") {
      state.quotes++;
      const current = state.jobs[0];
      current.productionState = "quoted";
      current.version++;
      current.quote = {
        id: "nav_committed_quote",
        version: 1,
        expiresAt: new Date(Date.now() + 120000).toISOString(),
        items: [],
        totalCents: 75,
        ownerCents: 60,
        platformCents: 15,
        currency: "USD",
        paymentMode: "mock",
        collectionPoint: "Navigation fixture desk",
      };
      if (state.quoteGate) await state.quoteGate;
      if (state.lost === "quote") return route.abort("failed");
      return json(route, { job: current });
    }
    return json(
      route,
      {
        error: {
          message: "No external operations allowed in navigation fixture",
        },
      },
      404,
    );
  });
  return state;
}

test("back, forward and reload preserve a saved requester selection without replacing its session (offline fixture)", async ({
  page,
}) => {
  const first = order("nav_first_order");
  first.spec.intent = "First saved navigation order";
  const second = order("nav_second_order");
  second.spec.intent = "Second saved navigation order";
  const state = await fixture(page, [first, second]);
  await page.goto("/");
  await expect(page.locator(".order-intent")).toHaveText(first.spec.intent);
  await page.locator(".order-row").filter({ hasText: "nav_seco" }).click();
  const expectSecondSelected = async () => {
    await expect(page.locator(".order-intent")).toHaveText(second.spec.intent);
    expect(
      await page.evaluate(() => localStorage.getItem("fabrary-current-job")),
    ).toBe(second.id);
  };
  await expectSecondSelected();
  await page.getByRole("link", { name: "Owner workshop", exact: true }).click();
  await expect(
    page.getByLabel("Owner access code", { exact: true }),
  ).toBeVisible();
  await changeDocument(page, () => page.goBack());
  await expectSecondSelected();
  await changeDocument(page, () => page.goForward());
  await expect(
    page.getByLabel("Owner access code", { exact: true }),
  ).toBeVisible();
  await changeDocument(page, () => page.goBack());
  await expectSecondSelected();
  expect(await reloadDocument(page)).toEqual([]);
  await expectSecondSelected();
  expect(state.sessionPosts).toBe(0);
});

test("a committed creation with lost response remains recoverable after reload without another creation (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, []);
  state.lost = "create";
  await page.goto("/");
  await useManualSettings(page);
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Recover my interrupted creation");
  await page.getByLabel("Upload artwork", { exact: true }).setInputFiles({
    name: "nav.png",
    mimeType: "image/png",
    buffer: await readFile(resolve("tests/fixtures/makers.png")),
  });
  await expect(page.getByAltText("Uploaded original artwork")).toBeVisible();
  await authorizePictures(page);
  await page
    .getByRole("button", { name: "Make production preview", exact: true })
    .click();
  await expect.poll(() => state.creates).toBe(1);
  expect(await reloadDocument(page)).toEqual(["beforeunload"]);
  await expect(page.locator(".order-row")).toHaveCount(1);
  await page.locator(".order-row").click();
  await expect(page.locator(".order-intent")).toHaveText(
    "Recover my interrupted creation",
  );
  expect(state.creates).toBe(1);
  expect(state.sessionPosts).toBe(0);
});

test("an edited specification committed before connection loss reloads as unapproved without resubmitting (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  state.lost = "edit";
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Edit artwork or specifications",
      exact: true,
    })
    .click();
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Committed edited navigation artwork");
  await expect(page.getByLabel("What is it for?", { exact: true })).toHaveValue(
    "Committed edited navigation artwork",
  );
  await page
    .getByRole("button", {
      name: "Save changes & rebuild preview",
      exact: true,
    })
    .click();
  await expect.poll(() => state.edits).toBe(1);
  expect(state.jobs[0].spec.intent).toBe("Committed edited navigation artwork");
  // A refresh may already have confirmed this committed edit as clean. Accept
  // any unload prompt, but prove a new document independently of dirty state.
  await reloadDocument(page);
  await expect(page.locator(".order-intent")).toHaveText(
    "Committed edited navigation artwork",
  );
  await expect(
    page.getByRole("button", { name: "Approve production file", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Get a quote", exact: true }),
  ).toHaveCount(0);
  expect(state.edits).toBe(1);
  expect(state.sessionPosts).toBe(0);
});

test("a quote committed before connection loss survives reload without a duplicate reservation (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  state.lost = "quote";
  await page.goto("/");
  await page.getByRole("button", { name: "Get a quote", exact: true }).click();
  await expect.poll(() => state.quotes).toBe(1);
  await reloadDocument(page);
  await expect(
    page.getByRole("heading", { name: "Your quote is ready", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Confirm mock payment/ }),
  ).toBeVisible();
  await reloadDocument(page);
  await expect(
    page.getByRole("heading", { name: "Your quote is ready", exact: true }),
  ).toBeVisible();
  expect(state.quotes).toBe(1);
  expect(state.sessionPosts).toBe(0);
});

test("unsaved requester edits can cancel accidental navigation without discarding artwork choices (offline fixture)", async ({
  page,
}) => {
  await fixture(page);
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.dismiss();
  });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Edit artwork or specifications",
      exact: true,
    })
    .click();
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Keep this unsaved artwork edit");
  const previousDocument = await documentIdentity(page);
  await page.getByRole("link", { name: "Owner workshop", exact: true }).click();
  await expect.poll(() => dialogs, { timeout: 3000 }).toEqual(["beforeunload"]);
  expect(await documentIdentity(page)).toBe(previousDocument);
  await expect(page.getByLabel("What is it for?", { exact: true })).toHaveValue(
    "Keep this unsaved artwork edit",
  );
});

test("owner authentication survives history navigation without restoring requester data or creating another identity (offline fixture)", async ({
  page,
}) => {
  let role: "requester" | "owner" = "requester";
  const sessionPosts: string[] = [];
  const requesterOrder = order("nav_requester_private");
  const ownerOrder = order("nav_owner_private");
  ownerOrder.spec.intent = "Private owner navigation order";
  ownerOrder.productionState = "produced";
  ownerOrder.fulfillmentState = "awaiting_owner";
  await seedSelectionOnce(page, requesterOrder.id);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/health")
      return json(route, {
        mode: "simulation",
        paymentMode: "mock",
        store: "navigation-ui-fixture",
      });
    if (path === "/api/session") {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        sessionPosts.push(body.role);
        if (
          body.role !== "owner" ||
          body.accessCode !== "offline-owner-fixture"
        )
          return json(
            route,
            {
              error: {
                message: "Unexpected identity change in navigation fixture",
              },
            },
            403,
          );
        role = "owner";
      }
      return json(route, { role, id: `navigation_${role}` });
    }
    if (path === "/api/events")
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": navigation fixture only\n\n",
      });
    if (path === "/api/owner/dashboard")
      return role === "owner"
        ? json(route, { machines: [], jobs: [ownerOrder], ledger: [] })
        : json(route, { error: { message: "Owner required" } }, 403);
    if (path === "/api/jobs")
      return role === "requester"
        ? json(route, { jobs: [requesterOrder] })
        : json(route, { error: { message: "Requester required" } }, 403);
    if (path === "/api/machines") return json(route, { machines: [] });
    if (path === "/api/catalog") return json(route, { models: [] });
    return json(
      route,
      {
        error: {
          message: "No external operation allowed in navigation fixture",
        },
      },
      404,
    );
  });
  await page.goto("/");
  await expect(page.locator(".order-intent")).toHaveText(
    requesterOrder.spec.intent,
  );
  await page.getByRole("link", { name: "Owner workshop", exact: true }).click();
  await page
    .getByLabel("Owner access code", { exact: true })
    .fill("offline-owner-fixture");
  await page
    .getByRole("button", { name: "Open owner workshop", exact: true })
    .click();
  await expect(
    page.getByText(ownerOrder.spec.intent, { exact: true }),
  ).toBeVisible();
  await changeDocument(page, () => page.goBack());
  await expect(
    page.getByText("Your current session is an owner session.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.locator(".order-intent")).toHaveCount(0);
  await expect(
    page.getByText(ownerOrder.spec.intent, { exact: true }),
  ).toHaveCount(0);
  await changeDocument(page, () => page.goForward());
  await expect(
    page.getByText(ownerOrder.spec.intent, { exact: true }),
  ).toBeVisible();
  await reloadDocument(page);
  await expect(
    page.getByText(ownerOrder.spec.intent, { exact: true }),
  ).toBeVisible();
  expect(sessionPosts).toEqual(["owner"]);
});

test("a new uploaded draft can cancel leaving without losing its image or intent (offline fixture)", async ({
  page,
}) => {
  await fixture(page, []);
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.dismiss();
  });
  await page.goto("/");
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Keep this unsaved new artwork");
  await page.getByLabel("Upload artwork", { exact: true }).setInputFiles({
    name: "nav.png",
    mimeType: "image/png",
    buffer: await readFile(resolve("tests/fixtures/makers.png")),
  });
  await expect(page.getByAltText("Uploaded original artwork")).toBeVisible();
  const previousDocument = await documentIdentity(page);
  await page.getByRole("link", { name: "Owner workshop", exact: true }).click();
  await expect.poll(() => dialogs).toEqual(["beforeunload"]);
  expect(await documentIdentity(page)).toBe(previousDocument);
  await expect(page.getByLabel("What is it for?", { exact: true })).toHaveValue(
    "Keep this unsaved new artwork",
  );
  await expect(page.getByAltText("Uploaded original artwork")).toBeVisible();
});

test("untouched edits and explicit draft discard do not warn on navigation (offline fixture)", async ({
  page,
}) => {
  await fixture(page);
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.accept();
  });
  const edit = () =>
    page
      .getByRole("button", {
        name: "Edit artwork or specifications",
        exact: true,
      })
      .click();
  const leave = async () => {
    await changeDocument(page, () =>
      page.getByRole("link", { name: "Owner workshop", exact: true }).click(),
    );
    await expect(
      page.getByLabel("Owner access code", { exact: true }),
    ).toBeVisible();
    await changeDocument(page, () => page.goBack());
    await expect(page.locator(".order-intent")).toHaveText(
      "Saved navigation fixture artwork",
    );
  };
  await page.goto("/");
  await edit();
  await leave();
  await edit();
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Discard this edit by explicit cancel");
  await page
    .getByRole("button", { name: "Keep existing specification", exact: true })
    .click();
  await leave();
  await edit();
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Keep this edit when starting a new order");
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await expect(page.getByLabel("What is it for?", { exact: true })).toHaveValue(
    "",
  );
  const drafts = page.getByRole("region", {
    name: "Your unsaved drafts",
    exact: true,
  });
  await expect(drafts).toContainText(
    "Keep this edit when starting a new order",
  );
  await drafts.getByRole("button", { name: /Discard edit/ }).click();
  await expect(drafts).toHaveCount(0);
  await page.getByRole("link", { name: "Owner workshop", exact: true }).click();
  await expect(
    page.getByLabel("Owner access code", { exact: true }),
  ).toBeVisible();
  expect(dialogs).toEqual([]);
});

test("a successful specification save removes the navigation warning (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.accept();
  });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Edit artwork or specifications",
      exact: true,
    })
    .click();
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Successfully saved navigation artwork");
  await page
    .getByRole("button", {
      name: "Save changes & rebuild preview",
      exact: true,
    })
    .click();
  await expect(page.locator(".order-intent")).toHaveText(
    "Successfully saved navigation artwork",
  );
  await expect(
    page.getByRole("button", { name: "New order", exact: true }),
  ).toBeEnabled();
  await page.getByRole("link", { name: "Owner workshop", exact: true }).click();
  await expect(
    page.getByLabel("Owner access code", { exact: true }),
  ).toBeVisible();
  expect(state.edits).toBe(1);
  expect(dialogs).toEqual([]);
});

test("an in-flight quote can cancel navigation and disarms after its saved response (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  let release!: () => void;
  state.quoteGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.dismiss();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Get a quote", exact: true }).click();
  try {
    await expect.poll(() => state.quotes).toBe(1);
    const previousDocument = await documentIdentity(page);
    await page
      .getByRole("link", { name: "Owner workshop", exact: true })
      .click();
    await expect.poll(() => dialogs).toEqual(["beforeunload"]);
    expect(await documentIdentity(page)).toBe(previousDocument);
    await expect(page).toHaveURL(/\/$/);
    release();
    await expect(
      page.getByRole("heading", { name: "Your quote is ready", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New order", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("link", { name: "Owner workshop", exact: true })
      .click();
    await expect(
      page.getByLabel("Owner access code", { exact: true }),
    ).toBeVisible();
    expect(dialogs).toEqual(["beforeunload"]);
    expect(state.quotes).toBe(1);
  } finally {
    release();
  }
});

test("deferred edit-heading focus cannot steal focus after the requester starts typing (offline fixture)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const target = window as Window & {
      __heldNavigationFrames?: FrameRequestCallback[];
      __releaseNavigationFrames?: () => void;
    };
    const original = window.requestAnimationFrame.bind(window);
    const held: FrameRequestCallback[] = [];
    target.__heldNavigationFrames = held;
    window.requestAnimationFrame = (callback) => {
      held.push(callback);
      return held.length;
    };
    target.__releaseNavigationFrames = () => {
      window.requestAnimationFrame = original;
      for (const callback of held.splice(0)) callback(performance.now());
    };
  });
  const state = await fixture(page);
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Edit artwork or specifications",
      exact: true,
    })
    .click();
  const intent = page.getByLabel("What is it for?", { exact: true });
  await intent.focus();
  await page.evaluate(() =>
    (
      window as Window & { __releaseNavigationFrames: () => void }
    ).__releaseNavigationFrames(),
  );
  await expect(intent).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("Do not lose text to a delayed heading focus");
  await expect(intent).toHaveValue(
    "Do not lose text to a delayed heading focus",
  );
  await page
    .getByRole("button", {
      name: "Save changes & rebuild preview",
      exact: true,
    })
    .click();
  await expect.poll(() => state.edits).toBe(1);
  expect(state.jobs[0].spec.intent).toBe(
    "Do not lose text to a delayed heading focus",
  );
});
