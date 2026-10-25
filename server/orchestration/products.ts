import type { Machine, State } from "../model.ts";
import { PRODUCER_STALE_MS } from "../../shared/connection-status.ts";
import { tagText } from "./intent.ts";
import { BUSY_REASON, eligibleRegistryMachines } from "./matching.ts";
import type { ExecutionMode, IntentItem, Process } from "./types.ts";

/**
 * What a conversation may offer. Each product is a template the producer
 * already prepares; nothing else is ever offered as makeable.
 */
export type ProductId =
  | "name_tag"
  | "drawn_sticker"
  | "photo_sticker"
  | "colour_print"
  | "photo_print";
export const PRODUCT_IDS: ProductId[] = [
  "name_tag",
  "drawn_sticker",
  "photo_sticker",
  "colour_print",
  "photo_print",
];
export interface Product {
  id: ProductId;
  title: string;
  process: Process;
  /** New artwork is drawn, so a design provider must be set up. */
  draws: boolean;
  needsPhoto: boolean;
  colour: "black and white" | "full colour" | "one colour";
  makes: string;
  personalize: string;
  /** The fields an option of this product carries. */
  fields: { text?: "required"; subject?: "required"; caption?: "optional" };
}
export const PRODUCTS: Record<ProductId, Product> = {
  name_tag: {
    id: "name_tag",
    title: "Name tag",
    process: "fdm_print",
    draws: false,
    needsPhoto: false,
    colour: "one colour",
    makes:
      "A 3D-printed tag in one colour of PLA, about 70 × 18 mm, with raised lettering and a keyring hole. Text only: no pictures.",
    personalize:
      "text: up to 16 letters, digits, spaces and . , ' & ! ? + -, engraved exactly as written.",
    fields: { text: "required" },
  },
  drawn_sticker: {
    id: "drawn_sticker",
    title: "Drawn sticker",
    process: "sticker_print",
    draws: true,
    needsPhoto: false,
    colour: "black and white",
    makes:
      "An original black-and-white drawing on a thermal sticker, 48 mm wide; its length follows the drawing, up to 150 mm.",
    personalize:
      "subject: what to draw, up to 40 characters. caption: optional lettering under the drawing, up to 16 of the same characters as a name tag, set in type (the drawing itself never has words). No logos or known characters.",
    fields: { subject: "required", caption: "optional" },
  },
  photo_sticker: {
    id: "photo_sticker",
    title: "Photo sticker",
    process: "sticker_print",
    draws: false,
    needsPhoto: true,
    colour: "black and white",
    makes:
      "The person's own photo as a black-and-white (dithered) thermal sticker, 48 mm wide.",
    personalize: "caption: optional lettering under the picture, up to 16 characters.",
    fields: { caption: "optional" },
  },
  colour_print: {
    id: "colour_print",
    title: "Colour print",
    process: "photo_print",
    draws: true,
    needsPhoto: false,
    colour: "full colour",
    makes: "An original colour drawing on instax mini film, 54 × 86 mm.",
    personalize: "subject: what to draw, up to 40 characters. No lettering.",
    fields: { subject: "required" },
  },
  photo_print: {
    id: "photo_print",
    title: "Photo print",
    process: "photo_print",
    draws: false,
    needsPhoto: true,
    colour: "full colour",
    makes: "The person's own photo in colour on instax mini film, 54 × 86 mm.",
    personalize: "none: the photo is printed as it is.",
    fields: {},
  },
};
export const isProduct = (x: unknown): x is ProductId =>
  typeof x === "string" && (PRODUCT_IDS as string[]).includes(x);

export interface Availability {
  available: boolean;
  /** Why not, in plain words; never a machine error. */
  reason?: string;
  machine?: string;
  /** Made on a simulated machine: nothing physical comes out. */
  practice?: boolean;
}
const KIND: Record<string, string> = {
  sticker_print: "sticker printer",
  photo_print: "photo printer",
  fdm_print: "3D printer",
};
/**
 * A hub printer on the cloud producer answers only through its Mac's
 * heartbeat: a machine record that says ready is not enough when the Mac
 * has gone quiet or its printer reports an error.
 */
function connected(s: State, m: Machine, at: number) {
  if (!m.producerHub || m.mode !== "hardware" || !s.producer) return true;
  const report = s.producer.machines[m.producerHub.machineId];
  return (
    !!report &&
    at - report.lastSeen <= PRODUCER_STALE_MS &&
    !["offline", "error"].includes(report.status)
  );
}
/** Whether a process can be made now, as matching and the producer's heartbeats see it. */
export function processAvailability(
  s: State,
  process: Process,
  colour: boolean,
  allowed: (mode: ExecutionMode) => boolean,
  at: number,
): Availability {
  const { candidates, rejected } = eligibleRegistryMachines(
    s,
    { process, quantity: 1, colorImportant: colour },
    allowed,
    at,
  );
  const live = candidates
    .filter((c) => connected(s, c.machine, at))
    .sort((a, b) => Number(b.mode === "hardware") - Number(a.mode === "hardware"));
  if (live.length)
    return {
      available: true,
      machine: live[0].machine.model,
      ...(live[0].mode === "simulation" ? { practice: true } : {}),
    };
  const kind = KIND[process] ?? "machine";
  if (candidates.length)
    return {
      available: false,
      reason: `The ${candidates[0].machine.model}'s computer has not checked in recently, so it may be off.`,
    };
  if (rejected.some((r) => r.reason === BUSY_REASON))
    return {
      available: false,
      reason: `The ${kind} is busy with another order right now.`,
    };
  return {
    available: false,
    reason: `No ${kind} is switched on and taking orders right now.`,
  };
}
export function productAvailability(
  s: State,
  options: {
    allowed: (mode: ExecutionMode) => boolean;
    at: number;
    /** A design provider is set up, so new artwork can be drawn. */
    drawing: boolean;
    photos: number;
  },
): Record<ProductId, Availability> {
  const byProcess = new Map<string, Availability>();
  const machine = (p: Product) => {
    const key = `${p.process}:${p.colour === "full colour"}`;
    if (!byProcess.has(key))
      byProcess.set(
        key,
        processAvailability(s, p.process, p.colour === "full colour", options.allowed, options.at),
      );
    return byProcess.get(key)!;
  };
  return Object.fromEntries(
    PRODUCT_IDS.map((id) => {
      const p = PRODUCTS[id];
      // Artwork and machines fail separately, and say so separately.
      const a: Availability = p.needsPhoto && !options.photos
        ? { available: false, reason: "It needs a photo: attach one first." }
        : p.draws && !options.drawing
          ? {
              available: false,
              reason: "Drawing new artwork is not set up here right now (this is not a printer problem).",
            }
          : machine(p);
      return [id, a];
    }),
  ) as Record<ProductId, Availability>;
}
/** What the model is told about each product: public facts only, no ids, owners or orders. */
export function capabilityFacts(availability: Record<ProductId, Availability>) {
  return PRODUCT_IDS.map((id) => {
    const p = PRODUCTS[id];
    const a = availability[id];
    return {
      product: id,
      title: p.title,
      makes: p.makes,
      colour: p.colour,
      personalize: p.personalize,
      needsPhoto: p.needsPhoto,
      available: a.available,
      ...(a.machine ? { machine: a.machine } : {}),
      ...(a.practice ? { practiceRunOnly: true } : {}),
      ...(a.reason ? { reason: a.reason } : {}),
    };
  });
}

/* ---------- personalization ---------- */

/** Text a name tag or caption can carry exactly as written, or null. */
export function lettering(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, " ");
  return text && tagText(text) === text ? text : null;
}
/** A drawing subject: short plain words, or null. */
export function drawingSubject(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
  return text && text.length <= 40 ? text : null;
}

/** What one chosen option makes, in the order pipeline's own terms. */
export function intentItem(
  option: { product: ProductId; title: string; why: string; text?: string; subject?: string; caption?: string },
  photos: string[],
): IntentItem {
  const p = PRODUCTS[option.product];
  const base = { quantity: 1, why: option.why };
  switch (option.product) {
    case "name_tag":
      return {
        ...base,
        process: "fdm_print",
        name: "A name tag",
        creation: "generate",
        photoAssetIds: [],
        text: option.text,
        colorImportant: false,
      };
    case "drawn_sticker":
      return {
        ...base,
        process: "sticker_print",
        name: `A ${option.subject} sticker`,
        creation: "generate",
        photoAssetIds: [],
        subject: option.subject,
        ...(option.caption ? { caption: option.caption } : {}),
        colorImportant: false,
      };
    case "photo_sticker":
      return {
        ...base,
        process: "sticker_print",
        name: "A sticker of your photo",
        creation: "preserve",
        photoAssetIds: photos.slice(0, 1),
        ...(option.caption ? { caption: option.caption } : {}),
        colorImportant: false,
      };
    case "colour_print":
      return {
        ...base,
        process: "photo_print",
        name: `A ${option.subject} print`,
        creation: "generate",
        photoAssetIds: [],
        subject: option.subject,
        colorImportant: true,
      };
    case "photo_print":
      return {
        ...base,
        process: p.process,
        name: "A print of your photo",
        creation: "preserve",
        photoAssetIds: photos.slice(0, 1),
        colorImportant: true,
      };
  }
}
