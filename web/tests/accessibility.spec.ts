import { useManualSettings, authorizePictures } from "./requester-manual";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const widths = [320, 390, 768, 1440];

async function audit(page: Page, state: string) {
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = result.violations.map(({ id, impact, nodes }) => ({
    id,
    impact,
    nodes: nodes.map(({ target, failureSummary }) => ({
      target,
      failureSummary,
    })),
  }));
  await test.info().attach(`${state}-accessibility`, {
    body: JSON.stringify(
      { state, violations, rulesPassed: result.passes.length },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(violations, `${state} accessibility violations`).toEqual([]);
}

async function reflow(page: Page, state: string) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(() => ({
          content: document.documentElement.scrollWidth,
          viewport: document.documentElement.clientWidth,
        })),
      )
      .toEqual({ content: width, viewport: width });
    if (width === 320 || width === 1440) await audit(page, `${state}-${width}`);
    const fullPage = await page.evaluate(
      () => document.documentElement.scrollHeight <= 6000,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `evidence/overnight-${state}-${width}.png`,
      fullPage,
    });
    if (
      width === 1440 &&
      ["requester-intake", "owner-orders-handling"].includes(state)
    )
      await page.screenshot({
        path: `evidence/overnight-${state}-overview.png`,
      });
  }
}

test("requester intake and production preview pass accessibility and 320px reflow", async ({
  page,
  browserName,
}) => {
  await mkdir(resolve("evidence"), { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const health = await (await page.request.get("/api/health")).json();
  expect(health.mode).toBe("simulation");
  expect(health.paymentMode).toBe("mock");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What are we making?" }),
  ).toBeVisible();
  // macOS WebKit defaults to Option+Tab for full keyboard navigation, including links.
  await page.keyboard.press(
    browserName === "webkit" && process.platform === "darwin"
      ? "Alt+Tab"
      : "Tab",
  );
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await page.locator("#main").evaluate((element) => element.blur());
  await reflow(page, "requester-intake");
  await useManualSettings(page);

  await page
    .getByLabel("Upload artwork", { exact: true })
    .setInputFiles(resolve("tests/fixtures/makers.png"));
  await expect(page.getByAltText("Uploaded original artwork")).toBeVisible();
  await page
    .getByLabel("What is it for?", { exact: true })
    .fill(`Overnight accessible production preview ${Date.now()}`);
  await authorizePictures(page);
  await page
    .getByRole("button", { name: "Make production preview", exact: true })
    .click();
  await expect(page.getByAltText(/Actual production preview/)).toBeVisible();
  await reflow(page, "requester-preview");
  // This check creates only an unpaid draft; it never dispatches physical or simulated work.
  await page.getByRole("button", { name: "Cancel order", exact: true }).click();
  await page.getByRole("button", { name: "Cancel order", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "This order was cancelled",
      exact: true,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("owner login and every dashboard tab pass accessibility and narrow reflow", async ({
  page,
}) => {
  await mkdir(resolve("evidence"), { recursive: true });
  await page.goto("/owner");
  await expect(
    page.getByLabel("Owner access code", { exact: true }),
  ).toBeVisible();
  await audit(page, "owner-login");
  await page.setViewportSize({ width: 320, height: 1000 });
  await audit(page, "owner-login-mobile");
  const credentials = JSON.parse(
    await readFile(resolve("../.data/local-credentials.json"), "utf8"),
  );
  await page
    .getByLabel("Owner access code", { exact: true })
    .fill(process.env.FABRARY_OWNER_CODE || credentials.ownerCode);
  await page
    .getByRole("button", { name: "Open owner workshop", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Keep the counter moving." }),
  ).toBeVisible();
  const ordersTab = page.getByRole("tab", {
    name: "Orders & handling",
    exact: true,
  });
  await ordersTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Machines & policy", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("tab", { name: "Payment records", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(ordersTab).toBeFocused();
  for (const tab of await page.getByRole("tab").all()) {
    const label = (await tab.innerText()).trim();
    const state = "owner-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await reflow(page, state);
  }
});

test("initial service failure has an accessible retry and recovers without reloading", async ({
  page,
}) => {
  let available = false;
  await page.route("**/api/health", async (route) => {
    if (available) return route.continue();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "STORE_DISCONNECTED",
          message:
            "The workshop is unavailable. Restore the local service and retry.",
        },
      }),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "workshop is unavailable",
  );
  await audit(page, "service-unavailable");
  available = true;
  await page.getByRole("button", { name: /try again|retry/i }).click();
  await expect(
    page.getByRole("heading", { name: "What are we making?" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
