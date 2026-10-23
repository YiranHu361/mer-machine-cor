import {
  test,
  expect,
  type Page,
  type Route,
  type Locator,
} from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:4317\//, () => {});
});
const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
function savedOrder() {
  const at = new Date().toISOString();
  return {
    id: "numeric_saved_order",
    version: 1,
    specVersion: 1,
    createdAt: at,
    updatedAt: at,
    spec: {
      assetIds: ["numeric_art"],
      intent: "Keyboard numeric editing fixture",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    artifact: { id: "numeric_preview", url: pixel, sha256: "a".repeat(64) },
    productionState: "specified",
    paymentState: "unpaid",
    fulfillmentState: "unprepared",
    history: [],
  };
}
async function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
async function fixture(page: Page) {
  const state = {
    job: savedOrder(),
    submissions: [] as Record<string, any>[],
    failNext: false,
    recommendationOutput: "instax" as "instax" | "sticker",
    recommendations: [] as any[],
  };
  await page.addInitScript((id) => {
    localStorage.setItem("fabrary-current-job", id);
  }, state.job.id);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/health")
      return json(route, {
        mode: "simulation",
        paymentMode: "mock",
        store: "numeric-fixture",
      });
    if (path === "/api/session")
      return json(route, { role: "requester", id: "numeric_requester" });
    if (path === "/api/machines") return json(route, { machines: [] });
    if (path === "/api/catalog") return json(route, { models: [] });
    if (path === "/api/recommendations") {
      const input = route.request().postDataJSON();
      state.recommendations.push(input);
      const photo = state.recommendationOutput === "instax";
      const machine = {
        id: photo ? "numeric_photo" : "numeric_thermal",
        name: photo ? "Photo desk" : "Sticker desk",
        model: photo ? "Instax Mini Link 3" : "Phomemo M02Pro",
        outputType: state.recommendationOutput,
        mode: "simulation",
      };
      return json(route, {
        status: "recommended",
        provider: "local_analysis",
        reason: "Format defaults belong to this current artwork.",
        questions: [],
        machine,
        spec: {
          assetIds: input.assetIds,
          intent: input.intent || "A print of the numeric artwork",
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
    if (path === "/api/events")
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": isolated numeric fixture\n\n",
      });
    if (path === "/api/jobs" && route.request().method() === "GET")
      return json(route, { revision: state.job.version, jobs: [state.job] });
    if (path.endsWith("/spec") && route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      state.submissions.push(body);
      if (state.failNext) {
        state.failNext = false;
        return json(
          route,
          {
            error: {
              message: "Numeric fixture save unavailable; retry these changes.",
            },
          },
          503,
        );
      }
      state.job = {
        ...state.job,
        spec: body,
        version: state.job.version + 1,
        specVersion: state.job.specVersion + 1,
      };
      return json(route, { job: state.job });
    }
    return json(
      route,
      {
        error: {
          message: "External operations are blocked in numeric fixture.",
        },
      },
      404,
    );
  });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Edit item",
      exact: true,
    })
    .click();
  return state;
}
async function clear(input: Locator) {
  await input.focus();
  await input.press("ControlOrMeta+A");
  await input.press("Backspace");
}
async function replace(input: Locator, value: string) {
  await clear(input);
  await input.pressSequentially(value);
}
function save(page: Page) {
  return page
    .getByRole("button", {
      name: "Update preview",
      exact: true,
    })
    .click();
}

test("clearing required numeric fields stays empty, blocks save and submits retyped numbers exactly (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  const width = page.getByLabel("Width (mm)", { exact: true });
  const height = page.getByLabel("Height (mm)", { exact: true });
  const quantity = page.getByLabel("Quantity", { exact: true });
  for (const input of [width, height, quantity]) {
    await clear(input);
    await expect(input).toHaveValue("");
  }
  await save(page);
  expect(state.submissions).toHaveLength(0);
  await width.pressSequentially("25");
  await height.pressSequentially("75");
  await quantity.pressSequentially("2");
  await expect(width).toHaveValue("25");
  await expect(height).toHaveValue("75");
  await expect(quantity).toHaveValue("2");
  await save(page);
  await expect.poll(() => state.submissions.length).toBe(1);
  expect(state.submissions[0]).toMatchObject({
    widthMm: 25,
    heightMm: 75,
    quantity: 2,
  });
});

test("a temporarily incomplete exponent and decimal budget survive typing without zero replacement (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  const height = page.getByLabel("Height (mm)", { exact: true });
  await replace(height, "5e");
  await expect(height).toHaveValue("");
  expect(
    await height.evaluate((input: HTMLInputElement) => input.validity.badInput),
  ).toBe(true);
  await save(page);
  expect(state.submissions).toHaveLength(0);
  await height.focus();
  await height.pressSequentially("1");
  await expect(height).toHaveValue("5e1");
  await page
    .getByLabel("Automatically accept a quote within my budget", {
      exact: true,
    })
    .check();
  const budget = page.getByLabel("Budget cap (USD)", { exact: true });
  await clear(budget);
  await expect(budget).toHaveValue("");
  await budget.pressSequentially("3.");
  await budget.pressSequentially("75");
  await expect(budget).toHaveValue("3.75");
  await save(page);
  await expect.poll(() => state.submissions.length).toBe(1);
  expect(state.submissions[0]).toMatchObject({
    heightMm: 50,
    budgetMandate: { enabled: true, capCents: 375 },
  });
});

test("failed numeric saves preserve the visible draft and retry the same values (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  state.failNext = true;
  await replace(page.getByLabel("Width (mm)", { exact: true }), "25");
  await replace(page.getByLabel("Height (mm)", { exact: true }), "75");
  await replace(page.getByLabel("Quantity", { exact: true }), "2");
  await page
    .getByLabel("Automatically accept a quote within my budget", {
      exact: true,
    })
    .check();
  await replace(page.getByLabel("Budget cap (USD)", { exact: true }), "12.34");
  await save(page);
  await expect(
    page.getByRole("alert").filter({
      hasText: "Numeric fixture save unavailable; retry these changes.",
    }),
  ).toBeVisible();
  for (const [label, value] of [
    ["Width (mm)", "25"],
    ["Height (mm)", "75"],
    ["Quantity", "2"],
    ["Budget cap (USD)", "12.34"],
  ])
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
  expect(state.job.spec).toMatchObject({
    widthMm: 53,
    heightMm: 50,
    quantity: 1,
  });
  await save(page);
  await expect.poll(() => state.submissions.length).toBe(2);
  expect(state.submissions[1]).toEqual(state.submissions[0]);
  expect(state.submissions[1]).toMatchObject({
    widthMm: 25,
    heightMm: 75,
    quantity: 2,
    budgetMandate: { capCents: 1234 },
  });
});

test("a fresh automatic recommendation replaces incomplete dimensions and quantity with supported format defaults (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await clear(page.getByLabel("Width (mm)", { exact: true }));
  await clear(page.getByLabel("Quantity", { exact: true }));
  await page
    .getByRole("button", { name: "Find suitable machine", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Machine recommendation", exact: true }),
  ).toContainText("Photo desk");
  await expect(page.getByLabel("Width (mm)", { exact: true })).toHaveValue(
    "54",
  );
  await expect(page.getByLabel("Height (mm)", { exact: true })).toHaveValue(
    "86",
  );
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("1");
  state.recommendationOutput = "sticker";
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill("black-and-white sticker for this numeric artwork");
  await page
    .getByRole("button", { name: "Find suitable machine", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Machine recommendation", exact: true }),
  ).toContainText("Sticker desk");
  await expect(page.getByLabel("Width (mm)", { exact: true })).toHaveValue(
    "53",
  );
  await expect(page.getByLabel("Height (mm)", { exact: true })).toHaveValue(
    "50",
  );
  await save(page);
  await expect.poll(() => state.submissions.length).toBe(1);
  expect(state.submissions[0]).toMatchObject({
    outputType: "sticker",
    widthMm: 53,
    heightMm: 50,
    quantity: 1,
    recommendedMachineId: "numeric_thermal",
  });
  expect(state.recommendations).toHaveLength(2);
  for (const input of state.recommendations)
    expect(input.assetIds).toEqual(["numeric_art"]);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(
    page.getByLabel("Owner-prepared model", { exact: true }),
  ).toHaveCount(0);
});

test("discarding an incomplete numeric edit restores saved values before the next edit (offline fixture)", async ({
  page,
}) => {
  const state = await fixture(page);
  await clear(page.getByLabel("Height (mm)", { exact: true }));
  await clear(page.getByLabel("Quantity", { exact: true }));
  await page
    .getByRole("button", { name: "Keep current item", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Edit item",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Width (mm)", { exact: true })).toHaveValue(
    "53",
  );
  await expect(page.getByLabel("Height (mm)", { exact: true })).toHaveValue(
    "50",
  );
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("1");
  expect(state.submissions).toHaveLength(0);
});
