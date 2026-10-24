import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

/* Just ask (/make) and Relief (/relief) against a real simulation instance
   whose drafts come from fixtures. They refuse to run against hardware, real
   payments or a live design model. */

async function ownerCode() {
  if (process.env.FABRARY_OWNER_CODE) return process.env.FABRARY_OWNER_CODE;
  const credentials = JSON.parse(
    await readFile(resolve("../.data/local-credentials.json"), "utf8"),
  );
  return credentials.ownerCode as string;
}
async function requireSimulation(request: APIRequestContext) {
  const health = await (await request.get("/api/health")).json();
  expect(health.mode, "Never start a physical job").toBe("simulation");
  expect(health.paymentMode, "Payments must be labeled mocks").toBe("mock");
  test.skip(
    health.integrations?.design !== "fixture",
    "Run with FABRARY_DESIGN_PROVIDER=fixture so no live model is called",
  );
}
async function audit(page: Page, state: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((n) => n.target),
    })),
    `${state} accessibility violations`,
  ).toEqual([]);
}
async function reflow(page: Page, state: string) {
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
    await audit(page, `${state}-${width}`);
    await page.screenshot({
      path: `evidence/just-ask-${state}-${width}.png`,
      fullPage: true,
    });
  }
}
/** Owner API session for the simulated sticker printer's routine handling. */
async function ownerApi(request: APIRequestContext, baseURL: string) {
  const login = await request.post("/api/session", {
    data: { role: "owner", accessCode: await ownerCode() },
    headers: { origin: baseURL },
  });
  expect(login.ok()).toBe(true);
  const call = async (
    path: string,
    data?: unknown,
    method = "POST",
    headers = {},
  ) => {
    const response = await request.fetch(`/api${path}`, {
      method: data === undefined ? "GET" : method,
      data: data as any,
      headers: { origin: baseURL, ...headers },
    });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return response.json();
  };
  return call;
}
type OwnerApi = Awaited<ReturnType<typeof ownerApi>>;
/** Finish earlier simulated work on the sticker printer and resume it. */
async function readyStickerPrinter(owner: OwnerApi) {
  await expect
    .poll(
      async () => {
        const d = await owner("/owner/dashboard");
        const m = d.machines.find((x: any) => x.id === "phomemo_01");
        expect(m.mode, "Only a simulated device is handled here").toBe(
          "simulation",
        );
        // Relief runs use up to ten labels each; refill the simulated roll.
        if (m.mediaRemaining < 20) {
          await owner(
            `/owner/machines/${m.id}`,
            { mediaRemaining: 100 },
            "PATCH",
            {
              "If-Match": `"${m.settingsFingerprint}"`,
            },
          );
          return false;
        }
        const active = d.jobs.find((j: any) => j.id === m.activeJobId);
        if (active?.fulfillmentState === "awaiting_owner")
          await owner(`/owner/jobs/${active.id}/prepare`, {
            removed: true,
            labeled: true,
            stored: true,
            cleared: true,
          });
        if (!m.activeJobId && m.paused && m.calibrated)
          await owner(
            `/owner/machines/${m.id}`,
            { paused: false, inspected: true, cleared: true },
            "PATCH",
            { "If-Match": `"${m.settingsFingerprint}"` },
          );
        const now = (await owner("/owner/dashboard")).machines.find(
          (x: any) => x.id === "phomemo_01",
        );
        return now.ready && !now.paused && !now.activeJobId;
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
}

test("Just ask turns one sentence into drafts, one confirmation and visible progress", async ({
  page,
  playwright,
  baseURL,
}) => {
  await mkdir(resolve("evidence"), { recursive: true });
  const ownerRequest = await playwright.request.newContext({ baseURL });
  try {
    await requireSimulation(ownerRequest);
    const owner = await ownerApi(ownerRequest, baseURL!);
    await readyStickerPrinter(owner);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/make");
    await expect(
      page.getByRole("heading", { name: "What should we make?" }),
    ).toBeVisible();
    await audit(page, "make-request");
    await page.getByLabel("Describe it").fill("I want a cat sticker");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const drafts = page.getByRole("button", { name: /^Use this design:/ });
    await expect(drafts).toHaveCount(3);
    await expect(page.getByRole("status")).toContainText("Choose a design.");
    for (const image of await page
      .getByRole("img", { name: /\(fixture\)/ })
      .all())
      await expect
        .poll(() => image.evaluate((i: HTMLImageElement) => i.naturalWidth))
        .toBeGreaterThan(0);
    await reflow(page, "drafts");
    await drafts.first().click();
    await expect(page.getByRole("status")).toContainText(
      "Check the preview and total.",
      { timeout: 30_000 },
    );
    await expect(
      page.getByRole("img", { name: /^Production preview:/ }),
    ).toBeVisible();
    await expect(page.getByText("No payment: simulated work")).toBeVisible();
    const make = page.getByRole("button", { name: "Make it (simulated)" });
    await expect(make).toBeDisabled();
    await page.getByLabel(/I own these pictures or have permission/).check();
    await reflow(page, "proposal");
    await make.click();
    await expect(page.getByRole("status")).toContainText(
      "Your order is under way.",
    );
    await expect(
      page.getByText("Simulated · made, waiting for the owner to finish up"),
    ).toBeVisible({ timeout: 60_000 });
    // The owner's routine handling of the simulated output completes the plan.
    await readyStickerPrinter(owner);
    await expect(page.getByRole("status")).toContainText("All done.", {
      timeout: 30_000,
    });
    await expect(
      page.getByText("Simulated · complete, no physical item"),
    ).toBeVisible();
    await expect(page.getByText(/Pickup code/)).toHaveCount(0);
    await audit(page, "make-done");
    expect(errors).toEqual([]);
  } finally {
    await ownerRequest.dispose();
  }
});

test("Relief plans across the team's machines and a simulated network, then replans after an outage", async ({
  page,
  playwright,
  baseURL,
}) => {
  await mkdir(resolve("evidence"), { recursive: true });
  await requireSimulation(page.request);
  const ownerRequest = await playwright.request.newContext({ baseURL });
  const owner = await ownerApi(ownerRequest, baseURL!);
  await readyStickerPrinter(owner);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/relief");
  await expect(page.getByText(/Sign in at the/)).toBeVisible();
  await page.goto("/owner");
  await page
    .getByLabel("Owner access code", { exact: true })
    .fill(await ownerCode());
  await page
    .getByRole("button", { name: "Open owner workshop", exact: true })
    .click();
  // The sign-in screen shares the "Your workshop" heading; tabs mean signed in.
  await expect(page.getByRole("tab", { name: "Machines" })).toBeVisible();
  await page.getByRole("link", { name: "Relief", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Relief coordinator" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset the simulation" }).click();
  await expect(page.getByText(/150 online · 0 offline/)).toBeVisible();
  await page.getByLabel("People in the shelter").fill("100");
  await page.getByRole("button", { name: "Plan supplies" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Check the plan, then confirm.",
    { timeout: 60_000 },
  );
  await expect(page.getByRole("row")).toHaveCount(11);
  await expect(page.getByText(/estimate \(not charged\)/)).toBeVisible();
  // The team's sticker printer takes cot labels next to the network.
  await expect(
    page
      .getByRole("row", { name: /Cot and supply-bin labels/ })
      .getByRole("cell")
      .nth(1),
  ).toHaveText(/^[1-9]\d*$/);
  await expect(
    page.getByText(/^1 job · no payment · simulated devices$/),
  ).toBeVisible();
  await page.getByLabel(/I coordinate this shelter/).check();
  await audit(page, "relief-proposal");
  await page.getByRole("button", { name: /^(Start|Pay .* & start)$/ }).click();
  await expect(page.getByRole("status")).toContainText("Under way · plan v1");
  await expect(page.getByLabel("Simulated progress")).toContainText(
    "simulated units done",
  );
  await page.getByRole("button", { name: "Outage: San Francisco" }).click();
  await expect(page.getByRole("status")).toContainText("plan v2");
  await expect(page.getByText(/\d+ online · [1-9]\d* offline/)).toBeVisible();
  await page.getByText("Events", { exact: true }).click();
  await expect(page.getByText("plan.replanned")).toBeVisible();
  await reflow(page, "relief-replanned");
  await page.getByRole("button", { name: "Restore power" }).click();
  await expect(page.getByText(/150 online · 0 offline/)).toBeVisible();
  expect(errors).toEqual([]);
  // Hand the printer back: its simulated cot labels are handled like any job.
  await readyStickerPrinter(owner);
  await ownerRequest.dispose();
});
