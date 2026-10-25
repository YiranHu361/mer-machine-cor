import { test, expect } from "@playwright/test";

test("Vercel remains connected while a stopped producer expires, including the A1", async ({
  page,
}) => {
  let lastSeen = new Date().toISOString();
  const printer = () => ({
    id: "bambu_01",
    name: "Model counter",
    model: "Bambu Lab A1 mini",
    makes: "3D prints",
    status: "connected",
    detail: "Printer answered.",
    lastSeen,
    checkedAt: lastSeen,
    linked: true,
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/session")
      return route.fulfill({ json: { role: "owner" } });
    if (path === "/api/owner/dashboard")
      return route.fulfill({
        json: {
          revision: 1,
          producer: { lastSeen, printers: [printer()] },
          machines: [
            {
              id: "bambu_01",
              name: "Model counter",
              model: "Bambu Lab A1 mini",
              outputType: "3d",
              mode: "hardware",
              producerHub: { machineId: "m_fdm_01", since: lastSeen },
              paired: true,
              configured: true,
              calibrated: true,
              listed: true,
              ready: true,
              paused: false,
              reason: "",
              mediaRemaining: 15,
              material: "pla",
              activeJobId: null,
              maxJobSeconds: 1800,
              collectionPoint: "test",
              settingsFingerprint: "test",
            },
          ],
          jobs: [],
          ledger: [],
          connectors: [],
          setupCodes: [],
        },
      });
    if (path === "/api/printers")
      return route.fulfill({ json: { printers: [printer()] } });
    if (path === "/api/events")
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": test\n\n",
      });
    return route.fulfill({
      json: {
        machines: [],
        cloud: true,
        local: false,
        actions: {},
        app: {
          realMachines: false,
          light: "ok",
          checkedAt: null,
          detail: "test",
        },
        python: {},
        hub: {},
      },
    });
  });
  await page.goto("/fabyn/seller#machines");
  await expect(
    page.getByText("Vercel connected", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/^Producer online/)).toBeVisible();
  const card = page.getByRole("article", { name: "Model counter" });
  await expect(card.getByText("Available", { exact: true })).toBeVisible();
  lastSeen = new Date(Date.now() - 21_000).toISOString();
  await expect(page.getByText(/^Producer offline/)).toBeVisible();
  await expect(
    page.getByText("Vercel connected", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText("Offline", { exact: true })).toBeVisible();
});
