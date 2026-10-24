import type { Experience, IntentBrief, IntentItem, Process } from "./types.ts";

export const GIFT_PROCESSES: Process[] = [
  "photo_print",
  "sticker_print",
  "fdm_print",
];
export const SINGLE_PROCESSES: Process[] = [
  "sticker_print",
  "photo_print",
  "fdm_print",
];
const TEXT_TAG = /^[A-Z0-9 !?&+-]{1,10}$/;
export const NEUTRAL_TAG_TEXT = "FOR YOU";

/** Keychain text the producer's template accepts, or the neutral default. */
export function tagText(raw: string | null | undefined) {
  const text = (raw ?? "").toUpperCase().trim().replace(/\s+/g, " ");
  return TEXT_TAG.test(text) ? text : NEUTRAL_TAG_TEXT;
}
/** The thing to draw: "I want a cat sticker" gives "cat". */
export function drawableSubject(text: string) {
  const lower = text.toLowerCase();
  const match =
    /\b(?:an?|the|some|my)\s+([a-z][a-z -]{0,30}?)\s+(?:sticker|stickers|label|labels|keychain|print|drawing|design)\b/.exec(
      lower,
    ) ??
    /\b(?:sticker|drawing|design)\s+of\s+(?:an?|the|my)?\s*([a-z][a-z -]{0,30})/.exec(
      lower,
    );
  const subject = (match?.[1] ?? "").trim();
  return subject && !/^(photo|picture|image)$/.test(subject) ? subject : null;
}
function requestedProcess(text: string): Process | null {
  const t = text.toLowerCase();
  if (/\b(keychain|key chain|3d|charm|tag)\b/.test(t)) return "fdm_print";
  if (/\b(sticker|stickers|label|labels|decal)\b/.test(t))
    return "sticker_print";
  if (
    /\b(photo print|print (?:this|my|the) photo|instax|polaroid|photo card)\b/.test(
      t,
    )
  )
    return "photo_print";
  return null;
}
/** Quoted text in the request, e.g. keychain that says "MAYA". */
function quotedText(text: string) {
  return /["“']([^"”']{1,10})["”']/.exec(text)?.[1] ?? null;
}
export interface PhotoFacts {
  assetId: string;
  colorful: boolean;
  kind: "graphic" | "photo" | "ambiguous";
}
/**
 * Deterministic understanding used without a Claude key and in tests. It never
 * picks a machine; it only names processes the registry might support.
 */
export function localIntent(
  experience: Exclude<Experience, "relief">,
  requestText: string,
  photos: PhotoFacts[],
): IntentBrief {
  const text = requestText.trim();
  const ids = photos.map((p) => p.assetId);
  const colorful = photos.some((p) => p.colorful || p.kind === "photo");
  const subject = drawableSubject(text);
  if (experience === "gift") {
    const items: IntentItem[] = [];
    if (ids.length)
      items.push({
        process: "photo_print",
        name: "A print of your photo",
        why: "Keeps the shared memory in colour.",
        quantity: 1,
        creation: ids.length > 1 ? "combine" : "preserve",
        photoAssetIds: ids.slice(0, 1),
        colorImportant: true,
      });
    items.push(
      ids.length && !subject
        ? {
            process: "sticker_print",
            name: "A sticker of your photo",
            why: "A small keepsake from the same picture.",
            quantity: 1,
            creation: "preserve",
            photoAssetIds: ids.slice(0, 1),
            colorImportant: false,
          }
        : {
            process: "sticker_print",
            name: `A ${subject ?? "heart"} sticker`,
            why: subject
              ? `Drawn from the request: ${subject}.`
              : "A simple drawn keepsake.",
            quantity: 1,
            creation: "generate",
            photoAssetIds: [],
            subject: subject ?? "heart",
            colorImportant: false,
          },
    );
    items.push({
      process: "fdm_print",
      name: "A keychain",
      why: "Something to carry; the text is editable.",
      quantity: 1,
      creation: "generate",
      photoAssetIds: [],
      text: tagText(quotedText(text)),
      colorImportant: false,
    });
    return {
      provider: "local",
      outcome: "A three-piece gift.",
      items,
      question: ids.length ? null : "Add a photo for the photo print.",
      reason: "Local rules: one item per gift process.",
    };
  }
  const asked = requestedProcess(text);
  const process: Process =
    asked ??
    (ids.length
      ? colorful
        ? "photo_print"
        : "sticker_print"
      : "sticker_print");
  const generate =
    !ids.length || (process === "sticker_print" && !!subject && !asked);
  const item: IntentItem =
    process === "fdm_print"
      ? {
          process,
          name: "A keychain",
          why: "Requested as a keychain.",
          quantity: 1,
          creation: "generate",
          photoAssetIds: [],
          text: tagText(quotedText(text)),
          colorImportant: false,
        }
      : {
          process,
          name:
            process === "photo_print"
              ? "A print of your photo"
              : subject && (!ids.length || generate)
                ? `A ${subject} sticker`
                : "A sticker of your picture",
          why:
            ids.length && !generate
              ? "Keeps your picture as it is."
              : `Drawn from the request${subject ? `: ${subject}` : ""}.`,
          quantity: 1,
          creation:
            ids.length && !(generate && subject)
              ? ids.length > 1
                ? "combine"
                : "preserve"
              : "generate",
          photoAssetIds: ids.length && !(generate && subject) ? ids : [],
          subject:
            subject ??
            (ids.length ? undefined : text.slice(0, 40) || undefined),
          colorImportant: process === "photo_print",
        };
  return {
    provider: "local",
    outcome: item.name,
    items: [item],
    question: null,
    reason: "Local rules from the request words and photo colour.",
  };
}
