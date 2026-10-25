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
// The producer's name tag template (node/fabrary_node/nametag.py) takes the same characters.
const LETTER = "A-Za-z0-9À-ÖØ-öø-ÿ";
const TEXT_TAG = new RegExp(`^[${LETTER} .,'&!?+-]{1,16}$`);
export const NEUTRAL_TAG_TEXT = "FOR YOU";

/** Name tag text as written, when the template can engrave it, or the neutral default. */
export function tagText(raw: string | null | undefined) {
  const text = (raw ?? "").trim().replace(/\s+/g, " ");
  return TEXT_TAG.test(text) && new RegExp(`[${LETTER}]`).test(text)
    ? text
    : NEUTRAL_TAG_TEXT;
}
/**
 * The name for a name tag: double-quoted text, or what follows "says",
 * "named", "with the name" and the like. Null when the request gives none.
 */
export function nameFromRequest(text: string): string | null {
  const quoted = /["“]([^"“”]{1,16})["”]/.exec(text)?.[1];
  const said =
    /\b(?:that says|saying|says|reads|named|called|with (?:the |my )?name|(?:my )?name is)\s*:?\s*(.+)$/i.exec(
      text,
    )?.[1];
  for (const candidate of [quoted, said]) {
    const name = candidate?.trim().replace(/[.,;:]+$/, "");
    if (name && tagText(name) === name) return name;
  }
  return null;
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
/** True when the request itself asks to keep colour, e.g. "in full colour". */
export function asksForColour(text: string) {
  return /\b(colou?r(ed|ful)?|full[- ]colou?r)\b/i.test(text);
}
export function requestedProcess(text: string): Process | null {
  const t = text.toLowerCase();
  if (/\b(keychain|key chain|3d|charm|tag|name ?tags?|name-tags?)\b/.test(t))
    return "fdm_print";
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
      text: tagText(nameFromRequest(text)),
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
          name: /\bname[ -]?tags?\b/i.test(text) ? "A name tag" : "A keychain",
          why: `“${tagText(nameFromRequest(text))}” engraved in one colour, with a keyring hole.`,
          quantity: 1,
          creation: "generate",
          photoAssetIds: [],
          text: tagText(nameFromRequest(text)),
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
