import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function job(id = "deadline_saved") {
  const at = new Date().toISOString();
  return {
    id,
    version: 1,
    specVersion: 1,
    createdAt: at,
    updatedAt: at,
    spec: {
      assetIds: ["deadline_art"],
      intent: "Deadline fixture artwork",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    artifact: {
      id: "deadline_preview",
      url: "/deadline-preview.png",
      sha256: "a".repeat(64),
    },
    productionState: "specified",
    paymentState: "unpaid",
    fulfillmentState: "unprepared",
    history: [],
  };
}
async function fixture(
  page: Page,
  initial: any[] = [],
  owner = false,
  hangSession = false,
  hangSessionCreation = false,
) {
  const state = {
    jobs: initial,
    held: hangSessionCreation ? "/api/session" : "",
    sessionActive: !hangSessionCreation,
    failureStatus: 0,
    missingJob: false,
    heldRead: hangSession ? "/api/session" : "",
    posts: [] as { path: string; body: any }[],
    sessions: 0,
    sessionReads: 0,
    machine: {
      id: "deadline_machine",
      name: "Deadline fixture printer",
      model: "Phomemo",
      outputType: "sticker",
      adapterVersion: "fixture",
      mode: "simulation",
      paired: true,
      configured: true,
      calibrated: true,
      listed: true,
      ready: false,
      paused: true,
      mediaRemaining: 20,
      material: "thermal-paper",
      collectionPoint: "Saved fixture desk",
      hours: { start: 0, end: 24 },
      maxJobSeconds: 120,
      priceCard: { consumables: 20, machine: 10, handling: 30, platform: 15 },
    },
  };
  await page.clock.install();
  await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:4317\//, () => {});
  if (initial[0])
    await page.addInitScript(
      (id) => localStorage.setItem("fabrary-current-job", id),
      initial[0].id,
    );
  await page.route("**/deadline-preview.png", async (route) =>
    route.fulfill({
      contentType: "image/png",
      body: await readFile(resolve("tests/fixtures/makers.png")),
    }),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      if (path === "/api/session") {
        state.sessions++;
        state.sessionActive = true;
      }
      state.posts.push({
        path,
        body: path === "/api/uploads" ? null : route.request().postDataJSON(),
      });
      if (path === state.held) return;
      if (state.failureStatus)
        return route.fulfill({
          status: state.failureStatus,
          contentType: "application/json",
          body: JSON.stringify({
            error: { message: "The storage acknowledgement is unavailable." },
          }),
        });
      if (state.missingJob)
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ job: null }),
        });
      if (path === "/api/uploads")
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            assets: [
              {
                id: "deadline_art",
                url: "/deadline-preview.png",
                sha256: "b".repeat(64),
                width: 1,
                height: 1,
              },
            ],
          }),
        });
      if (path === "/api/jobs") {
        const saved = {
          ...job(`deadline_created_${state.jobs.length}`),
          spec: route.request().postDataJSON(),
        };
        state.jobs.push(saved);
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ job: saved }),
        });
      }
      return route.fulfill({
        status: 405,
        body: "Only isolated fixture mutations are allowed.",
      });
    }
    if (path === "/api/session") state.sessionReads++;
    if (path === state.heldRead) return;
    if (path === "/api/events")
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": deadline fixture\n\n",
      });
    const value =
      path === "/api/health"
        ? {
            mode: "simulation",
            paymentMode: "mock",
            store: "deadline-ui-fixture",
          }
        : path === "/api/session"
          ? {
              role: state.sessionActive
                ? owner
                  ? "owner"
                  : "requester"
                : null,
              id: "deadline_fixture_identity",
            }
          : path === "/api/jobs"
            ? {
                jobs: state.jobs,
                revision: state.jobs.reduce(
                  (sum, value) => sum + value.version,
                  1,
                ),
              }
            : path === "/api/machines"
              ? { machines: [] }
              : path === "/api/catalog"
                ? { models: [] }
                : path === "/api/owner/dashboard"
                  ? {
                      revision: 1,
                      machines: [state.machine],
                      jobs: [],
                      ledger: [],
                    }
                  : null;
    return route.fulfill({
      status: value ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(
        value || { error: { message: "Unknown isolated fixture read." } },
      ),
    });
  });
  await page.goto(owner ? "/owner" : "/");
  return state;
}
async function upload(page: Page) {
  await page.getByLabel("Upload artwork", { exact: true }).setInputFiles({
    name: "deadline.png",
    mimeType: "image/png",
    buffer: await readFile(resolve("tests/fixtures/makers.png")),
  });
}
async function expire(page: Page) {
  await page.clock.fastForward(180_001);
  await expect(
    page.getByRole("alert").filter({ hasText: "timed out" }),
  ).toContainText("result is unknown");
}

test("an interrupted creation stops spinning, recovers its late committed order and only creates again after explicit new order (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  state.held = "/api/jobs";
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Recover a stalled creation");
  await upload(page);
  await expect(page.getByAltText("Uploaded original artwork")).toBeVisible();
  const submit = page.getByRole("button", {
    name: "Make production preview",
    exact: true,
  });
  await submit.click();
  await expect
    .poll(() => state.posts.filter((item) => item.path === "/api/jobs").length)
    .toBe(1);
  await expire(page);
  await expect(submit).not.toHaveAttribute("aria-busy", "true");
  await expect(submit).toBeDisabled();
  await page.clock.fastForward(180_001);
  expect(state.posts.filter((item) => item.path === "/api/jobs")).toHaveLength(
    1,
  );
  const committed = {
    ...job("deadline_late_committed"),
    spec: state.posts.find((item) => item.path === "/api/jobs")!.body,
  };
  state.jobs.push(committed);
  await page
    .getByRole("button", { name: "Check saved orders", exact: true })
    .click();
  await page.locator(".order-row").click();
  await expect(page.locator(".order-intent")).toHaveText(
    "Recover a stalled creation",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("fabrary-current-job")),
  ).toBe(committed.id);
  expect(state.sessions).toBe(0);
  state.held = "";
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Recover a stalled creation");
  await upload(page);
  await expect(page.getByAltText("Uploaded original artwork")).toBeVisible();
  await submit.click();
  await expect
    .poll(() => state.posts.filter((item) => item.path === "/api/jobs").length)
    .toBe(2);
  expect(state.jobs).toHaveLength(2);
});

test("a stalled upload releases the form without discarding intent or submitting an order (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  state.held = "/api/uploads";
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Keep this intent after upload timeout");
  await upload(page);
  await expect.poll(() => state.posts.length).toBe(1);
  await expire(page);
  await expect(
    page.getByLabel("Upload artwork", { exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("What is it for?", { exact: true })).toHaveValue(
    "Keep this intent after upload timeout",
  );
  expect(state.posts.map((item) => item.path)).toEqual(["/api/uploads"]);
  expect(state.sessions).toBe(0);
});

test("a stalled specification save keeps the draft and recovers a late saved version without resubmitting (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, [job()]);
  state.held = "/api/jobs/deadline_saved/spec";
  await page
    .getByRole("button", {
      name: "Edit artwork or specifications",
      exact: true,
    })
    .click();
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Late saved specification");
  const save = page.getByRole("button", {
    name: "Save changes & rebuild preview",
    exact: true,
  });
  await save.click();
  await expect.poll(() => state.posts.length).toBe(1);
  await expire(page);
  await expect(save).toBeEnabled();
  await expect(page.getByLabel("What is it for?", { exact: true })).toHaveValue(
    "Late saved specification",
  );
  state.jobs[0] = {
    ...state.jobs[0],
    spec: state.posts[0].body,
    version: 2,
    specVersion: 2,
  };
  await page.clock.fastForward(2501);
  await page.locator(".order-row").click();
  await expect(page.locator(".order-intent")).toHaveText(
    "Late saved specification",
  );
  expect(state.posts).toHaveLength(1);
});

for (const action of ["checkout", "dispatch"] as const)
  test(`a stalled ${action} recovers the same late pending record without repeating payment or production (offline fixture)`, async ({
    page,
  }) => {
    const saved: any = {
      ...job(),
      productionState: action === "checkout" ? "quoted" : "payment_confirmed",
      paymentState: action === "checkout" ? "unpaid" : "held",
      quote: {
        id: "deadline_quote",
        version: 1,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        items: [],
        totalCents: 75,
        ownerCents: 60,
        platformCents: 15,
        currency: "USD",
        paymentMode: "mock",
        collectionPoint: "Deadline desk",
      },
    };
    const state = await fixture(page, [saved]);
    state.held = `/api/jobs/deadline_saved/${action}`;
    const button = page.getByRole("button", {
      name:
        action === "checkout"
          ? "Confirm mock payment · $0.75"
          : "Start production",
      exact: true,
    });
    await button.click();
    await expect.poll(() => state.posts.length).toBe(1);
    const checkoutKey = state.posts[0].body.idempotencyKey;
    await expire(page);
    await expect(button).toBeEnabled();
    state.jobs[0] = {
      ...saved,
      version: 2,
      paymentState: action === "checkout" ? "collection_pending" : "held",
      productionState: action === "checkout" ? "quoted" : "running",
      ...(action === "checkout"
        ? { checkoutKey }
        : { attemptId: "deadline_single_attempt" }),
    };
    await page.clock.fastForward(2501);
    await expect(
      page.getByRole("status").filter({
        hasText:
          action === "checkout"
            ? "Payment collection is pending"
            : "machine is working",
      }),
    ).toBeVisible();
    expect(state.posts).toHaveLength(1);
    expect(state.jobs[0].id).toBe(saved.id);
    if (action === "checkout")
      expect(checkoutKey).toMatch(/^fabrary-checkout-v1:/);
    expect(state.sessions).toBe(0);
  });

test("a stalled owner settings save releases busy controls and keeps the exact entered draft (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, [], true);
  state.held = "/api/owner/machines/deadline_machine";
  await page
    .getByRole("tab", { name: "Machines & policy", exact: true })
    .click();
  await page
    .getByText("Media, prices, hours & policy", { exact: true })
    .click();
  const input = page.getByLabel("Collection point", { exact: true });
  await input.fill("Unconfirmed deadline collection point");
  await page
    .getByRole("button", { name: "Save machine settings", exact: true })
    .click();
  await expect.poll(() => state.posts.length).toBe(1);
  await expire(page);
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("Unconfirmed deadline collection point");
  expect(state.posts).toHaveLength(1);
});

test("a stalled successful JSON body is bounded and late creation recovers without another submission (offline fixture)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const native = window.fetch;
    (window as any).deadlineBodySubmissions = [];
    window.fetch = async (input, init) => {
      if (
        new URL(String(input), location.href).pathname === "/api/jobs" &&
        init?.method === "POST"
      ) {
        (window as any).deadlineBodySubmissions.push(
          JSON.parse(String(init.body)),
        );
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"job":'));
            init.signal?.addEventListener(
              "abort",
              () =>
                controller.error(
                  new DOMException("Request aborted", "AbortError"),
                ),
              { once: true },
            );
          },
        });
        return new Response(body, {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      return native(input, init);
    };
  });
  const state = await fixture(page);
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Recover the stalled response body");
  await upload(page);
  await expect(page.getByAltText("Uploaded original artwork")).toBeVisible();
  await page
    .getByRole("button", { name: "Make production preview", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).deadlineBodySubmissions.length),
    )
    .toBe(1);
  await expire(page);
  const body = await page.evaluate(
    () => (window as any).deadlineBodySubmissions[0],
  );
  state.jobs.push({ ...job("deadline_body_committed"), spec: body });
  await page
    .getByRole("button", { name: "Check saved orders", exact: true })
    .click();
  await page.locator(".order-row").click();
  await expect(page.locator(".order-intent")).toHaveText(
    "Recover the stalled response body",
  );
  expect(
    await page.evaluate(() => (window as any).deadlineBodySubmissions.length),
  ).toBe(1);
  expect(state.sessions).toBe(0);
});

test("a stalled session lookup offers bounded recovery without making a replacement identity (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, [job()], false, true);
  await expect.poll(() => state.sessionReads).toBeGreaterThan(0);
  await page.clock.fastForward(30_001);
  await expect(
    page.getByRole("heading", {
      name: "The workshop is offline.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("timed out");
  expect(state.sessions).toBe(0);
  state.heldRead = "";
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".order-intent")).toHaveText(
    "Deadline fixture artwork",
  );
  expect(state.sessions).toBe(0);
  expect(state.posts).toEqual([]);
});

for (const missingJob of [false, true])
  test(`${missingJob ? "a missing job in a successful reply" : "an HTTP500 after uncertain storage"} blocks duplicate creation and recovers the late committed order (offline fixture)`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await page
      .getByLabel("What is it for?", { exact: true })
      .fill("Recover the ambiguous committed response");
    await upload(page);
    await expect(page.getByAltText("Uploaded original artwork")).toBeVisible();
    state.failureStatus = missingJob ? 0 : 500;
    state.missingJob = missingJob;
    const submit = page.getByRole("button", {
      name: "Make production preview",
      exact: true,
    });
    await submit.click();
    await expect(page.getByRole("alert")).toContainText("result is unknown");
    await expect(submit).toBeDisabled();
    expect(
      state.posts.filter((item) => item.path === "/api/jobs"),
    ).toHaveLength(1);
    state.jobs.push({
      ...job("deadline_uncertain_reply"),
      spec: state.posts.find((item) => item.path === "/api/jobs")!.body,
    });
    await page
      .getByRole("button", { name: "Check saved orders", exact: true })
      .click();
    await page.locator(".order-row").click();
    await expect(page.locator(".order-intent")).toHaveText(
      "Recover the ambiguous committed response",
    );
    expect(state.sessions).toBe(0);
  });

test("retry after a stalled session creation first recovers the existing identity instead of issuing another session POST (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, [], false, false, true);
  await expect.poll(() => state.sessions).toBe(1);
  await page.clock.fastForward(180_001);
  await expect(
    page.getByRole("heading", {
      name: "The workshop is offline.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("result is unknown");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByLabel("What is it for?", { exact: true }),
  ).toBeVisible();
  expect(state.sessions).toBe(1);
  expect(state.posts.map((item) => item.path)).toEqual(["/api/session"]);
});
