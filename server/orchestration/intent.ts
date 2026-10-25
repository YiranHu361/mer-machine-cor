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
// The producer's name tag template (node/fabyn_node/nametag.py) takes the same characters.
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
    /\b(?:that says|saying|says|(?:it|to) say\b|reads|named|called|with (?:the |my )?name|(?:my )?name is|name to)\s*:?\s*(.+)$/i.exec(
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
/** Colour words that ask for colour, not "black and white" or "no colour". */
export function wantsColour(text: string) {
  return (
    asksForColour(text) &&
    !/\bblack[- ]and[- ]white\b|\bb ?& ?w\b|\bmonochrome\b|\bgr[ae]yscale\b|\b(?:no|without) colou?rs?\b/i.test(text)
  );
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
/** A request written over several chat messages: one line per message, newest last. */
export function requestLines(text: string) {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
}
/** What the newest line that says it says: a later message overrides an earlier one. */
function latest<T>(text: string, read: (line: string) => T | null): T | null {
  const lines = requestLines(text);
  for (let i = lines.length - 1; i >= 0; i--) {
    const found = read(lines[i]);
    if (found !== null) return found;
  }
  return null;
}
export const latestProcess = (text: string) => latest(text, requestedProcess);
export const latestName = (text: string) => latest(text, nameFromRequest);
export const latestSubject = (text: string) => latest(text, drawableSubject);
/* ---------- several things in one request ---------- */

/** Words that name a thing to make, by the process that makes it (checked in this order). */
const THINGS: [Process, RegExp][] = [
  ["fdm_print", /\b(key ?chains?|3d|charms?|tags?|name ?tags?|name-tags?)\b/i],
  ["sticker_print", /\b(stickers?|labels?|decals?)\b/i],
  [
    "photo_print",
    /\b(photo prints?|prints? (?:of )?(?:this|my|the|our|that) (?:photo|picture|pic|selfie)|instax|polaroids?|photo cards?)\b/i,
  ],
];
const thingIn = (part: string) =>
  THINGS.find(([, words]) => words.test(part))?.[0] ?? null;
const SEPARATOR = /(\s*(?:,|;|\band\b|\bplus\b|\balso\b)\s*)/i;
export const MAX_ITEMS = 3;

/** One line cut into the things it names, each with its own words; quoted names are never cut. */
function thingsInLine(line: string): { process: Process; text: string }[] {
  const quotes: string[] = [];
  const masked = line.replace(/["“][^"“”]*["”]/g, (q) => `\u0000${quotes.push(q) - 1}\u0000`);
  const unmask = (t: string) => t.replace(/\u0000(\d+)\u0000/g, (_, i) => quotes[Number(i)]);
  const pieces = masked.split(SEPARATOR);
  const things: { process: Process; text: string }[] = [];
  let lead = "";
  for (let i = 0; i < pieces.length; i += 2) {
    const part = unmask(pieces[i]);
    const sep = i > 0 ? unmask(pieces[i - 1]) : "";
    const process = part.trim() ? thingIn(part) : null;
    if (process) things.push({ process, text: (lead + part).trim() });
    else if (things.length) things[things.length - 1].text += sep + part;
    else lead += part + sep;
    if (process) lead = "";
  }
  return things;
}
const distinct = (things: { process: Process; text: string }[]) =>
  things.filter((t, i) => things.findIndex((x) => x.process === t.process) === i);

/**
 * The things a request explicitly asks for, one per process, when it asks for
 * two or more; [] when it asks for one (or none), which keeps the one-item
 * rules. The newest line naming two or more things sets the list; a later line
 * naming one thing refines (or adds) that thing, and a line naming none
 * refines them all.
 */
export function requestedThings(text: string): { process: Process; text: string }[] {
  const lines = requestLines(text);
  const perLine = lines.map((l) => distinct(thingsInLine(l)));
  let base = -1;
  for (let i = lines.length - 1; i >= 0 && base < 0; i--)
    if (perLine[i].length >= 2) base = i;
  if (base < 0) return [];
  const things = perLine[base].map((t) => ({ ...t }));
  for (let i = base + 1; i < lines.length; i++) {
    const named = perLine[i];
    if (!named.length) for (const t of things) t.text += `\n${lines[i]}`;
    for (const n of named) {
      const same = things.find((t) => t.process === n.process);
      if (same) same.text += `\n${lines[i]}`;
      else things.push({ ...n });
    }
  }
  return things.slice(0, MAX_ITEMS);
}
/** The processes the request names: every thing of a several-thing request, or the one it names. */
export function namedProcesses(text: string): Set<Process> {
  const things = requestedThings(text);
  if (things.length) return new Set(things.map((t) => t.process));
  const one = latestProcess(text);
  return new Set(one ? [one] : []);
}
const draws = (i: IntentItem) =>
  i.creation === "generate" && i.process !== "fdm_print" && !i.catalogItemId;
/**
 * Several requested items: one per process, at most three, and one drawn
 * design at most, because an order has one set of drafts. A second drawn item
 * with the same subject shares those drafts; one with another subject is left
 * out and named in `left`.
 */
export function oneOfEach(items: IntentItem[]): { items: IntentItem[]; left: string[] } {
  const kept: IntentItem[] = [];
  const left: string[] = [];
  let drawn: string | null = null;
  for (const item of items) {
    if (kept.length >= MAX_ITEMS || kept.some((k) => k.process === item.process)) {
      left.push(item.name);
      continue;
    }
    if (draws(item)) {
      const subject = (item.subject ?? "").trim().toLowerCase();
      if (drawn !== null && subject !== drawn) {
        left.push(item.name);
        continue;
      }
      drawn = subject;
    }
    kept.push(item);
  }
  return { items: kept, left };
}
export const leftOutNote = (left: string[]) =>
  left.length
    ? `One order makes one of each kind and draws one design, so I left out ${left.map((n) => n.charAt(0).toLowerCase() + n.slice(1)).join(" and ")}. Order it next.`
    : null;

/** The item for one thing of a several-thing request. */
function thingItem(thing: { process: Process; text: string }, ids: string[]): IntentItem | null {
  const t = thing.text;
  if (thing.process === "fdm_print") {
    const text = tagText(latestName(t));
    return {
      process: "fdm_print",
      name: /\bname[ -]?tags?\b/i.test(t) ? "A name tag" : "A keychain",
      why: `“${text}” engraved in one colour, with a keyring hole.`,
      quantity: 1,
      creation: "generate",
      photoAssetIds: [],
      text,
      colorImportant: false,
    };
  }
  const subject =
    latestSubject(t) ??
    latest(t, (line) => /\b(?:an?|the|some|my)\s+([a-z][a-z -]{0,30}?)\s+(?:instax|polaroid|photo print|photo card)s?\b/i.exec(line)?.[1]?.toLowerCase() ?? null);
  const fallback = requestLines(t).join(", ").slice(0, 40);
  // A sticker printer prints only black: a sticker asked for in colour is a colour print.
  if (thing.process === "sticker_print" && wantsColour(t)) {
    const usesPhoto = ids.length > 0 && !subject;
    return {
      process: "photo_print",
      name: usesPhoto ? "A colour print of your picture" : `A ${subject ?? "colour"} print`,
      why: usesPhoto ? "In colour, as asked; a sticker printer prints only black." : `Drawn in colour, as asked${subject ? `: ${subject}` : ""}.`,
      quantity: 1,
      creation: usesPhoto ? (ids.length > 1 ? "combine" : "preserve") : "generate",
      photoAssetIds: usesPhoto ? ids : [],
      ...(usesPhoto ? {} : { subject: subject ?? fallback }),
      colorImportant: true,
    };
  }
  if (thing.process === "sticker_print") {
    const usesPhoto = ids.length > 0 && !subject;
    return {
      process: "sticker_print",
      name: usesPhoto ? "A sticker of your picture" : `A ${subject ?? "drawn"} sticker`,
      why: usesPhoto ? "Keeps your picture as it is." : `Drawn from the request${subject ? `: ${subject}` : ""}.`,
      quantity: 1,
      creation: usesPhoto ? (ids.length > 1 ? "combine" : "preserve") : "generate",
      photoAssetIds: usesPhoto ? ids : [],
      ...(usesPhoto ? {} : { subject: subject ?? fallback }),
      colorImportant: false,
    };
  }
  if (ids.length)
    return {
      process: "photo_print",
      name: "A print of your photo",
      why: "Keeps your picture as it is.",
      quantity: 1,
      creation: ids.length > 1 ? "combine" : "preserve",
      photoAssetIds: ids,
      colorImportant: true,
    };
  if (!subject) return null;
  return {
    process: "photo_print",
    name: `A ${subject} print`,
    why: `Drawn in colour from the request: ${subject}.`,
    quantity: 1,
    creation: "generate",
    photoAssetIds: [],
    subject,
    colorImportant: true,
  };
}
/** Local rules for a request that names two or three things. */
function severalIntent(things: { process: Process; text: string }[], ids: string[]): IntentBrief {
  const built = things.map((t) => thingItem(t, ids));
  const { items, left } = oneOfEach(built.filter((i): i is IntentItem => !!i));
  const noPhoto = built.some((i) => !i);
  return {
    provider: "local",
    outcome: items.map((i) => i.name).join(" + "),
    items,
    ...(items.length > 1 ? { requested: items.length } : {}),
    question: noPhoto ? "Add the photo for the photo print." : leftOutNote(left),
    reason: "Local rules: one item per thing the request names.",
  };
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
  options: { single?: boolean } = {},
): IntentBrief {
  const text = requestText.trim();
  const ids = photos.map((p) => p.assetId);
  if (experience === "best_single" && !options.single) {
    const things = requestedThings(text);
    if (things.length >= 2) {
      const several = severalIntent(things, ids);
      if (several.items.length) return several;
    }
  }
  const colorful = photos.some((p) => p.colorful || p.kind === "photo");
  const subject = latestSubject(text);
  const name = latestName(text);
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
      text: tagText(name),
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
  const asked = latestProcess(text);
  const process: Process =
    asked ??
    (ids.length
      ? colorful
        ? "photo_print"
        : "sticker_print"
      : "sticker_print");
  // A sticker printer prints only black: colour asked for in words is a colour
  // print, even when a sticker was named.
  if (process === "sticker_print" && wantsColour(text)) {
    const usesPhoto = ids.length > 0 && !subject;
    const item: IntentItem = {
      process: "photo_print",
      name: usesPhoto ? "A print of your photo" : `A ${subject ?? "colour"} print`,
      why: usesPhoto ? "In colour, as asked." : `Drawn in colour, as asked${subject ? `: ${subject}` : ""}.`,
      quantity: 1,
      creation: usesPhoto ? (ids.length > 1 ? "combine" : "preserve") : "generate",
      photoAssetIds: usesPhoto ? ids : [],
      ...(usesPhoto ? {} : { subject: subject ?? (requestLines(text).join(", ").slice(0, 40) || undefined) }),
      colorImportant: true,
    };
    return {
      provider: "local",
      outcome: item.name,
      items: [item],
      question: null,
      reason: "Local rules: colour was asked for, and a sticker printer prints only black.",
    };
  }
  const generate =
    !ids.length || (process === "sticker_print" && !!subject && !asked);
  const item: IntentItem =
    process === "fdm_print"
      ? {
          process,
          name: /\bname[ -]?tags?\b/i.test(text) ? "A name tag" : "A keychain",
          why: `“${tagText(name)}” engraved in one colour, with a keyring hole.`,
          quantity: 1,
          creation: "generate",
          photoAssetIds: [],
          text: tagText(name),
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
            (ids.length
              ? undefined
              : requestLines(text).join(", ").slice(0, 40) || undefined),
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
