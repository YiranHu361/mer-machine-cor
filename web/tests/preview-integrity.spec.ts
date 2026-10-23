import { test, expect, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

async function json(route: Route, value: unknown) {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

for (const context of [
  "another order",
  "a rebuilt file on the same order",
  "the reselected and reopened current order",
] as const)
  test(`identical production bytes for ${context} still wait for the current preview to load (UI fixture)`, async ({
    page,
  }) => {
    const bytes = await readFile(resolve("tests/fixtures/makers.png"));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const at = new Date().toISOString();
    const jobs = ["a111111", "b222222"].map((suffix) => ({
      id: `job_${suffix}`,
      version: 1,
      specVersion: 1,
      createdAt: at,
      updatedAt: at,
      spec: {
        assetIds: [`original_${suffix}`],
        intent: `Preview identity for ${suffix}`,
        outputType: "sticker",
        widthMm: 53,
        heightMm: 50,
        quantity: 1,
        material: "thermal-paper",
        permission: "authorized",
        crop: "contain",
      },
      artifact: {
        id: `production_${suffix}`,
        url: `/fixture-preview-${suffix}.png`,
        sha256,
      },
      productionState: "specified",
      paymentState: "unpaid",
      fulfillmentState: "unprepared",
      history: [],
    }));
    let revision = 1;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.addInitScript(
      (id) => localStorage.setItem("fabrary-current-job", id),
      jobs[0].id,
    );
    await page.route("**/fixture-preview-*.png", async (route) => {
      if (route.request().url().includes("b222222")) await pending;
      await route.fulfill({ contentType: "image/png", body: bytes });
    });
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/health")
        return json(route, {
          mode: "simulation",
          paymentMode: "mock",
          store: "preview-ui-fixture",
        });
      if (path === "/api/session")
        return json(route, { role: "requester", id: "preview_requester" });
      if (path === "/api/jobs") return json(route, { revision, jobs });
      if (path === "/api/machines")
        return json(route, { revision: 1, machines: [] });
      if (path === "/api/catalog") return json(route, { models: [] });
      if (path === "/api/events")
        return route.fulfill({
          contentType: "text/event-stream",
          body: ": isolated preview fixture\n\n",
        });
      return route.fulfill({
        status: 404,
        body: "No external operations allowed in this UI fixture.",
      });
    });
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const approve = page.getByRole("button", {
        name: "Approve preview & see price",
        exact: true,
      });
      await expect(approve).toBeEnabled();
      if (context === "another order") {
        await page
          .locator(".order-row")
          .filter({ hasText: "job_b222" })
          .click();
        await expect(page.locator(".order-intent")).toHaveText(
          jobs[1].spec.intent,
        );
      } else if (context === "the reselected and reopened current order") {
        await page
          .locator(".order-row")
          .filter({ hasText: "job_a111" })
          .click();
        await expect(approve).toBeEnabled();
        await page
          .getByRole("button", {
            name: "Edit item",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", {
            name: "Keep current item",
            exact: true,
          })
          .click();
        await expect(approve).toBeEnabled();
        return;
      } else {
        jobs[0] = {
          ...jobs[0],
          version: 2,
          specVersion: 2,
          spec: {
            ...jobs[0].spec,
            intent: "Rebuilt preview for the same order",
          },
          artifact: jobs[1].artifact,
        };
        revision++;
        await expect(page.locator(".order-intent")).toHaveText(
          jobs[0].spec.intent,
        );
      }
      await expect(
        page.getByText("Loading production preview…", { exact: true }),
      ).toBeVisible();
      await expect(approve).toBeDisabled();
      release();
      await expect(approve).toBeEnabled();
    } finally {
      release();
    }
  });
