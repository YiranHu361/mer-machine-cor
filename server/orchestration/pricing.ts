import type { Machine } from "../model.ts";
import type { PriceTerms } from "./types.ts";

export const PRICE_POLICY = "price-card-v1";
export const FEE_PERCENT = 10;
export interface PriceCard {
  materialCentsPerUnit: number;
  unitCents: number;
  timeCentsPerMinute: number;
  minimumCents: number;
  /** Charged once per assignment, never multiplied by quantity. */
  setupCents: number;
}
/**
 * Adapter from today's registry price card (consumables, machine, handling,
 * platform) so existing quotes keep their meaning: consumables become the
 * material rate, machine the unit cost, handling a once-per-assignment charge.
 */
export function registryPriceCard(
  machine: Pick<Machine, "priceCard">,
): PriceCard {
  const c = machine.priceCard;
  return {
    materialCentsPerUnit: c.consumables,
    unitCents: c.machine,
    timeCentsPerMinute: 0,
    setupCents: c.handling,
    minimumCents: c.consumables + c.machine + c.handling,
  };
}
const half = (numerator: number, denominator: number) =>
  Math.floor((numerator * 2 + denominator) / (2 * denominator));
/**
 * owner = max(minimum, setup + quantity × (material × rate + unit + minutes × rate)),
 * all in integer cents; the buyer pays owner + a 10% fee rounded half up once.
 */
export function priceAssignment(
  card: PriceCard,
  quantity: number,
  materialPerUnit: number,
  minutesPerUnit: number,
): PriceTerms {
  if (!Number.isSafeInteger(quantity) || quantity < 1)
    throw new Error("PRICE_INVALID_QUANTITY");
  const material = Math.round(
    quantity * materialPerUnit * card.materialCentsPerUnit,
  );
  const unit = quantity * card.unitCents;
  const time = Math.round(quantity * minutesPerUnit * card.timeCentsPerMinute);
  const terms = [
    { label: "Material", cents: material },
    { label: "Unit cost", cents: unit },
    { label: "Machine time", cents: time },
    { label: "Owner handling", cents: card.setupCents },
  ].filter((t) => t.cents > 0);
  const subtotal = material + unit + time + card.setupCents;
  const ownerCents = Math.max(card.minimumCents, subtotal);
  if (ownerCents > subtotal)
    terms.push({ label: "Minimum price", cents: ownerCents - subtotal });
  const feeCents = half(ownerCents * FEE_PERCENT, 100);
  terms.push({ label: "Platform fee (10%)", cents: feeCents });
  return {
    ownerCents,
    feeCents,
    totalCents: ownerCents + feeCents,
    terms,
    policy: PRICE_POLICY,
  };
}
