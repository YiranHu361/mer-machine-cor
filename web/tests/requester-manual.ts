import { expect, type Page } from "@playwright/test";

/** Existing lifecycle scenarios deliberately open the optional print refinements. */
export async function useManualSettings(page: Page) {
  await openPurposeNote(page);
  const summary = page.getByText("Optional print settings", { exact: true });
  if (!(await summary.count())) return;
  await expect(summary).toBeVisible();
  const expanded = await summary.evaluate(
    (element) => element.closest("details")?.open === true,
  );
  if (!expanded) await summary.click();
  const manual = page.getByRole("button", {
    name: "Adjust print settings",
    exact: true,
  });
  if (await manual.isVisible()) await manual.click();
}

export async function openPurposeNote(page: Page) {
  const summary = page.locator(".picture-context > summary");
  await expect(summary).toBeVisible();
  if (
    !(await summary.evaluate(
      (element) => element.closest("details")?.open === true,
    ))
  )
    await summary.click();
}

/** Order facts and the production-file fingerprint are folded under Order details. */
export async function openOrderDetails(page: Page) {
  const details = page.locator(".request-state-details");
  await expect(details).toHaveCount(1);
  if ((await details.getAttribute("open")) === null)
    await details.locator(":scope > summary").click();
  await expect(details).toHaveAttribute("open", "");
}

export async function authorizePictures(page: Page) {
  await page
    .getByLabel("I own these pictures or have permission to print them", {
      exact: true,
    })
    .check();
}

/** Deterministic recommendation boundary for isolated requester lifecycle fixtures. */
export function recommendationFor(input: {
  assetIds: string[];
  intent?: string;
}) {
  const machine = {
    id: "fixture_thermal_recommendation",
    name: "Fixture sticker counter",
    model: "Phomemo M02Pro",
    outputType: "sticker",
    mode: "simulation",
  };
  return {
    status: "recommended",
    provider: "local_analysis",
    reason:
      "This fixture machine supports the uploaded artwork and paper size.",
    questions: [],
    machine,
    spec: {
      assetIds: input.assetIds,
      intent:
        (input.intent?.trim().length ?? 0) >= 3
          ? input.intent
          : "Picture for a workshop print",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      crop: "contain",
      permission: "unclear",
      recommendedMachineId: machine.id,
    },
    notice: "Local analysis fixture; no AI service reviewed these pictures.",
  };
}
