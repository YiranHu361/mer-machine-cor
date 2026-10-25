import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function deferred() {
  let release!: () => void;
  return {
    promise: new Promise<void>((done) => {
      release = done;
    }),
    release: () => release(),
  };
}
async function fixture(page: Page, kind: "preview") {
  const at = "2026-10-23T10:30:00.000Z";
  const url = "/fixture-image-deadline-initial.png";
  const job: any = {
    id: "image_deadline",
    version: 1,
    specVersion: 1,
    createdAt: at,
    updatedAt: at,
    spec: {
      assetIds: [],
      intent: "Native image deadline fixture",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    productionState: "specified",
    paymentState: "unpaid",
    fulfillmentState: "unprepared",
    history: [],
    artifact: { id: "deadline_original_artifact", url, sha256: "a".repeat(64) },
  };
  const state = {
    job,
    revision: 1,
    imageRequests: [] as {
      url: string;
      pending: ReturnType<typeof deferred>;
      finished: boolean;
    }[],
    mutations: [] as string[],
  };
  const bytes = await readFile(resolve("tests/fixtures/makers.png"));
  await page.clock.install();
  await page.addInitScript((id) => {
    localStorage.setItem("fabyn-current-job", id);
    const sources = new Set<{ handler?: () => void }>();
    (window as any).__imageDeadlineRefresh = () => {
      for (const source of sources) source.handler?.();
    };
    (window as any).EventSource = class {
      handler?: () => void;
      constructor() {
        sources.add(this);
      }
      addEventListener(name: string, handler: () => void) {
        if (name === "refresh") this.handler = handler;
      }
      close() {
        sources.delete(this);
      }
    };
  }, job.id);
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  const holdImage = async (
    route: Parameters<Parameters<Page["route"]>[1]>[0],
  ) => {
    const entry = {
      url: route.request().url(),
      pending: deferred(),
      finished: false,
    };
    state.imageRequests.push(entry);
    await entry.pending.promise;
    try {
      await route.fulfill({ contentType: "image/png", body: bytes });
    } catch {
      /* A timed-out/unmounted native image may cancel its read. */
    }
    entry.finished = true;
  };
  await page.route("**/fixture-image-deadline-*.png*", holdImage);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      state.mutations.push(path);
      return route.fulfill({
        status: 405,
        body: "No mutation is allowed in the native-image fixture",
      });
    }
    const data: Record<string, unknown> = {
      "/api/health": {
        mode: "simulation",
        paymentMode: "mock",
        store: "image-deadline-ui-fixture",
      },
      "/api/session": { id: "image_deadline_requester", role: "requester" },
      "/api/jobs": { revision: state.revision, jobs: [state.job] },
      "/api/machines": { revision: 1, machines: [] },
      "/api/catalog": { models: [] },
    };
    return route.fulfill({
      status: data[path] ? 200 : 405,
      contentType: "application/json",
      body: JSON.stringify(data[path] ?? {}),
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => state.imageRequests.length).toBe(1);
  const surface = page.locator(".preview-surface");
  await expect(surface).toHaveAttribute("aria-busy", "true");
  const refresh = async () => {
    const response = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/jobs" &&
        response.status() === 200,
    );
    await page.evaluate(() => (window as any).__imageDeadlineRefresh());
    await (await response).finished();
    await page.clock.runFor(50);
  };
  return {
    state,
    surface,
    refresh,
    releaseAll() {
      for (const request of state.imageRequests) request.pending.release();
    },
  };
}

for (const kind of ["preview"] as const)
  for (const recovery of ["retry", "new context"] as const)
    test(`${kind} native image timeout permits ${recovery} and ignores the late expired read (offline fixture)`, async ({
      page,
    }) => {
      const f = await fixture(page, kind);
      try {
        const oldImage = await f.surface.locator("img").elementHandle();
        expect(oldImage).not.toBeNull();
        await page.clock.fastForward(14_000);
        f.state.job.version++;
        f.state.revision++;
        await f.refresh(); // An ordinary parent refresh must not restart the deadline.
        await page.clock.fastForward(16_001);
        await expect(f.surface).not.toHaveAttribute("aria-busy", "true");
        await expect(f.surface).toContainText("did not finish loading");
        const retry = f.surface.getByRole("button", {
          name: "Retry production preview",
          exact: true,
        });
        await expect(retry).toBeVisible();
        expect(await oldImage!.evaluate((element) => element.isConnected)).toBe(
          false,
        );
        await page.clock.fastForward(30_001);
        expect(f.state.imageRequests).toHaveLength(1);
        if (recovery === "retry") {
          await retry.focus();
          await retry.press("Enter");
          await expect(retry).toBeFocused();
          await expect(retry).toHaveAttribute("aria-disabled", "true");
          await retry.press("Enter");
        } else {
          f.state.job.artifact = {
            id: "deadline_replacement_artifact",
            url: "/fixture-image-deadline-current.png",
            sha256: "b".repeat(64),
          };
          f.state.job.specVersion++;
          f.state.job.version++;
          f.state.revision++;
          await f.refresh();
        }
        await expect.poll(() => f.state.imageRequests.length).toBe(2);
        await expect(f.surface).toHaveAttribute("aria-busy", "true");
        f.state.imageRequests[0].pending.release();
        await expect.poll(() => f.state.imageRequests[0].finished).toBe(true);
        await page.clock.runFor(50);
        await expect(f.surface).toHaveAttribute("aria-busy", "true");
        if (kind === "preview")
          await expect(
            page.getByRole("button", {
              name: "Approve preview & see price",
              exact: true,
            }),
          ).toBeDisabled();
        else await expect(f.surface.getByRole("img")).toHaveCount(0);
        f.state.imageRequests[1].pending.release();
        const image = f.surface.getByRole("img");
        await expect(image).toBeVisible();
        await expect
          .poll(() =>
            image.evaluate(
              (element) => (element as HTMLImageElement).naturalWidth,
            ),
          )
          .toBeGreaterThan(0);
        await expect(f.surface).not.toHaveAttribute("aria-busy", "true");
        if (kind === "preview")
          await expect(
            page.getByRole("button", {
              name: "Approve preview & see price",
              exact: true,
            }),
          ).toBeEnabled();
        if (recovery === "retry") await expect(image).toBeFocused();
        await page.clock.fastForward(30_001); // Settled attempts have no live deadline.
        await expect(image).toBeVisible();
        await expect(f.surface).not.toContainText("did not finish loading");
        expect(f.state.imageRequests).toHaveLength(2);
        expect(f.state.mutations).toEqual([]);
        await oldImage!.dispose();
      } finally {
        f.releaseAll();
      }
    });
