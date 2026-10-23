import { test, expect, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openProviderDetails } from "./provider-controls";
import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";

const machineId = "calibration_retry_fixture";
const slot = `fabrary-calibration-${machineId}`;
const readyLabel =
  "The device is supervised, the output area is clear and I am ready to start this physical calibration.";
const inspectionLabel =
  "I inspected this device and the output state for this calibration attempt.";
const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
async function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
async function fixture(
  page: Page,
  options: {
    stored?: string;
    output?: "sticker" | "3d";
    existing?: boolean;
  } = {},
) {
  const machine: any = {
    id: machineId,
    registrationId: "registration_one",
    name: "Calibration retry printer",
    model: "Fixture finite adapter",
    outputType: options.output || "sticker",
    mode: "hardware",
    adapterVersion: "fixture-v1",
    paired: true,
    configured: true,
    calibrated: false,
    listed: false,
    ready: false,
    paused: true,
    mediaRemaining: 100,
    material: options.output === "3d" ? "pla" : "thermal-paper",
    priceCard: { consumables: 10, machine: 10, handling: 10, platform: 5 },
    hours: { start: 0, end: 24 },
    maxJobSeconds: 120,
    collectionPoint: "Offline test desk",
  };
  const context = () =>
    createHash("sha256")
      .update(
        JSON.stringify([
          machine.id,
          machine.registrationId,
          machine.mode,
          machine.outputType,
          machine.adapterVersion,
          machine.material,
          machine.paired,
          machine.configured,
        ]),
      )
      .digest("hex");
  const record = (
    suffix: string,
    key: string,
    productionState = "failed",
    bound = context(),
  ) => ({
    id: `calibration_${suffix}`,
    version: 1,
    machineId,
    checkoutKey: key,
    attemptId: `attempt_${suffix}`,
    calibrationDeviceContext: bound,
    productionState,
    evidence: {
      url: pixel,
      capturedAt: "2026-10-23T11:00:00.000Z",
      machineId,
      jobId: `calibration_${suffix}`,
    },
  });
  const old = record("old", "old_fixture_request");
  const state = {
    machine,
    context,
    record,
    calibration:
      options.existing === false
        ? null
        : (old as ReturnType<typeof record> | null),
    records: options.existing === false ? [] : [old],
    starts: [] as any[],
    posts: [] as string[],
    queryKeys: [] as (string | null)[],
    revision: 1,
    startMode: "success" as "success" | "unknown" | "wrong" | "rejected",
    failLookup: false,
    lifecycleFault: "" as "" | "missing" | "inconsistent",
    holdUploads: false,
    heldUploads: [] as Route[],
    uploads: 0,
    holdLookup: false,
    heldLookup: [] as { route: Route; body: any }[],
  };
  if (options.stored)
    await page.addInitScript(
      ({ slot, stored }) => sessionStorage.setItem(slot, stored),
      { slot, stored: options.stored },
    );
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.addInitScript(() => {
    const callbacks: Array<() => void> = [];
    class Events {
      onopen: (() => void) | null = null;
      onerror = null;
      onmessage = null;
      constructor() {
        queueMicrotask(() => this.onopen?.());
      }
      addEventListener(name: string, callback: () => void) {
        if (name === "refresh") callbacks.push(callback);
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: Events });
    (window as any).refreshCalibrationRetryFixture = () =>
      callbacks.forEach((callback) => callback());
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      method = route.request().method();
    if (method !== "GET") state.posts.push(path);
    if (path === "/api/health")
      return json(route, {
        mode: "hardware",
        paymentMode: "mock",
        store: "calibration-retry-fixture",
      });
    if (path === "/api/session")
      return json(route, { role: "owner", id: "calibration_retry_owner" });
    if (path === "/api/owner/dashboard")
      return json(route, {
        revision: state.revision,
        machines: [machine],
        jobs: [],
        ledger: [],
      });
    if (path === "/api/catalog")
      return json(route, {
        models: [
          {
            id: "prepared_model",
            name: "Inspected fixture model",
            artifactId: "prepared_art",
            widthMm: 25,
            heightMm: 35,
            depthMm: 10,
            color: "blue",
            estimatedSeconds: 60,
            material: "pla",
          },
        ],
      });
    if (path.endsWith("/calibration")) {
      if (state.failLookup)
        return json(
          route,
          {
            error: {
              message: "The saved calibration is temporarily unavailable.",
            },
          },
          503,
        );
      const active = machine.activeJobId || null,
        requested = url.searchParams.get("requestKey");
      state.queryKeys.push(requested);
      const reserved =
        machine.reservation &&
        (!Number.isFinite(Date.parse(machine.reservation.expiresAt)) ||
          Date.parse(machine.reservation.expiresAt) > Date.now());
      const body: any = {
        calibration: state.calibration,
        status: {
          execution_status:
            state.calibration?.productionState === "produced"
              ? "completed"
              : state.calibration?.productionState === "needs_review"
                ? "uncertain"
                : state.calibration?.productionState === "running"
                  ? "running"
                  : "failed",
        },
        lifecycle: {
          activeJobId: active,
          calibrationActive: Boolean(
            state.calibration && active === state.calibration.id,
          ),
          canRequestCancellation: false,
          canRequestNew:
            !active &&
            !reserved &&
            machine.paired &&
            machine.configured &&
            !machine.policyReconciliationRequired,
          context: context(),
          contextMatch: state.calibration
            ? state.calibration.calibrationDeviceContext === context()
            : null,
          reasonCode: active
            ? "MACHINE_ACTIVE"
            : reserved
              ? "RESERVED"
              : "AVAILABLE_TO_REQUEST",
          reason:
            "Offline saved-state permission only; hardware idleness has not been established.",
        },
        ...(requested
          ? {
              requestedCalibration:
                state.records.find((item) => item.checkoutKey === requested) ||
                null,
            }
          : {}),
      };
      if (state.lifecycleFault === "missing") delete body.lifecycle;
      if (state.lifecycleFault === "inconsistent")
        body.lifecycle = {
          ...body.lifecycle,
          activeJobId: "other_customer_job",
          canRequestCancellation: false,
          canRequestNew: true,
        };
      if (state.holdLookup) {
        state.heldLookup.push({ route, body: structuredClone(body) });
        return;
      }
      return json(route, body);
    }
    if (path === "/api/uploads") {
      state.uploads++;
      if (state.holdUploads) {
        state.heldUploads.push(route);
        return;
      }
      return json(route, {
        assets: [
          {
            id: `upload_${state.uploads}`,
            url: pixel,
            sha256: "b".repeat(64),
            width: 1,
            height: 1,
          },
        ],
      });
    }
    if (path.endsWith("/calibration/start")) {
      const body = route.request().postDataJSON();
      state.starts.push(body);
      if (state.startMode === "rejected")
        return json(
          route,
          {
            error: {
              code: "CALIBRATION_AUTHORIZATION_CHANGED",
              message:
                "The device context changed before any start was accepted.",
            },
          },
          409,
        );
      if (state.startMode === "unknown")
        return json(
          route,
          { error: { message: "The calibration acknowledgement was lost." } },
          500,
        );
      const next = record(
        `new_${state.starts.length}`,
        body.idempotencyKey,
        "running",
      );
      state.calibration = next;
      state.records.push(next);
      machine.activeJobId = next.id;
      state.revision++;
      return json(route, {
        calibration:
          state.startMode === "wrong"
            ? { ...next, checkoutKey: "different_request_key" }
            : next,
      });
    }
    if (path.endsWith("/calibration/resolve")) {
      state.calibration = { ...state.calibration!, productionState: "failed" };
      machine.activeJobId = undefined;
      state.revision++;
      return json(route, { calibration: state.calibration });
    }
    return json(
      route,
      {
        error: {
          message:
            "Physical/external operations are prohibited in this fixture.",
        },
      },
      405,
    );
  });
  await page.goto("/owner");
  await page.getByRole("tab", { name: "Machines", exact: true }).click();
  await openProviderDetails(page, "Physical calibration job & inspection");
  if (options.existing === false)
    await expect(
      page.getByLabel("Calibration artwork", { exact: true }),
    ).toBeEnabled();
  else await expect(page.getByText(/Attempt attempt_old\./)).toBeVisible();
  return state;
}
const surface = (page: Page) => page.locator(".physical-calibration");
const prepare = (page: Page) =>
  page.getByRole("button", {
    name: "Prepare a new supervised calibration",
    exact: true,
  });
const start = (page: Page) =>
  page.getByRole("button", { name: "Start physical calibration", exact: true });
const artwork = (page: Page) =>
  page.getByLabel("Calibration artwork", { exact: true });
const ready = (page: Page) => page.getByLabel(readyLabel, { exact: true });
async function refresh(page: Page) {
  await page.evaluate(() => (window as any).refreshCalibrationRetryFixture());
}
async function readStatus(page: Page) {
  await surface(page)
    .getByRole("button", { name: "Refresh calibration status", exact: true })
    .click();
}
async function upload(page: Page) {
  await artwork(page).setInputFiles(resolve("tests/fixtures/makers.png"));
  await expect(page.getByAltText("Calibration original artwork")).toBeVisible();
  await expect(artwork(page)).toBeEnabled();
}
async function checkpoint(page: Page) {
  return page.evaluate((slot) => {
    const value = sessionStorage.getItem(slot);
    return value ? JSON.parse(value) : null;
  }, slot);
}

test("a resolved inactive failure retains history and needs explicit fresh preparation, key, context and readiness before one new start (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, { stored: "old_fixture_request" });
  await expect(prepare(page)).toBeEnabled();
  await prepare(page).click();
  await expect(page.getByText(/Attempt attempt_old\./)).toBeVisible();
  await expect(ready(page)).not.toBeChecked();
  expect(state.starts).toEqual([]);
  await upload(page);
  await ready(page).check();
  await start(page).click();
  await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].idempotencyKey).not.toBe("old_fixture_request");
  expect(state.starts[0].expectedContext).toBe(state.context());
  await expect(page.getByText(/Attempt attempt_new_1\./)).toBeVisible();
  expect((await checkpoint(page)).pending).toBe(false);
});

test("a replacement setup cannot inherit old inspection and keeps fresh draft fields through the same historical read (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  state.machine.registrationId = "registration_two";
  state.machine.adapterVersion = "fixture-v2";
  state.revision++;
  await refresh(page);
  await openProviderDetails(page, "Connection details");
  await expect(page.getByText(/adapter fixture-v2/i)).toBeVisible();
  await expect(
    page.getByLabel(inspectionLabel, { exact: true }),
  ).toBeDisabled();
  await prepare(page).click();
  await upload(page);
  await page.getByLabel("Calibration width (mm)", { exact: true }).fill("");
  await page.getByLabel("Calibration height (mm)", { exact: true }).fill("75");
  await readStatus(page);
  await expect(
    page.getByLabel("Calibration width (mm)", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByLabel("Calibration height (mm)", { exact: true }),
  ).toHaveValue("75");
  await expect(page.getByAltText("Calibration original artwork")).toBeVisible();
  expect(state.starts).toEqual([]);
});

for (const gate of [
  "active",
  "customer",
  "reservation",
  "missing",
  "inconsistent",
] as const)
  test(`${gate} calibration permission cannot offer a fresh physical start (offline fixture)`, async ({
    page,
  }) => {
    const state = await fixture(page);
    if (gate === "active") {
      state.calibration!.productionState = "needs_review";
      state.machine.activeJobId = state.calibration!.id;
    }
    if (gate === "customer") state.machine.activeJobId = "customer_execution";
    if (gate === "reservation")
      state.machine.reservation = {
        jobId: "reserved_customer",
        expiresAt: "invalid-expiry",
      };
    if (gate === "missing" || gate === "inconsistent")
      state.lifecycleFault = gate;
    state.revision++;
    await refresh(page);
    await readStatus(page);
    await expect(prepare(page)).toHaveCount(0);
    await expect(start(page)).toHaveCount(0);
    if (gate === "active")
      await expect(
        page.getByLabel(inspectionLabel, { exact: true }),
      ).toBeEnabled();
    else
      await expect(
        page.getByLabel(inspectionLabel, { exact: true }),
      ).toBeDisabled();
    expect(state.starts).toEqual([]);
  });

test("a newer customer execution observed by the dashboard cancels an open preparation without submitting it (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await prepare(page).click();
  await upload(page);
  await ready(page).check();
  state.machine.activeJobId = "new_customer_execution";
  state.revision++;
  await refresh(page);
  await expect(start(page)).toHaveCount(0);
  await expect(artwork(page)).toHaveCount(0);
  await expect(
    page.getByLabel(inspectionLabel, { exact: true }),
  ).toBeDisabled();
  expect(state.starts).toEqual([]);
});

test("a registration change fences an old upload and its finally callback cannot unlock a newer upload (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await prepare(page).click();
  state.holdUploads = true;
  await artwork(page).setInputFiles(resolve("tests/fixtures/makers.png"));
  await expect.poll(() => state.heldUploads.length).toBe(1);
  state.machine.registrationId = "registration_two";
  state.machine.adapterVersion = "fixture-v2";
  state.revision++;
  await refresh(page);
  await openProviderDetails(page, "Connection details");
  await expect(page.getByText(/adapter fixture-v2/i)).toBeVisible();
  await expect(prepare(page)).toBeEnabled();
  await prepare(page).click();
  await artwork(page).setInputFiles(resolve("tests/fixtures/makers.png"));
  await expect.poll(() => state.heldUploads.length).toBe(2);
  await json(state.heldUploads[0], {
    assets: [{ id: "old_late_art", url: pixel, sha256: "a".repeat(64) }],
  });
  await expect(artwork(page)).toBeDisabled();
  await expect(page.getByAltText("Calibration original artwork")).toHaveCount(
    0,
  );
  await json(state.heldUploads[1], {
    assets: [{ id: "new_current_art", url: pixel, sha256: "b".repeat(64) }],
  });
  await expect(artwork(page)).toBeEnabled();
  await ready(page).check();
  await start(page).click();
  await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].spec.assetIds).toEqual(["new_current_art"]);
});

test("an uncertain new start keeps one pending checkpoint across absent reads and reload until its exact archived request is found (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await prepare(page).click();
  await upload(page);
  await ready(page).check();
  state.startMode = "unknown";
  await start(page).click();
  await expect(surface(page)).toContainText(
    "An earlier calibration request has not been matched",
  );
  const pending = await checkpoint(page);
  expect(pending.pending).toBe(true);
  await surface(page)
    .getByRole("button", {
      name: "Check saved calibration request",
      exact: true,
    })
    .click();
  expect(await checkpoint(page)).toEqual(pending);
  await expect(prepare(page)).toHaveCount(0);
  await page.reload();
  await page.getByRole("tab", { name: "Machines", exact: true }).click();
  await openProviderDetails(page, "Physical calibration job & inspection");
  await expect(surface(page)).toContainText(
    "An earlier calibration request has not been matched",
  );
  const recovered = state.record("recovered", pending.key, "failed");
  state.records.push(recovered);
  state.calibration = state.record(
    "later",
    "another_known_request",
    "produced",
  );
  state.records.push(state.calibration);
  state.revision++;
  await surface(page)
    .getByRole("button", {
      name: "Check saved calibration request",
      exact: true,
    })
    .click();
  await expect(prepare(page)).toBeEnabled();
  expect((await checkpoint(page)).pending).toBe(false);
  expect(state.queryKeys).toContain(pending.key);
  expect(state.starts).toHaveLength(1);
});

test("a definitely rejected authorization keeps the draft, settles its key and needs fresh readiness plus a deliberate retry (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await prepare(page).click();
  await upload(page);
  await page.getByLabel("Calibration height (mm)", { exact: true }).fill("75");
  await ready(page).check();
  state.startMode = "rejected";
  await start(page).click();
  await expect(surface(page)).toContainText(
    "No new calibration was accepted for this request",
  );
  await expect(ready(page)).not.toBeChecked();
  await expect(start(page)).toBeDisabled();
  await expect(
    page.getByLabel("Calibration height (mm)", { exact: true }),
  ).toHaveValue("75");
  await expect(artwork(page)).toBeEnabled();
  expect((await checkpoint(page)).pending).toBe(false);
  expect(state.starts).toHaveLength(1);
  state.startMode = "success";
  await ready(page).check();
  await start(page).click();
  await expect.poll(() => state.starts.length).toBe(2);
  expect(state.starts[1].idempotencyKey).not.toBe(
    state.starts[0].idempotencyKey,
  );
  expect(state.starts[1].spec.heightMm).toBe(75);
});

test("an unmatched legacy key remains blocked instead of silently rotating to a new attempt (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, { stored: "unknown_legacy_request" });
  await expect(surface(page)).toContainText(
    "An earlier calibration request has not been matched",
  );
  await expect(prepare(page)).toHaveCount(0);
  await surface(page)
    .getByRole("button", {
      name: "Check saved calibration request",
      exact: true,
    })
    .click();
  expect(
    await page.evaluate((slot) => sessionStorage.getItem(slot), slot),
  ).toBe("unknown_legacy_request");
  expect(state.starts).toEqual([]);
});

test("an unreadable retry checkpoint still permits explicit resolution of a valid active attempt without authorizing a new start (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, { stored: "{damaged-checkpoint" });
  state.calibration!.productionState = "needs_review";
  state.machine.activeJobId = state.calibration!.id;
  state.revision++;
  await refresh(page);
  await readStatus(page);
  await expect(page.getByLabel(inspectionLabel, { exact: true })).toBeEnabled();
  await page.getByLabel(inspectionLabel, { exact: true }).check();
  await page
    .getByLabel("Calibration inspection reason", { exact: true })
    .fill("Inspected this exact current attempt; no usable output exists");
  await page
    .getByText("Resolve an uncertain calibration attempt", { exact: true })
    .click();
  await page
    .getByLabel("Observed calibration outcome", { exact: true })
    .selectOption("failed");
  await page
    .getByRole("button", { name: "Record observed outcome", exact: true })
    .click();
  await expect.poll(() => state.calibration!.productionState).toBe("failed");
  await expect(prepare(page)).toHaveCount(0);
  expect(state.starts).toEqual([]);
  expect(
    await page.evaluate((slot) => sessionStorage.getItem(slot), slot),
  ).toBe("{damaged-checkpoint");
});

test("a malformed successful start reply keeps its pending key until an exact saved request is recovered (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await prepare(page).click();
  await upload(page);
  await ready(page).check();
  state.startMode = "wrong";
  await start(page).click();
  await expect(surface(page).getByRole("alert")).toContainText(
    "could not be matched",
  );
  const pending = await checkpoint(page);
  expect(pending.pending).toBe(true);
  await surface(page)
    .getByRole("button", {
      name: "Check saved calibration request",
      exact: true,
    })
    .click();
  await expect(page.getByText(/Attempt attempt_new_1\./)).toBeVisible();
  expect((await checkpoint(page)).pending).toBe(false);
  expect(state.starts).toHaveLength(1);
});

for (const failure of ["throw", "unretained"] as const)
  test(`${failure} checkpoint persistence prevents a POST and removes a known-not-sent orphan where storage permits (offline fixture)`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ slot, failure }) => {
        const set = Storage.prototype.setItem,
          get = Storage.prototype.getItem;
        let failRead = false;
        Storage.prototype.setItem = function (key, value) {
          if (
            this === sessionStorage &&
            key === slot &&
            JSON.parse(value).pending === true
          ) {
            if (failure === "throw")
              throw new DOMException("Storage denied", "SecurityError");
            set.call(this, key, value);
            failRead = true;
            return;
          }
          set.call(this, key, value);
        };
        Storage.prototype.getItem = function (key) {
          if (this === sessionStorage && key === slot && failRead) {
            failRead = false;
            return null;
          }
          return get.call(this, key);
        };
      },
      { slot, failure },
    );
    const state = await fixture(page);
    await prepare(page).click();
    await upload(page);
    await ready(page).check();
    await start(page).click();
    await expect(surface(page).getByRole("alert")).toContainText(
      "No job was started",
    );
    expect(state.starts).toEqual([]);
    expect(
      await page.evaluate((slot) => sessionStorage.getItem(slot), slot),
    ).toBeNull();
  });

test("a failed settlement checkpoint write remains recoverable by exact GET after reload without another POST (offline fixture)", async ({
  page,
}) => {
  await page.addInitScript((slot) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (
        this === sessionStorage &&
        key === slot &&
        JSON.parse(value).pending === false
      )
        throw new DOMException("Settlement write denied", "SecurityError");
      set.call(this, key, value);
    };
  }, slot);
  const state = await fixture(page);
  await prepare(page).click();
  await upload(page);
  await ready(page).check();
  await start(page).click();
  await expect(page.getByText(/Attempt attempt_new_1\./)).toBeVisible();
  const pending = await checkpoint(page);
  expect(pending.pending).toBe(true);
  state.machine.activeJobId = undefined;
  state.calibration!.productionState = "produced";
  state.revision++;
  await page.reload();
  await page.getByRole("tab", { name: "Machines", exact: true }).click();
  await openProviderDetails(page, "Physical calibration job & inspection");
  await expect(prepare(page)).toBeEnabled();
  expect(state.queryKeys).toContain(pending.key);
  expect(state.starts).toHaveLength(1);
});

test("prepared-model calibration keeps the inspected selection through history refresh and submits only after fresh readiness (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, { output: "3d" });
  await prepare(page).click();
  await page
    .getByLabel("Calibration prepared model", { exact: true })
    .selectOption("prepared_model");
  await readStatus(page);
  await expect(
    page.getByLabel("Calibration prepared model", { exact: true }),
  ).toHaveValue("prepared_model");
  await expect(ready(page)).not.toBeChecked();
  await ready(page).check();
  await start(page).click();
  await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].spec.preparedModelId).toBe("prepared_model");
});

test("fresh preparation is reachable and focused by keyboard at320px without stealing a newer focus choice (offline fixture)", async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 320, height: 664 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await fixture(page);
  await prepare(page).focus();
  await prepare(page).press("Enter");
  await expect(artwork(page)).toBeFocused();
  await page.keyboard.press(
    browserName === "webkit" && process.platform === "darwin"
      ? "Alt+Tab"
      : "Tab",
  );
  await expect(
    page.getByLabel("Calibration width (mm)", { exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const audit = await new AxeBuilder({ page })
    .include(".physical-calibration")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await test.info().attach("calibration-retry-accessibility", {
    body: JSON.stringify({
      state: "calibration-retry-320",
      rulesPassed: audit.passes.length,
      violations: audit.violations,
    }),
    contentType: "application/json",
  });
  expect(audit.violations).toEqual([]);
  await artwork(page).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "evidence/overnight-calibration-retry-320.png",
  });
  await page
    .getByRole("button", {
      name: "Cancel calibration preparation",
      exact: true,
    })
    .click();
  await prepare(page).focus();
  await page.evaluate(() => {
    const button = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find(
      (node) =>
        node.textContent?.trim() === "Prepare a new supervised calibration",
    )!;
    button.click();
    document
      .querySelector<HTMLElement>(".physical-calibration > summary")!
      .focus();
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.locator(".physical-calibration > summary")).toBeFocused();
  expect(state.starts).toEqual([]);
});
