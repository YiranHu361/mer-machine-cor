import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

for (const role of ["requester", "owner"] as const)
  for (const failure of ["unauthorized", "missing", "corrupt"] as const)
    test(`${role} can recover ${failure} result evidence without changing the recorded outcome (UI fixture)`, async ({
      page,
    }, testInfo) => {
      const at = new Date().toISOString();
      const job = {
        id: "job_evidence_recovery",
        version: 1,
        specVersion: 1,
        createdAt: at,
        updatedAt: at,
        spec: {
          assetIds: [],
          intent: "Inspect the simulated workshop result",
          outputType: "sticker",
          widthMm: 53,
          heightMm: 50,
          quantity: 1,
          material: "thermal-paper",
          permission: "authorized",
          crop: "contain",
        },
        productionState: "needs_review",
        paymentState: "release_pending",
        fulfillmentState: "unprepared",
        attemptId: "attempt_fixture",
        evidence: {
          url: "/fixture-result-evidence.png",
          result: "review",
          reason: "The simulated frame needs operator inspection.",
          capturedAt: at,
          machineId: "fixture_machine",
          source: "simulation",
          completionCredible: false,
        },
        history: [],
      };
      let requests = 0;
      const imageRequests: string[] = [];
      let recovered = false;
      const mutations: string[] = [];
      await page.addInitScript(
        (id) => localStorage.setItem("fabrary-current-job", id),
        job.id,
      );
      await page.routeWebSocket(/.*/, (socket) => socket.close());
      await page.route("**/fixture-result-evidence.png*", async (route) => {
        requests++;
        imageRequests.push(route.request().url());
        if (recovered)
          return route.fulfill({
            contentType: "image/png",
            body: await readFile(resolve("tests/fixtures/makers.png")),
          });
        return route.fulfill({
          status:
            failure === "unauthorized"
              ? 403
              : failure === "missing"
                ? 404
                : 200,
          contentType: failure === "corrupt" ? "image/png" : "text/plain",
          body: "Unavailable image fixture",
        });
      });
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() !== "GET") mutations.push(path);
        let body: unknown;
        if (path === "/api/health")
          body = {
            mode: "simulation",
            paymentMode: "mock",
            store: "evidence-recovery-fixture",
          };
        else if (path === "/api/session")
          body = { role, id: "evidence_fixture" };
        else if (path === "/api/jobs") body = { revision: 1, jobs: [job] };
        else if (path === "/api/owner/dashboard")
          body = { revision: 1, machines: [], jobs: [job], ledger: [] };
        else if (path === "/api/machines") body = { revision: 1, machines: [] };
        else if (path === "/api/catalog") body = { models: [] };
        else if (path === "/api/events")
          return route.fulfill({
            contentType: "text/event-stream",
            body: ": isolated media fixture\n\n",
          });
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
      await page.goto(role === "owner" ? "/owner" : "/");
      const surface = page.locator(
        role === "owner" ? ".owner-evidence" : ".evidence",
      );
      await expect(surface.getByRole("status")).toContainText(
        "The result image could not be displayed.",
      );
      await expect(surface).toContainText(
        "The simulated frame needs operator inspection.",
      );
      await expect(surface).toContainText(
        role === "owner" ? "simulated" : "Simulated evidence",
      );
      await expect(surface).toContainText(
        role === "owner" ? "unconfirmed" : "completion unconfirmed",
      );
      if (role === "owner") {
        await expect(
          page.getByRole("heading", {
            name: "Record an operator decision",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByLabel("Reason for decision", { exact: true }),
        ).toHaveValue("");
      }
      if (role === "requester" && failure === "corrupt") {
        await page.setViewportSize({ width: 320, height: 664 });
        await surface.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: resolve("evidence/overnight-evidence-recovery-320.png"),
        });
      }
      const retry = surface.getByRole("button", {
        name: "Retry result image",
        exact: true,
      });
      await retry.click();
      await expect(retry).toBeVisible();
      await expect.poll(() => requests).toBe(2);
      await expect(retry).toBeEnabled();
      recovered = true;
      await retry.focus();
      await retry.press("Enter");
      const image = surface.getByRole("img");
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate(
            (element) => (element as HTMLImageElement).naturalWidth,
          ),
        )
        .toBeGreaterThan(0);
      await expect(surface.getByRole("status")).toHaveCount(0);
      await expect(
        surface.getByRole("link", {
          name: "Open result image in a new tab",
          exact: true,
        }),
      ).toHaveAttribute("href", job.evidence.url);
      await expect(surface.getByRole("link")).toBeFocused();
      expect(requests).toBe(3);
      expect(new Set(imageRequests).size).toBe(3);
      expect(mutations).toEqual([]);
      await testInfo.attach("evidence-recovery-fixture", {
        contentType: "application/json",
        body: JSON.stringify({
          role,
          failure,
          requests,
          mutations,
          recordedResult: job.evidence.result,
          paymentState: job.paymentState,
        }),
      });
    });

test("malformed result sources remain an inline failure through repeated retries without leaking details or mutations (UI fixture)", async ({
  page,
}) => {
  const source = "http://[private-fixture-detail";
  const at = new Date().toISOString();
  const job = {
    id: "job_malformed_evidence",
    version: 1,
    specVersion: 1,
    createdAt: at,
    updatedAt: at,
    spec: {
      assetIds: [],
      intent: "Inspect malformed fixture evidence",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    productionState: "needs_review",
    paymentState: "release_pending",
    fulfillmentState: "unprepared",
    attemptId: "malformed_fixture_attempt",
    evidence: {
      url: source,
      result: "review",
      reason: "Ask the owner to inspect this recorded result.",
      capturedAt: at,
      machineId: "fixture_machine",
      source: "simulation",
      completionCredible: false,
    },
    history: [],
  };
  const mutations: string[] = [],
    externalRequests: string[] = [],
    pageErrors: string[] = [];
  const origin = new URL(
    process.env.FABRARY_BROWSER_URL || "http://127.0.0.1:4317",
  ).origin;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(
    (id) => localStorage.setItem("fabrary-current-job", id),
    job.id,
  );
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.fallback();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      mutations.push(path);
      return route.fulfill({
        status: 405,
        body: "Only fixture reads are allowed.",
      });
    }
    let body: unknown;
    if (path === "/api/health")
      body = {
        mode: "simulation",
        paymentMode: "mock",
        store: "malformed-media-fixture",
      };
    else if (path === "/api/session")
      body = { role: "requester", id: "malformed_media_requester" };
    else if (path === "/api/jobs") body = { revision: 1, jobs: [job] };
    else if (path === "/api/machines") body = { revision: 1, machines: [] };
    else if (path === "/api/catalog") body = { models: [] };
    else if (path === "/api/events")
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": malformed media fixture\n\n",
      });
    else
      return route.fulfill({
        status: 404,
        body: "Unknown isolated fixture read.",
      });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("/");
  const evidence = page.locator(".evidence");
  const retry = evidence.getByRole("button", {
    name: "Retry result image",
    exact: true,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(evidence.getByRole("status")).toHaveText(
      "The result image could not be displayed.",
    );
    const previousImage = await evidence.locator("img").elementHandle();
    expect(previousImage).not.toBeNull();
    await retry.click();
    await expect
      .poll(() => previousImage!.evaluate((image) => image.isConnected))
      .toBe(false);
    await previousImage!.dispose();
  }
  await expect(evidence.getByRole("status")).toHaveText(
    "The result image could not be displayed.",
  );
  await expect(retry).toBeEnabled();
  await expect(page.locator(".order-intent")).toHaveText(job.spec.intent);
  await expect(evidence).toContainText(job.evidence.reason);
  await expect(evidence.getByRole("img")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(source);
  await expect(page.locator("body")).not.toContainText("Invalid URL");
  expect(pageErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(mutations).toEqual([]);
});
