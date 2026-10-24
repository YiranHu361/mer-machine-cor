import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openProviderDetails } from "./provider-controls";

// Every API request is intercepted: this checks the setup interface only.
const machine = (over: Record<string, unknown> = {}) => ({
  id: "phomemo_01",
  name: "Sticker counter",
  model: "Phomemo M02Pro",
  outputType: "sticker",
  adapterVersion: "fixture",
  mode: "simulation",
  paired: true,
  configured: true,
  calibrated: false,
  listed: false,
  ready: false,
  paused: true,
  reason: "Registered; calibration and owner inspection required.",
  mediaRemaining: 100,
  material: "thermal-paper",
  priceCard: { consumables: 20, machine: 10, handling: 30, platform: 15 },
  hours: { start: 0, end: 24 },
  maxJobSeconds: 120,
  collectionPoint: "Team demo table",
  policy: { authorizedArtwork: true, maxQuantity: 10 },
  settingsFingerprint: "a".repeat(64),
  ...over,
});
const checks = (consented: string[]) => {
  const steps = [
    ["system", "Check this computer", null],
    ["search", "Find your M02 Pro", "Allow a short Bluetooth search"],
    ["pair", "Pair and read its serial channel", "Allow pairing"],
    ["camera", "Take a test photo", "Take a test photo"],
  ] as const;
  let blocked = false;
  return steps.map(([id, label, consent]) => {
    const done = !consent || consented.includes(id);
    const status = blocked ? "pending" : done ? "done" : "waiting";
    blocked = blocked || status !== "done";
    return {
      id,
      label,
      status,
      ...(status === "waiting" ? { consent } : {}),
      ...(status === "done" ? { detail: `${label} finished` } : {}),
    };
  });
};

async function workshop(page: Page) {
  const state = {
    consented: [] as string[],
    issued: false,
    used: false,
    registered: false,
    posts: [] as { path: string; body: any }[],
  };
  await page.addInitScript(() => {
    class QuietEvents {
      onopen: (() => void) | null = null;
      constructor() {
        queueMicrotask(() => this.onopen?.());
      }
      addEventListener() {}
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: QuietEvents });
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (request.method() !== "GET")
      state.posts.push({ path, body: request.postDataJSON() });
    if (path === "/api/health")
      return json({
        mode: "simulation",
        paymentMode: "mock",
        store: "fixture",
      });
    if (path === "/api/session")
      return json({ role: "owner", id: "connector_ui_owner" });
    if (path === "/api/owner/setup-codes") {
      state.issued = true;
      return json(
        {
          setupCode: {
            id: "setup_1",
            machineId: "phomemo_01",
            mode: "hardware",
            expiresAt: new Date(Date.now() + 900000).toISOString(),
            code: "FAB-7KQ2-M9XD",
          },
          platformUrl: "http://192.168.1.20:4318",
          command:
            "curl -fsSL http://192.168.1.20:4318/connect.sh | sh -s -- FAB-7KQ2-M9XD",
        },
        201,
      );
    }
    const consent = /^\/api\/owner\/connectors\/connector_1\/consent$/.exec(
      path,
    );
    if (consent) {
      state.consented.push(request.postDataJSON().check);
      if (state.consented.includes("camera")) state.registered = true;
      return json({ connector: {} });
    }
    if (path === "/api/owner/dashboard") {
      const connector = {
        id: "connector_1",
        machineId: "phomemo_01",
        mode: "hardware",
        hostLabel: "workbench-pi",
        online: true,
        ready: state.registered,
        ...(state.registered ? { registeredAt: new Date().toISOString() } : {}),
        createdAt: new Date().toISOString(),
        checks: [
          {
            id: "connector",
            label: "Connector online",
            status: "done",
            detail: "Enrolled from workbench-pi",
          },
          ...checks(state.consented),
          {
            id: "register",
            label: "Add it to your workshop",
            status: state.registered ? "done" : "pending",
          },
        ],
      };
      return json({
        revision: state.consented.length + Number(state.used) + 1,
        machines: [
          machine(
            state.registered
              ? { mode: "hardware", connectorId: "connector_1" }
              : {},
          ),
        ],
        jobs: [],
        ledger: [],
        connectors: state.used ? [connector] : [],
        setupCodes:
          state.issued && !state.used
            ? [
                {
                  id: "setup_1",
                  machineId: "phomemo_01",
                  mode: "hardware",
                  expiresAt: new Date(Date.now() + 900000).toISOString(),
                },
              ]
            : [],
      });
    }
    return json(
      { error: { message: "No other requests in this fixture" } },
      405,
    );
  });
  return state;
}

test("a provider connects a machine with one command and allows each setup step", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await workshop(page);
  await page.goto("/owner");
  await page.getByRole("tab", { name: "Machines", exact: true }).click();
  await openProviderDetails(page, "Add a machine");
  await page
    .getByLabel("Device mode", { exact: true })
    .selectOption("hardware");
  await page
    .getByRole("button", { name: "Get setup command", exact: true })
    .click();
  await expect(page.locator(".command-box code")).toHaveText(
    "curl -fsSL http://192.168.1.20:4318/connect.sh | sh -s -- FAB-7KQ2-M9XD",
  );
  await expect(page.getByText(/works once and expires at/)).toBeVisible();
  await expect(
    page.getByText("Waiting for the machine computer to connect…"),
  ).toBeVisible();
  expect(state.posts).toEqual([
    {
      path: "/api/owner/setup-codes",
      body: { model: "phomemo-m02pro", mode: "hardware" },
    },
  ]);
  // The machine computer runs the command and enrolls.
  state.used = true;
  const setup = page.getByRole("region", {
    name: "Setting up Sticker counter",
    exact: true,
  });
  await expect(setup).toBeVisible();
  await expect(page.locator(".setup-code-panel")).toHaveCount(0);
  await expect(setup.getByRole("listitem")).toHaveCount(6);
  // Only the current step offers an action; later steps wait their turn.
  await expect(setup.getByRole("button")).toHaveText([
    "Allow a short Bluetooth search",
    "Cancel this setup…",
  ]);
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await testInfo.attach("machine-connector-accessibility", {
    body: JSON.stringify({
      state: "machine-connector-setup-390",
      rulesPassed: audit.passes.length,
      violations: audit.violations,
    }),
    contentType: "application/json",
  });
  expect(audit.violations).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  for (const name of [
    "Allow a short Bluetooth search",
    "Allow pairing",
    "Take a test photo",
  ]) {
    await setup.getByRole("button", { name, exact: true }).click();
    await expect(setup.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  }
  expect(state.consented).toEqual(["search", "pair", "camera"]);
  // Registered: the checklist gives way to the machine card's connection facts.
  await expect(setup).toHaveCount(0);
  const card = page.locator(".owner-machine");
  await openProviderDetails(card, "Connection details");
  await expect(card.getByText("Connected through")).toContainText(
    "workbench-pi · online",
  );
});
