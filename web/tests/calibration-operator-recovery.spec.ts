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
    outcome?: string;
    active?: boolean;
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
    version: 7,
    createdAt: "2026-10-23T09:00:00.000Z",
    artifact: { sha256: "a".repeat(64) },
    specVersion: 1,
    spec: {
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      crop: "contain",
      assetIds: ["original_art"],
      intent: "Offline calibration fixture",
      permission: "authorized",
    },
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
  const old = record("old", "old_fixture_request", options.outcome || "failed");
  if (options.active) machine.activeJobId = old.id;
  if (options.outcome === "needs_review") delete (old as any).evidence;
  const state = {
    machine,
    context,
    record,
    calibration: options.existing === false ? null : (old as any),
    records: options.existing === false ? [] : [old],
    starts: [] as any[],
    posts: [] as string[],
    queryKeys: [] as (string | null)[],
    revision: 1,
    actions: [] as { name: string; body: any }[],
    actionFailure: "",
    proofSkewMs: 0,
    malformed: "",
    holdAction: false,
    heldActions: [] as { route: Route; name: string }[],
    startMode: "success" as "success" | "unknown" | "wrong" | "rejected",
    failLookup: false,
    lifecycleFault: "" as "" | "missing" | "inconsistent",
    holdUploads: false,
    heldUploads: [] as Route[],
    uploads: 0,
    holdLookup: false,
    heldLookup: [] as { route: Route; body: any }[],
  };
  const parameters = {
    outputType: "sticker",
    widthMm: 53,
    heightMm: 50,
    quantity: 1,
    material: "thermal-paper",
    crop: "contain",
    specVersion: 1,
  };
  const finishAction = async (route: Route, name: string) => {
    if (state.actionFailure)
      return json(
        route,
        {
          error: { code: "RECOVERY_UNCONFIRMED", message: state.actionFailure },
        },
        409,
      );
    const submitted = route.request().postDataJSON();
    if (name === "reject")
      state.calibration = {
        ...state.calibration,
        version: state.calibration.version + 2,
        calibrationInspection: {
          outcome: "rejected",
          reason: submitted.reason,
          recordedAt: new Date().toISOString(),
          attemptId: old.attemptId,
        },
      };
    if (name === "cancel-before-acceptance")
      state.calibration = {
        ...state.calibration,
        version: state.calibration.version + 2,
        productionState: "cancelled",
        executionCancellation: {
          status: "cancelled_before_acceptance",
          machine_id: machineId,
          job_id: old.id,
          attempt_id: old.attemptId,
          artifact_sha256: old.artifact.sha256,
          parameters,
          target_scope: "calibration",
          expected_mode: "hardware",
          cancelled_at: new Date(Date.now() + state.proofSkewMs).toISOString(),
        },
      };
    if (name === "resolve")
      state.calibration = {
        ...state.calibration,
        version: state.calibration.version + 2,
        productionState:
          submitted.result === "completed" ? "produced" : "failed",
      };
    if (name !== "calibrate") machine.activeJobId = null;
    state.revision++;
    let body: any = { calibration: structuredClone(state.calibration) };
    if (state.malformed === "reject-identity")
      body = { calibration: { ...old, id: "different_attempt" } };
    if (state.malformed && name === "cancel-before-acceptance") {
      const proof = body.calibration.executionCancellation;
      if (state.malformed === "artifact")
        proof.artifact_sha256 = "b".repeat(64);
      if (state.malformed === "mode") proof.expected_mode = "simulation";
      if (state.malformed === "parameters") proof.parameters.widthMm = 25;
      if (state.malformed === "timestamp")
        proof.cancelled_at = new Date(Date.now() + 120000).toISOString();
      if (state.malformed === "timestamp-before-created")
        proof.cancelled_at = new Date(
          Date.parse(state.calibration.createdAt) - 120000,
        ).toISOString();
    }
    return json(route, body);
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
          canRequestCancellation: Boolean(
            state.calibration &&
            active === state.calibration.id &&
            ["dispatched", "needs_review"].includes(
              state.calibration.productionState,
            ),
          ),
          canRequestNew:
            !active &&
            !reserved &&
            machine.paired &&
            machine.configured &&
            !machine.policyReconciliationRequired,
          context: context(),
          contextMatch: state.calibration?.calibrationDeviceContext
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
    const actionName = path.endsWith("/calibrate")
      ? "calibrate"
      : path.split("/").at(-1)!;
    if (
      ["reject", "resolve", "calibrate", "cancel-before-acceptance"].includes(
        actionName,
      )
    ) {
      state.actions.push({
        name: actionName,
        body: route.request().postDataJSON(),
      });
      if (state.holdAction) {
        state.heldActions.push({ route, name: actionName });
        return;
      }
      return finishAction(route, actionName);
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
  return Object.assign(state, { finishAction });
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
const recovery = (page: Page) => page.locator(".calibration-action-recovery");
async function inspect(page: Page) {
  await page.getByLabel(inspectionLabel, { exact: true }).check();
  await page
    .getByLabel("Calibration inspection reason", { exact: true })
    .fill("Inspected this exact attempt; its output cannot be used.");
}
async function visibleError(page: Page) {
  await expect(recovery(page)).toBeFocused();
  await expect
    .poll(async () => {
      const box = await recovery(page).boundingBox();
      return Boolean(
        box &&
        box.y >= 0 &&
        box.y + box.height <= (await page.evaluate(() => innerHeight)),
      );
    })
    .toBe(true);
}

test("rejecting unusable completed output retains the execution fact and requires deliberate new preparation (offline fixture)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 664 });
  const state = await fixture(page, { outcome: "produced", active: true });
  await inspect(page);
  await page
    .getByRole("button", { name: "Reject calibration output", exact: true })
    .click();
  await expect(
    page.getByText(/Calibration output rejected\. Execution remains completed/),
  ).toBeVisible();
  expect(state.calibration.productionState).toBe("produced");
  expect(state.actions).toEqual([
    {
      name: "reject",
      body: {
        attemptId: "attempt_old",
        expectedVersion: 7,
        expectedContext: state.context(),
        inspected: true,
        reason: "Inspected this exact attempt; its output cannot be used.",
      },
    },
  ]);
  await expect(
    page.getByRole("button", {
      name: "Confirm usable calibration",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(prepare(page)).toBeEnabled();
  await expect(prepare(page)).toBeFocused();
  expect(state.starts).toEqual([]);
});

test("unknown device acceptance can be cancelled only with a matching proof, without claiming a physical stop (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, { outcome: "needs_review", active: true });
  await expect(
    page.getByRole("button", {
      name: "Confirm usable calibration",
      exact: true,
    }),
  ).toBeDisabled();
  await inspect(page);
  await page
    .getByRole("button", {
      name: "Cancel before device acceptance",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(/node durably cancelled this attempt before acceptance/),
  ).toBeVisible();
  expect(state.calibration.productionState).toBe("cancelled");
  expect(state.actions[0].body.expectedVersion).toBe(7);
  await expect(prepare(page)).toBeEnabled();
  expect(state.starts).toEqual([]);
});

for (const malformed of [
  "artifact",
  "mode",
  "parameters",
  "timestamp",
  "timestamp-before-created",
])
  test(`a mismatched ${malformed} cancellation proof cannot authorize a replacement (offline fixture)`, async ({
    page,
  }) => {
    const state = await fixture(page, {
      outcome: "needs_review",
      active: true,
    });
    state.malformed = malformed;
    await inspect(page);
    await page
      .getByRole("button", {
        name: "Cancel before device acceptance",
        exact: true,
      })
      .click();
    await expect(recovery(page)).toContainText(
      "could not be matched to this exact saved attempt",
    );
    await expect(
      page.getByText(/node durably cancelled this attempt before acceptance/),
    ).toHaveCount(0);
    await expect(prepare(page)).toHaveCount(0);
    expect(state.actions).toHaveLength(1);
    expect(state.starts).toEqual([]);
  });

test("a wrong rejection response preserves uncertainty instead of clearing the active guard (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, { outcome: "produced", active: true });
  state.malformed = "reject-identity";
  await inspect(page);
  await page
    .getByRole("button", { name: "Reject calibration output", exact: true })
    .click();
  await expect(recovery(page)).toContainText("could not be matched");
  await expect(prepare(page)).toHaveCount(0);
  expect(state.actions).toHaveLength(1);
  expect(state.starts).toEqual([]);
});

test("failed confirmation recovers locally at320px with an unchecked fresh inspection (offline fixture)", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 664 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await fixture(page, { outcome: "produced", active: true });
  state.actionFailure =
    "Calibration requires a fresh associated result camera frame";
  await inspect(page);
  await page
    .getByRole("button", { name: "Confirm usable calibration", exact: true })
    .click();
  await visibleError(page);
  await expect(page.locator('.owner-workshop > [role="alert"]')).toHaveCount(0);
  await expect(
    page.getByLabel(inspectionLabel, { exact: true }),
  ).not.toBeChecked();
  const audit = await new AxeBuilder({ page })
    .include(".physical-calibration")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await testInfo.attach("calibration-operator-accessibility", {
    body: JSON.stringify({
      state: "calibration-operator-error-320",
      rulesPassed: audit.passes.length,
      violations: audit.violations,
    }),
    contentType: "application/json",
  });
  expect(audit.violations).toEqual([]);
  await page.screenshot({
    path: "evidence/overnight-calibration-operator-error-320.png",
  });
  await recovery(page)
    .getByRole("button", {
      name: "Refresh saved calibration status",
      exact: true,
    })
    .click();
  await expect(page.getByLabel(inspectionLabel, { exact: true })).toBeFocused();
  await expect(
    page.getByLabel(inspectionLabel, { exact: true }),
  ).not.toBeChecked();
  expect(state.actions).toHaveLength(1);
  expect(state.starts).toEqual([]);
});

for (const operation of ["finalize", "resolve"])
  test(`a held ${operation} failure preserves a newer owner focus choice (offline fixture)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 664 });
    const state = await fixture(page, {
      outcome: operation === "resolve" ? "needs_review" : "produced",
      active: true,
    });
    state.holdAction = true;
    state.actionFailure = "The current result could not be confirmed";
    await inspect(page);
    if (operation === "resolve") {
      await page
        .getByText("Resolve an uncertain calibration attempt", { exact: true })
        .click();
      await page
        .getByRole("button", { name: "Record observed outcome", exact: true })
        .click();
    } else
      await page
        .getByRole("button", {
          name: "Confirm usable calibration",
          exact: true,
        })
        .click();
    await expect.poll(() => state.heldActions.length).toBe(1);
    const summary = page.locator(".physical-calibration > summary");
    await summary.focus();
    const position = await page.evaluate(() => scrollY);
    await state.finishAction(
      state.heldActions[0].route,
      state.heldActions[0].name,
    );
    await expect(recovery(page)).toContainText("could not be confirmed");
    await expect(summary).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(position);
    expect(state.actions).toHaveLength(1);
    expect(state.starts).toEqual([]);
  });

test("failed resolution retains usable local retry across repeated lookup failures without resubmission (offline fixture)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 664 });
  const state = await fixture(page, { outcome: "needs_review", active: true });
  state.actionFailure =
    "The worker is still active; wait before recording its outcome";
  await inspect(page);
  await page
    .getByText("Resolve an uncertain calibration attempt", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Record observed outcome", exact: true })
    .click();
  await visibleError(page);
  state.failLookup = true;
  const retry = recovery(page).getByRole("button", {
    name: "Refresh saved calibration status",
    exact: true,
  });
  for (let index = 0; index < 2; index++) {
    await retry.focus();
    await retry.press("Enter");
    await expect(retry).toBeEnabled();
    await expect(retry).toBeFocused();
  }
  state.failLookup = false;
  await retry.press("Enter");
  await expect(page.getByLabel(inspectionLabel, { exact: true })).toBeFocused();
  await expect(
    page.getByLabel(inspectionLabel, { exact: true }),
  ).not.toBeChecked();
  expect(state.actions).toHaveLength(1);
  expect(state.starts).toEqual([]);
});

test("rejecting another known current attempt never settles an unmatched pending-start checkpoint (offline fixture)", async ({
  page,
}) => {
  const stored = JSON.stringify({
    v: 2,
    key: "unmatched_original_key",
    pending: true,
  });
  const state = await fixture(page, {
    outcome: "produced",
    active: true,
    stored,
  });
  await inspect(page);
  await page
    .getByRole("button", { name: "Reject calibration output", exact: true })
    .click();
  await expect(page.getByText(/Calibration output rejected/)).toBeVisible();
  await expect(prepare(page)).toHaveCount(0);
  await expect(
    surface(page).getByRole("heading", {
      name: "Saved inactive calibration",
      exact: true,
    }),
  ).toBeFocused();
  expect(
    await page.evaluate((slot) => sessionStorage.getItem(slot), slot),
  ).toBe(stored);
  expect(state.actions.map((action) => action.name)).toEqual(["reject"]);
  expect(state.starts).toEqual([]);
});

test("Cancel calibration preparation clears only the local unsent draft and restores keyboard entry at320px (offline fixture)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 664 });
  const state = await fixture(page, { outcome: "produced" });
  await prepare(page).focus();
  await prepare(page).press("Enter");
  await upload(page);
  await page.getByLabel("Calibration width (mm)", { exact: true }).fill("");
  const cancel = page.getByRole("button", {
    name: "Cancel calibration preparation",
    exact: true,
  });
  await cancel.focus();
  await cancel.press("Enter");
  await expect(prepare(page)).toBeFocused();
  await expect(page.getByText(/Attempt attempt_old\./)).toBeVisible();
  await expect(page.getByAltText("Calibration original artwork")).toHaveCount(
    0,
  );
  await prepare(page).press("Enter");
  await expect(
    page.getByLabel("Calibration width (mm)", { exact: true }),
  ).toHaveValue("53");
  await expect(ready(page)).not.toBeChecked();
  expect(state.actions).toEqual([]);
  expect(state.starts).toEqual([]);
});

test("an exact cancellation proof tolerates a five-second node clock delay without losing its bound identity (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, { outcome: "needs_review", active: true });
  state.calibration.createdAt = new Date().toISOString();
  state.proofSkewMs = -5000;
  await readStatus(page);
  await inspect(page);
  await page
    .getByRole("button", {
      name: "Cancel before device acceptance",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(/node durably cancelled this attempt before acceptance/),
  ).toBeVisible();
  await expect(prepare(page)).toBeEnabled();
  expect(state.actions).toHaveLength(1);
  expect(state.starts).toEqual([]);
});

test("negative inspection cleanup remains reachable for a legacy active attempt without granting device readiness (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, { outcome: "produced", active: true });
  state.machine.paired = false;
  state.machine.configured = false;
  state.machine.policyReconciliationRequired = true;
  state.machine.reservation = {
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  delete state.calibration.calibrationDeviceContext;
  state.revision++;
  await refresh(page);
  await readStatus(page);
  await inspect(page);
  await expect(
    page.getByRole("button", {
      name: "Confirm usable calibration",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Reject calibration output", exact: true })
    .click();
  await expect(page.getByText(/Calibration output rejected/)).toBeVisible();
  expect(state.machine.policyReconciliationRequired).toBe(true);
  expect(state.machine.reservation).toBeTruthy();
  expect(state.machine.ready).toBe(false);
  expect(state.actions).toHaveLength(1);
  expect(state.starts).toEqual([]);
});
