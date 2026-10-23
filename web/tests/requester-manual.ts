import { expect, type Page } from "@playwright/test";

/** These existing scenarios deliberately exercise the optional manual workflow. */
export async function useManualSettings(page: Page) {
  const summary = page.getByText("Advanced settings", { exact: true });
  await expect(summary).toBeVisible();
  const expanded = await summary.evaluate(
    (element) => element.closest("details")?.open === true,
  );
  if (!expanded) await summary.click();
  const manual = page.getByRole("button", {
    name: "Use manual settings",
    exact: true,
  });
  if (await manual.isVisible()) await manual.click();
}

export async function authorizePictures(page: Page) {
  await page
    .getByLabel("I own these pictures or have permission to print them", {
      exact: true,
    })
    .check();
}
