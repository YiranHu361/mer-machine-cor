import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("a terminal calibration's stale bound image fails readably and explicit metadata refresh loads only its new exact frame (offline fixture)", async ({
  page,
}, testInfo) => {
  const machineId = "evidence_binding_fixture";
  const endpoint = `/api/owner/machines/${machineId}/calibration`;
  const frameA = "a".repeat(64),
    frameB = "b".repeat(64);
  const calibration = (suffix: string, frame: string) => ({
    id: `calibration_${suffix}`,
    version: 1,
    machineId,
    attemptId: `attempt_${suffix}`,
    productionState: "produced",
    evidence: {
      url: `${endpoint}/evidence?frame=${frame}&calibration=calibration_${suffix}`,
      jobId: `calibration_${suffix}`,
      machineId,
      capturedAt:
        suffix === "A"
          ? "2026-10-23T10:00:00.000Z"
          : "2026-10-23T10:01:00.000Z",
    },
  });
  const old = calibration("A", frameA),
    fresh = calibration("B", frameB);
  const machine = {
    id: machineId,
    name: "Bound evidence printer",
    model: "Phomemo M02Pro",
    outputType: "sticker",
    adapterVersion: "offline-evidence-fixture",
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
    collectionPoint: "Isolated fixture desk",
  };
  const bytes = await readFile(resolve("tests/fixtures/makers.png"));
  const imageReads: {
    frame: string | null;
    calibration: string | null;
    nonce: string | null;
    status: number;
  }[] = [];
  const mutations: string[] = [],
    errors: string[] = [];
  let metadataReads = 0;
  await page.clock.install();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (route.request().method() !== "GET") {
      mutations.push(path);
      return route.fulfill({
        status: 405,
        body: "No mutations or physical actions in this fixture",
      });
    }
    let body: unknown;
    if (path === "/api/health")
      body = {
        mode: "hardware",
        paymentMode: "mock",
        store: "offline-bound-evidence-fixture",
      };
    else if (path === "/api/session")
      body = { role: "owner", id: "evidence_binding_owner" };
    else if (path === "/api/owner/dashboard")
      body = { revision: 1, machines: [machine], jobs: [], ledger: [] };
    else if (path === endpoint) {
      metadataReads++;
      body = {
        calibration: metadataReads === 1 ? old : fresh,
        status: { execution_status: "completed" },
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
      };
    } else if (path === `${endpoint}/evidence`) {
      const frame = url.searchParams.get("frame"),
        id = url.searchParams.get("calibration");
      const status = frame === frameB && id === fresh.id ? 200 : 409;
      imageReads.push({
        frame,
        calibration: id,
        nonce: url.searchParams.get("fabrary_image_retry"),
        status,
      });
      return route.fulfill({
        status,
        contentType: status === 200 ? "image/png" : "application/json",
        body:
          status === 200
            ? bytes
            : JSON.stringify({
                error: {
                  code: "EVIDENCE_CHANGED",
                  message:
                    "The saved frame changed. Refresh saved calibration metadata.",
                },
              }),
      });
    } else if (path === "/api/events")
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": offline evidence fixture\n\n",
      });
    else
      return route.fulfill({
        status: 405,
        body: "Only isolated fixture reads allowed",
      });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("/owner");
  await page
    .getByRole("tab", { name: "Machines & policy", exact: true })
    .click();
  await page
    .getByText("Physical calibration job & inspection", { exact: true })
    .click();
  const surface = page.locator(".calibration-evidence");
  await expect(surface.getByRole("status")).toHaveText(
    "The result image could not be displayed.",
  );
  await expect(surface).toContainText(
    "inspect the machine and recorded outcome",
  );
  await expect(surface.getByRole("img")).toHaveCount(0);
  expect(imageReads).toHaveLength(1);
  expect(imageReads[0]).toMatchObject({
    frame: frameA,
    calibration: old.id,
    status: 409,
  });
  await page.clock.fastForward(3500);
  expect(metadataReads).toBe(1); // Terminal attempts do not poll; refresh must remain usable.
  await surface
    .getByRole("button", { name: "Retry result image", exact: true })
    .click();
  await expect.poll(() => imageReads.length).toBe(2);
  await expect(surface.getByRole("status")).toHaveText(
    "The result image could not be displayed.",
  );
  expect(imageReads[1]).toMatchObject({
    frame: frameA,
    calibration: old.id,
    status: 409,
  });
  expect(imageReads[1].nonce).not.toBe(imageReads[0].nonce);
  expect(metadataReads).toBe(1);
  await page
    .getByRole("button", { name: "Refresh calibration status", exact: true })
    .click();
  const image = surface.getByRole("img", {
    name: "Fresh calibration evidence for Bound evidence printer",
    exact: true,
  });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(surface.getByRole("status")).toHaveCount(0);
  await expect(surface.getByRole("link")).toHaveAttribute(
    "href",
    fresh.evidence.url,
  );
  const displayed = new URL((await image.getAttribute("src"))!);
  expect(displayed.searchParams.get("frame")).toBe(frameB);
  expect(displayed.searchParams.get("calibration")).toBe(fresh.id);
  expect(metadataReads).toBe(2);
  expect(imageReads).toHaveLength(3);
  expect(imageReads[2]).toMatchObject({
    frame: frameB,
    calibration: fresh.id,
    status: 200,
  });
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
  await testInfo.attach("bound-evidence-recovery", {
    contentType: "application/json",
    body: JSON.stringify({ metadataReads, imageReads, mutations }),
  });
});
