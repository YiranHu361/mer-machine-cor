import { useManualSettings, openPurposeNote } from "./requester-manual";
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
  "base64",
);
const rights = (page: Page) =>
  page.getByRole("checkbox", {
    name: "I own these pictures or have permission to print them",
    exact: true,
  });
const preview = (page: Page) =>
  page.getByRole("button", { name: "Preview your item", exact: true });
const result = (page: Page) =>
  page.getByRole("region", { name: "Machine recommendation", exact: true });
const artwork = resolve("tests/fixtures/makers.png");
function machine(outputType = "sticker") {
  return {
    id:
      outputType === "sticker"
        ? "thermal_database_device"
        : "photo_database_device",
    name:
      outputType === "sticker"
        ? "Community sticker counter"
        : "Workshop photo desk",
    model: outputType === "sticker" ? "Phomemo M02Pro" : "Instax Mini Link 3",
    outputType,
    adapterVersion: "fixture",
    mode: "simulation",
    paired: true,
    configured: true,
    calibrated: true,
    listed: true,
    ready: true,
    paused: false,
    mediaRemaining: 20,
    material: outputType === "sticker" ? "thermal-paper" : "photo-film",
    priceCard: { consumables: 20, machine: 10, handling: 30, platform: 15 },
    hours: { start: 0, end: 24 },
    maxJobSeconds: 120,
    collectionPoint: "Fixture collection desk",
  };
}
async function json(route: Route, value: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}
async function fixture(page: Page) {
  const state = {
    uploads: 0,
    jobs: [] as any[],
    recommendations: [] as any[],
    creations: [] as any[],
    edits: [] as any[],
    actions: [] as string[],
    bindingReply: "" as "" | "drop" | "change",
    failReads: false,
    mode: "recommended" as
      | "recommended"
      | "unavailable"
      | "needs_clarification"
      | "error"
      | "authorized"
      | "wrong-assets",
    holdFirst: false,
    held: [] as Route[],
    expired: false,
    identity: "picture_requester_A",
    firstOutput: "sticker",
    revision: 1,
    mutations: [] as string[],
  };
  await page.addInitScript(() => {
    const refreshes: Array<() => void> = [];
    class FixtureEvents {
      onopen: (() => void) | null = null;
      constructor() {
        queueMicrotask(() => this.onopen?.());
      }
      addEventListener(name: string, fn: () => void) {
        if (name === "refresh") refreshes.push(fn);
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: FixtureEvents });
    (window as any).refreshPictureFixture = () =>
      refreshes.forEach((fn) => fn());
  });
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.route("**/picture-fixture/*.png", (route) =>
    route.fulfill({ contentType: "image/png", body: pixel }),
  );
  const replyJob = (job: any) => {
    const reply = structuredClone(job);
    if (state.bindingReply === "drop") delete reply.spec.recommendedMachineId;
    if (state.bindingReply === "change")
      reply.spec.recommendedMachineId = "unrelated_database_machine";
    return reply;
  };
  const respond = async (route: Route) => {
    const request = route.request().postDataJSON();
    if (state.mode === "error")
      return json(
        route,
        {
          error: {
            message: "The fixture analysis is temporarily unavailable.",
          },
        },
        503,
      );
    const device = machine(
      request.assetIds[0] === "picture_1" ? state.firstOutput : "sticker",
    );
    const recommended = ["recommended", "authorized", "wrong-assets"].includes(
      state.mode,
    );
    return json(route, {
      status: recommended ? "recommended" : state.mode,
      provider: "local_analysis",
      reason: recommended
        ? "This picture works as a small monochrome label. This database machine supports the required paper and size."
        : "No currently ready machine can make this picture without losing its intended output. Ask the owner to prepare a compatible device.",
      questions:
        state.mode === "needs_clarification"
          ? ["Should the picture retain its colors?"]
          : [],
      machine: recommended ? device : null,
      spec:
        recommended || state.mode === "unavailable"
          ? {
              assetIds:
                state.mode === "wrong-assets"
                  ? ["unrelated_artwork"]
                  : request.assetIds,
              intent:
                (request.intent?.trim().length ?? 0) >= 3
                  ? request.intent
                  : "Picture for a workshop print",
              outputType: device.outputType,
              widthMm: device.outputType === "instax" ? 54 : 53,
              heightMm: device.outputType === "instax" ? 86 : 50,
              quantity: 1,
              material: device.material,
              crop: "contain",
              permission:
                state.mode === "authorized" ? "authorized" : "unclear",
              recommendedMachineId: recommended ? device.id : undefined,
            }
          : null,
      notice:
        "Local analysis is being used. No AI service reviewed these pictures.",
    });
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      state.mutations.push(path);
      if (path === "/api/session") {
        state.expired = false;
        state.identity = "picture_requester_B";
        return json(route, { role: "requester", id: state.identity });
      }
      if (path === "/api/uploads") {
        state.uploads++;
        return json(route, {
          assets: [
            {
              id: `picture_${state.uploads}`,
              url: `/picture-fixture/${state.uploads}.png`,
              sha256: String(state.uploads).repeat(64),
              width: 626,
              height: 591,
            },
          ],
        });
      }
      if (path === "/api/recommendations") {
        state.recommendations.push(request.postDataJSON());
        if (state.holdFirst && state.recommendations.length === 1) {
          state.held.push(route);
          return;
        }
        return respond(route);
      }
      if (path === "/api/intake")
        return json(route, {
          draft: {
            outputType: "sticker",
            widthMm: 53,
            heightMm: 50,
            quantity: 1,
            material: "thermal-paper",
            crop: "contain",
            questions: [],
            contentReview: "review",
            reason: "The artwork needs an owner review before approval.",
            provider: "fixture",
            model: "fixture",
          },
        });
      if (path === "/api/jobs") {
        const spec = request.postDataJSON();
        if (typeof spec.intent !== "string" || spec.intent.trim().length < 3)
          return json(
            route,
            {
              error: {
                code: "VALIDATION_ERROR",
                message:
                  "A saved production specification needs an intent of at least three characters.",
              },
            },
            422,
          );
        state.creations.push({
          spec,
          key: request.headers()["idempotency-key"],
        });
        const at = new Date().toISOString();
        const job = {
          id: `picture_job_${state.creations.length}`,
          creationRequestId: request.headers()["idempotency-key"],
          spec,
          version: 1,
          specVersion: 1,
          artifact: {
            id: "picture_preview",
            url: "/picture-fixture/preview.png",
            sha256: "a".repeat(64),
          },
          history: [],
          createdAt: at,
          updatedAt: at,
          productionState:
            spec.permission === "authorized" ? "specified" : "needs_review",
          paymentState: "unpaid",
          fulfillmentState: "unprepared",
        };
        state.jobs.unshift(job);
        state.revision++;
        return json(route, { job: replyJob(job) }, 201);
      }
      const update = path.match(
        /^\/api\/jobs\/([^/]+)\/(spec|approve-and-quote)$/,
      );
      if (update) {
        const job = state.jobs.find((item) => item.id === update[1]);
        if (!job)
          return json(
            route,
            { error: { message: "Unknown fixture order" } },
            404,
          );
        if (update[2] === "spec") {
          const spec = request.postDataJSON();
          if (typeof spec.intent !== "string" || spec.intent.trim().length < 3)
            return json(
              route,
              {
                error: {
                  code: "VALIDATION_ERROR",
                  message:
                    "A saved production specification needs an intent of at least three characters.",
                },
              },
              422,
            );
          state.edits.push({ spec, baseline: request.headers()["if-match"] });
          job.spec = spec;
          job.specVersion++;
        } else {
          state.actions.push(update[2]);
          job.productionState = "quoted";
          job.machineId =
            job.spec.recommendedMachineId || "thermal_database_device";
          job.quote = {
            id: "picture_bound_quote",
            version: 1,
            expiresAt: new Date(Date.now() + 120000).toISOString(),
            items: [],
            totalCents: 75,
            ownerCents: 60,
            platformCents: 15,
            currency: "USD",
            paymentMode: "mock",
            collectionPoint: "Fixture collection desk",
            accepted: false,
          };
        }
        job.version++;
        state.revision++;
        return json(route, { job: replyJob(job) });
      }
      return json(
        route,
        {
          error: {
            message:
              "No payments, owner changes or machine runs are allowed in this fixture.",
          },
        },
        405,
      );
    }
    if (path === "/api/health")
      return json(route, {
        mode: "simulation",
        paymentMode: "mock",
        store: "picture-first-offline-fixture",
      });
    if (path === "/api/session")
      return json(route, { role: "requester", id: state.identity });
    if (path === "/api/jobs")
      return state.failReads
        ? json(
            route,
            {
              error: {
                message:
                  "Saved orders are temporarily unavailable in this fixture.",
              },
            },
            503,
          )
        : state.expired
          ? json(
              route,
              {
                error: {
                  code: "AUTH_REQUIRED",
                  message: "Fixture requester expired",
                },
              },
              401,
            )
          : json(route, { jobs: state.jobs, revision: state.revision });
    if (path === "/api/machines")
      return json(route, { machines: [machine()], revision: state.revision });
    if (path === "/api/catalog") return json(route, { models: [] });
    return json(
      route,
      {
        error: { message: "Only isolated picture fixture reads are allowed." },
      },
      404,
    );
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Upload your pictures", exact: true }),
  ).toBeVisible();
  return { state, respond };
}
async function upload(page: Page) {
  await page
    .getByLabel("Upload artwork", { exact: true })
    .setInputFiles(artwork);
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(1);
}
async function manual(page: Page) {
  await useManualSettings(page);
}
async function boundPreview(page: Page) {
  await upload(page);
  await expect(result(page)).toContainText("Community sticker counter");
  await rights(page).check();
  await preview(page).click();
  await expect(
    page.getByRole("button", {
      name: "Approve preview & see price",
      exact: true,
    }),
  ).toBeEnabled();
}
async function addEarlierOrder(
  page: Page,
  state: { jobs: any[]; revision: number },
) {
  const at = new Date(Date.now() - 60000).toISOString();
  state.jobs.push({
    id: "saved_earlier_order",
    version: 1,
    specVersion: 1,
    createdAt: at,
    updatedAt: at,
    spec: {
      assetIds: ["saved_private_art"],
      intent: "An earlier saved order",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      crop: "contain",
      permission: "authorized",
    },
    artifact: {
      id: "saved_preview",
      url: "/picture-fixture/saved.png",
      sha256: "f".repeat(64),
    },
    history: [],
    productionState: "specified",
    paymentState: "unpaid",
    fulfillmentState: "unprepared",
  });
  state.revision++;
  await page.evaluate(() => (window as any).refreshPictureFixture());
  await expect(page.locator(".order-row")).toHaveCount(1);
}

test("picture-only intake finds a database machine and waits for explicit rights and preview approval", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await expect(
    page.getByRole("radio", { name: /Thermal sticker/ }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Width (mm)", { exact: true })).toBeHidden();
  await expect(page.locator(".counter-note")).toHaveCount(0);
  await upload(page);
  await expect(result(page)).toContainText("Community sticker counter");
  await expect(result(page)).toContainText("Local picture analysis");
  await expect(result(page)).toContainText(
    "No AI service reviewed these pictures",
  );
  expect(state.recommendations).toEqual([
    { assetIds: ["picture_1"], intent: "" },
  ]);
  expect(state.creations).toHaveLength(0);
  await expect(rights(page)).not.toBeChecked();
  await expect(preview(page)).toBeDisabled();
  await rights(page).check();
  await preview(page).click();
  await expect(
    page.getByRole("button", {
      name: "Approve preview & see price",
      exact: true,
    }),
  ).toBeEnabled();
  expect(state.creations).toHaveLength(1);
  expect(state.creations[0].spec).toMatchObject({
    assetIds: ["picture_1"],
    recommendedMachineId: "thermal_database_device",
    permission: "authorized",
    quantity: 1,
  });
  expect(state.creations[0].key).toMatch(/^[a-f0-9-]{36}$/);
  expect(state.mutations).toEqual([
    "/api/uploads",
    "/api/recommendations",
    "/api/jobs",
  ]);
});

test("the requester has no output or machine chooser, including expanded print options", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await expect(
    page.locator(
      '.output-picker, .output-choice, input[name="output"], .public-machines',
    ),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Owner-prepared model", { exact: true }),
  ).toHaveCount(0);
  await expect(result(page)).toHaveCount(0);
  await expect(
    page.getByText("Optional print settings", { exact: true }),
  ).toHaveCount(0);
  expect(state.mutations).toEqual([]);
  await upload(page);
  await expect(result(page)).toContainText("Community sticker counter");
  await manual(page);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(
    page.getByLabel("Owner-prepared model", { exact: true }),
  ).toHaveCount(0);
  expect(state.mutations).toEqual(["/api/uploads", "/api/recommendations"]);
  expect(state.creations).toEqual([]);
});

test("optional print refinements retain the exact machine chosen from the database", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await upload(page);
  await expect(result(page)).toContainText("Community sticker counter");
  await manual(page);
  await page.getByLabel("Width (mm)", { exact: true }).fill("25");
  await page.getByLabel("Height (mm)", { exact: true }).fill("75");
  await page.getByLabel("Quantity", { exact: true }).fill("2");
  await page
    .getByLabel("Image placement", { exact: true })
    .selectOption("cover");
  await rights(page).check();
  await preview(page).click();
  await expect(
    page.getByRole("button", {
      name: "Approve preview & see price",
      exact: true,
    }),
  ).toBeEnabled();
  expect(state.creations[0].spec).toMatchObject({
    recommendedMachineId: "thermal_database_device",
    outputType: "sticker",
    widthMm: 25,
    heightMm: 75,
    quantity: 2,
    crop: "cover",
    permission: "authorized",
  });
  expect(state.recommendations).toHaveLength(1);
});

test("replacing a recommended image after refinement runs a fresh machine analysis", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.firstOutput = "instax";
  await upload(page);
  await expect(result(page)).toContainText("Workshop photo desk");
  await manual(page);
  await page.getByLabel("Quantity", { exact: true }).fill("2");
  await rights(page).check();
  await upload(page);
  await expect(result(page)).toContainText("Community sticker counter");
  expect(state.recommendations).toHaveLength(2);
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("1");
  await expect(rights(page)).not.toBeChecked();
  await rights(page).check();
  await preview(page).click();
  await expect(
    page.getByRole("button", {
      name: "Approve preview & see price",
      exact: true,
    }),
  ).toBeEnabled();
  expect(state.creations[0].spec).toMatchObject({
    assetIds: ["picture_2"],
    recommendedMachineId: "thermal_database_device",
    outputType: "sticker",
    quantity: 1,
  });
});

test("a note change after print refinement requires a fresh recommendation before preview", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await upload(page);
  await expect(result(page)).toContainText("Community sticker counter");
  await manual(page);
  await rights(page).check();
  await openPurposeNote(page);
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("A keepsake color photo");
  await expect(preview(page)).toBeDisabled();
  state.firstOutput = "instax";
  await openPurposeNote(page);
  await page
    .getByRole("button", { name: "Find suitable machine", exact: true })
    .click();
  await expect(result(page)).toContainText("Workshop photo desk");
  await manual(page);
  await page
    .getByRole("button", {
      name: "Request artwork permission review",
      exact: true,
    })
    .click();
  await preview(page).click();
  await expect(
    page.getByRole("heading", {
      name: "An owner review is needed",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.creations[0].spec).toMatchObject({
    recommendedMachineId: "photo_database_device",
    outputType: "instax",
    permission: "unclear",
  });
});

test("a legacy specification suggestion cannot silently change a recommended photo into a sticker", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.firstOutput = "instax";
  await upload(page);
  await expect(result(page)).toContainText("Workshop photo desk");
  await manual(page);
  await rights(page).check();
  await page
    .getByRole("button", { name: "Suggest specification", exact: true })
    .click();
  await expect(preview(page)).toBeDisabled();
  await expect(page.getByLabel("Width (mm)", { exact: true })).toHaveValue(
    "54",
  );
  expect(state.creations).toHaveLength(0);
  await openPurposeNote(page);
  await page
    .getByRole("button", { name: "Find suitable machine", exact: true })
    .click();
  await expect(result(page)).toContainText("Workshop photo desk");
  await page
    .getByRole("button", {
      name: "Request artwork permission review",
      exact: true,
    })
    .click();
  await preview(page).click();
  await expect(
    page.getByRole("heading", {
      name: "An owner review is needed",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.creations[0].spec).toMatchObject({
    recommendedMachineId: "photo_database_device",
    outputType: "instax",
    permission: "unclear",
  });
});

test("changing a note and reanalyzing cannot erase an existing artwork review flag", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await manual(page);
  await upload(page);
  await expect(result(page)).toContainText("Community sticker counter");
  await manual(page);
  await openPurposeNote(page);
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("An artwork needing owner permission review");
  await page
    .getByRole("button", { name: "Suggest specification", exact: true })
    .click();
  await expect(rights(page)).toBeDisabled();
  await openPurposeNote(page);
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("A revised description for the very same artwork");
  await expect(rights(page)).toBeDisabled();
  await openPurposeNote(page);
  await page
    .getByRole("button", { name: "Find suitable machine", exact: true })
    .click();
  await expect(result(page)).toContainText("Community sticker counter");
  await expect(rights(page)).toBeDisabled();
  await expect(preview(page)).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Request artwork permission review",
      exact: true,
    })
    .click();
  await preview(page).click();
  await expect(
    page.getByRole("heading", {
      name: "An owner review is needed",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.creations[0].spec).toMatchObject({
    recommendedMachineId: "thermal_database_device",
    permission: "unclear",
  });
});

test("a creation reply dropping the recommended machine stays unresolved through a read outage and recovers only its saved bound order", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await upload(page);
  await expect(result(page)).toContainText("Community sticker counter");
  await rights(page).check();
  state.bindingReply = "drop";
  state.failReads = true;
  await preview(page).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Its result is unknown" }),
  ).toBeVisible();
  await expect(result(page)).toContainText("Community sticker counter");
  await expect(preview(page)).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Approve preview & see price",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(state.creations).toHaveLength(1);
  expect(state.jobs[0].spec.recommendedMachineId).toBe(
    "thermal_database_device",
  );
  state.failReads = false;
  state.bindingReply = "";
  await page
    .getByRole("button", { name: "Check saved orders", exact: true })
    .click();
  await page.locator(".order-row").click();
  await page
    .getByRole("button", {
      name: "Edit item",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Update preview",
      exact: true,
    })
    .click();
  expect(state.creations).toHaveLength(1);
  expect(state.edits).toHaveLength(1);
  expect(state.edits[0].spec.recommendedMachineId).toBe(
    "thermal_database_device",
  );
});

test("an edit reply changing the recommended machine preserves the existing bound draft during failed reads", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await boundPreview(page);
  await page
    .getByRole("button", {
      name: "Edit item",
      exact: true,
    })
    .click();
  state.bindingReply = "change";
  state.failReads = true;
  const save = page.getByRole("button", {
    name: "Update preview",
    exact: true,
  });
  await save.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Its result is unknown" }),
  ).toBeVisible();
  await expect(save).toBeVisible();
  await expect(page.getByLabel("Width (mm)", { exact: true })).toHaveValue(
    "53",
  );
  expect(state.edits).toHaveLength(1);
  expect(state.edits[0]).toMatchObject({
    baseline: '"1"',
    spec: { recommendedMachineId: "thermal_database_device" },
  });
  expect(state.jobs[0].spec.recommendedMachineId).toBe(
    "thermal_database_device",
  );
});

test("an approval reply dropping the recommended machine cannot seed an unbound edit when saved reads fail", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await boundPreview(page);
  state.bindingReply = "drop";
  state.failReads = true;
  await page
    .getByRole("button", { name: "Approve preview & see price", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Its result is unknown" }),
  ).toBeVisible();
  await expect(page.locator(".ticket-title")).toHaveText("Review your preview");
  expect(state.actions).toEqual(["approve-and-quote"]);
  state.bindingReply = "";
  await page
    .getByRole("button", {
      name: "Edit item",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Update preview",
      exact: true,
    })
    .click();
  expect(state.edits).toHaveLength(1);
  expect(state.edits[0].spec.recommendedMachineId).toBe(
    "thermal_database_device",
  );
  expect(state.actions).toEqual(["approve-and-quote"]);
});

test("replacement pictures remain reachable while analysis is held and a late result cannot overwrite them", async ({
  page,
}) => {
  const { state, respond } = await fixture(page);
  state.holdFirst = true;
  state.firstOutput = "instax";
  await upload(page);
  await expect.poll(() => state.held.length).toBe(1);
  await expect(
    page.getByLabel("Upload artwork", { exact: true }),
  ).toBeEnabled();
  await upload(page);
  await expect(result(page)).toContainText("Community sticker counter");
  await rights(page).check();
  await respond(state.held[0]);
  await expect(result(page)).not.toContainText("Workshop photo desk");
  await expect(rights(page)).toBeChecked();
  await preview(page).click();
  expect(state.creations[0].spec.assetIds).toEqual(["picture_2"]);
  expect(state.creations[0].spec.outputType).toBe("sticker");
  expect(state.recommendations).toHaveLength(2);
});

test("a newer note invalidates held analysis and explicit refinement uses that exact note", async ({
  page,
}) => {
  const { state, respond } = await fixture(page);
  state.holdFirst = true;
  state.firstOutput = "instax";
  await upload(page);
  await expect.poll(() => state.held.length).toBe(1);
  await openPurposeNote(page);
  const note = page.getByLabel("What is it for?", { exact: true });
  await note.fill("Keep the complete club logo in black and white");
  await openPurposeNote(page);
  await page
    .getByRole("button", { name: "Find suitable machine", exact: true })
    .click();
  await expect(result(page)).toContainText("Workshop photo desk");
  await respond(state.held[0]);
  await expect(note).toHaveValue(
    "Keep the complete club logo in black and white",
  );
  expect(state.recommendations[1].intent).toBe(
    "Keep the complete club logo in black and white",
  );
  expect(state.creations).toHaveLength(0);
});

test("no compatible device keeps the pictures and offers an explicit read-only retry without making an order", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.mode = "unavailable";
  await upload(page);
  await expect(result(page)).toContainText("No suitable machine right now");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(preview(page)).toBeDisabled();
  expect(state.creations).toHaveLength(0);
  state.mode = "recommended";
  await openPurposeNote(page);
  await page
    .getByRole("button", { name: "Check workshop again", exact: true })
    .click();
  await expect(result(page)).toContainText("Suitable machine found");
  expect(state.uploads).toBe(1);
  expect(state.recommendations).toHaveLength(2);
  expect(state.creations).toHaveLength(0);
});

test("a cached picture recommendation restores only its own artwork and bound machine after selecting another order", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await addEarlierOrder(page, state);
  await upload(page);
  await expect(result(page)).toContainText("Community sticker counter");
  await rights(page).check();
  await page.locator(".order-row").click();
  await expect(page.locator(".order-intent")).toHaveText(
    "An earlier saved order",
  );
  await page
    .getByRole("button", { name: "Resume new draft", exact: true })
    .click();
  await expect(result(page)).toContainText("Community sticker counter");
  await expect(rights(page)).toBeChecked();
  await preview(page).click();
  expect(state.creations[0].spec.assetIds).toEqual(["picture_1"]);
  expect(state.creations[0].spec.recommendedMachineId).toBe(
    "thermal_database_device",
  );
  expect(state.recommendations).toHaveLength(1);
});

test("held analysis cannot overwrite a different saved order or silently finish its cached new draft", async ({
  page,
}) => {
  const { state, respond } = await fixture(page);
  await addEarlierOrder(page, state);
  state.holdFirst = true;
  await upload(page);
  await expect.poll(() => state.held.length).toBe(1);
  await page.locator(".order-row").click();
  await respond(state.held[0]);
  await expect(page.locator(".order-intent")).toHaveText(
    "An earlier saved order",
  );
  await expect(result(page)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Resume new draft", exact: true })
    .click();
  await expect(result(page)).not.toContainText("Community sticker counter");
  await openPurposeNote(page);
  await expect(
    page.getByRole("button", { name: "Find suitable machine", exact: true }),
  ).toBeEnabled();
  expect(state.creations).toHaveLength(0);
});

for (const status of ["unavailable", "needs_clarification"] as const)
  test(`an edit with ${status} analysis cannot bypass machine matching through optional print settings`, async ({
    page,
  }) => {
    const { state } = await fixture(page);
    await addEarlierOrder(page, state);
    await page.locator(".order-row").click();
    await page
      .getByRole("button", {
        name: "Edit item",
        exact: true,
      })
      .click();
    const save = page.getByRole("button", {
      name: "Update preview",
      exact: true,
    });
    await expect(save).toBeEnabled();
    state.mode = status;
    await page
      .getByRole("button", { name: "Find suitable machine", exact: true })
      .click();
    await expect(result(page)).toContainText(
      status === "unavailable"
        ? "No suitable machine right now"
        : "A little more context would help",
    );
    await expect(save).toBeDisabled();
    await expect(page.getByLabel("Width (mm)", { exact: true })).toHaveValue(
      "53",
    );
    await page
      .getByRole("button", { name: "Adjust print settings", exact: true })
      .click();
    await expect(save).toBeDisabled();
    state.mode = "recommended";
    await page
      .getByRole("button", {
        name: /^(Find suitable machine|Check workshop again|Refine recommendation)$/,
      })
      .click();
    await expect(result(page)).toContainText("Community sticker counter");
    await expect(save).toBeEnabled();
    expect(state.creations).toHaveLength(0);
    expect(state.recommendations).toHaveLength(2);
  });

test("a completed analysis respects a newer keyboard focus and scroll choice", async ({
  page,
}) => {
  const { state, respond } = await fixture(page);
  state.holdFirst = true;
  await upload(page);
  await expect.poll(() => state.held.length).toBe(1);
  await openPurposeNote(page);
  const note = page.getByLabel("What is it for?", { exact: true });
  await note.scrollIntoViewIfNeeded();
  await note.focus();
  // WebKit can defer native caret scrolling until the next paint. Establish
  // the user's visible focus/scroll choice before releasing the held reply.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const before = await page.evaluate(() => scrollY);
  await respond(state.held[0]);
  await expect(result(page)).toContainText("Community sticker counter");
  await expect(note).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(before);
});

test("legacy artwork review cannot be erased by the new rights checkbox", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await manual(page);
  await openPurposeNote(page);
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("An artwork that needs a permission review");
  await upload(page);
  await expect(result(page)).toContainText("Community sticker counter");
  await manual(page);
  await rights(page).check();
  await page
    .getByRole("button", { name: "Suggest specification", exact: true })
    .click();
  await expect(rights(page)).not.toBeChecked();
  await expect(rights(page)).toBeDisabled();
  await expect(preview(page)).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Request artwork permission review",
      exact: true,
    })
    .click();
  await preview(page).click();
  expect(state.creations[0].spec.permission).toBe("unclear");
  await expect(
    page.getByRole("heading", {
      name: "An owner review is needed",
      exact: true,
    }),
  ).toBeVisible();
});

for (const mode of ["authorized", "wrong-assets"] as const)
  test(`a recommendation with ${mode} data cannot authorize or replace the uploaded picture`, async ({
    page,
  }) => {
    const { state } = await fixture(page);
    state.mode = mode;
    await upload(page);
    await expect(page.getByRole("alert")).toContainText(
      "recommendation could not be confirmed",
    );
    await expect(rights(page)).not.toBeChecked();
    await expect(preview(page)).toBeDisabled();
    state.mode = "recommended";
    await page
      .getByRole("button", { name: "Retry picture analysis", exact: true })
      .click();
    await expect(result(page)).toContainText("Community sticker counter");
    expect(state.creations).toHaveLength(0);
  });

test("expired requester analysis cannot restore private pictures or recommendations in a replacement session", async ({
  page,
}) => {
  const { state, respond } = await fixture(page);
  state.holdFirst = true;
  await upload(page);
  await expect.poll(() => state.held.length).toBe(1);
  state.expired = true;
  await page.evaluate(() => (window as any).refreshPictureFixture());
  await page
    .getByRole("button", { name: "Open requester session", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Upload your pictures", exact: true }),
  ).toBeVisible();
  await respond(state.held[0]);
  await expect(page.getByAltText("Uploaded original artwork")).toHaveCount(0);
  await expect(result(page)).toHaveCount(0);
  await expect(page.getByLabel("What is it for?", { exact: true })).toHaveValue(
    "",
  );
  expect(state.creations).toHaveLength(0);
});

test("replacement upload chooses supported settings after prior-picture adjustments and permission review stays explicit", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await openPurposeNote(page);
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Manually sized club label");
  await upload(page);
  await expect(result(page)).toContainText("Community sticker counter");
  await manual(page);
  await page.getByLabel("Width (mm)", { exact: true }).fill("61");
  await upload(page);
  await expect.poll(() => state.recommendations.length).toBe(2);
  await expect(result(page)).toContainText("Community sticker counter");
  await expect(page.getByLabel("Width (mm)", { exact: true })).toHaveValue(
    "53",
  );
  await manual(page);
  await page.getByLabel("Width (mm)", { exact: true }).fill("61");
  expect(state.recommendations).toHaveLength(2);
  await expect(preview(page)).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Request artwork permission review",
      exact: true,
    })
    .click();
  await preview(page).click();
  await expect(
    page.getByRole("heading", {
      name: "An owner review is needed",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.creations[0].spec).toMatchObject({
    widthMm: 61,
    permission: "unclear",
  });
  expect(state.creations[0].spec.recommendedMachineId).toBe(
    "thermal_database_device",
  );
  await expect(
    page.getByRole("button", {
      name: "Approve preview & see price",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("a fresh picture preview accepts an omitted or short optional note and preserves longer notes exactly", async ({
  page,
}) => {
  const { state } = await fixture(page);
  for (const note of ["", "a", "ab", "  An exact existing note  "]) {
    if (state.creations.length)
      await page
        .getByRole("button", { name: "New order", exact: true })
        .click();
    await openPurposeNote(page);
    await page.getByLabel("What is it for?", { exact: true }).fill(note);
    await upload(page);
    await expect(result(page)).toContainText("Community sticker counter");
    await rights(page).check();
    await preview(page).click();
    await expect(
      page.getByRole("button", {
        name: "Approve preview & see price",
        exact: true,
      }),
    ).toBeEnabled({ timeout: 2000 });
    expect(state.creations.at(-1).spec.intent).toBe(
      note.trim().length < 3 ? "Picture for a workshop print" : note,
    );
    expect(state.creations.at(-1).key).toMatch(/^[a-f0-9-]{36}$/);
  }
  expect(state.creations).toHaveLength(4);
  expect(new Set(state.creations.map((creation) => creation.key)).size).toBe(4);
  expect(state.recommendations).toHaveLength(4);
  for (const creation of state.creations)
    expect(creation.spec.recommendedMachineId).toBe("thermal_database_device");
});

test("an edited optional note can be cleared or shortened without changing the raw draft or its save baseline", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await addEarlierOrder(page, state);
  await page.locator(".order-row").click();
  const notes = ["", "x", "  Keep this edit exactly  "];
  for (const [index, note] of notes.entries()) {
    await page
      .getByRole("button", {
        name: "Edit item",
        exact: true,
      })
      .click();
    const field = page.getByLabel("What is it for?", { exact: true });
    await field.fill(note);
    await expect(field).toHaveValue(note);
    await page
      .getByRole("button", {
        name: "Update preview",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Edit item",
        exact: true,
      }),
    ).toBeVisible();
    expect(state.edits[index].spec.intent).toBe(
      note.trim().length < 3 ? "Picture for a workshop print" : note,
    );
    expect(state.edits[index].baseline).toBe(`"${index + 1}"`);
  }
  expect(state.edits).toHaveLength(3);
  expect(state.creations).toHaveLength(0);
  expect(state.recommendations).toHaveLength(0);
});

test("an invalid manual field reopens its disclosure without losing the exact cleared value", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await openPurposeNote(page);
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("Exact manually sized label");
  await upload(page);
  await expect(result(page)).toContainText("Community sticker counter");
  await manual(page);
  await rights(page).check();
  const width = page.getByLabel("Width (mm)", { exact: true });
  await width.fill("");
  await page.getByText("Optional print settings", { exact: true }).click();
  await expect(width).toBeHidden();
  await preview(page).click();
  await expect(width).toBeVisible();
  await expect(width).toBeFocused();
  await expect(width).toHaveValue("");
  expect(state.creations).toHaveLength(0);
});

for (const viewport of [
  { width: 320, height: 760 },
  { width: 390, height: 844 },
])
  test(`fresh picture upload is visible without scrolling at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await fixture(page);
    const box = await page.locator(".picture-upload").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });

test("320px keyboard picture flow stays legible with collapsed technical fields and visible rights confirmation", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { state } = await fixture(page);
  await page.screenshot({
    path: "evidence/upload-first-empty-320.png",
    fullPage: false,
  });
  await upload(page);
  await expect(result(page)).toContainText("Community sticker counter");
  await rights(page).focus();
  await page.keyboard.press("Space");
  await expect(rights(page)).toBeChecked();
  await expect(page.getByLabel("Quantity", { exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await testInfo.attach("picture-first-accessibility", {
    contentType: "application/json",
    body: JSON.stringify({
      state: "picture-recommended-320",
      rulesPassed: audit.passes.length,
      violations: audit.violations,
    }),
  });
  expect(audit.violations).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "evidence/upload-first-recommended-320.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await result(page).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "evidence/upload-first-recommended-desktop.png",
    fullPage: false,
  });
  await preview(page).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", {
      name: "Approve preview & see price",
      exact: true,
    }),
  ).toBeEnabled();
  expect(state.creations).toHaveLength(1);
});
