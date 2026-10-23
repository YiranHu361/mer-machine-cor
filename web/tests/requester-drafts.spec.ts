import {
  useManualSettings,
  openPurposeNote,
  authorizePictures,
  recommendationFor,
} from "./requester-manual";
import {
  test,
  expect,
  type Dialog,
  type Page,
  type Route,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";

function order(id: string, assetId = `original_${id}`) {
  const at = "2026-10-23T10:00:00.000Z";
  return {
    id,
    creationRequestId: undefined as string | undefined,
    version: 1,
    specVersion: 1,
    createdAt: at,
    updatedAt: at,
    spec: {
      assetIds: [assetId],
      intent: `Saved artwork for ${id}`,
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    artifact: {
      id: `preview_${id}`,
      url: "/requester-draft-image.png",
      sha256: "a".repeat(64),
    },
    productionState: "specified",
    paymentState: "unpaid",
    fulfillmentState: "unprepared",
    history: [],
  };
}
type FixtureOrder = ReturnType<typeof order>;
async function json(route: Route, value: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}
async function fixture(
  page: Page,
  initial: FixtureOrder[] = [order("alpha_order"), order("bravo_order")],
  initialLookup?: "held" | "failed",
) {
  const state = {
    jobs: initial,
    revision: 1,
    uploads: 0,
    creations: [] as { id: string; body: any }[],
    patches: [] as { id: string; baseline: string; body: any }[],
    createUnknown: false,
    createReply: "" as "" | "missing" | "other",
    editReplyOther: false,
    expired: false,
    identity: "requester_private_A",
    sessionPosts: 0,
    holdJobs: initialLookup === "held",
    failJobs: initialLookup === "failed",
    heldJobs: [] as Route[],
    holdUploads: false,
    heldUploads: [] as Route[],
  };
  await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:4317\//, () => {});
  await page.addInitScript((selectedId) => {
    if (selectedId) localStorage.setItem("fabrary-current-job", selectedId);
    const callbacks: Array<() => void> = [];
    class FixtureEvents {
      onopen: (() => void) | null = null;
      onerror = null;
      onmessage = null;
      constructor() {
        queueMicrotask(() => this.onopen?.());
      }
      addEventListener(name: string, fn: () => void) {
        if (name === "refresh") callbacks.push(fn);
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: FixtureEvents });
    (window as any).refreshRequesterDrafts = () =>
      callbacks.forEach((fn) => fn());
  }, initial[0]?.id || null);
  await page.route("**/requester-draft-image.png", async (route) =>
    route.fulfill({
      contentType: "image/png",
      body: await readFile(resolve("tests/fixtures/makers.png")),
    }),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    if (path === "/api/health")
      return json(route, {
        mode: "simulation",
        paymentMode: "mock",
        store: "draft-fixture",
      });
    if (path === "/api/session") {
      if (method !== "GET") {
        state.sessionPosts++;
        state.expired = false;
        state.identity = "requester_private_B";
        state.jobs = [];
        state.revision++;
      }
      return json(route, { role: "requester", id: state.identity });
    }
    if (path === "/api/recommendations")
      return json(route, recommendationFor(route.request().postDataJSON()));
    if (path === "/api/machines")
      return json(route, { machines: [], revision: state.revision });
    if (path === "/api/catalog") return json(route, { models: [] });
    if (path === "/api/jobs" && method === "GET" && state.holdJobs) {
      state.heldJobs.push(route);
      return;
    }
    if (path === "/api/jobs" && method === "GET" && state.failJobs)
      return json(
        route,
        { error: { message: "Initial saved orders unavailable." } },
        503,
      );
    if (path === "/api/jobs" && method === "GET")
      return state.expired
        ? json(
            route,
            {
              error: {
                code: "SESSION_EXPIRED",
                message: "Session expired in fixture.",
              },
            },
            401,
          )
        : json(route, { jobs: state.jobs, revision: state.revision });
    if (path.startsWith("/api/jobs/") && method === "GET")
      return json(route, {
        job: state.jobs.find((job) => job.id === path.split("/")[3]),
      });
    if (path === "/api/uploads") {
      state.uploads++;
      if (state.holdUploads) {
        state.heldUploads.push(route);
        return;
      }
      return json(route, {
        assets: [1, 2].map((i) => ({
          id: `upload_${state.uploads}_${i}`,
          url: "/requester-draft-image.png",
          sha256: String(i).repeat(64),
          width: 1,
          height: 1,
        })),
      });
    }
    if (path === "/api/intake")
      return json(route, {
        draft: {
          outputType: "sticker",
          widthMm: 53,
          heightMm: 50,
          quantity: 2,
          material: "thermal-paper",
          crop: "contain",
          questions: ["Private draft question"],
          contentReview: "review",
          reason: "Suggestion for this draft only",
          provider: "fixture",
          model: "fixture",
        },
      });
    if (path.endsWith("/spec") && method === "PATCH") {
      const id = path.split("/")[3],
        body = route.request().postDataJSON(),
        baseline = route.request().headers()["if-match"];
      state.patches.push({ id, body, baseline });
      const saved = state.jobs.find((job) => job.id === id)!;
      if (baseline !== `"${saved.version}"`)
        return json(
          route,
          {
            error: {
              code: "STALE_SPECIFICATION",
              message: "The saved order changed after this draft began.",
            },
          },
          409,
        );
      const next = {
        ...saved,
        version: saved.version + 1,
        specVersion: saved.specVersion + 1,
        spec: body,
      };
      state.jobs = state.jobs.map((job) => (job.id === id ? next : job));
      state.revision++;
      return json(route, {
        job: state.editReplyOther ? { ...next, id: "bravo_order" } : next,
      });
    }
    if (path === "/api/jobs" && method === "POST") {
      const creation = {
        id: route.request().headers()["idempotency-key"],
        body: route.request().postDataJSON(),
      };
      state.creations.push(creation);
      if (state.createUnknown)
        return json(
          route,
          { error: { message: "Creation acknowledgement unavailable." } },
          500,
        );
      const saved = {
        ...order(`created_${state.creations.length}`),
        spec: creation.body,
        creationRequestId: creation.id,
      };
      state.jobs = [saved, ...state.jobs];
      state.revision++;
      return json(
        route,
        {
          job: state.createReply
            ? {
                ...saved,
                creationRequestId:
                  state.createReply === "missing"
                    ? undefined
                    : "different-request",
              }
            : saved,
        },
        201,
      );
    }
    return json(
      route,
      { error: { message: "No external service is used by this fixture." } },
      405,
    );
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name:
        initial.length && !initialLookup
          ? "Your preview"
          : "Upload your pictures",
      exact: true,
    }),
  ).toBeVisible();
  if (!initial.length || initialLookup) await useManualSettings(page);
  return state;
}
const intent = (page: Page) =>
  page.getByLabel("What is it for?", { exact: true });
const width = (page: Page) => page.getByLabel("Width (mm)", { exact: true });
const budgetToggle = (page: Page) =>
  page.getByLabel("Automatically accept a quote within my budget", {
    exact: true,
  });
const budget = (page: Page) =>
  page.getByLabel("Budget cap (USD)", { exact: true });
const drafts = (page: Page) =>
  page.getByRole("region", { name: "Your unsaved drafts", exact: true });
const row = (page: Page, id: string) =>
  page.locator(".order-row").filter({ hasText: id.slice(0, 8) });
const edit = (page: Page) =>
  page
    .getByRole("button", {
      name: "Edit item",
      exact: true,
    })
    .click();
const save = (page: Page) =>
  page.getByRole("button", {
    name: "Update preview",
    exact: true,
  });
const make = (page: Page) =>
  page.getByRole("button", { name: "Preview your item", exact: true });
async function upload(page: Page) {
  const freshOrder = !(await save(page).isVisible());
  const bytes = await readFile(resolve("tests/fixtures/makers.png"));
  await page.getByLabel("Upload artwork", { exact: true }).setInputFiles(
    [1, 2].map((i) => ({
      name: `draft_${i}.png`,
      mimeType: "image/png",
      buffer: bytes,
    })),
  );
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(2);
  if (freshOrder)
    await expect(
      page.getByRole("region", { name: "Machine recommendation", exact: true }),
    ).toContainText("Fixture sticker counter");
  await useManualSettings(page);
  await authorizePictures(page);
  await expect(
    page.getByLabel("Upload artwork", { exact: true }),
  ).toBeEnabled();
}
async function refresh(page: Page) {
  await page.evaluate(() => (window as any).refreshRequesterDrafts());
}
async function leaveWarning(page: Page) {
  const dialogs: string[] = [];
  const handle = async (dialog: Dialog) => {
    dialogs.push(dialog.type());
    await dialog.dismiss();
  };
  page.on("dialog", handle);
  try {
    await page
      .getByRole("link", { name: "Make something", exact: true })
      .click();
    expect(dialogs).toEqual(["beforeunload"]);
  } finally {
    page.off("dialog", handle);
  }
}
async function noLeaveWarning(page: Page) {
  const dialogs: string[] = [];
  const handle = async (dialog: Dialog) => {
    dialogs.push(dialog.type());
    await dialog.accept();
  };
  page.on("dialog", handle);
  try {
    await page.reload();
    expect(dialogs).toEqual([]);
  } finally {
    page.off("dialog", handle);
  }
}
async function uncertainNewDraft(page: Page) {
  const state = await fixture(page);
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await useManualSettings(page);
  await intent(page).fill("The exact interrupted creation");
  await upload(page);
  state.createUnknown = true;
  await make(page).click();
  await expect(
    page.getByRole("button", { name: "Check saved orders", exact: true }),
  ).toBeVisible();
  await expect(make(page)).toBeDisabled();
  return state;
}

for (const lookup of ["held", "failed"] as const)
  test(`typing before a ${lookup} initial saved selection lookup preserves the new draft through recovery and later selection (offline fixture)`, async ({
    page,
  }) => {
    const state = await fixture(
      page,
      [order("alpha_order"), order("bravo_order")],
      lookup,
    );
    if (lookup === "failed")
      await expect(
        page.getByRole("button", { name: "Refresh now", exact: true }),
      ).toBeVisible();
    await intent(page).fill(
      "  My new draft begins before the saved selection loads  ",
    );
    const uploading = upload(page);
    await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(2);
    state.holdJobs = false;
    state.failJobs = false;
    for (const route of state.heldJobs.splice(0))
      await json(route, { jobs: state.jobs, revision: state.revision });
    await uploading;
    // Print refinements become available only after pictures and matching.
    await width(page).fill("");
    await budgetToggle(page).check();
    await budget(page).fill("6.75");
    await refresh(page);
    await expect(intent(page)).toHaveValue(
      "  My new draft begins before the saved selection loads  ",
    );
    await expect(width(page)).toHaveValue("");
    await expect(budget(page)).toHaveValue("6.75");
    await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(2);
    expect(
      await page.evaluate(() => localStorage.getItem("fabrary-current-job")),
    ).toBeNull();
    await row(page, "bravo_order").click();
    await drafts(page)
      .getByRole("button", { name: "Resume new order draft", exact: true })
      .click();
    await expect(intent(page)).toHaveValue(
      "  My new draft begins before the saved selection loads  ",
    );
    await expect(width(page)).toHaveValue("");
    await expect(budget(page)).toHaveValue("6.75");
    expect(state.creations).toEqual([]);
    expect(state.patches).toEqual([]);
  });

test("edits retain exact blanks, budget, artwork and suggestions across order selection without carrying them to another order (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await edit(page);
  await upload(page);
  await intent(page).fill("  Keep exact private alpha draft  ");
  await page
    .getByRole("button", { name: "Suggest specification", exact: true })
    .click();
  await expect(
    page.getByText("Suggestion for this draft only", { exact: true }),
  ).toBeVisible();
  await width(page).fill("");
  await page.getByLabel("Quantity", { exact: true }).fill("");
  await budgetToggle(page).check();
  await budget(page).fill("");
  await row(page, "bravo_order").click();
  await edit(page);
  await expect(intent(page)).toHaveValue("Saved artwork for bravo_order");
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(0);
  await expect(
    page.getByText("Suggestion for this draft only", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Image placement", { exact: true })
    .selectOption("cover");
  await save(page).click();
  expect(state.patches[0].body.assetIds).toEqual(["original_bravo_order"]);
  await drafts(page)
    .getByRole("button", { name: "Resume edit alpha_or", exact: true })
    .click();
  await expect(intent(page)).toHaveValue("  Keep exact private alpha draft  ");
  await expect(width(page)).toHaveValue("");
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("");
  await expect(budget(page)).toHaveValue("");
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(2);
  await expect(
    page.getByText("Suggestion for this draft only", { exact: true }),
  ).toBeVisible();
  expect(state.creations).toEqual([]);
});

test("new-order and edit drafts resume independently and an accepted edit clears only its own slot (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await useManualSettings(page);
  await upload(page);
  await intent(page).fill("  My separate new order  ");
  await width(page).fill("");
  await budgetToggle(page).check();
  await budget(page).fill("8.75");
  await row(page, "alpha_order").click();
  await edit(page);
  await intent(page).fill("An independent alpha edit");
  await row(page, "bravo_order").click();
  await expect(drafts(page).locator("li")).toHaveCount(2);
  await drafts(page)
    .getByRole("button", { name: "Resume new order draft", exact: true })
    .click();
  await expect(intent(page)).toHaveValue("  My separate new order  ");
  await expect(width(page)).toHaveValue("");
  await expect(budget(page)).toHaveValue("8.75");
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(2);
  await drafts(page)
    .getByRole("button", { name: "Resume edit alpha_or", exact: true })
    .click();
  await expect(intent(page)).toHaveValue("An independent alpha edit");
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(0);
  await save(page).click();
  await expect(drafts(page).locator("li")).toHaveCount(1);
  await expect(drafts(page)).toContainText("My separate new order");
  await leaveWarning(page);
  expect(state.patches).toHaveLength(1);
  expect(state.creations).toEqual([]);
});

test("hidden edits warn before leaving; explicit mobile keyboard discard clears the warning and restores useful focus (offline fixture)", async ({
  page,
  browserName,
}) => {
  const tab =
    browserName === "webkit" && process.platform === "darwin"
      ? "Alt+Tab"
      : "Tab";
  await page.setViewportSize({ width: 320, height: 664 });
  await fixture(page);
  await edit(page);
  await intent(page).fill(
    `A very long private draft ${"long-content".repeat(30)}`,
  );
  await row(page, "bravo_order").click();
  await leaveWarning(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const audit = await new AxeBuilder({ page })
    .include(".requester-drafts")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const violations = audit.violations.map(({ id, impact, nodes }) => ({
    id,
    impact,
    nodes: nodes.map(({ target, failureSummary }) => ({
      target,
      failureSummary,
    })),
  }));
  await test.info().attach("requester-drafts-accessibility", {
    body: JSON.stringify(
      {
        state: "requester-drafts-320",
        rulesPassed: audit.passes.length,
        violations,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(violations).toEqual([]);
  await row(page, "bravo_order").click();
  const production = page.getByRole("heading", {
    name: "Your preview",
    exact: true,
  });
  await expect(production).toBeFocused();
  await production.press(tab);
  await page.keyboard.press(tab);
  const view = page.getByRole("button", {
    name: "View unsaved drafts",
    exact: true,
  });
  await expect(view).toBeFocused();
  await view.press("Enter");
  const draftHeading = page.getByRole("heading", {
    name: "Your unsaved drafts",
    exact: true,
  });
  await expect(draftHeading).toBeFocused();
  await expect
    .poll(async () => (await draftHeading.boundingBox())?.y)
    .toBeGreaterThanOrEqual(0);
  await expect
    .poll(async () => (await draftHeading.boundingBox())?.y)
    .toBeLessThan(664);
  await page.screenshot({
    path: "evidence/overnight-requester-drafts-320.png",
  });
  await draftHeading.press(tab);
  const resume = drafts(page).getByRole("button", {
    name: "Resume edit alpha_or",
    exact: true,
  });
  await expect(resume).toBeFocused();
  await resume.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Edit item", exact: true }),
  ).toBeFocused();
  await expect(intent(page)).toHaveValue(
    `A very long private draft ${"long-content".repeat(30)}`,
  );
  await row(page, "bravo_order").click();
  const discard = drafts(page).getByRole("button", {
    name: "Discard edit alpha_or",
    exact: true,
  });
  await discard.focus();
  await discard.press("Enter");
  await expect(drafts(page)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Your preview", exact: true }),
  ).toBeFocused();
  await noLeaveWarning(page);
});

test("returning numeric fields to their original visible values leaves no hidden draft or leave warning (offline fixture)", async ({
  page,
}) => {
  await fixture(page);
  await edit(page);
  await width(page).fill("");
  await width(page).fill("53");
  await page.getByLabel("Quantity", { exact: true }).fill("");
  await page.getByLabel("Quantity", { exact: true }).fill("1");
  await row(page, "bravo_order").click();
  await expect(drafts(page)).toHaveCount(0);
  await noLeaveWarning(page);
});

test("a resumed edit retains its original immutable save baseline after a newer saved version is observed (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await edit(page);
  await page.getByLabel("Height (mm)", { exact: true }).fill("75");
  await row(page, "bravo_order").click();
  state.jobs[0] = {
    ...state.jobs[0],
    version: 2,
    specVersion: 2,
    spec: { ...state.jobs[0].spec, quantity: 2 },
  };
  state.revision++;
  await refresh(page);
  await drafts(page)
    .getByRole("button", { name: "Resume edit alpha_or", exact: true })
    .click();
  await save(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "changed after this draft began",
  );
  expect(state.patches[0].baseline).toBe('"1"');
  await expect(page.getByLabel("Height (mm)", { exact: true })).toHaveValue(
    "75",
  );
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("1");
  await page
    .getByRole("button", { name: "Use saved specification", exact: true })
    .click();
  await expect(page.getByLabel("Height (mm)", { exact: true })).toHaveValue(
    "50",
  );
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("2");
  await page
    .getByRole("button", { name: "Keep current item", exact: true })
    .click();
  await expect(drafts(page)).toHaveCount(0);
  expect(state.patches).toHaveLength(1);
});

test("an interrupted creation stays guarded across older or identical unrelated orders and reconciles only its exact request id (offline fixture)", async ({
  page,
}) => {
  const state = await uncertainNewDraft(page),
    request = state.creations[0];
  expect(request.id).toMatch(/^[0-9a-f-]{36}$/);
  await row(page, "bravo_order").click();
  await expect(
    page.getByRole("button", { name: "Check saved orders", exact: true }),
  ).toBeVisible();
  await leaveWarning(page);
  state.jobs.push({
    ...order("identical_other"),
    spec: request.body,
    creationRequestId: "another-tab-request",
  });
  state.revision++;
  await refresh(page);
  await row(page, "identical_other").click();
  await expect(
    page.getByRole("button", { name: "Check saved orders", exact: true }),
  ).toBeVisible();
  state.jobs.push({
    ...order("matching_exact"),
    spec: request.body,
    creationRequestId: request.id,
  });
  state.revision++;
  await refresh(page);
  const exact = row(page, "matching_exact");
  await expect(exact).toContainText("Matches interrupted request");
  await exact.click();
  await expect(
    page.getByRole("button", { name: "Check saved orders", exact: true }),
  ).toHaveCount(0);
  await expect(drafts(page)).toHaveCount(0);
  expect(state.creations).toHaveLength(1);
  expect(state.sessionPosts).toBe(0);
  await noLeaveWarning(page);
});

test("newer edits survive exact interrupted-create reconciliation and a later explicit creation uses a fresh identity (offline fixture)", async ({
  page,
}) => {
  const state = await uncertainNewDraft(page),
    original = state.creations[0];
  await intent(page).fill("  Newer edits after the interrupted request  ");
  await width(page).fill("");
  await budgetToggle(page).check();
  await budget(page).fill("7.25");
  await row(page, "bravo_order").click();
  state.jobs.push({
    ...order("matching_exact"),
    spec: original.body,
    creationRequestId: original.id,
  });
  state.revision++;
  await refresh(page);
  await row(page, "matching_exact").click();
  await expect(
    page.getByRole("button", { name: "Check saved orders", exact: true }),
  ).toHaveCount(0);
  await drafts(page)
    .getByRole("button", { name: "Resume new order draft", exact: true })
    .click();
  await expect(intent(page)).toHaveValue(
    "  Newer edits after the interrupted request  ",
  );
  await expect(width(page)).toHaveValue("");
  await expect(budget(page)).toHaveValue("7.25");
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(2);
  expect(state.creations).toHaveLength(1);
  state.createUnknown = false;
  await openPurposeNote(page);
  await page
    .getByRole("button", { name: "Find suitable machine", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Machine recommendation", exact: true }),
  ).toContainText("Fixture sticker counter");
  await useManualSettings(page);
  await width(page).fill("53");
  await make(page).click();
  await expect(page.locator(".order-intent")).toHaveText(
    "  Newer edits after the interrupted request  ",
  );
  expect(state.creations).toHaveLength(2);
  expect(state.creations[1].id).not.toBe(original.id);
  await expect(drafts(page)).toHaveCount(0);
});

test("explicit interrupted-draft discard leaves unrelated edits intact and allows a fresh intentional request (offline fixture)", async ({
  page,
}) => {
  const state = await uncertainNewDraft(page),
    originalId = state.creations[0].id;
  await row(page, "alpha_order").click();
  await edit(page);
  await intent(page).fill("Keep this unrelated edit");
  await row(page, "bravo_order").click();
  await page
    .getByRole("button", { name: "Discard interrupted draft", exact: true })
    .click();
  await expect(drafts(page).locator("li")).toHaveCount(1);
  await expect(drafts(page)).toContainText("Keep this unrelated edit");
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await useManualSettings(page);
  await expect(intent(page)).toHaveValue("");
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(0);
  await intent(page).fill("A new intentional creation");
  await upload(page);
  state.createUnknown = false;
  await make(page).click();
  await expect(page.locator(".order-intent")).toHaveText(
    "A new intentional creation",
  );
  expect(state.creations).toHaveLength(2);
  expect(state.creations[1].id).not.toBe(originalId);
});

for (const reply of ["missing", "other"] as const)
  test(`a successful creation reply with ${reply} request identity cannot discard or select over the pending draft (offline fixture)`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await page.getByRole("button", { name: "New order", exact: true }).click();
    await useManualSettings(page);
    await intent(page).fill(
      "Retain my draft until its exact creation is known",
    );
    await upload(page);
    state.createReply = reply;
    await make(page).click();
    await expect(page.getByRole("alert")).toContainText("could not be matched");
    await expect(intent(page)).toHaveValue(
      "Retain my draft until its exact creation is known",
    );
    await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(2);
    await expect(make(page)).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Check saved orders", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("fabrary-current-job")),
    ).toBeNull();
    await row(page, "bravo_order").click();
    await expect(
      page.getByRole("button", { name: "Check saved orders", exact: true }),
    ).toBeVisible();
    const committed = row(page, "created_1");
    await expect(committed).toContainText("Matches interrupted request");
    await committed.click();
    await expect(
      page.getByRole("button", { name: "Check saved orders", exact: true }),
    ).toHaveCount(0);
    await expect(drafts(page)).toHaveCount(0);
    expect(state.creations).toHaveLength(1);
  });

test("a successful edit reply for another order leaves the original draft, selection and immutable baseline intact (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await edit(page);
  await intent(page).fill("This private edit belongs only to alpha");
  state.editReplyOther = true;
  await save(page).click();
  await expect(page.getByRole("alert")).toContainText("could not be matched");
  await expect(intent(page)).toHaveValue(
    "This private edit belongs only to alpha",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("fabrary-current-job")),
  ).toBe("alpha_order");
  await row(page, "bravo_order").click();
  await expect(page.locator(".order-intent")).toHaveText(
    "Saved artwork for bravo_order",
  );
  await drafts(page)
    .getByRole("button", { name: "Resume edit alpha_or", exact: true })
    .click();
  await expect(intent(page)).toHaveValue(
    "This private edit belongs only to alpha",
  );
  state.editReplyOther = false;
  await save(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "changed after this draft began",
  );
  expect(state.patches.map((patch) => patch.baseline)).toEqual(['"1"', '"1"']);
  expect(state.creations).toEqual([]);
});

test("the first available interrupted-request recovery keeps focus after its announcement and locks during another pending action (offline fixture)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 664 });
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const check = [
        ...document.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.textContent?.trim() === "Check saved orders");
      if (check && !check.disabled) {
        observer.disconnect();
        check.focus();
        check.click();
      }
    });
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  });
  const state = await uncertainNewDraft(page);
  await expect(page.locator(".order-row").first()).toBeFocused();
  const check = page.getByRole("button", {
    name: "Check saved orders",
    exact: true,
  });
  state.holdUploads = true;
  await page.getByLabel("Upload artwork", { exact: true }).setInputFiles({
    name: "later.png",
    mimeType: "image/png",
    buffer: await readFile(resolve("tests/fixtures/makers.png")),
  });
  await expect.poll(() => state.heldUploads.length).toBe(1);
  await expect(check).toBeDisabled();
  state.holdUploads = false;
  await json(state.heldUploads.shift()!, {
    assets: [
      {
        id: "newer_draft_art",
        url: "/requester-draft-image.png",
        sha256: "b".repeat(64),
        width: 1,
        height: 1,
      },
    ],
  });
  await expect(check).toBeEnabled();
  expect(state.creations).toHaveLength(1);
  expect(state.patches).toEqual([]);
});

test("opening the draft list respects a newer keyboard focus choice in the same frame (offline fixture)", async ({
  page,
}) => {
  await fixture(page);
  await edit(page);
  await intent(page).fill("Keep this hidden draft");
  await row(page, "bravo_order").click();
  const view = page.getByRole("button", {
      name: "View unsaved drafts",
      exact: true,
    }),
    next = page.getByRole("button", { name: "New order", exact: true });
  await view.focus();
  await page.evaluate(() => {
    const controls = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ];
    controls
      .find((button) => button.textContent?.trim() === "View unsaved drafts")!
      .click();
    controls
      .find((button) => button.textContent?.trim() === "New order")!
      .focus();
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(next).toBeFocused();
});

test("requester expiry clears hidden and active private drafts before an explicit new identity opens (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await edit(page);
  await upload(page);
  await intent(page).fill("Private hidden requester A edit");
  await row(page, "bravo_order").click();
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await useManualSettings(page);
  await upload(page);
  await intent(page).fill("Private active requester A new draft");
  await budgetToggle(page).check();
  await budget(page).fill("9.75");
  state.expired = true;
  await refresh(page);
  await expect(
    page.getByRole("button", { name: "Open requester session", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Private (hidden|active) requester A/),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open requester session", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Upload your pictures", exact: true }),
  ).toBeVisible();
  await openPurposeNote(page);
  await expect(intent(page)).toHaveValue("");
  await expect(width(page)).toHaveCount(0);
  await expect(budgetToggle(page)).toHaveCount(0);
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(0);
  await expect(drafts(page)).toHaveCount(0);
  expect(state.sessionPosts).toBe(1);
  expect(
    await page.evaluate(() => localStorage.getItem("fabrary-current-job")),
  ).toBeNull();
});
