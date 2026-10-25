import {
  useManualSettings,
  authorizePictures,
  recommendationFor,
} from "./requester-manual";
import { test, expect, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function order() {
  const at = new Date().toISOString();
  return {
    id: "stale_order_first",
    creationRequestId: undefined as string | undefined,
    version: 1,
    specVersion: 1,
    createdAt: at,
    updatedAt: at,
    spec: {
      assetIds: ["stale_art"],
      intent: "Shared order in two editing tabs",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    artifact: {
      id: "stale_preview",
      url: "/stale-fixture.png",
      sha256: "a".repeat(64),
    },
    productionState: "specified",
    paymentState: "unpaid",
    fulfillmentState: "unprepared",
    history: [],
  };
}
async function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
async function fixture(page: Page, saved = true) {
  const context = page.context();
  const state = {
    jobs: saved ? [order()] : [],
    patches: [] as { baseline?: string; body: any; accepted: boolean }[],
    creations: [] as any[],
    creationIds: [] as string[],
    sessions: 0,
    malformedDetail: false,
    detailFault: "" as "" | "artifact" | "history",
    holdJobs: false,
    held: [] as Route[],
    reads: [] as { page: Page; version: number }[],
  };
  await context.routeWebSocket(/^ws:\/\/127\.0\.0\.1:4317\//, () => {});
  await context.addInitScript(
    (initialId) => {
      if (initialId) localStorage.setItem("fabyn-current-job", initialId);
      const refresh: Array<() => void> = [];
      class FixtureEvents {
        onopen: (() => void) | null = null;
        onerror = null;
        onmessage = null;
        constructor() {
          queueMicrotask(() => this.onopen?.());
        }
        addEventListener(name: string, callback: () => void) {
          if (name === "refresh") refresh.push(callback);
        }
        close() {}
      }
      Object.defineProperty(window, "EventSource", {
        value: FixtureEvents,
        configurable: true,
      });
      (window as any).refreshRequesterConflictFixture = () =>
        refresh.forEach((callback) => callback());
    },
    saved ? order().id : null,
  );
  await context.route("**/stale-fixture.png", async (route) =>
    route.fulfill({
      contentType: "image/png",
      body: await readFile(resolve("tests/fixtures/makers.png")),
    }),
  );
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    if (path === "/api/health")
      return json(route, {
        mode: "simulation",
        paymentMode: "mock",
        store: "stale-form-fixture",
      });
    if (path === "/api/session") {
      if (method !== "GET") state.sessions++;
      return json(route, { role: "requester", id: "shared_fixture_identity" });
    }
    if (path === "/api/recommendations")
      return json(route, recommendationFor(route.request().postDataJSON()));
    if (path === "/api/machines") return json(route, { machines: [] });
    if (path === "/api/catalog") return json(route, { models: [] });
    if (path === "/api/jobs" && method === "GET") {
      state.reads.push({
        page: route.request().frame().page(),
        version: state.jobs[0]?.version || 0,
      });
      if (state.holdJobs) {
        state.held.push(route);
        return;
      }
      return json(route, {
        jobs: state.jobs,
        revision: state.jobs[0]?.version || 0,
      });
    }
    if (path.startsWith("/api/jobs/") && method === "GET")
      return json(route, {
        job: state.malformedDetail
          ? null
          : state.detailFault === "artifact"
            ? { ...state.jobs[0], artifact: null }
            : state.detailFault === "history"
              ? { ...state.jobs[0], history: [{ at: null, event: {} }] }
              : state.jobs[0],
      });
    if (path.endsWith("/spec") && method === "PATCH") {
      const baseline = route.request().headers()["if-match"],
        body = route.request().postDataJSON();
      const accepted = baseline === `"${state.jobs[0].version}"`;
      state.patches.push({ baseline, body, accepted });
      if (!accepted)
        return json(
          route,
          {
            error: {
              code: "STALE_SPECIFICATION",
              message:
                "This order changed after editing began. Your draft was not saved.",
            },
          },
          409,
        );
      state.jobs[0] = {
        ...state.jobs[0],
        version: state.jobs[0].version + 1,
        specVersion: state.jobs[0].specVersion + 1,
        spec: body,
      };
      return json(route, { job: state.jobs[0] });
    }
    if (path === "/api/uploads")
      return json(route, {
        assets: [
          {
            id: "stale_art",
            url: "/stale-fixture.png",
            sha256: "b".repeat(64),
            width: 1,
            height: 1,
          },
        ],
      });
    if (path === "/api/jobs" && method === "POST") {
      state.creations.push(route.request().postDataJSON());
      state.creationIds.push(route.request().headers()["idempotency-key"]);
      return json(
        route,
        { error: { message: "The storage acknowledgement is unavailable." } },
        500,
      );
    }
    return json(
      route,
      { error: { message: "Unknown isolated fixture request." } },
      405,
    );
  });
  await page.goto("/");
  return state;
}
const edit = (page: Page) =>
  page
    .getByRole("button", {
      name: "Edit item",
      exact: true,
    })
    .click();
const save = (page: Page) =>
  page.getByRole("button", {
    name: "Update preview",
    exact: true,
  });

test("an older tab retains its draft, rejects its immutable baseline and explicitly adopts newer fields before reapplying (offline fixture)", async ({
  page: a,
}) => {
  const state = await fixture(a);
  const b = await a.context().newPage();
  await b.goto("/");
  await edit(a);
  await edit(b);
  await a.getByLabel("Height (mm)", { exact: true }).fill("75");
  await b.getByLabel("Quantity", { exact: true }).fill("2");
  await save(b).click();
  await expect.poll(() => state.jobs[0].version).toBe(2);
  await a.evaluate(() => (window as any).refreshRequesterConflictFixture());
  await expect
    .poll(() =>
      state.reads.some((read) => read.page === a && read.version === 2),
    )
    .toBe(true);
  await save(a).click();
  await expect(a.getByRole("alert")).toContainText(
    "changed after editing began",
  );
  await expect(save(a)).toBeDisabled();
  await expect(a.getByLabel("Height (mm)", { exact: true })).toHaveValue("75");
  await expect(a.getByLabel("Quantity", { exact: true })).toHaveValue("1");
  expect(
    state.patches.map((patch) => [patch.baseline, patch.accepted]),
  ).toEqual([
    ['"1"', true],
    ['"1"', false],
  ]);
  expect(state.jobs[0].spec.quantity).toBe(2);
  await a.setViewportSize({ width: 320, height: 800 });
  await a.getByRole("alert").scrollIntoViewIfNeeded();
  expect(
    await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await a.screenshot({
    path: "evidence/overnight-requester-edit-conflict-320.png",
  });
  await a
    .getByRole("button", { name: "Use saved specification", exact: true })
    .click();
  await expect(a.getByLabel("Height (mm)", { exact: true })).toHaveValue("50");
  await expect(a.getByLabel("Quantity", { exact: true })).toHaveValue("2");
  await a.getByLabel("Height (mm)", { exact: true }).fill("75");
  await save(a).click();
  await expect.poll(() => state.jobs[0].version).toBe(3);
  expect(state.jobs[0].spec).toMatchObject({ heightMm: 75, quantity: 2 });
  expect(state.patches[2].baseline).toBe('"2"');
  expect(state.sessions).toBe(0);
});

test("an unreadable saved-state recovery preserves the local draft and conflict until a confirmed version is adopted (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await edit(page);
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Keep my unsaved local intent");
  state.jobs[0] = { ...state.jobs[0], version: 2 };
  await save(page).click();
  await expect(
    page.getByRole("button", { name: "Use saved specification", exact: true }),
  ).toBeVisible();
  state.malformedDetail = true;
  await page
    .getByRole("button", { name: "Use saved specification", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Your draft is kept");
  await expect(page.getByLabel("What is it for?", { exact: true })).toHaveValue(
    "Keep my unsaved local intent",
  );
  await expect(save(page)).toBeDisabled();
  expect(state.patches).toHaveLength(1);
  state.malformedDetail = false;
  for (const fault of ["artifact", "history"] as const) {
    state.detailFault = fault;
    await page
      .getByRole("button", { name: "Use saved specification", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("Your draft is kept");
    await expect(
      page.getByLabel("What is it for?", { exact: true }),
    ).toHaveValue("Keep my unsaved local intent");
    await expect(save(page)).toBeDisabled();
  }
  expect(pageErrors).toEqual([]);
  state.detailFault = "";
  await page
    .getByRole("button", { name: "Use saved specification", exact: true })
    .click();
  await expect(page.getByLabel("What is it for?", { exact: true })).toHaveValue(
    "Shared order in two editing tabs",
  );
  await expect(save(page)).toBeEnabled();
});

async function interruptedCreation(page: Page) {
  await page.setViewportSize({ width: 320, height: 664 });
  const state = await fixture(page, false);
  await useManualSettings(page);
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Find this recovered order on mobile");
  await page.getByLabel("Upload artwork", { exact: true }).setInputFiles({
    name: "recover.png",
    mimeType: "image/png",
    buffer: await readFile(resolve("tests/fixtures/makers.png")),
  });
  await expect(page.getByAltText("Uploaded original artwork")).toBeVisible();
  await authorizePictures(page);
  await page
    .getByRole("button", { name: "Preview your item", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Check saved orders", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check saved orders", exact: true }),
  ).toBeEnabled();
  return state;
}
async function expectInViewport(target: ReturnType<Page["locator"]>) {
  await expect
    .poll(async () => {
      const box = await target.boundingBox();
      return Boolean(box && box.y >= 0 && box.y + box.height <= 664);
    })
    .toBe(true);
}
test("checking saved orders focuses the recovered mobile row for immediate keyboard selection (offline fixture)", async ({
  page,
}) => {
  const state = await interruptedCreation(page);
  state.jobs = [
    {
      ...order(),
      spec: state.creations[0],
      creationRequestId: state.creationIds[0],
    },
  ];
  const check = page.getByRole("button", {
    name: "Check saved orders",
    exact: true,
  });
  await check.focus();
  await check.press("Enter");
  const row = page.locator(".order-row");
  await expect(row).toBeFocused();
  await expectInViewport(row);
  await row.press("Enter");
  await expect(page.locator(".order-intent")).toHaveText(
    "Find this recovered order on mobile",
  );
  expect(state.creations).toHaveLength(1);
  expect(state.sessions).toBe(0);
});
test("checking an empty saved-order list keeps its visible mobile recovery control focused without another creation (offline fixture)", async ({
  page,
}) => {
  const state = await interruptedCreation(page);
  const check = page.getByRole("button", {
    name: "Check saved orders",
    exact: true,
  });
  await check.focus();
  await check.press("Enter");
  await expect(check).toBeFocused();
  await expectInViewport(check);
  await expect(page.locator(".orders-section")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Upload your pictures", exact: true }),
  ).toBeVisible();
  expect(state.creations).toHaveLength(1);
  expect(state.sessions).toBe(0);
});
test("a delayed saved-order lookup respects a newer requester focus choice (offline fixture)", async ({
  page,
}) => {
  const state = await interruptedCreation(page);
  state.jobs = [
    {
      ...order(),
      spec: state.creations[0],
      creationRequestId: state.creationIds[0],
    },
  ];
  state.holdJobs = true;
  const check = page.getByRole("button", {
    name: "Check saved orders",
    exact: true,
  });
  await check.focus();
  await check.press("Enter");
  await expect.poll(() => state.held.length).toBeGreaterThan(0);
  const intent = page.getByLabel("What is it for?", { exact: true });
  await intent.focus();
  await intent.pressSequentially(" still editing");
  state.holdJobs = false;
  for (const route of state.held.splice(0))
    await json(route, { jobs: state.jobs, revision: 1 });
  await expect(page.locator(".order-row")).toBeVisible();
  await expect(intent).toBeFocused();
  await expect(intent).toHaveValue(
    "Find this recovered order on mobile still editing",
  );
  expect(state.creations).toHaveLength(1);
});
