import { openPurposeNote } from "./requester-manual";
import { test, expect, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
function job(paymentMode: "mock" | "testnet" = "mock") {
  const now = new Date().toISOString();
  return {
    id: "job_storage_fixture",
    specVersion: 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
    spec: {
      assetIds: ["fixture_art"],
      intent: "Storage recovery fixture order",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    artifact: { id: "fixture_art", url: pixel, sha256: "fixture_art_hash" },
    approvedSpecHash: "fixture_spec_hash",
    productionState: "quoted",
    paymentState: "unpaid",
    fulfillmentState: "unprepared",
    history: [],
    quote: {
      id: "quote_storage_fixture",
      version: 1,
      expiresAt: new Date(Date.now() + 120000).toISOString(),
      items: [],
      totalCents: 75,
      ownerCents: 60,
      platformCents: 15,
      currency: "USD",
      paymentMode,
      collectionPoint: "Storage UI fixture collection point",
    },
  };
}
async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}
type Failure = "none" | "getter" | "quota";
async function unavailableStorage(
  page: Page,
  local: Failure,
  session: Failure,
  selected = true,
) {
  await page.addInitScript(
    ({ local, session, selected }) => {
      if (selected)
        window.localStorage.setItem(
          "fabrary-current-job",
          "job_storage_fixture",
        );
      for (const [name, failure] of [
        ["localStorage", local],
        ["sessionStorage", session],
      ] as const) {
        if (failure === "getter")
          Object.defineProperty(window, name, {
            configurable: true,
            get() {
              throw new DOMException(
                "Fixture browser denied storage",
                "SecurityError",
              );
            },
          });
        if (failure === "quota") {
          const original = window[name];
          Object.defineProperty(window, name, {
            configurable: true,
            value: {
              getItem: original.getItem.bind(original),
              removeItem: original.removeItem.bind(original),
              setItem() {
                throw new DOMException(
                  "Fixture quota exhausted",
                  "QuotaExceededError",
                );
              },
            },
          });
        }
      }
    },
    { local, session, selected },
  );
}
async function requester(
  page: Page,
  current: ReturnType<typeof job>,
  custom?: (route: Route, path: string) => Promise<boolean>,
) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (custom && (await custom(route, path))) return;
    if (path === "/api/health")
      return json(route, {
        mode: "simulation",
        paymentMode: current.quote.paymentMode,
        store: "storage-ui-fixture",
      });
    if (path === "/api/session")
      return json(route, { role: "requester", id: "storage_requester" });
    if (path === "/api/machines") return json(route, { machines: [] });
    if (path === "/api/catalog") return json(route, { models: [] });
    if (path === "/api/jobs") return json(route, { jobs: [current] });
    if (path === "/api/events")
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": offline storage fixture\n\n",
      });
    return json(
      route,
      {
        error: {
          message:
            "No external operation is allowed in this offline storage fixture.",
        },
      },
      404,
    );
  });
}
function challenge(current: ReturnType<typeof job>) {
  return {
    x402Version: 2,
    resource: {
      url: `http://127.0.0.1:4317/api/jobs/${current.id}/checkout?quote=${current.quote.id}`,
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        amount: "750000",
        payTo: "0x2222222222222222222222222222222222222222",
        maxTimeoutSeconds: 100,
        extra: { name: "USDC", version: "2" },
      },
    ],
  };
}
async function offlineWallet(page: Page, signed: () => void) {
  await page.exposeFunction("fixtureWalletSignature", signed);
  await page.addInitScript(() => {
    (window as any).ethereum = {
      request: async ({ method }: { method: string }) => {
        if (method === "eth_chainId") return "0x14a34";
        if (method === "eth_requestAccounts")
          return ["0x1111111111111111111111111111111111111111"];
        if (method === "eth_signTypedData_v4") {
          await (window as any).fixtureWalletSignature();
          return "0x" + "11".repeat(65);
        }
        throw new Error(
          "No real wallet/RPC method is permitted in this fixture",
        );
      },
    };
  });
}

for (const failure of ["getter", "quota"] as const) {
  test(`local storage ${failure} failure leaves requester interface and order selection usable (offline fixture)`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await unavailableStorage(page, failure, "none", false);
    await requester(page, job());
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Upload your pictures", exact: true }),
    ).toBeVisible();
    await openPurposeNote(page);
    await expect(
      page.getByLabel("What is it for?", { exact: true }),
    ).toHaveValue("");
    await page.locator(".order-row").filter({ hasText: "job_stor" }).click();
    await expect(page.locator(".order-intent")).toHaveText(
      "Storage recovery fixture order",
    );
    await expect(
      page.getByText(/Browser storage is unavailable/),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("unavailable session storage retains the same mock checkout key across interrupted response and reload (offline fixture)", async ({
  page,
}) => {
  const current = job();
  const keys: string[] = [];
  await unavailableStorage(page, "none", "getter");
  await requester(page, current, async (route, path) => {
    if (!path.endsWith("/checkout")) return false;
    keys.push(route.request().postDataJSON().idempotencyKey);
    if (keys.length === 1) await route.abort("failed");
    else {
      current.paymentState = "held";
      current.productionState = "payment_confirmed";
      current.version++;
      await json(route, { job: current });
    }
    return true;
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Confirm mock payment/ }).click();
  await expect.poll(() => keys.length).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: /Confirm mock payment/ }).click();
  await expect(
    page.getByRole("heading", { name: "Payment confirmed", exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(keys[0].length).toBeGreaterThanOrEqual(8);
});

test("quota-limited session storage blocks wallet signature and signed submission with useful error (offline fixture)", async ({
  page,
}) => {
  const current = job("testnet");
  let signatures = 0;
  let signedPosts = 0;
  await unavailableStorage(page, "none", "quota");
  await offlineWallet(page, () => signatures++);
  await requester(page, current, async (route, path) => {
    if (!path.endsWith("/checkout")) return false;
    if (route.request().headers()["payment-signature"]) signedPosts++;
    await json(route, challenge(current), 402);
    return true;
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Pay .* on testnet/ }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "No payment was signed or submitted" }),
  ).toBeVisible();
  expect(signatures).toBe(0);
  expect(signedPosts).toBe(0);
  await expect(page.locator(".order-intent")).toHaveText(current.spec.intent);
});

test("ambiguous wallet submission cannot sign again after retry or page reload (offline fixture)", async ({
  page,
}) => {
  const current = job("testnet");
  let signatures = 0;
  let signedPosts = 0;
  const keys: string[] = [];
  await unavailableStorage(page, "none", "none");
  await offlineWallet(page, () => signatures++);
  await requester(page, current, async (route, path) => {
    if (!path.endsWith("/checkout")) return false;
    keys.push(route.request().postDataJSON().idempotencyKey);
    if (route.request().headers()["payment-signature"]) {
      signedPosts++;
      await route.abort("failed");
    } else await json(route, challenge(current), 402);
    return true;
  });
  await page.goto("/");
  const pay = () =>
    page.getByRole("button", { name: /Pay .* on testnet/ }).click();
  await pay();
  await expect(
    page.getByRole("alert").filter({ hasText: "Retry this same order" }),
  ).toBeVisible();
  await pay();
  await expect(
    page.getByRole("alert").filter({ hasText: "earlier wallet authorization" }),
  ).toBeVisible();
  await page.reload();
  await pay();
  await expect(
    page.getByRole("alert").filter({ hasText: "earlier wallet authorization" }),
  ).toBeVisible();
  expect(signatures).toBe(1);
  expect(signedPosts).toBe(1);
  expect(new Set(keys).size).toBe(1);
});

test("clearing session storage in the open page cannot authorize another ambiguous payment (offline fixture)", async ({
  page,
}) => {
  const current = job("testnet");
  let signatures = 0;
  let signedPosts = 0;
  await unavailableStorage(page, "none", "none");
  await offlineWallet(page, () => signatures++);
  await requester(page, current, async (route, path) => {
    if (!path.endsWith("/checkout")) return false;
    if (route.request().headers()["payment-signature"]) {
      signedPosts++;
      await route.abort("failed");
    } else await json(route, challenge(current), 402);
    return true;
  });
  await page.goto("/");
  const pay = () =>
    page.getByRole("button", { name: /Pay .* on testnet/ }).click();
  await pay();
  await expect(
    page.getByRole("alert").filter({ hasText: "Retry this same order" }),
  ).toBeVisible();
  await page.evaluate(() => sessionStorage.clear());
  // Stay in this document: its observed attempt must survive storage eviction.
  await pay();
  await expect(
    page.getByRole("alert").filter({ hasText: "earlier wallet authorization" }),
  ).toBeVisible();
  expect(signatures).toBe(1);
  expect(signedPosts).toBe(1);
  await expect(page.locator(".order-intent")).toHaveText(current.spec.intent);
});

test("denied session storage leaves owner calibration visible and blocks a new physical attempt (offline fixture)", async ({
  page,
}) => {
  await unavailableStorage(page, "none", "getter", false);
  let starts = 0;
  const machine = {
    id: "phomemo_storage_fixture",
    name: "Storage test printer",
    model: "Phomemo M02Pro",
    outputType: "sticker",
    adapterVersion: "offline-fixture",
    mode: "hardware",
    paired: true,
    configured: true,
    calibrated: false,
    listed: false,
    ready: false,
    paused: true,
    mediaRemaining: 100,
    material: "thermal-paper",
    priceCard: { consumables: 10, machine: 10, handling: 10, platform: 5 },
    hours: { start: 0, end: 24 },
    maxJobSeconds: 120,
    collectionPoint: "Offline fixture desk",
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/health")
      return json(route, {
        mode: "hardware",
        paymentMode: "mock",
        store: "storage-ui-fixture",
      });
    if (path === "/api/session")
      return json(route, { role: "owner", id: "storage_owner" });
    if (path === "/api/owner/dashboard")
      return json(route, { machines: [machine], jobs: [], ledger: [] });
    if (path === "/api/events")
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": offline storage fixture\n\n",
      });
    if (path.endsWith("/calibration"))
      return json(route, {
        calibration: null,
        lifecycle: {
          activeJobId: null,
          calibrationActive: false,
          canRequestCancellation: false,
          canRequestNew: true,
          context: "c".repeat(64),
          contextMatch: null,
          reasonCode: "AVAILABLE_TO_REQUEST",
          reason: "Offline fixture store permission only.",
        },
      });
    if (path === "/api/uploads")
      return json(route, {
        assets: [{ id: "fixture_art", url: pixel, sha256: "fixture_art_hash" }],
      });
    if (path.endsWith("/calibration/start")) {
      starts++;
      return json(
        route,
        { error: { message: "Physical jobs forbidden in offline fixture" } },
        409,
      );
    }
    return json(
      route,
      { error: { message: "No external operation allowed" } },
      404,
    );
  });
  await page.goto("/owner");
  await page.getByRole("tab", { name: "Machines", exact: true }).click();
  await page
    .getByText("Physical calibration job & inspection", { exact: true })
    .click();
  await page.getByLabel("Calibration artwork", { exact: true }).setInputFiles({
    name: "fixture.png",
    mimeType: "image/png",
    buffer: await readFile(resolve("tests/fixtures/makers.png")),
  });
  await expect(page.getByAltText("Calibration original artwork")).toBeVisible();
  await page.getByLabel(/The device is supervised/).check();
  await page
    .getByRole("button", { name: "Start physical calibration", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /storage.*unavailable|cannot.*save|cannot.*saved/i }),
  ).toBeVisible();
  expect(starts).toBe(0);
});
