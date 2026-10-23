import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const machine: any = {
    id: "machine_settings_fixture",
    name: "Settings conflict fixture",
    model: "Phomemo M02Pro",
    outputType: "sticker",
    adapterVersion: "fixture-v1",
    mode: "simulation",
    paired: true,
    configured: true,
    calibrated: true,
    listed: true,
    ready: false,
    paused: true,
    mediaRemaining: 42,
    material: "thermal-paper",
    priceCard: { consumables: 20, machine: 10, handling: 30, platform: 15 },
    hours: { start: 0, end: 24 },
    maxJobSeconds: 120,
    collectionPoint: "Initial owner desk",
    policy: { authorizedArtwork: true, maxQuantity: 10 },
  };
  const state = {
    machine,
    revision: 1,
    configVersion: 1,
    ledger: [] as any[],
    posts: [] as { path: string; body: any; match?: string }[],
    rejectNext: false,
    uncertainNext: false,
    failDashboard: false,
    failReadsAfterSave: false,
    preserveOperationalAction: false,
  };
  const fingerprint = () => state.configVersion.toString(16).padStart(64, "0");
  const view = () => ({
    ...structuredClone(machine),
    settingsFingerprint: fingerprint(),
  });
  const editable = () =>
    JSON.stringify([
      machine.listed,
      machine.mediaRemaining,
      machine.material,
      machine.priceCard,
      machine.hours,
      machine.maxJobSeconds,
      machine.collectionPoint,
      machine.policy,
      machine.ownerAddress ?? null,
    ]);
  const changeConfig = (patch: any) => {
    Object.assign(machine, patch);
    state.configVersion++;
    state.revision++;
  };
  await page.addInitScript(() => {
    const sources = new Set<{ handler?: () => void }>();
    (window as any).__settingsFixtureRefresh = () => {
      for (const source of sources) source.handler?.();
    };
    (window as any).EventSource = class {
      handler?: () => void;
      onopen?: () => void;
      constructor() {
        sources.add(this);
        queueMicrotask(() => this.onopen?.());
      }
      addEventListener(name: string, handler: () => void) {
        if (name === "refresh") this.handler = handler;
      }
      close() {
        sources.delete(this);
      }
    };
  });
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (route.request().method() !== "GET") {
      const input = route.request().postDataJSON(),
        match = route.request().headers()["if-match"];
      state.posts.push({ path, body: input, match });
      if (state.rejectNext) {
        state.rejectNext = false;
        changeConfig({
          priceCard: { ...machine.priceCard, consumables: 65 },
          ownerAddress: "0x" + "bb".repeat(20),
        });
      }
      if (match && match !== `"${fingerprint()}"`)
        return route.fulfill({
          status: 412,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "STALE_MACHINE_SETTINGS",
              message:
                "The saved machine settings changed. Load the newer saved settings before saving again.",
            },
          }),
        });
      if (state.uncertainNext) {
        state.uncertainNext = false;
        Object.assign(machine, {
          policyReconciliationRequired: true,
          ready: false,
          paused: true,
        });
        state.revision++;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "MACHINE_POLICY_RECONCILIATION",
              message:
                "The machine policy update or saved settings could not be confirmed. Machine availability is paused. Refresh and save the current settings to synchronize policy, then inspect before resuming.",
            },
          }),
        });
      }
      if (path.endsWith("/calibrate")) body = { machine: view() };
      else if (path === `/api/owner/machines/${machine.id}`) {
        const before = editable();
        if (!(state.preserveOperationalAction && input.paused !== undefined)) {
          const { inspected, cleared, ownerAddress, ...patch } = input;
          Object.assign(machine, patch);
          if (ownerAddress === null) delete machine.ownerAddress;
          else if (ownerAddress !== undefined)
            machine.ownerAddress = ownerAddress;
          if (
            machine.policyReconciliationRequired &&
            input.mediaRemaining !== undefined
          ) {
            delete machine.policyReconciliationRequired;
            machine.ready = false;
            machine.paused = true;
          }
        }
        if (before !== editable()) state.configVersion++;
        state.revision++;
        body = { machine: view() };
      } else
        return route.fulfill({
          status: 405,
          body: "Only isolated owner settings mutations are allowed",
        });
      if (state.failReadsAfterSave) state.failDashboard = true;
    } else if (path === "/api/health")
      body = {
        mode: "simulation",
        paymentMode: "mock",
        store: "machine-settings-ui-fixture",
      };
    else if (path === "/api/session")
      body = { role: "owner", id: "settings_fixture_owner" };
    else if (path === "/api/owner/dashboard") {
      if (state.failDashboard)
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: { message: "The isolated dashboard is unavailable" },
          }),
        });
      body = {
        revision: state.revision,
        machines: [view()],
        jobs: [],
        ledger: state.ledger,
      };
    } else if (path.endsWith("/calibration")) body = { calibration: null };
    else
      return route.fulfill({
        status: 405,
        body: "Only isolated fixture reads are allowed",
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
    .getByText("Media, prices, hours & policy", { exact: true })
    .click();
  const form = page.locator(".machine-settings form");
  const save = form.getByRole("button", {
    name: "Save machine settings",
    exact: true,
  });
  const refresh = async () => {
    state.revision++;
    const response = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/owner/dashboard",
    );
    await page.evaluate(() => (window as any).__settingsFixtureRefresh());
    await (await response).finished();
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
  };
  const clearance = page.getByRole("checkbox", {
    name: "I inspected the output area, loaded media and cleared the machine.",
    exact: true,
  });
  return { state, form, save, refresh, changeConfig, fingerprint, clearance };
}

test("a newer saved settings snapshot preserves the draft and requires explicit adoption before guarded save (offline fixture)", async ({
  page,
}) => {
  const f = await fixture(page);
  await f.form
    .getByLabel("Collection point", { exact: true })
    .fill("My unsaved collection draft");
  f.changeConfig({
    priceCard: { ...f.state.machine.priceCard, consumables: 65 },
    ownerAddress: "0x" + "bb".repeat(20),
  });
  await f.refresh();
  await expect(f.form.getByRole("alert")).toContainText("Your draft is kept");
  await expect(
    f.form.getByLabel("Collection point", { exact: true }),
  ).toHaveValue("My unsaved collection draft");
  await expect(f.form.getByLabel("Consumables", { exact: true })).toHaveValue(
    "20",
  );
  await expect(
    f.form.getByLabel("Owner test payout address", { exact: true }),
  ).toHaveValue("");
  await expect(f.save).toBeDisabled();
  expect(f.state.posts).toEqual([]);
  await page.setViewportSize({ width: 320, height: 800 });
  await f.form.getByRole("alert").scrollIntoViewIfNeeded();
  await expect(f.form.getByRole("alert")).toBeVisible();
  const adoption = f.form.getByRole("button", {
    name: "Load newer saved settings",
    exact: true,
  });
  await expect(adoption).toBeEnabled();
  await adoption.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "evidence/overnight-machine-settings-conflict-320.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await f.form
    .getByRole("button", { name: "Load newer saved settings", exact: true })
    .click();
  await expect(f.form.getByLabel("Consumables", { exact: true })).toHaveValue(
    "65",
  );
  await expect(
    f.form.getByLabel("Owner test payout address", { exact: true }),
  ).toHaveValue("0x" + "bb".repeat(20));
  await expect(
    f.form.getByLabel("Collection point", { exact: true }),
  ).toHaveValue("Initial owner desk");
  await expect(f.form.getByRole("alert")).toHaveCount(0);
  await f.form
    .getByLabel("Collection point", { exact: true })
    .fill("Reapplied collection draft");
  const expected = f.fingerprint();
  await f.save.click();
  await expect.poll(() => f.state.posts.length).toBe(1);
  expect(f.state.posts[0].match).toBe(`"${expected}"`);
  expect(f.state.posts[0].body.priceCard.consumables).toBe(65);
  expect(f.state.posts[0].body.ownerAddress).toBe("0x" + "bb".repeat(20));
  await expect(
    f.form.getByRole("button", { name: "Discard machine edits", exact: true }),
  ).toHaveCount(0);
});

test("uncertain policy acknowledgement retains the failed draft until explicit saved-settings adoption and synchronization (offline fixture)", async ({
  page,
}) => {
  const f = await fixture(page);
  const initialFingerprint = f.fingerprint();
  await f.clearance.check();
  await f.form
    .getByLabel("Media remaining (estimated)", { exact: true })
    .fill("5");
  await f.form
    .getByLabel("Collection point", { exact: true })
    .fill("Unconfirmed outgoing desk");
  f.state.uncertainNext = true;
  await f.save.click();
  await expect(f.form.getByRole("alert")).toContainText(
    "policy needs synchronization",
  );
  await expect(
    f.form.getByLabel("Media remaining (estimated)", { exact: true }),
  ).toHaveValue("5");
  await expect(
    f.form.getByLabel("Collection point", { exact: true }),
  ).toHaveValue("Unconfirmed outgoing desk");
  await expect(f.save).toBeDisabled();
  await expect(f.clearance).not.toBeChecked();
  expect(f.fingerprint()).toBe(initialFingerprint);
  expect(f.state.posts).toHaveLength(1);
  await f.form
    .getByRole("button", {
      name: "Load saved settings for synchronization",
      exact: true,
    })
    .click();
  await expect(
    f.form.getByLabel("Media remaining (estimated)", { exact: true }),
  ).toHaveValue("42");
  await expect(
    f.form.getByLabel("Collection point", { exact: true }),
  ).toHaveValue("Initial owner desk");
  await expect(f.save).toBeEnabled();
  expect(f.state.posts).toHaveLength(1);
  await f.save.click();
  await expect.poll(() => f.state.posts.length).toBe(2);
  await expect(f.form.getByRole("alert")).toHaveCount(0);
  expect(f.state.posts[1].match).toBe(`"${initialFingerprint}"`);
  expect(f.state.posts[1].body.mediaRemaining).toBe(42);
  expect(f.state.machine.policyReconciliationRequired).toBeUndefined();
  expect(f.state.machine.paused).toBe(true);
  await expect(
    page.getByRole("button", { name: "Resume machine", exact: true }),
  ).toBeDisabled();
  await f.clearance.check();
  await expect(
    page.getByRole("button", { name: "Resume machine", exact: true }),
  ).toBeEnabled();
});

test("a server precondition conflict refreshes the newer settings without discarding or resubmitting the draft (offline fixture)", async ({
  page,
}) => {
  const f = await fixture(page);
  await f.form
    .getByLabel("Collection point", { exact: true })
    .fill("Draft before hidden concurrent save");
  f.state.rejectNext = true;
  await f.save.click();
  await expect(f.form.getByRole("alert")).toContainText("Your draft is kept");
  await expect(f.save).toBeDisabled();
  await expect(
    f.form.getByLabel("Collection point", { exact: true }),
  ).toHaveValue("Draft before hidden concurrent save");
  expect(f.state.posts).toHaveLength(1);
  await f.form.getByLabel("Collection point", { exact: true }).press("Enter");
  expect(f.state.posts).toHaveLength(1);
  await f.form
    .getByRole("button", { name: "Load newer saved settings", exact: true })
    .click();
  await expect(f.form.getByLabel("Consumables", { exact: true })).toHaveValue(
    "65",
  );
  await expect(f.save).toBeEnabled();
  expect(f.state.posts).toHaveLength(1);
});

test("accepted settings advance the form baseline even when its dashboard refresh fails (offline fixture)", async ({
  page,
}) => {
  const f = await fixture(page);
  await f.form
    .getByLabel("Collection point", { exact: true })
    .fill("First accepted owner desk");
  f.state.failReadsAfterSave = true;
  await f.save.click();
  await expect(
    page.getByRole("status").filter({ hasText: "change was accepted" }),
  ).toBeVisible();
  await expect(
    f.form.getByLabel("Collection point", { exact: true }),
  ).toHaveValue("First accepted owner desk");
  const fresh = f.fingerprint();
  await f.form
    .getByLabel("Collection point", { exact: true })
    .fill("Second accepted owner desk");
  await expect(f.form.getByRole("alert")).toHaveCount(0);
  await expect(f.save).toBeEnabled();
  await f.save.click();
  await expect.poll(() => f.state.posts.length).toBe(2);
  expect(f.state.posts[1].match).toBe(`"${fresh}"`);
  expect(f.state.machine.collectionPoint).toBe("Second accepted owner desk");
});

test("unrelated operational refreshes preserve editable drafts without settings conflicts (offline fixture)", async ({
  page,
}) => {
  const f = await fixture(page);
  await f.form
    .getByLabel("Collection point", { exact: true })
    .fill("Draft across job and ledger refresh");
  await f.clearance.check();
  f.state.machine.reason = "Updated operational note";
  f.state.ledger = [{ id: "unrelated_ledger", status: "confirmed" }];
  await f.refresh();
  await expect(f.clearance).toBeChecked();
  await expect(f.save).toBeEnabled();
  await expect(f.form.getByRole("alert")).toHaveCount(0);
  f.state.machine.activeJobId = "different_active_execution";
  f.state.machine.ready = true;
  await f.refresh();
  await expect(f.clearance).not.toBeChecked();
  await expect(f.save).toBeEnabled();
  await expect(
    f.form.getByLabel("Collection point", { exact: true }),
  ).toHaveValue("Draft across job and ledger refresh");
  expect(f.state.posts).toEqual([]);
});

test("clearance confirmation binds physical and execution contexts while unrelated prices keep it (offline fixture)", async ({
  page,
}) => {
  const f = await fixture(page);
  await f.clearance.check();
  f.changeConfig({
    priceCard: { ...f.state.machine.priceCard, consumables: 25 },
  });
  await f.refresh();
  await expect(f.clearance).toBeChecked();
  for (const patch of [
    { adapterVersion: "fixture-v2" },
    { mode: "hardware" },
    { material: "photo-film" },
    { paired: false },
    { configured: false },
    { calibrated: false },
    { calibrationAt: "2026-10-23T12:30:00.000Z" },
    { activeJobId: "next_execution" },
    {
      reservation: {
        jobId: "next_reservation",
        expiresAt: "2026-10-23T13:00:00.000Z",
      },
    },
  ]) {
    await f.clearance.check();
    Object.assign(f.state.machine, patch);
    await f.refresh();
    await expect(f.clearance).not.toBeChecked();
  }
  expect(f.state.posts).toEqual([]);
});

test("accepted pause, resume and calibration consume clearance even when the reported context is unchanged (offline fixture)", async ({
  page,
}) => {
  const f = await fixture(page);
  f.state.preserveOperationalAction = true;
  await f.clearance.check();
  await page
    .getByRole("button", { name: "Resume machine", exact: true })
    .click();
  await expect(f.clearance).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Resume machine", exact: true }),
  ).toBeDisabled();
  await f.clearance.check();
  await page
    .getByRole("button", { name: "Run simulation calibration", exact: true })
    .click();
  await expect(f.clearance).not.toBeChecked();
  f.state.machine.paused = false;
  f.state.machine.ready = true;
  await f.refresh();
  await f.clearance.check();
  await page
    .getByRole("button", { name: "Pause machine", exact: true })
    .click();
  await expect(f.clearance).not.toBeChecked();
  expect(f.state.posts).toHaveLength(3);
  expect(f.state.posts.every((post) => post.match === undefined)).toBe(true);
});
