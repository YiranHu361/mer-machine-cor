import { test, expect, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
function fixtureJob(id: string, intent: string) {
  const now = new Date().toISOString();
  return {
    id,
    specVersion: 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
    spec: {
      assetIds: ["fixture_art"],
      intent,
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    artifact: { id: "fixture_art", url: pixel, sha256: id + "_fixture_hash" },
    productionState: "specified",
    paymentState: "unpaid",
    fulfillmentState: "unprepared",
    history: [],
    quote: {
      id: "quote_" + id,
      version: 1,
      expiresAt: new Date(Date.now() + 120000).toISOString(),
      items: [],
      totalCents: 75,
      ownerCents: 60,
      platformCents: 15,
      currency: "USD",
      paymentMode: "mock",
      collectionPoint: "Interface fixture collection point",
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

async function requesterFixture(
  page: Page,
  jobs: ReturnType<typeof fixtureJob>[] = [],
  custom?: (route: Route, path: string) => Promise<boolean>,
) {
  if (jobs[0])
    await page.addInitScript(
      (id) => localStorage.setItem("fabrary-current-job", id),
      jobs[0].id,
    );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (custom && (await custom(route, path))) return;
    if (path === "/api/health")
      return json(route, {
        mode: "simulation",
        paymentMode: "mock",
        store: "ui-fixture",
      });
    if (path === "/api/session")
      return json(route, { role: "requester", id: "fixture_requester" });
    if (path === "/api/machines") return json(route, { machines: [] });
    if (path === "/api/catalog") return json(route, { models: [] });
    if (path === "/api/jobs") return json(route, { jobs });
    if (path === "/api/events")
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": UI fixture only\n\n",
      });
    return json(
      route,
      {
        error: {
          message: "No external calls are allowed in this interface fixture.",
        },
      },
      404,
    );
  });
}

test("invalid and failed uploads preserve the form and allow a deliberate retry (UI fixture)", async ({
  page,
}) => {
  let uploads = 0;
  const image = await readFile(resolve("tests/fixtures/makers.png"));
  await requesterFixture(page, [], async (route, path) => {
    if (path !== "/api/uploads") return false;
    uploads++;
    if (uploads === 1)
      await json(
        route,
        {
          error: {
            message: "Artwork upload is temporarily unavailable. Please retry.",
          },
        },
        503,
      );
    else
      await json(route, {
        assets: [{ id: "fixture_art", url: pixel, sha256: "fixture_art" }],
      });
    return true;
  });
  await page.goto("/");
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Preserve my workshop label draft");
  const upload = page.getByLabel("Upload artwork", { exact: true });
  await upload.setInputFiles({
    name: "unprintable.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("fixture"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Choose PNG" }),
  ).toContainText("Choose PNG, JPEG, or WebP");
  await upload.setInputFiles(
    Array.from({ length: 5 }, (_, i) => ({
      name: `${i}.png`,
      mimeType: "image/png",
      buffer: image,
    })),
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "Choose up to" }),
  ).toContainText("Choose up to four images");
  expect(uploads).toBe(0);
  await upload.setInputFiles({
    name: "retry.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "upload is temporarily" }),
  ).toContainText("upload is temporarily unavailable");
  await expect(page.getByLabel("What is it for?", { exact: true })).toHaveValue(
    "Preserve my workshop label draft",
  );
  await upload.setInputFiles({
    name: "retry.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(page.getByAltText("Uploaded original artwork")).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "upload is temporarily" }),
  ).toHaveCount(0);
  expect(uploads).toBe(2);
});

for (const failure of ["unavailable", "corrupt"] as const)
  test(`a ${failure} production image blocks approval and has a working preview retry (UI fixture)`, async ({
    page,
  }) => {
    const job = fixtureJob("job_preview", "Preview recovery fixture");
    job.artifact.url = "/fixture-production-preview.png";
    let available = false;
    await page.route("**/fixture-production-preview.png*", async (route) => {
      if (!available)
        return route.fulfill({
          status: failure === "corrupt" ? 200 : 503,
          contentType: "image/png",
          body: "Temporarily unavailable",
        });
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: await readFile(resolve("tests/fixtures/makers.png")),
      });
    });
    await requesterFixture(page, [job]);
    await page.goto("/");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "production preview is unavailable" }),
    ).toContainText("production preview is unavailable");
    await expect(
      page.getByRole("button", {
        name: "Approve production file",
        exact: true,
      }),
    ).toBeDisabled();
    available = true;
    await page
      .getByRole("button", { name: /retry.*preview|reload.*preview/i })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Approve production file",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(page.getByAltText(/Actual production preview/)).toBeVisible();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "production preview is unavailable" }),
    ).toHaveCount(0);
  });

test("an older receipt response never appears on a newly selected order (UI fixture)", async ({
  page,
}) => {
  const first = fixtureJob("job_a111111", "First fixture order");
  const second = fixtureJob("job_b222222", "Second fixture order");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  let completed = false;
  await requesterFixture(page, [first, second], async (route, path) => {
    if (path !== `/api/jobs/${first.id}/receipt`) return false;
    requested = true;
    await pending;
    await json(route, {
      mode: "mock",
      ledger: [
        {
          id: "old_fixture_receipt",
          jobId: first.id,
          kind: "collection",
          state: "confirmed",
          mode: "mock",
          amountCents: 75,
          transactionRef: "OLD_RECEIPT_ONLY",
        },
      ],
    });
    completed = true;
    return true;
  });
  await page.goto("/");
  await expect(page.locator(".order-intent")).toHaveText(first.spec.intent);
  await page
    .getByRole("button", {
      name: "View receipt & payment records",
      exact: true,
    })
    .click();
  await expect.poll(() => requested).toBe(true);
  await page.locator(".order-row").filter({ hasText: "job_b222" }).click();
  await expect(page.locator(".order-intent")).toHaveText(second.spec.intent);
  release();
  await expect.poll(() => completed).toBe(true);
  // Wait for the old network response to reach React, not merely for the route to finish.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.locator(".receipt")).toHaveCount(0);
  await expect(page.getByText("OLD_RECEIPT_ONLY")).toHaveCount(0);
});

test("an expired owner session clears private dashboard data and offers sign-in (UI fixture)", async ({
  page,
}) => {
  let expired = false;
  const job = fixtureJob("job_private", "Private owner fixture order");
  job.productionState = "produced";
  job.fulfillmentState = "awaiting_owner";
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/health")
      return json(route, {
        mode: "simulation",
        paymentMode: "mock",
        store: "ui-fixture",
      });
    if (path === "/api/session")
      return json(route, {
        role: expired ? null : "owner",
        id: "fixture_owner",
      });
    if (path === "/api/owner/dashboard") {
      if (expired)
        return json(
          route,
          { error: { code: "AUTH_REQUIRED", message: "Sign in to continue." } },
          401,
        );
      return json(route, { machines: [], jobs: [job], ledger: [] });
    }
    if (path === "/api/events")
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": UI fixture only\n\n",
      });
    return json(
      route,
      {
        error: {
          message: "No external calls are allowed in this interface fixture.",
        },
      },
      404,
    );
  });
  await page.goto("/owner");
  await expect(page.getByText(job.spec.intent, { exact: true })).toBeVisible();
  expired = true;
  await expect(
    page.getByLabel("Owner access code", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(job.spec.intent, { exact: true })).toHaveCount(0);
});
