import { test, expect } from "@playwright/test";

// Exercise the built website without a producer, paid service, or real order.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.postDataJSON()?.role === "owner")
      return route.fulfill({
        status: 403,
        json: {
          error: { code: "ACCESS_CODE", message: "Access code required" },
        },
      });
    return route.fulfill({
      json: { role: request.method() === "POST" ? "requester" : null },
    });
  });
});

for (const path of ["/", "/index.html", "/fabyn", "/relief", "/live"]) {
  test(`${path} opens the current Fabyn home`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const scripts: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script") scripts.push(request.url());
    });
    await page.goto(path);
    await expect(page).toHaveURL(/\/fabyn$/);
    await expect(
      page.getByRole("navigation", { name: "fabyn", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^start demo$/i }),
    ).toBeVisible();
    await expect(page).toHaveTitle("fabyn");
    expect(scripts.some((url) => /legacy[-.]/.test(url))).toBe(false);
    expect(errors).toEqual([]);
  });
}

test("the retired owner page opens a usable new seller sign-in and preserves bookmarks", async ({
  page,
}) => {
  await page.goto("/owner/?from=bookmark#machines");
  await expect(page).toHaveURL(/\/fabyn\/seller\?from=bookmark#machines$/);
  await expect(
    page.getByRole("heading", { name: "Put your machines to work." }),
  ).toBeVisible();
  await expect(page.getByLabel("Access code", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open the workshop" }),
  ).toBeVisible();
});

test("both consumer entry URLs open the new ordering chat", async ({
  page,
}) => {
  for (const path of ["/make", "/fabyn/order"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/fabyn\/order$/);
    await expect(
      page.getByRole("heading", {
        name: "Tell us what you want to build today",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "What do you want made?" }),
    ).toBeVisible();
  }
});

test("homepage navigation reaches the consumer and seller interfaces", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^start demo$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Who are you today?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "continue as consumer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tell us what you want to build today" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "seller side →", exact: true })
    .click();
  await expect(page).toHaveURL(/\/fabyn\/seller$/);
  await expect(
    page.getByRole("heading", { name: "Put your machines to work." }),
  ).toBeVisible();
});
