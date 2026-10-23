import { test, expect, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const at = "2026-10-23T10:30:00.000Z";
const calibration = (suffix = "one") => ({
  id: `calibration_${suffix}`,
  attemptId: `calibration_attempt_${suffix}`,
  productionState: "produced",
  evidence: {
    url: `/fixture-calibration-${suffix}.png`,
    capturedAt: at,
    machineId: "calibration_recovery_fixture",
    jobId: `calibration_${suffix}`,
  },
});
async function fixture(
  page: Page,
  existing = true,
  lookup:
    "ready" | "held" | "failed" | "malformed" | "malformed-status" = "ready",
) {
  const state = {
    calibration: existing
      ? calibration()
      : (null as ReturnType<typeof calibration> | null),
    imageAvailable: false,
    starts: [] as Record<string, any>[],
    mutations: [] as string[],
    revision: 1,
    holdLookup: lookup === "held",
    heldLookups: [] as Route[],
    lookupStatus: lookup === "failed" ? 503 : 200,
    malformedLookup: lookup === "malformed",
    statusValue: (lookup === "malformed-status"
      ? { execution_status: { malformed: true } }
      : { execution_status: "completed" }) as unknown,
  };
  const machine = {
    id: "calibration_recovery_fixture",
    name: "Calibration fixture printer",
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
    collectionPoint: "Isolated fixture desk",
  };
  const bytes = await readFile(resolve("tests/fixtures/makers.png"));
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.route("**/fixture-calibration-*.png*", async (route) => {
    await route.fulfill({
      status: state.imageAvailable ? 200 : 403,
      contentType: state.imageAvailable ? "image/png" : "text/plain",
      body: state.imageAvailable ? bytes : "Unavailable fixture evidence",
    });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method !== "GET") state.mutations.push(path);
    let body: unknown;
    if (path === "/api/health")
      body = {
        mode: "hardware",
        paymentMode: "mock",
        store: "calibration-ui-fixture-no-hardware",
      };
    else if (path === "/api/session")
      body = { role: "owner", id: "calibration_fixture_owner" };
    else if (path === "/api/owner/dashboard")
      body = {
        revision: state.revision,
        machines: [machine],
        jobs: [],
        ledger: [],
      };
    else if (path.endsWith("/calibration")) {
      if (state.holdLookup) {
        state.heldLookups.push(route);
        return;
      }
      if (state.lookupStatus !== 200)
        return route.fulfill({
          status: state.lookupStatus,
          contentType: "application/json",
          body: JSON.stringify({
            error: { message: "Saved calibration is temporarily unavailable" },
          }),
        });
      if (state.malformedLookup)
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ status: { execution_status: "completed" } }),
        });
      body = {
        calibration: state.calibration,
        status: state.statusValue,
      };
    } else if (path === "/api/uploads" && method === "POST")
      body = {
        assets: [
          {
            id: "fixture_art",
            url: `data:image/png;base64,${bytes.toString("base64")}`,
            sha256: "fixture-original",
          },
        ],
      };
    else if (path.endsWith("/calibration/start") && method === "POST") {
      state.starts.push(route.request().postDataJSON());
      state.calibration = calibration();
      body = { calibration: state.calibration };
    } else if (path === "/api/events")
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": offline calibration fixture\n\n",
      });
    else
      return route.fulfill({
        status: 405,
        body: "All physical/external operations are forbidden in this fixture",
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
  return Object.assign(state, { machine });
}

test("calibration numeric fields can be cleared and retyped without replacing blank with zero (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, false);
  await page
    .getByLabel("Calibration artwork", { exact: true })
    .setInputFiles(resolve("tests/fixtures/makers.png"));
  const width = page.getByLabel("Calibration width (mm)", { exact: true });
  const height = page.getByLabel("Calibration height (mm)", { exact: true });
  await expect(page.getByAltText("Calibration original artwork")).toBeVisible();
  for (const input of [width, height]) {
    await expect(input).toBeEnabled();
    await input.focus();
    await input.press("ControlOrMeta+A");
    await input.press("Backspace");
    await expect(input).toHaveValue("");
  }
  await page
    .getByText(
      "The device is supervised, the output area is clear and I am ready to start this physical calibration.",
      { exact: true },
    )
    .click();
  await page
    .getByRole("button", { name: "Start physical calibration", exact: true })
    .click();
  expect(state.starts).toHaveLength(0);
  await width.pressSequentially("25");
  await height.pressSequentially("75");
  await page
    .getByRole("button", { name: "Start physical calibration", exact: true })
    .click();
  await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].spec).toMatchObject({
    widthMm: 25,
    heightMm: 75,
    quantity: 1,
  });
  expect(state.starts[0].ownerReady).toBe(true);
});

test("unavailable calibration evidence has an image-only retry without starting or confirming hardware (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  const imageArea = page.locator(".calibration-evidence");
  await expect(imageArea.getByRole("status")).toContainText(
    "The result image could not be displayed.",
  );
  state.imageAvailable = true;
  await imageArea
    .getByRole("button", { name: "Retry result image", exact: true })
    .click();
  await expect(imageArea.getByRole("img")).toBeVisible();
  await expect
    .poll(() =>
      imageArea
        .getByRole("img")
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(imageArea).toContainText("Calibration evidence");
  expect(state.mutations).toEqual([]);
  expect(state.starts).toEqual([]);
});

for (const changed of ["attempt", "frame", "adapter"] as const)
  test(`calibration inspection cannot carry to a different ${changed}, while the same outcome retains its draft (offline fixture)`, async ({
    page,
  }) => {
    const state = await fixture(page);
    const inspected = page.getByLabel(
      "I inspected the physical output and fresh result evidence after this attempt completed.",
      { exact: true },
    );
    const reason = page.getByLabel("Calibration inspection reason", {
      exact: true,
    });
    await inspected.check();
    await reason.fill("Inspected only the first fixture attempt");
    await page
      .getByRole("button", { name: "Refresh calibration status", exact: true })
      .click();
    await expect(inspected).toBeChecked();
    await expect(reason).toHaveValue(
      "Inspected only the first fixture attempt",
    );
    if (changed === "attempt") state.calibration = calibration("two");
    else if (changed === "frame")
      state.calibration = {
        ...calibration(),
        evidence: {
          ...calibration().evidence,
          url: "/fixture-calibration-new-frame.png",
          capturedAt: "2026-10-23T10:31:00.000Z",
        },
      };
    else {
      state.machine.adapterVersion = "offline-fixture-v2";
      state.revision++;
    }
    await page
      .getByRole("button", { name: "Refresh calibration status", exact: true })
      .click();
    if (changed === "attempt")
      await expect(
        page.getByText(/Attempt calibration_attempt_two/),
      ).toBeVisible();
    if (changed === "adapter")
      await expect(page.getByText(/adapter offline-fixture-v2/)).toBeVisible();
    await expect(inspected).not.toBeChecked();
    await expect(reason).toHaveValue("");
    expect(state.mutations).toEqual([]);
  });

const readyLabel =
  "The device is supervised, the output area is clear and I am ready to start this physical calibration.";

test("an unknown saved calibration stays gated until a held lookup confirms explicit absence (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, false, "held");
  await expect.poll(() => state.heldLookups.length).toBe(1);
  await expect(
    page.getByText("Checking the saved calibration record…", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Calibration artwork", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Start physical calibration",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(state.mutations).toEqual([]);
  state.holdLookup = false;
  await state.heldLookups[0].fulfill({
    contentType: "application/json",
    body: JSON.stringify({ calibration: null, status: null }),
  });
  await expect(
    page.getByLabel("Calibration artwork", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Start physical calibration",
      exact: true,
    }),
  ).toBeDisabled();
  expect(state.starts).toEqual([]);
});

for (const failure of ["failed", "malformed"] as const)
  test(`a ${failure} saved-calibration lookup offers explicit recovery without treating it as no prior attempt (offline fixture)`, async ({
    page,
  }) => {
    const state = await fixture(page, false, failure);
    await expect(
      page.locator(".physical-calibration").getByRole("alert"),
    ).toBeVisible();
    await expect(
      page.getByLabel("Calibration artwork", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Start physical calibration",
        exact: true,
      }),
    ).toHaveCount(0);
    state.lookupStatus = 200;
    state.malformedLookup = false;
    await page
      .getByRole("button", {
        name: "Refresh saved calibration status",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Calibration artwork", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".physical-calibration").getByRole("alert"),
    ).toHaveCount(0);
    expect(state.mutations).toEqual([]);
  });

test("physical start supervision must be reconfirmed after adapter and pairing changes (offline fixture)", async ({
  page,
}) => {
  await page.clock.install();
  const state = await fixture(page, false);
  await page
    .getByLabel("Calibration artwork", { exact: true })
    .setInputFiles(resolve("tests/fixtures/makers.png"));
  const ready = page.getByLabel(readyLabel, { exact: true });
  const start = page.getByRole("button", {
    name: "Start physical calibration",
    exact: true,
  });
  await ready.check();
  await expect(start).toBeEnabled();
  state.machine.adapterVersion = "new-adapter-needs-supervision";
  state.machine.paired = false;
  state.revision++;
  await page.clock.fastForward(3001);
  await expect(
    page.getByText(/adapter new-adapter-needs-supervision/),
  ).toBeVisible();
  await expect(ready).not.toBeChecked();
  await expect(start).toBeDisabled();
  state.machine.paired = true;
  state.revision++;
  await page.clock.fastForward(3001);
  await expect(ready).not.toBeChecked();
  await expect(start).toBeDisabled();
  await ready.check();
  await expect(start).toBeEnabled();
  expect(state.mutations).toEqual(["/api/uploads"]);
  expect(state.starts).toEqual([]);
});

test("slow calibration reads serialize, apply meaningful replies and release explicit refresh after one queued follow-up (offline fixture)", async ({
  page,
}) => {
  await page.clock.install();
  await fixture(page);
  const pending: Route[] = [];
  let setup = true;
  const running = { ...calibration(), productionState: "running" };
  await page.route("**/api/owner/machines/*/calibration", async (route) => {
    if (setup)
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          calibration: running,
          status: { execution_status: "running" },
        }),
      });
    pending.push(route);
  });
  const refresh = page.getByRole("button", {
    name: "Refresh calibration status",
    exact: true,
  });
  await refresh.click();
  setup = false;
  await page.clock.fastForward(3001);
  await expect.poll(() => pending.length).toBe(1);
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await page.clock.fastForward(3001);
  expect(pending.length).toBe(1);
  const first = { ...calibration("slow-first"), productionState: "running" };
  await pending[0].fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      calibration: first,
      status: { execution_status: "running" },
    }),
  });
  await expect(
    page.getByText(/Attempt calibration_attempt_slow-first/),
  ).toBeVisible();
  await expect.poll(() => pending.length).toBe(2);
  await page.clock.fastForward(3001);
  expect(pending.length).toBe(2);
  const second = { ...calibration("slow-second"), productionState: "running" };
  await pending[1].fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      calibration: second,
      status: { execution_status: "running" },
    }),
  });
  await expect(
    page.getByText(/Attempt calibration_attempt_slow-second/),
  ).toBeVisible();
  await expect.poll(() => pending.length).toBe(3);
  await expect(refresh).toBeEnabled();
  // The third periodic read is deliberately pending: it must not extend the
  // caller's completed queued refresh into an unbounded spinner.
});

test("a device change fences a pending old calibration reply before the queued current lookup (offline fixture)", async ({
  page,
}) => {
  await page.clock.install();
  const state = await fixture(page);
  let held: Route | undefined;
  let reads = 0;
  const latest = calibration("fresh-device");
  await page.route("**/api/owner/machines/*/calibration", async (route) => {
    reads++;
    if (reads === 1) {
      held = route;
      return;
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        calibration: latest,
        status: { execution_status: "completed" },
      }),
    });
  });
  const refresh = page.getByRole("button", {
    name: "Refresh calibration status",
    exact: true,
  });
  await refresh.click();
  await expect.poll(() => Boolean(held)).toBe(true);
  state.machine.adapterVersion = "generation-fenced-adapter";
  state.revision++;
  await page.clock.fastForward(3001);
  await expect(
    page.getByText(/adapter generation-fenced-adapter/),
  ).toBeVisible();
  expect(reads).toBe(1);
  await page.evaluate(() => {
    (window as any).calibrationReviewSeen = [];
    const target = document.querySelector(".physical-calibration")!;
    new MutationObserver(() =>
      (window as any).calibrationReviewSeen.push(target.textContent),
    ).observe(target, { childList: true, subtree: true, characterData: true });
  });
  await held!.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      calibration: calibration("stale-device"),
      status: { execution_status: "completed" },
    }),
  });
  await expect(
    page.getByText(/Attempt calibration_attempt_fresh-device/),
  ).toBeVisible();
  await expect(
    page.getByText(/Attempt calibration_attempt_stale-device/),
  ).toHaveCount(0);
  expect(reads).toBe(2);
  expect(
    await page.evaluate(() =>
      (window as any).calibrationReviewSeen.some((text: string) =>
        text.includes("calibration_attempt_stale-device"),
      ),
    ),
  ).toBe(false);
  expect(state.mutations).toEqual([]);
});

test("a malformed optional calibration status stays recoverable instead of blanking the app, then focuses the fresh unchecked inspection (offline fixture)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 664 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = await fixture(page, true, "malformed-status");
  const region = page.locator(".physical-calibration");
  await expect(region.getByRole("alert")).toContainText(
    "could not be confirmed",
  );
  await expect(
    page.getByRole("heading", {
      name: "Keep the counter moving.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    region.getByRole("button", {
      name: "Start physical calibration",
      exact: true,
    }),
  ).toHaveCount(0);
  state.statusValue = { execution_status: "completed" };
  const retry = region.getByRole("button", {
    name: "Refresh saved calibration status",
    exact: true,
  });
  await retry.focus();
  await retry.press("Enter");
  const inspected = page.getByLabel(
    "I inspected the physical output and fresh result evidence after this attempt completed.",
    { exact: true },
  );
  await expect(inspected).toBeFocused();
  await expect(inspected).not.toBeChecked();
  await expect(region.getByRole("alert")).toHaveCount(0);
  const labelBox = await inspected.locator("..").boundingBox();
  expect(
    labelBox && labelBox.y >= 0 && labelBox.y + labelBox.height <= 664,
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

test("explicit calibration retry puts a keyboard user in the recovered start form at320px (offline fixture)", async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 320, height: 664 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await fixture(page, false, "failed");
  const retry = page.getByRole("button", {
    name: "Refresh saved calibration status",
    exact: true,
  });
  await retry.focus();
  state.lookupStatus = 200;
  await retry.press("Enter");
  const artwork = page.getByLabel("Calibration artwork", { exact: true });
  await expect(artwork).toBeFocused();
  const fieldBox = await artwork.locator("..").boundingBox();
  expect(
    fieldBox && fieldBox.y >= 0 && fieldBox.y + fieldBox.height <= 664,
  ).toBe(true);
  await page.keyboard.press(
    browserName === "webkit" && process.platform === "darwin"
      ? "Alt+Tab"
      : "Tab",
  );
  await expect(
    page.getByLabel("Calibration width (mm)", { exact: true }),
  ).toBeFocused();
  expect(state.mutations).toEqual([]);
});

test("failed calibration retry restores its usable keyboard recovery control without starting a physical job (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, false, "failed");
  const retry = page.getByRole("button", {
    name: "Refresh saved calibration status",
    exact: true,
  });
  await retry.focus();
  await retry.press("Enter");
  await expect(
    page.locator(".physical-calibration").getByRole("alert"),
  ).toContainText("temporarily unavailable");
  await expect(retry).toBeEnabled();
  await expect(retry).toBeFocused();
  await expect(
    page.getByLabel("Calibration artwork", { exact: true }),
  ).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});

test("a recovered calibration lookup respects a newer owner focus choice while its reply was pending (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page, false, "failed");
  state.lookupStatus = 200;
  state.holdLookup = true;
  const retry = page.getByRole("button", {
    name: "Refresh saved calibration status",
    exact: true,
  });
  await retry.focus();
  await retry.press("Enter");
  await expect.poll(() => state.heldLookups.length).toBe(1);
  const newFocus = page.getByRole("tab", {
    name: "Payment records",
    exact: true,
  });
  await newFocus.focus();
  state.holdLookup = false;
  await state.heldLookups[0].fulfill({
    contentType: "application/json",
    body: JSON.stringify({ calibration: null, status: null }),
  });
  await expect(
    page.getByLabel("Calibration artwork", { exact: true }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(newFocus).toBeFocused();
  expect(state.mutations).toEqual([]);
});
