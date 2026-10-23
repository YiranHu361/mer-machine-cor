import { openProviderDetails } from "./provider-controls";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const firstCapture = "2026-10-23T10:30:00.000Z";
const secondCapture = "2026-10-23T10:31:00.000Z";
const tiny = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
function deferred() {
  let release!: () => void;
  return {
    promise: new Promise<void>((done) => {
      release = done;
    }),
    release: () => release(),
  };
}
async function fixture(
  page: Page,
  kind: "requester" | "owner" | "calibration",
) {
  const isCalibration = kind === "calibration";
  const machine = {
    id: "evidence_frame_machine",
    name: "Evidence frame fixture",
    model: "Phomemo M02Pro",
    outputType: "sticker",
    adapterVersion: "offline-frame-v1",
    mode: isCalibration ? "hardware" : "simulation",
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
    collectionPoint: "Isolated frame desk",
    policy: { authorizedArtwork: true, maxQuantity: 10 },
  };
  const evidenceUrl = isCalibration
    ? `/api/owner/machines/${machine.id}/calibration/evidence`
    : "/api/jobs/job_frame_context/evidence";
  const job = {
    id: "job_frame_context",
    version: 1,
    specVersion: 1,
    createdAt: firstCapture,
    updatedAt: firstCapture,
    spec: {
      assetIds: [],
      intent: "Frame context fixture artwork",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    artifact: {
      id: "saved_source_artifact",
      url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
      sha256: "a".repeat(64),
    },
    productionState: "needs_review",
    paymentState: "release_pending",
    fulfillmentState: "unprepared",
    attemptId: "attempt_first_frame",
    machineId: machine.id,
    history: [],
    evidence: {
      url: evidenceUrl,
      jobId: "job_frame_context",
      result: "review",
      reason: "First captured frame fixture",
      capturedAt: firstCapture,
      machineId: machine.id,
      source: "simulation",
      completionCredible: false,
    },
  };
  const calibration = {
    id: "calibration_frame_first",
    version: 1,
    machineId: machine.id,
    attemptId: "calibration_attempt_first",
    productionState: "produced",
    evidence: {
      url: evidenceUrl,
      capturedAt: firstCapture,
      machineId: machine.id,
      jobId: "calibration_frame_first",
    },
  };
  const state = {
    job,
    calibration,
    revision: 1,
    imageRequests: [] as string[],
    mutations: [] as string[],
    hold: null as ReturnType<typeof deferred> | null,
  };
  const bytes = await readFile(resolve("tests/fixtures/makers.png"));
  await page.addInitScript((selected) => {
    localStorage.setItem("fabrary-current-job", selected);
    const sources = new Set<{ handler?: () => void }>();
    (window as any).__frameFixtureRefresh = () => {
      for (const source of sources) source.handler?.();
    };
    (window as any).EventSource = class {
      handler?: () => void;
      constructor() {
        sources.add(this);
      }
      addEventListener(name: string, handler: () => void) {
        if (name === "refresh") this.handler = handler;
      }
      close() {
        sources.delete(this);
      }
    };
  }, job.id);
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      state.mutations.push(path);
      return route.fulfill({
        status: 405,
        body: "Only isolated fixture reads are allowed",
      });
    }
    if (path === evidenceUrl) {
      state.imageRequests.push(route.request().url());
      const first = state.imageRequests.length === 1;
      await state.hold?.promise;
      return route.fulfill({
        contentType: "image/png",
        body: first ? tiny : bytes,
      });
    }
    const data: Record<string, unknown> = {
      "/api/health": {
        mode: machine.mode,
        paymentMode: "mock",
        store: "frame-context-ui-fixture",
      },
      "/api/session": {
        id: "frame_fixture_user",
        role: kind === "requester" ? "requester" : "owner",
      },
      "/api/jobs": { revision: state.revision, jobs: [state.job] },
      "/api/owner/dashboard": {
        revision: state.revision,
        machines: isCalibration ? [machine] : [],
        jobs: isCalibration ? [] : [state.job],
        ledger: [],
      },
      "/api/machines": { revision: state.revision, machines: [] },
      "/api/catalog": { models: [] },
      [`/api/owner/machines/${machine.id}/calibration`]: {
        calibration: state.calibration,
        status: {
          execution_status:
            state.calibration.productionState === "produced"
              ? "completed"
              : "failed",
        },
        lifecycle: {
          activeJobId: null,
          calibrationActive: false,
          canRequestCancellation: false,
          canRequestNew: true,
          context: "c".repeat(64),
          contextMatch: null,
          reasonCode: "NEW_CALIBRATION_ALLOWED",
          reason:
            "Saved idle fixture permits an explicitly supervised new request.",
        },
      },
    };
    return route.fulfill({
      status: data[path] ? 200 : 405,
      contentType: "application/json",
      body: JSON.stringify(
        data[path] ?? { error: { message: "Unknown isolated fixture read" } },
      ),
    });
  });
  await page.goto(kind === "requester" ? "/" : "/owner");
  if (isCalibration) {
    await page.getByRole("tab", { name: "Machines", exact: true }).click();
    await openProviderDetails(page, "Physical calibration job & inspection");
  }
  const surface = page.locator(
    isCalibration
      ? ".calibration-evidence"
      : kind === "requester"
        ? ".evidence"
        : ".owner-evidence",
  );
  const refresh = async () => {
    const endpoint = isCalibration
      ? `/api/owner/machines/${machine.id}/calibration`
      : kind === "requester"
        ? "/api/jobs"
        : "/api/owner/dashboard";
    const response = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === endpoint &&
        response.status() === 200,
    );
    if (isCalibration)
      await page
        .getByRole("button", {
          name: "Refresh calibration status",
          exact: true,
        })
        .click();
    else await page.evaluate(() => (window as any).__frameFixtureRefresh());
    await (await response).finished();
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
  };
  return { state, surface, refresh };
}
async function captureLabel(page: Page, timestamp: string) {
  return page.evaluate(
    (value) =>
      new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    timestamp,
  );
}

for (const kind of ["requester", "owner", "calibration"] as const)
  test(`${kind} evidence binds decoded images to the current frame and attempt behind a stable URL (offline fixture)`, async ({
    page,
  }) => {
    const f = await fixture(page, kind);
    try {
      const image = f.surface.getByRole("img");
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate(
            (element) => (element as HTMLImageElement).naturalWidth,
          ),
        )
        .toBe(1);
      const firstImage = await image.elementHandle();
      expect(firstImage).not.toBeNull();
      const firstSource = await image.getAttribute("src");
      // Result labels, payment progress and ordinary parent refreshes do not
      // change the frame identity or refetch an already decoded image.
      f.state.job.evidence.result = "pass";
      f.state.job.evidence.reason =
        "Same captured image, updated recorded decision";
      f.state.job.paymentState = "released";
      f.state.job.version++;
      f.state.calibration.productionState = "failed";
      f.state.revision++;
      await f.refresh();
      if (kind === "calibration")
        await expect(page.locator(".calibration-status")).toContainText(
          "failed",
        );
      else await expect(f.surface).toContainText(f.state.job.evidence.reason);
      expect(await firstImage!.evaluate((element) => element.isConnected)).toBe(
        true,
      );
      await expect(image).toHaveAttribute("src", firstSource!);
      expect(f.state.imageRequests).toHaveLength(1);

      f.state.hold = deferred();
      f.state.job.evidence.capturedAt = secondCapture;
      f.state.job.evidence.reason = "Second freshly captured image fixture";
      f.state.job.version++;
      f.state.calibration.evidence.capturedAt = secondCapture;
      f.state.revision++;
      await f.refresh();
      await expect(f.surface).toContainText(
        await captureLabel(page, secondCapture),
      );
      expect(await firstImage!.evaluate((element) => element.isConnected)).toBe(
        false,
      );
      await expect(f.surface.getByRole("status")).toHaveText(
        "Loading result image…",
      );
      await expect(image).toHaveCount(0);
      await expect.poll(() => f.state.imageRequests.length).toBe(2);
      expect(f.state.mutations).toEqual([]);
      f.state.hold.release();
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate(
            (element) => (element as HTMLImageElement).naturalWidth,
          ),
        )
        .toBeGreaterThan(1);
      const secondImage = await image.elementHandle();
      expect(secondImage).not.toBeNull();
      expect(await image.getAttribute("src")).not.toBe(firstSource);

      // A new attempt can retain the same captured timestamp and endpoint.
      f.state.hold = deferred();
      f.state.job.attemptId = "attempt_second_frame";
      f.state.job.evidence.reason =
        "Evidence belongs to the replacement attempt";
      f.state.job.version++;
      f.state.calibration.id = "calibration_frame_second";
      f.state.calibration.attemptId = "calibration_attempt_second";
      f.state.calibration.evidence.jobId = f.state.calibration.id;
      f.state.revision++;
      await f.refresh();
      if (kind === "calibration")
        await expect(page.locator(".calibration-status")).toContainText(
          "calibration_attempt_second",
        );
      else await expect(f.surface).toContainText(f.state.job.evidence.reason);
      expect(
        await secondImage!.evaluate((element) => element.isConnected),
      ).toBe(false);
      await expect(f.surface.getByRole("status")).toHaveText(
        "Loading result image…",
      );
      await expect(image).toHaveCount(0);
      await expect.poll(() => f.state.imageRequests.length).toBe(3);
      f.state.hold.release();
      await expect(image).toBeVisible();
      expect(new Set(f.state.imageRequests).size).toBe(3);
      expect(f.state.mutations).toEqual([]);
      await firstImage!.dispose();
      await secondImage!.dispose();
    } finally {
      f.state.hold?.release();
    }
  });
