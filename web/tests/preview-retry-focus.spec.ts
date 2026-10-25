import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function previewFixture(page: Page) {
  const at = new Date().toISOString();
  const job = {
    id: "job_preview_focus",
    specVersion: 1,
    version: 1,
    createdAt: at,
    updatedAt: at,
    spec: {
      assetIds: ["fixture_art"],
      intent: "Review the production preview with a keyboard",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    artifact: {
      id: "fixture_art",
      url: "/fixture-preview-focus.png",
      sha256: "fixture-production-fingerprint",
    },
    productionState: "specified",
    paymentState: "unpaid",
    fulfillmentState: "unprepared",
    history: [],
  };
  const imageRequests: string[] = [];
  const mutations: string[] = [];
  let release!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  const image = await readFile(resolve("tests/fixtures/makers.png"));
  await page.addInitScript(
    (id) => localStorage.setItem("fabyn-current-job", id),
    job.id,
  );
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.route("**/fixture-preview-focus.png*", async (route) => {
    imageRequests.push(route.request().url());
    if (imageRequests.length === 1)
      return route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Unavailable preview fixture",
      });
    await response;
    return route.fulfill({ contentType: "image/png", body: image });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") mutations.push(path);
    const data: Record<string, unknown> = {
      "/api/health": {
        mode: "simulation",
        paymentMode: "mock",
        store: "preview-focus-fixture",
      },
      "/api/session": { id: "fixture_requester", role: "requester" },
      "/api/jobs": { revision: 1, jobs: [job] },
      "/api/machines": { revision: 1, machines: [] },
      "/api/catalog": { models: [] },
    };
    if (path === "/api/events")
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": isolated preview focus fixture\n\n",
      });
    return route.fulfill({
      status: data[path] ? 200 : 405,
      contentType: "application/json",
      body: JSON.stringify(
        data[path] ?? { error: { message: "Fixture reads only" } },
      ),
    });
  });
  await page.goto("/");
  const retry = page.getByRole("button", {
    name: "Retry production preview",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await retry.focus();
  await retry.press("Enter");
  await expect.poll(() => imageRequests.length).toBe(2);
  return { retry, release, imageRequests, mutations };
}

test("keyboard preview retry keeps focus while loading, ignores duplicates and focuses the recovered image (UI fixture)", async ({
  page,
}) => {
  const f = await previewFixture(page);
  await expect(f.retry).toBeFocused();
  await expect(f.retry).toHaveAttribute("aria-disabled", "true");
  await expect(
    page.getByRole("button", {
      name: "Approve preview & see price",
      exact: true,
    }),
  ).toBeDisabled();
  await f.retry.press("Enter");
  await f.retry.press("Enter");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(f.imageRequests).toHaveLength(2);
  expect(
    new URL(f.imageRequests[1]).searchParams.get("fabyn_image_retry"),
  ).toBeTruthy();
  f.release();
  const preview = page.getByRole("img", { name: /Actual production preview/ });
  await expect(preview).toBeFocused();
  await expect
    .poll(() =>
      preview.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("button", {
      name: "Approve preview & see price",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(f.retry).toHaveCount(0);
  expect(f.imageRequests).toHaveLength(2);
  expect(f.mutations).toEqual([]);
});

test("a recovered preview preserves a newer keyboard focus choice (UI fixture)", async ({
  page,
}) => {
  const f = await previewFixture(page);
  await expect(f.retry).toBeFocused();
  const edit = page.getByRole("button", {
    name: "Edit item",
    exact: true,
  });
  await edit.focus();
  f.release();
  await expect(
    page.getByRole("button", {
      name: "Approve preview & see price",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    page.getByRole("img", { name: /Actual production preview/ }),
  ).toBeVisible();
  await expect(edit).toBeFocused();
  await expect(
    page.getByRole("img", { name: /Actual production preview/ }),
  ).toHaveAttribute("tabindex", "-1");
  expect(f.imageRequests).toHaveLength(2);
  expect(f.mutations).toEqual([]);
});
