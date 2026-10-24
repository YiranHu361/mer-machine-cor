/**
 * Fixed Relief catalog: ten process types and the items a 300-person shelter
 * needs after a hypothetical M6.8 Hayward Fault earthquake. Pure data and
 * deterministic arithmetic only; matching always works on process, never brand.
 */
export type ProcessId =
  | "sticker_print"
  | "photo_print"
  | "fdm_print"
  | "laser_cut"
  | "cnc_route"
  | "vinyl_cut"
  | "large_format_print"
  | "document_print"
  | "sewing"
  | "heat_press";

export const PROCESS_IDS: readonly ProcessId[] = Object.freeze([
  "sticker_print",
  "photo_print",
  "fdm_print",
  "laser_cut",
  "cnc_route",
  "vinyl_cut",
  "large_format_print",
  "document_print",
  "sewing",
  "heat_press",
] as const);

/** Processes the team's own machines can run physically; the rest are simulation-only. */
export const REAL_CAPABLE_PROCESSES: readonly ProcessId[] = Object.freeze([
  "sticker_print",
  "photo_print",
  "fdm_print",
] as const);

export function isProcessId(value: unknown): value is ProcessId {
  return (
    typeof value === "string" &&
    (PROCESS_IDS as readonly string[]).includes(value)
  );
}

export interface ProcessSheet {
  process: ProcessId;
  label: string;
  unit: string;
  setupSeconds: number;
  secondsPerUnit: number;
  materialPerUnit: number;
  materialUnit: string;
  basis: "assumption";
  sources: string[];
  note: string;
}

const ASSUMPTION_NOTE = "Assumption pending a sourced, checked spec sheet.";

function sheet(
  process: ProcessId,
  label: string,
  unit: string,
  setupSeconds: number,
  secondsPerUnit: number,
  materialPerUnit: number,
  materialUnit: string,
): ProcessSheet {
  return Object.freeze({
    process,
    label,
    unit,
    setupSeconds,
    secondsPerUnit,
    materialPerUnit,
    materialUnit,
    basis: "assumption" as const,
    sources: [],
    note: ASSUMPTION_NOTE,
  });
}

/**
 * Placeholder process figures. Every value is an unsourced assumption
 * (basis "assumption", no sources) until a checked spec sheet replaces it.
 */
export const PROCESS_SHEETS: Record<ProcessId, ProcessSheet> = Object.freeze({
  sticker_print: sheet(
    "sticker_print",
    "Sticker and label printing",
    "label",
    30,
    6,
    0.05,
    "m of label roll",
  ),
  photo_print: sheet(
    "photo_print",
    "Photo printing",
    "card",
    20,
    15,
    1,
    "photo sheet",
  ),
  fdm_print: sheet(
    "fdm_print",
    "FDM 3D printing",
    "clip",
    120,
    600,
    6,
    "g of PLA filament",
  ),
  laser_cut: sheet(
    "laser_cut",
    "Laser cutting",
    "sign",
    180,
    240,
    0.06,
    "m² of 3 mm acrylic",
  ),
  cnc_route: sheet(
    "cnc_route",
    "CNC routing",
    "panel",
    600,
    900,
    0.75,
    "sheet of 1220×2440 mm plywood",
  ),
  vinyl_cut: sheet(
    "vinyl_cut",
    "Vinyl cutting",
    "decal",
    120,
    60,
    0.09,
    "m² of floor vinyl",
  ),
  large_format_print: sheet(
    "large_format_print",
    "Large-format printing",
    "poster",
    120,
    180,
    0.5,
    "m² of poster paper",
  ),
  document_print: sheet(
    "document_print",
    "Document printing",
    "sheet",
    30,
    3,
    1,
    "sheet of letter paper",
  ),
  sewing: sheet("sewing", "Sewing", "piece", 300, 420, 0.5, "m of fabric"),
  heat_press: sheet(
    "heat_press",
    "Heat pressing",
    "vest",
    180,
    90,
    0.05,
    "m² of heat-transfer vinyl",
  ),
});

export interface ReliefCatalogItem {
  id: string;
  name: string;
  process: ProcessId;
  unit: string;
  chunkSize: number;
  perHundredPeople: number;
}

function item(
  id: string,
  name: string,
  process: ProcessId,
  chunkSize: number,
  perHundredPeople: number,
): ReliefCatalogItem {
  return Object.freeze({
    id,
    name,
    process,
    unit: PROCESS_SHEETS[process].unit,
    chunkSize,
    perHundredPeople,
  });
}

/** Exactly one item per process type. */
export const RELIEF_CATALOG: readonly ReliefCatalogItem[] = Object.freeze([
  item("cot-labels", "Cot and supply-bin labels", "sticker_print", 50, 200),
  item("found-pet-cards", "Found-pet photo cards", "photo_print", 10, 10),
  item("tarp-clips", "Tarp clips", "fdm_print", 10, 40),
  item("privacy-partitions", "Plywood privacy partitions", "cnc_route", 2, 10),
  item("wayfinding-signs", "Acrylic wayfinding signs", "laser_cut", 4, 8),
  item("floor-decals", "Floor decals for lines", "vinyl_cut", 10, 20),
  item(
    "posters-maps",
    "Multilingual posters and maps",
    "large_format_print",
    5,
    10,
  ),
  item(
    "intake-forms",
    "Intake forms and info sheets",
    "document_print",
    100,
    400,
  ),
  item("blanket-hems", "Blanket hems and tote bags", "sewing", 10, 50),
  item("volunteer-vests", "Volunteer vests", "heat_press", 5, 10),
]);

/**
 * Integer quantity per catalog item id for a shelter of `headCount` people:
 * ceil(headCount / 100 × perHundredPeople), at least 1. Integer arithmetic only.
 */
export function reliefQuantities(headCount: number): Record<string, number> {
  if (!Number.isInteger(headCount) || headCount < 1 || headCount > 10000) {
    throw new RangeError("headCount must be an integer from 1 to 10000.");
  }
  const quantities: Record<string, number> = {};
  for (const entry of RELIEF_CATALOG) {
    const scaled = headCount * entry.perHundredPeople;
    quantities[entry.id] = Math.max(1, Math.floor((scaled + 99) / 100));
  }
  return quantities;
}
