import { test, expect } from "@playwright/test";

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
  await expect(page.locator(".job-states")).toContainText("release pending");
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
  await expect(page.locator(".job-states")).toContainText("Payment: released");
  expect(submittedReferences).toHaveLength(2);
  await page.getByText("Trial costs & handling time", { exact: true }).click();
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
  for (const [label, value] of values)
    await trial.getByLabel(label, { exact: true }).fill(value);
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
  const suggest = page.getByRole("button", {
    name: "Suggest specification",
    exact: true,
  });
  await expect(suggest).toBeDisabled();
  await page
    .getByLabel("Upload artwork", { exact: true })
    .setInputFiles("tests/fixtures/makers.png");
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
    page.getByRole("button", { name: "Make production preview", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Height (mm)", { exact: true })).toBeEnabled();
  expect(createdJobs).toBe(0);
  expect(drafts).toEqual(
    Array.from({ length: 3 }, () => ({
      assetIds: ["artwork_fixture"],
      intent: "A club sticker for our local tabling event",
    })),
  );
});
