import { useManualSettings, openPurposeNote } from "./requester-manual";
import { test, expect, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
function job(id: string, assetId: string) {
  const at = new Date().toISOString();
  return {
    id,
    version: 1,
    specVersion: 1,
    createdAt: at,
    updatedAt: at,
    spec: {
      assetIds: [assetId],
      intent: `Artwork for ${id}`,
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    artifact: { id: `preview_${id}`, url: pixel, sha256: "a".repeat(64) },
    productionState: "specified",
    paymentState: "unpaid",
    fulfillmentState: "unprepared",
    history: [],
  };
}
async function json(route: Route, value: unknown) {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}
async function fixture(page: Page, initial: ReturnType<typeof job>[]) {
  const state = {
    jobs: initial,
    saved: [] as { path: string; spec: any }[],
    intakes: [] as any[],
    recommendations: [] as any[],
    approvals: 0,
  };
  if (initial[0])
    await page.addInitScript(
      (id) => localStorage.setItem("fabrary-current-job", id),
      initial[0].id,
    );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/health")
      return json(route, {
        mode: "simulation",
        paymentMode: "mock",
        store: "ui-fixture",
      });
    if (path === "/api/session")
      return json(route, { role: "requester", id: "fixture_requester" });
    if (path === "/api/machines") return json(route, { machines: [] });
    if (path === "/api/catalog") return json(route, { models: [] });
    if (path === "/api/jobs" && route.request().method() === "GET")
      return json(route, { jobs: state.jobs });
    if (path === "/api/uploads")
      return json(route, {
        assets: [1, 2].map((i) => ({
          id: `replacement_${i}`,
          url: pixel,
          sha256: String(i).repeat(64),
          width: 1,
          height: 1,
        })),
      });
    if (path === "/api/intake") {
      state.intakes.push(route.request().postDataJSON());
      return json(route, {
        draft: {
          outputType: "sticker",
          widthMm: 53,
          heightMm: 50,
          quantity: 2,
          material: "thermal-paper",
          crop: "contain",
          questions: [],
          contentReview: "review",
          reason: "Suggestion applies only to this replacement artwork",
          provider: "fixture",
          model: "fixture",
        },
      });
    }
    if (path === "/api/recommendations") {
      const input = route.request().postDataJSON();
      state.recommendations.push(input);
      const photo = /color photo/i.test(input.intent || "");
      const machine = {
        id: photo ? "context_photo" : "context_thermal",
        name: photo ? "Photo counter" : "Sticker counter",
        model: photo ? "Instax Mini Link 3" : "Phomemo M02Pro",
        outputType: photo ? "instax" : "sticker",
        mode: "simulation",
      };
      return json(route, {
        status: "recommended",
        provider: "local_analysis",
        reason: "The recommendation belongs only to these uploaded originals.",
        questions: [],
        machine,
        spec: {
          assetIds: input.assetIds,
          intent: input.intent || "Print the uploaded pictures",
          outputType: machine.outputType,
          widthMm: photo ? 54 : 53,
          heightMm: photo ? 86 : 50,
          quantity: 1,
          material: photo ? "photo-film" : "thermal-paper",
          crop: "contain",
          permission: "unclear",
          recommendedMachineId: machine.id,
        },
      });
    }
    if (
      (path === "/api/jobs" && route.request().method() === "POST") ||
      path.endsWith("/spec")
    ) {
      const spec = route.request().postDataJSON();
      state.saved.push({ path, spec });
      const id = path === "/api/jobs" ? "job_created" : path.split("/")[3];
      const original =
        state.jobs.find((candidate) => candidate.id === id) ||
        job(id, spec.assetIds[0]);
      const revised = {
        ...original,
        ...(path === "/api/jobs"
          ? { creationRequestId: route.request().headers()["idempotency-key"] }
          : {}),
        version: original.version + 1,
        specVersion: original.specVersion + 1,
        spec,
        productionState:
          spec.permission === "unclear" ? "needs_review" : "specified",
        artifact: {
          id: `new_preview_${id}`,
          url: pixel,
          sha256: "c".repeat(64),
        },
      };
      state.jobs = [
        ...state.jobs.filter((candidate) => candidate.id !== id),
        revised,
      ];
      return json(route, { job: revised });
    }
    if (path.endsWith("/approve-and-quote")) state.approvals++;
    if (path === "/api/events")
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": isolated fixture only\n\n",
      });
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: { message: "No external calls are allowed in this fixture." },
      }),
    });
  });
  return state;
}
async function replaceWithTwoImages(page: Page) {
  const bytes = await readFile(resolve("tests/fixtures/makers.png"));
  await page.getByLabel("Upload artwork", { exact: true }).setInputFiles(
    [1, 2].map((i) => ({
      name: `replacement_${i}.png`,
      mimeType: "image/png",
      buffer: bytes,
    })),
  );
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(2);
}
async function edit(page: Page) {
  await page
    .getByRole("button", {
      name: "Edit item",
      exact: true,
    })
    .click();
}
async function save(page: Page) {
  await page
    .getByRole("button", {
      name: "Update preview",
      exact: true,
    })
    .click();
  await expect(page.locator(".hash-note")).toContainText("cccccccccccccccc");
  await expect(
    page.getByRole("button", {
      name: "Approve preview & see price",
      exact: true,
    }),
  ).toBeVisible();
}

test("discarded multi-image replacements and suggestions never move from order A into order B (UI fixture)", async ({
  page,
}) => {
  const a = job("job_a111111", "original_A"),
    b = job("job_b222222", "original_B");
  const state = await fixture(page, [a, b]);
  await page.goto("/");
  await edit(page);
  await replaceWithTwoImages(page);
  await page
    .getByRole("button", { name: "Suggest specification", exact: true })
    .click();
  await expect(
    page.getByText("Suggestion applies only to this replacement artwork", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Artwork permission", { exact: true }),
  ).toHaveValue("unclear");
  await page
    .getByRole("button", { name: "Keep current item", exact: true })
    .click();
  await page.locator(".order-row").filter({ hasText: "job_b222" }).click();
  await edit(page);
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(0);
  await expect(
    page.getByText("Suggestion applies only to this replacement artwork", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Artwork permission", { exact: true }),
  ).toHaveValue("authorized");
  await page.getByLabel("Height (mm)", { exact: true }).fill("60");
  await save(page);
  expect(state.saved[0].path).toBe(`/api/jobs/${b.id}/spec`);
  expect(state.saved[0].spec.assetIds).toEqual(["original_B"]);
  expect(state.saved[0].spec.outputType).toBe("sticker");
  expect(state.saved[0].spec.heightMm).toBe(60);
  expect(
    state.jobs.find((candidate) => candidate.id === a.id)!.spec.assetIds,
  ).toEqual(["original_A"]);
  expect(state.approvals).toBe(0);
});

test("selecting a different order keeps prior unsaved replacements out of the selected order (UI fixture)", async ({
  page,
}) => {
  const a = job("job_a111111", "original_A"),
    b = job("job_b222222", "original_B");
  const state = await fixture(page, [a, b]);
  await page.goto("/");
  await edit(page);
  await replaceWithTwoImages(page);
  await page.locator(".order-row").filter({ hasText: "job_b222" }).click();
  await edit(page);
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(0);
  await page.getByLabel("Width (mm)", { exact: true }).fill("25");
  await save(page);
  expect(state.saved[0].spec.assetIds).toEqual(["original_B"]);
  expect(state.saved[0].spec.widthMm).toBe(25);
  expect(state.approvals).toBe(0);
});

test("canceling an artwork replacement restores the same order's saved sources (UI fixture)", async ({
  page,
}) => {
  const a = job("job_a111111", "original_A");
  const state = await fixture(page, [a]);
  await page.goto("/");
  await edit(page);
  await replaceWithTwoImages(page);
  await page
    .getByRole("button", { name: "Keep current item", exact: true })
    .click();
  await edit(page);
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(0);
  await page.getByLabel("Height (mm)", { exact: true }).fill("60");
  await save(page);
  expect(state.saved[0].spec.assetIds).toEqual(["original_A"]);
  expect(state.saved[0].spec.heightMm).toBe(60);
  expect(state.approvals).toBe(0);
});

test("a new multi-image draft keeps its originals through automatic format recommendations and explicit permission review (UI fixture)", async ({
  page,
}) => {
  const state = await fixture(page, []);
  await page.goto("/");
  await replaceWithTwoImages(page);
  await expect(
    page.getByRole("region", { name: "Machine recommendation", exact: true }),
  ).toContainText("Sticker counter");
  await openPurposeNote(page);
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("color photo — keep both uploaded images");
  await page
    .getByRole("button", { name: "Find suitable machine", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Machine recommendation", exact: true }),
  ).toContainText("Photo counter");
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("black-and-white sticker — keep both uploaded images");
  await page
    .getByRole("button", { name: "Find suitable machine", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Machine recommendation", exact: true }),
  ).toContainText("Sticker counter");
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(2);
  await useManualSettings(page);
  await page
    .getByRole("button", { name: "Suggest specification", exact: true })
    .click();
  await expect(
    page.getByLabel("Artwork permission", { exact: true }),
  ).toHaveValue("unclear");
  expect(state.intakes[0].assetIds).toEqual(["replacement_1", "replacement_2"]);
  expect(state.recommendations).toHaveLength(3);
  for (const input of state.recommendations)
    expect(input.assetIds).toEqual(["replacement_1", "replacement_2"]);
  await page
    .getByRole("button", {
      name: "Request artwork permission review",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Preview your item", exact: true })
    .click();
  await expect(page.locator(".hash-note")).toContainText("cccccccccccccccc");
  expect(state.saved[0].spec.assetIds).toEqual([
    "replacement_1",
    "replacement_2",
  ]);
  expect(state.saved[0].spec.permission).toBe("unclear");
  expect(state.saved[0].spec.recommendedMachineId).toBe("context_thermal");
  expect(state.approvals).toBe(0);
});
