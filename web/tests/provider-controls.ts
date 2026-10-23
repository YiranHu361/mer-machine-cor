import { expect, type Locator, type Page } from "@playwright/test";

/** Open real native disclosures, outermost first, without changing form values. */
export async function revealProviderControl(control: Locator) {
  await expect(control).toHaveCount(1);
  const disclosures = control.locator("xpath=ancestor::details");
  for (const details of await disclosures.all()) {
    if ((await details.getAttribute("open")) !== null) continue;
    const summary = details.locator(":scope > summary");
    await expect(summary).toBeVisible();
    await summary.click();
    await expect(details).toHaveAttribute("open", "");
  }
  await expect(control).toBeVisible();
}

export async function openProviderDetails(
  scope: Page | Locator,
  label: string,
) {
  const summary = scope.locator("summary").filter({
    hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
  });
  await revealProviderControl(summary);
  const details = summary.locator("..");
  if ((await details.getAttribute("open")) === null) await summary.click();
  await expect(details).toHaveAttribute("open", "");
}

export async function openMachineSettings(machine: Locator) {
  await revealProviderControl(
    machine.getByLabel("Collection point", { exact: true }),
  );
}

export async function openOrderDetails(order: Locator) {
  await openProviderDetails(order, "Recovery & order history");
}

export async function openTrialMeasurements(order: Locator) {
  await revealProviderControl(
    order.getByLabel("Consumables (USD cents)", { exact: true }),
  );
}

export async function openPaymentRecovery(order: Locator) {
  await revealProviderControl(
    order.getByLabel("Pending test payment operation", { exact: true }),
  );
}

export async function openHandlingSteps(order: Locator) {
  await revealProviderControl(
    order.getByLabel("Output removed", { exact: true }),
  );
}
