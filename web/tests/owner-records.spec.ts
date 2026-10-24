import {
  useManualSettings,
  openPurposeNote,
  authorizePictures,
  recommendationFor,
} from "./requester-manual";
import { test, expect } from "@playwright/test";
import {
  openPaymentRecovery,
  openProviderDetails,
  openTrialMeasurements,
} from "./provider-controls";

test("owner recovery forms validate references and submit measured trial records (UI fixture)", async ({
  page,
}) => {
  const now = new Date().toISOString();
  const job: any = {
    id: "job_ui_fixture",
    specVersion: 1,
    spec: {
      assetIds: ["asset_fixture"],
      intent: "Owner payment recovery interface fixture",
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
    quote: {
      id: "quote_fixture",
      version: 1,
      expiresAt: now,
      items: [],
      totalCents: 75,
      ownerCents: 60,
      platformCents: 15,
      paymentMode: "testnet",
      collectionPoint: "Interface fixture collection point",
    },
    history: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  const records = [
    {
      id: "pending_release",
      jobId: job.id,
      mode: "testnet",
      kind: "release",
      status: "pending",
      receipt: { status: "pending" },
    },
    {
      id: "wrong_job",
      jobId: "someone_else",
      mode: "testnet",
      status: "pending",
      receipt: {},
    },
    {
      id: "mock_record",
      jobId: job.id,
      mode: "mock",
      status: "pending",
      receipt: {},
    },
    {
      id: "confirmed_record",
      jobId: job.id,
      mode: "testnet",
      status: "confirmed",
      receipt: {},
    },
    {
      id: "no_saved_receipt",
      jobId: job.id,
      mode: "testnet",
      status: "pending",
    },
  ];
  const submittedReferences: unknown[] = [];
  let measurements: unknown = null;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/recommendations")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(recommendationFor(route.request().postDataJSON())),
      });
    let status = 200;
    let body: unknown = {};
    if (path === "/api/health")
      body = {
        mode: "simulation",
        paymentMode: "testnet",
        store: "ui-fixture",
      };
    else if (path === "/api/session")
      body = { role: "owner", id: "ui_fixture_owner" };
    else if (path === "/api/owner/dashboard")
      body = { machines: [], jobs: [job], ledger: records };
    else if (path === "/api/events") {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": Interface fixture, no live subscription\n\n",
      });
      return;
    } else if (path.endsWith("/payment-reference")) {
      submittedReferences.push(route.request().postDataJSON());
      if (submittedReferences.length === 1) {
        status = 409;
        body = {
          error: {
            code: "REFERENCE_MISMATCH",
            message:
              "This transaction does not match the saved transfer. Payment remains pending.",
          },
        };
      } else {
        job.paymentState = "released";
        records[0].status = "confirmed";
        body = { job };
      }
    } else if (path.endsWith("/economics")) {
      measurements = route.request().postDataJSON();
      job.economics = {
        ...(measurements as object),
        ownerNetCents: 35,
        platformMarginCents: 13,
        ownerEarningsPerHandlingMinuteCents: 172,
        recordedAt: now,
      };
      body = { job };
    } else {
      status = 404;
      body = {
        error: {
          message:
            "No external API calls are allowed in this interface fixture.",
        },
      };
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("/owner");
  const order = page.locator('[data-owner-order="job_ui_fixture"]');
  await openPaymentRecovery(order);
  const reference = page.getByRole("form", {
    name: "Resolve pending test payment",
    exact: true,
  });
  const select = reference.getByLabel("Pending test payment operation", {
    exact: true,
  });
  await expect(select.locator("option")).toHaveCount(2);
  await select.selectOption("pending_release");
  await reference
    .getByLabel("Confirmed Base Sepolia transaction hash", { exact: true })
    .fill("0x123");
  await reference
    .getByLabel("Payment recovery reason", { exact: true })
    .fill("Observed transfer reference requires verification.");
  await reference
    .getByRole("button", {
      name: "Validate confirmed transaction reference",
      exact: true,
    })
    .click();
  expect(
    await reference
      .getByLabel("Confirmed Base Sepolia transaction hash", { exact: true })
      .evaluate((input: HTMLInputElement) => input.validity.patternMismatch),
  ).toBe(true);
  expect(submittedReferences).toHaveLength(0);
  const transactionHash = "0x" + "a".repeat(64);
  await reference
    .getByLabel("Confirmed Base Sepolia transaction hash", { exact: true })
    .fill(transactionHash);
  await reference
    .getByRole("button", {
      name: "Validate confirmed transaction reference",
      exact: true,
    })
    .click();
  await expect(reference.getByRole("alert")).toContainText(
    "The reference was not confirmed",
  );
  await openProviderDetails(order, "Order details");
  await expect(order.locator(".provider-order-facts")).toContainText(
    "Payout confirming",
  );
  expect(submittedReferences).toEqual([
    {
      operationId: "pending_release",
      transactionHash,
      reason: "Observed transfer reference requires verification.",
    },
  ]);
  await reference
    .getByRole("button", {
      name: "Validate confirmed transaction reference",
      exact: true,
    })
    .click();
  await expect(reference).toHaveCount(0);
  await expect(
    order.locator(".provider-order-facts dd").filter({ hasText: /^Paid out$/ }),
  ).toBeVisible();
  expect(submittedReferences).toHaveLength(2);
  await openTrialMeasurements(order);
  const trial = page.getByRole("form", {
    name: "Record trial costs and handling",
    exact: true,
  });
  await trial
    .getByRole("button", { name: "Save trial measurements", exact: true })
    .click();
  expect(measurements).toBeNull();
  const values = [
    ["Consumables (USD cents)", "20"],
    ["Machine time (seconds)", "8.5"],
    ["Owner handling time (seconds)", "12.2"],
    ["Failed attempts", "0"],
    ["API cost (USD cents)", "2"],
    ["Machine cost (USD cents)", "5"],
  ];
  for (const [label, value] of values) {
    const input = trial.getByLabel(label, { exact: true });
    await input.fill(value);
    await expect(input).toHaveValue(value);
  }
  await trial
    .getByRole("button", { name: "Save trial measurements", exact: true })
    .click();
  await expect(page.locator(".trial-summary")).toContainText("$0.35");
  await expect(page.locator(".trial-summary")).toContainText("$1.72");
  expect(measurements).toEqual({
    consumablesCents: 20,
    machineSeconds: 8.5,
    handlingSeconds: 12.2,
    failedAttempts: 0,
    apiCostCents: 2,
    machineCostCents: 5,
  });
  await expect(
    page.getByText(
      "Simulation trial records do not establish physical consumable costs or hardware performance.",
      { exact: false },
    ),
  ).toBeVisible();
});

test("requester specification suggestions preserve approval and manual fallback (UI fixture)", async ({
  page,
}) => {
  const drafts: unknown[] = [];
  let createdJobs = 0;
  const pixel =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/recommendations")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(recommendationFor(route.request().postDataJSON())),
      });
    let status = 200;
    let body: unknown = {};
    if (path === "/api/health")
      body = { mode: "simulation", paymentMode: "mock", store: "ui-fixture" };
    else if (path === "/api/session")
      body = { role: "requester", id: "fixture_requester" };
    else if (path === "/api/machines") body = { machines: [] };
    else if (path === "/api/catalog") body = { models: [] };
    else if (path === "/api/events") {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": Interface fixture\n\n",
      });
      return;
    } else if (path === "/api/uploads")
      body = {
        assets: [
          {
            id: "artwork_fixture",
            url: pixel,
            sha256: "fixture",
            width: 500,
            height: 460,
          },
        ],
      };
    else if (path === "/api/intake") {
      drafts.push(route.request().postDataJSON());
      if (drafts.length === 3) {
        status = 503;
        body = {
          error: {
            code: "CLAUDE_UNAVAILABLE",
            message: "Configured suggestion service is unavailable.",
          },
        };
      } else
        body = {
          draft: {
            outputType: "sticker",
            widthMm: 25,
            heightMm: null,
            quantity: 2,
            material: null,
            crop: "cover",
            questions: [
              "Confirm the final crop.",
              "Do you have permission to print this artwork?",
            ],
            contentReview: drafts.length === 1 ? "review" : "clear",
            reason:
              "A monochrome roll can make this club label. Missing values remain yours to confirm.",
            provider: "claude",
            model: "fixture",
          },
        };
    } else if (path === "/api/jobs") {
      if (route.request().method() === "POST") createdJobs++;
      body = { jobs: [] };
    } else {
      status = 404;
      body = {
        error: {
          message: "No external calls are allowed in this interface fixture.",
        },
      };
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Upload your pictures", exact: true }),
  ).toBeVisible();
  await useManualSettings(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("A label that still needs artwork");
  await expect(
    page.getByRole("button", { name: "Preview your item", exact: true }),
  ).toHaveCount(0);
  expect(createdJobs).toBe(0);
  const suggest = page.getByRole("button", {
    name: "Suggest specification",
    exact: true,
  });
  await expect(suggest).toHaveCount(0);
  await page
    .getByLabel("Upload artwork", { exact: true })
    .setInputFiles("tests/fixtures/makers.png");
  await expect(
    page.getByRole("region", { name: "Machine recommendation", exact: true }),
  ).toContainText("Fixture sticker counter");
  await useManualSettings(page);
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("A club sticker for our local tabling event");
  await page.getByLabel("Height (mm)", { exact: true }).fill("70");
  await suggest.click();
  await expect(
    page.getByRole("heading", { name: "Suggested specification", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("A monochrome roll can make this club label.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Confirm the final crop.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Do you have permission to print this artwork?", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Width (mm)", { exact: true })).toHaveValue(
    "25",
  );
  await expect(page.getByLabel("Height (mm)", { exact: true })).toHaveValue(
    "70",
  );
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("2");
  await expect(page.getByLabel("Image placement", { exact: true })).toHaveValue(
    "cover",
  );
  await expect(
    page.getByLabel("Artwork permission", { exact: true }),
  ).toHaveValue("unclear");
  const manualIntent = "A revised club sticker for the evening event";
  const intent = page.getByLabel("What is it for?", { exact: true });
  await intent.fill(manualIntent);
  await expect(intent).toHaveValue(manualIntent);
  await suggest.click();
  await expect.poll(() => drafts.length).toBe(2);
  await expect(
    page.getByLabel("Artwork permission", { exact: true }),
  ).toHaveValue("unclear");
  await suggest.click();
  await expect(
    page.getByText(
      "Specification suggestions are unavailable in this workshop.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preview your item", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Find suitable machine", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Machine recommendation", exact: true }),
  ).toContainText("Fixture sticker counter");
  await page
    .getByRole("button", {
      name: "Request artwork permission review",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Preview your item", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Height (mm)", { exact: true })).toBeEnabled();
  expect(createdJobs).toBe(0);
  expect(drafts).toEqual(
    Array.from({ length: 3 }, (_, index) => ({
      assetIds: ["artwork_fixture"],
      intent:
        index === 0
          ? "A club sticker for our local tabling event"
          : manualIntent,
    })),
  );
});

test("owner queue finds actionable orders, keeps history and supports keyboard views at narrow widths (UI fixture)", async ({
  page,
}, testInfo) => {
  const now = new Date().toISOString();
  const makeJob = (
    id: string,
    productionState: string,
    fulfillmentState: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    specVersion: 1,
    spec: {
      assetIds: [],
      intent:
        id === "job_prepare"
          ? "Membership labels for the local making counter"
          : `Workshop order ${id}`,
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    productionState,
    paymentState: "released",
    fulfillmentState,
    history: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...extra,
  });
  const jobs = [
    makeJob("job_review", "needs_review", "unprepared"),
    makeJob("job_recovered", "failed", "unprepared", {
      history: [
        {
          at: now,
          event: "owner_recovery",
          reason: "Output inspected and machine cleared",
        },
      ],
    }),
    makeJob("job_prepare", "produced", "awaiting_owner"),
    makeJob("job_pickup", "produced", "ready_for_pickup", {
      pickup: {
        code: "QUEUE-PICKUP-FIXTURE",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    }),
    makeJob("job_running", "running", "unprepared", { paymentState: "held" }),
    makeJob("job_collected", "produced", "collected"),
    makeJob("job_cancelled", "cancelled", "unprepared", {
      paymentState: "unpaid",
    }),
    makeJob("job_payment", "produced", "collected", {
      paymentState: "release_pending",
    }),
  ];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/recommendations")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(recommendationFor(route.request().postDataJSON())),
      });
    const body =
      path === "/api/health"
        ? { mode: "simulation", paymentMode: "mock", store: "ui-fixture" }
        : path === "/api/session"
          ? { role: "owner", id: "queue_fixture_owner" }
          : path === "/api/owner/dashboard"
            ? { machines: [], jobs, ledger: [] }
            : {};
    await route.fulfill({
      status: 200,
      contentType:
        path === "/api/events" ? "text/event-stream" : "application/json",
      body: path === "/api/events" ? ": UI fixture\n\n" : JSON.stringify(body),
    });
  });
  await page.goto("/owner");
  const filter = page.getByLabel("Show orders", { exact: true });
  const search = page.getByLabel("Find an order", { exact: true });
  await expect(filter).toHaveValue("action");
  await expect(page.locator(".owner-job")).toHaveCount(4);
  await expect(page.locator(".queue-count")).toHaveText("4 of 8 orders shown");
  await expect(
    page.getByText("Workshop order job_recovered", { exact: true }),
  ).toHaveCount(0);
  await search.fill("membership labels");
  await expect(page.locator(".owner-job")).toHaveCount(1);
  await search.fill("not-an-order");
  await expect(
    page.getByRole("heading", { name: "No orders match.", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show all orders", exact: true })
    .click();
  await expect(search).toHaveValue("");
  await expect(filter).toHaveValue("all");
  await expect(page.locator(".owner-job")).toHaveCount(8);
  for (const [view, count] of [
    ["pickup", 1],
    ["production", 1],
    ["completed", 3],
  ] as const) {
    await filter.selectOption(view);
    await expect(page.locator(".owner-job")).toHaveCount(count);
  }
  await filter.selectOption("action");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, `Owner queue must fit a ${width}px viewport`).toBe(false);
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath("owner-queue-320.png"),
    fullPage: true,
  });
  const queueTab = page.getByRole("tab", {
    name: "Orders",
    exact: true,
  });
  await queueTab.focus();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("tab", { name: "Payments", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "Payments", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(queueTab).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Machines", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(queueTab).toBeFocused();
  await expect(search).toBeVisible();
});

test("a clear owner counter keeps archived orders reachable through finite pages and search (UI fixture)", async ({
  page,
}) => {
  const now = new Date().toISOString();
  const jobs = Array.from({ length: 10 }, (_, index) => ({
    id: `archived_${index + 1}`,
    specVersion: 1,
    spec: {
      assetIds: [],
      intent: `Archive order ${index + 1}`,
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    productionState: "produced",
    paymentState: "released",
    fulfillmentState: "collected",
    history: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
  }));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/recommendations")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(recommendationFor(route.request().postDataJSON())),
      });
    const body =
      path === "/api/health"
        ? { mode: "simulation", paymentMode: "mock", store: "ui-fixture" }
        : path === "/api/session"
          ? { role: "owner", id: "archive_fixture_owner" }
          : path === "/api/owner/dashboard"
            ? { machines: [], jobs, ledger: [] }
            : {};
    await route.fulfill({
      status: 200,
      contentType:
        path === "/api/events" ? "text/event-stream" : "application/json",
      body: path === "/api/events" ? ": fixture\n\n" : JSON.stringify(body),
    });
  });
  await page.goto("/owner");
  await expect(
    page.getByRole("heading", {
      name: "No orders need owner action.",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show all orders", exact: true })
    .click();
  await expect(page.locator(".owner-job")).toHaveCount(8);
  await expect(
    page.getByRole("button", { name: "Previous orders", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Next orders", exact: true }).click();
  await expect(page.locator(".owner-job")).toHaveCount(2);
  await expect(
    page.getByRole("search", { name: "Find workshop orders", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByText("Archive order 9", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next orders", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".queue-count")).toHaveText(
    "9–10 of 10 matching orders shown",
  );
  await page
    .getByLabel("Find an order", { exact: true })
    .fill("Archive order 1");
  await expect(page.locator(".owner-job")).toHaveCount(2);
  await expect(
    page.getByText("Archive order 1", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Order pages", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Find an order", { exact: true }).fill("");
  await expect(page.locator(".owner-job")).toHaveCount(8);
  await expect(page.locator(".queue-count")).toHaveText(
    "1–8 of 10 matching orders shown",
  );
});

test("requester identity changes discard private artwork, drafts and saved order selection (UI fixture)", async ({
  page,
}) => {
  const pixel =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
  let identity = "requester_A";
  let expired = false;
  let opened = 0;
  let privateJob: any = null;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/recommendations")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(recommendationFor(route.request().postDataJSON())),
      });
    let status = 200;
    let body: unknown = {};
    if (path === "/api/health")
      body = { mode: "simulation", paymentMode: "mock", store: "ui-fixture" };
    else if (path === "/api/session") {
      if (route.request().method() === "POST") {
        identity = "requester_B";
        opened++;
      }
      body = { role: "requester", id: identity };
    } else if (path === "/api/machines") body = { machines: [] };
    else if (path === "/api/catalog") body = { models: [] };
    else if (path === "/api/events") {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": UI fixture\n\n",
      });
      return;
    } else if (path === "/api/uploads")
      body = {
        assets: [
          {
            id: "private_artwork_A",
            url: pixel,
            sha256: "private_A",
            width: 500,
            height: 460,
          },
        ],
      };
    else if (path === "/api/intake")
      body = {
        draft: {
          outputType: "sticker",
          widthMm: 25,
          heightMm: 70,
          quantity: 2,
          material: "thermal-paper",
          crop: "cover",
          questions: ["Private draft question for requester A"],
          contentReview: "clear",
          reason: "Private artwork suggestion for requester A",
          provider: "fixture",
          model: "fixture",
        },
      };
    else if (path === "/api/jobs" && route.request().method() === "POST") {
      const now = new Date().toISOString();
      privateJob = {
        id: "private_order_A",
        creationRequestId: route.request().headers()["idempotency-key"],
        specVersion: 1,
        spec: route.request().postDataJSON(),
        artifact: { id: "private_preview_A", url: pixel, sha256: "private_A" },
        productionState: "specified",
        paymentState: "unpaid",
        fulfillmentState: "unprepared",
        history: [],
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      body = { job: privateJob };
    } else if (path === "/api/jobs") {
      if (expired && identity === "requester_A") {
        status = 401;
        body = { error: { message: "Requester session expired" } };
      } else
        body = {
          jobs: identity === "requester_A" && privateJob ? [privateJob] : [],
        };
    } else {
      status = 404;
      body = { error: { message: "No external calls in this fixture" } };
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Upload your pictures", exact: true }),
  ).toBeVisible();
  await useManualSettings(page);
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Private requester A workshop artwork");
  await page
    .getByLabel("Upload artwork", { exact: true })
    .setInputFiles("tests/fixtures/makers.png");
  await expect(page.getByAltText("Uploaded original artwork")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Machine recommendation", exact: true }),
  ).toContainText("Fixture sticker counter");
  await useManualSettings(page);
  await authorizePictures(page);
  await page
    .getByLabel("Automatically accept a quote within my budget", {
      exact: true,
    })
    .check();
  await page.getByLabel("Budget cap (USD)", { exact: true }).fill("9.00");
  await page
    .getByRole("button", { name: "Suggest specification", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Suggested specification", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Preview your item", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your preview", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("fabrary-current-job")),
    )
    .toBe("private_order_A");
  await page
    .getByRole("button", {
      name: "Edit item",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("What is it for?", { exact: true })).toHaveValue(
    "Private requester A workshop artwork",
  );
  expired = true;
  const reopen = page.getByRole("button", {
    name: "Open requester session",
    exact: true,
  });
  await expect(reopen).toBeVisible();
  expect(opened).toBe(0);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("fabrary-current-job")),
    )
    .toBeNull();
  await reopen.click();
  await expect(
    page.getByRole("heading", { name: "Upload your pictures", exact: true }),
  ).toBeVisible();
  expect(opened).toBe(1);
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(0);
  await openPurposeNote(page);
  await expect(page.getByLabel("What is it for?", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.getByLabel("Width (mm)", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Height (mm)", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Image placement", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByLabel("Automatically accept a quote within my budget", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Budget cap (USD)", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Suggested specification", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByAltText(/Actual production preview/)).toHaveCount(0);
  await expect(page.locator(".order-row")).toHaveCount(0);
});

for (const deferredOperation of ["upload", "create"] as const) {
  test(`late ${deferredOperation} results from an expired requester cannot restore private state (UI fixture)`, async ({
    page,
  }) => {
    const pixel =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
    let identity = "requester_A";
    let expired = false;
    let pending: import("@playwright/test").Route | null = null;
    let createSpec: unknown;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/recommendations")
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            recommendationFor(route.request().postDataJSON()),
          ),
        });
      const isCreate =
        path === "/api/jobs" && route.request().method() === "POST";
      if (
        (deferredOperation === "upload" && path === "/api/uploads") ||
        (deferredOperation === "create" && isCreate)
      ) {
        pending = route;
        if (isCreate) createSpec = route.request().postDataJSON();
        return;
      }
      let status = 200;
      let body: unknown = {};
      if (path === "/api/health")
        body = { mode: "simulation", paymentMode: "mock", store: "ui-fixture" };
      else if (path === "/api/session") {
        if (route.request().method() === "POST") identity = "requester_B";
        body = { role: "requester", id: identity };
      } else if (path === "/api/machines") body = { machines: [] };
      else if (path === "/api/catalog") body = { models: [] };
      else if (path === "/api/events") {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: ": UI fixture\n\n",
        });
        return;
      } else if (path === "/api/uploads")
        body = {
          assets: [{ id: "old_private_A", url: pixel, sha256: "private_A" }],
        };
      else if (path === "/api/jobs") {
        if (expired && identity === "requester_A") {
          status = 401;
          body = { error: { message: "Requester session expired" } };
        } else body = { jobs: [] };
      } else {
        status = 404;
        body = { error: { message: "No external calls in this fixture" } };
      }
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Upload your pictures", exact: true }),
    ).toBeVisible();
    await useManualSettings(page);
    await page
      .getByLabel("What is it for?", { exact: true })
      .fill("Private work belonging only to requester A");
    await page
      .getByLabel("Upload artwork", { exact: true })
      .setInputFiles("tests/fixtures/makers.png");
    if (deferredOperation === "create") {
      await expect(
        page.getByAltText("Uploaded original artwork"),
      ).toBeVisible();
      await expect(
        page.getByRole("region", {
          name: "Machine recommendation",
          exact: true,
        }),
      ).toContainText("Fixture sticker counter");
      await authorizePictures(page);
      await page
        .getByRole("button", { name: "Preview your item", exact: true })
        .click();
    }
    await expect.poll(() => Boolean(pending)).toBe(true);
    expired = true;
    await page
      .getByRole("button", { name: "Open requester session", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Upload your pictures", exact: true }),
    ).toBeVisible();
    await openPurposeNote(page);
    await page
      .getByLabel("What is it for?", { exact: true })
      .fill("New requester B draft stays separate");
    const now = new Date().toISOString();
    const oldResult =
      deferredOperation === "upload"
        ? {
            assets: [
              { id: "late_private_art_A", url: pixel, sha256: "private_A" },
            ],
          }
        : {
            job: {
              id: "late_private_order_A",
              creationRequestId: pending!.request().headers()[
                "idempotency-key"
              ],
              specVersion: 1,
              spec: createSpec,
              artifact: {
                id: "late_private_art_A",
                url: pixel,
                sha256: "private_A",
              },
              productionState: "specified",
              paymentState: "unpaid",
              fulfillmentState: "unprepared",
              history: [],
              createdAt: now,
              updatedAt: now,
              version: 1,
            },
          };
    const response = page.waitForResponse(
      (value) =>
        value
          .url()
          .endsWith(
            deferredOperation === "upload" ? "/api/uploads" : "/api/jobs",
          ) && value.request().method() === "POST",
    );
    await pending!.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(oldResult),
    });
    await response;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.getByLabel("What is it for?", { exact: true }),
    ).toHaveValue("New requester B draft stays separate");
    await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(0);
    await expect(page.getByAltText(/Actual production preview/)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Open requester session", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem("fabrary-current-job")),
    ).toBeNull();
  });
}
