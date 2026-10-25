import { test, expect, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function savedOrder() {
  const at = new Date().toISOString();
  return {
    id: "approval_response_order",
    version: 1,
    specVersion: 1,
    createdAt: at,
    updatedAt: at,
    spec: {
      assetIds: ["approval_source"],
      intent: "My exact recommended sticker",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      crop: "contain",
      permission: "authorized",
      recommendedMachineId: "approval_thermal_device",
    },
    artifact: {
      id: "approval_preview",
      url: "/approval-response.png",
      sha256: "a".repeat(64),
    },
    productionState: "specified",
    paymentState: "unpaid",
    fulfillmentState: "unprepared",
    history: [],
  };
}
function quote(totalCents = 75) {
  return {
    id: "approval_response_quote",
    version: 1,
    expiresAt: new Date(Date.now() + 120000).toISOString(),
    items: [{ label: "Fixture print", cents: totalCents }],
    totalCents,
    ownerCents: totalCents,
    platformCents: 0,
    currency: "USD",
    paymentMode: "mock",
    collectionPoint: "Fixture pickup desk",
    accepted: false,
  };
}
async function json(route: Route, value: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}
async function fixture(
  page: Page,
  corrupt: (job: any) => void,
  totalCents = 75,
) {
  const initial = savedOrder();
  const state = {
    job: initial as any,
    revision: 1,
    failedReads: false,
    actions: [] as { path: string; body: any }[],
    reads: 0,
    corruptList: null as ((job: any) => void) | null,
  };
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.addInitScript((id) => {
    localStorage.setItem("fabyn-current-job", id);
    const callbacks: Array<() => void> = [];
    class FixtureEvents {
      onopen: (() => void) | null = null;
      constructor() {
        queueMicrotask(() => this.onopen?.());
      }
      addEventListener(name: string, callback: () => void) {
        if (name === "refresh") callbacks.push(callback);
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: FixtureEvents });
    (window as any).refreshApprovalFixture = () =>
      callbacks.forEach((fn) => fn());
  }, initial.id);
  await page.route("**/approval-response.png", async (route) =>
    route.fulfill({
      contentType: "image/png",
      body: await readFile(resolve("tests/fixtures/makers.png")),
    }),
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      state.actions.push({ path, body: request.postDataJSON() });
      if (path === `/api/jobs/${initial.id}/approve-and-quote`) {
        state.job = {
          ...initial,
          version: 3,
          machineId: initial.spec.recommendedMachineId,
          productionState: "quoted",
          approvedSpecHash: "exact_approved_fixture",
          quote: quote(totalCents),
        };
        state.revision++;
        const reply = structuredClone(state.job);
        corrupt(reply);
        state.failedReads = true;
        return json(route, { job: reply });
      }
      return json(
        route,
        {
          error: {
            message:
              "No payment or production mutation is allowed in this fixture.",
          },
        },
        405,
      );
    }
    if (path === "/api/session")
      return json(route, {
        role: "requester",
        id: "approval_response_requester",
      });
    if (path === "/api/health")
      return json(route, {
        mode: "simulation",
        paymentMode: "mock",
        store: "approval-response-fixture",
      });
    if (path === "/api/machines")
      return json(route, { machines: [], revision: state.revision });
    if (path === "/api/jobs") {
      state.reads++;
      const snapshot = structuredClone(state.job);
      state.corruptList?.(snapshot);
      return state.failedReads
        ? json(
            route,
            {
              error: {
                message: "Saved state lookup is unavailable in this fixture.",
              },
            },
            503,
          )
        : json(route, { jobs: [snapshot], revision: state.revision });
    }
    return json(
      route,
      { error: { message: "No external read is allowed in this fixture." } },
      404,
    );
  });
  await page.goto("/");
  const approve = page.getByRole("button", {
    name: "Approve preview & see price",
    exact: true,
  });
  await expect(approve).toBeEnabled();
  return { state, pageErrors, approve, initial };
}
const faults: Array<{ name: string; corrupt: (job: any) => void }> = [
  {
    name: "null quote items",
    corrupt: (job) => {
      job.quote.items = null;
    },
  },
  {
    name: "an object price label",
    corrupt: (job) => {
      job.quote.items[0].label = { private: "unexpected" };
    },
  },
  {
    name: "an object collection point",
    corrupt: (job) => {
      job.quote.collectionPoint = { private: "unexpected" };
    },
  },
  {
    name: "an unsupported payment mode",
    corrupt: (job) => {
      job.quote.paymentMode = "mainnet";
    },
  },
  {
    name: "an invalid quote deadline",
    corrupt: (job) => {
      job.quote.expiresAt = "unknown";
    },
  },
  {
    name: "an inconsistent money allocation",
    corrupt: (job) => {
      job.quote.ownerCents = 90;
    },
  },
  {
    name: "a missing quote",
    corrupt: (job) => {
      delete job.quote;
    },
  },
  {
    name: "a different actual machine",
    corrupt: (job) => {
      job.machineId = "another_device";
    },
  },
  {
    name: "a different specification version",
    corrupt: (job) => {
      job.specVersion++;
    },
  },
  {
    name: "a different production artifact",
    corrupt: (job) => {
      job.artifact.sha256 = "b".repeat(64);
    },
  },
];
for (const fault of faults)
  test(`approval reply with ${fault.name} preserves the original preview and recovers the exact saved quote through reads`, async ({
    page,
  }) => {
    const { state, pageErrors, approve, initial } = await fixture(
      page,
      fault.corrupt,
    );
    await approve.click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Its result is unknown" }),
    ).toBeVisible();
    await expect(approve).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Confirm mock payment/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Start production", exact: true }),
    ).toHaveCount(0);
    expect(state.actions).toEqual([
      {
        path: `/api/jobs/${initial.id}/approve-and-quote`,
        body: {
          artifactSha256: initial.artifact.sha256,
          specVersion: initial.specVersion,
          recommendedMachineId: initial.spec.recommendedMachineId,
          autoAccept: false,
        },
      },
    ]);
    expect(pageErrors).toEqual([]);
    await page.evaluate(() => (window as any).refreshApprovalFixture());
    const refresh = page.getByRole("button", {
      name: "Refresh now",
      exact: true,
    });
    await expect(refresh).toBeVisible();
    state.failedReads = false;
    await refresh.click();
    await expect(
      page.getByRole("heading", { name: "Your quote is ready", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Confirm mock payment · $0.75",
        exact: true,
      }),
    ).toBeEnabled();
    expect(state.actions).toHaveLength(1);
    expect(state.job.id).toBe(initial.id);
    expect(state.job.quote.id).toBe("approval_response_quote");
    expect(pageErrors).toEqual([]);
  });

test("a valid zero-cost mock quote remains readable and does not trigger payment or production", async ({
  page,
}) => {
  const { state, pageErrors, approve } = await fixture(page, () => {}, 0);
  await approve.click();
  await expect(
    page.getByRole("heading", { name: "Your quote is ready", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Confirm mock payment · $0.00",
      exact: true,
    }),
  ).toBeEnabled();
  expect(state.actions).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test("an unreadable saved-order quote snapshot keeps the last good view and recovers without a mutation", async ({
  page,
}) => {
  const { state, pageErrors, approve, initial } = await fixture(page, () => {});
  state.corruptList = (job) => {
    job.productionState = "quoted";
    job.quote = quote();
    job.quote.items = null;
  };
  state.revision++;
  await page.evaluate(() => (window as any).refreshApprovalFixture());
  const refresh = page.getByRole("button", {
    name: "Refresh now",
    exact: true,
  });
  await expect(refresh).toBeVisible();
  await expect(approve).toBeEnabled();
  await expect(page.locator(".order-row")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /^Confirm mock payment/ }),
  ).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(state.actions).toEqual([]);
  state.corruptList = null;
  state.job = {
    ...state.job,
    version: 2,
    spec: {
      ...state.job.spec,
      intent: "Recovered authoritative saved artwork",
    },
  };
  state.revision++;
  await refresh.click();
  await expect(page.locator(".order-intent")).toHaveText(
    "Recovered authoritative saved artwork",
  );
  await expect(approve).toBeEnabled();
  await expect(page.locator(".order-row")).toHaveCount(1);
  expect(
    await page.evaluate(() => localStorage.getItem("fabyn-current-job")),
  ).toBe(initial.id);
  expect(pageErrors).toEqual([]);
  expect(state.actions).toEqual([]);
});
