import { id, now, ownValue, Problem, requireThat, type State } from "../model.ts";
import { mutate } from "../store.ts";
import {
  createClaudeProvider,
  type ConversationInput,
  type ConversationReply,
  type ProposedOption,
} from "../../integrations/src/claude.ts";
import { MAX_ITEMS, nameFromRequest } from "./intent.ts";
import {
  capabilityFacts,
  drawingSubject,
  intentItem,
  isProduct,
  lettering,
  productAvailability,
  PRODUCT_IDS,
  PRODUCTS,
  type Availability,
  type ProductId,
} from "./products.ts";
import type { Orchestrator } from "./orchestrator.ts";
import type { IntentBrief, Order } from "./types.ts";

/*
 * The conversation before (and around) an order: the person and fabyn talk
 * about what the machines can make, fabyn offers concrete options, and a
 * choice among those options becomes an order through the usual pipeline.
 * The conversation is durable state, so a reload or another server instance
 * carries on with the same memory. The model only proposes: every offered
 * option, choice and availability is checked here before anything happens,
 * and nothing here confirms, pays for or dispatches work.
 */

type Actor = { id: string; role: string };
export interface ConversationOption {
  id: string;
  product: ProductId;
  title: string;
  why: string;
  text?: string;
  subject?: string;
  caption?: string;
}
export type TurnAction = "answer" | "offer" | "clarify" | "select";
export interface ConversationTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  /** The client's id for a message: a retry is answered once. */
  messageId?: string;
  /** The message an assistant turn answers. */
  replyTo?: string;
  photoAssetIds?: string[];
  /** Options pressed (user) or offered (assistant). */
  choiceIds?: string[];
  optionIds?: string[];
  action?: TurnAction;
  orderId?: string;
}
export interface ConversationMemory {
  recipient: string | null;
  occasion: string | null;
  interests: string[];
  notes: string[];
}
export interface Conversation {
  id: string;
  requesterId: string;
  creationKey: string;
  requesterName?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  turns: ConversationTurn[];
  memory: ConversationMemory;
  /** Every option offered so far, by id. */
  options: Record<string, ConversationOption>;
  /** The latest offer in the order shown: "the second one" counts here. */
  offered: string[];
  /** The options the current order was made from. */
  chosen: string[];
  orderId?: string;
  photoAssetIds: string[];
  nextOption: number;
  /** A message being answered; others wait until it is done or its lease ends. */
  pending?: { messageId: string; expiresAt: string };
}
export interface ConversationDeps {
  /** The conversation model; absent, a Claude key enables it, otherwise local rules answer. */
  converse?: (input: ConversationInput) => Promise<ConversationReply>;
  clock?: () => number;
}
/** The assistant turn to commit, with what it changes in the conversation. */
type Reply = Pick<ConversationTurn, "text" | "action" | "orderId" | "optionIds"> & {
  memory?: ConversationMemory;
  offer?: Omit<ConversationOption, "id">[];
  select?: ConversationOption[];
};
/** What one turn decided, before the backend acts on it. */
interface Decision {
  message: string;
  action: TurnAction;
  memory: ConversationMemory;
  offer?: Omit<ConversationOption, "id">[];
  /** Chosen options, already checked against the ones offered. */
  select?: ConversationOption[];
  provider: "claude" | "local";
  model?: string;
}

const LEASE_MS = 120_000;
const MAX_TURNS = 120;
const MAX_MESSAGE = 1000;
const EMPTY_MEMORY: ConversationMemory = {
  recipient: null,
  occasion: null,
  interests: [],
  notes: [],
};
const list = (xs: string[], joiner = "or") =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${joiner} ${xs[xs.length - 1]}`;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** "a name tag", "a colour print": a product as said in a sentence. */
const aProduct = (p: ProductId) => `a ${lower(PRODUCTS[p].title)}`;

/** The title an option is shown with: made here from its checked fields, never by the model. */
export function optionTitle(o: Pick<ConversationOption, "product" | "text" | "subject" | "caption">) {
  const caption = o.caption ? ` with “${o.caption}” under it` : "";
  switch (o.product) {
    case "name_tag":
      return `A name tag that says “${o.text}”`;
    case "drawn_sticker":
      return `A ${o.subject} sticker${caption}`;
    case "photo_sticker":
      return `A sticker of your photo${caption}`;
    case "colour_print":
      return `A colour print of ${o.subject}`;
    case "photo_print":
      return "A print of your photo";
  }
}
/** An option the backend can make as described, or why not. */
export function checkOption(
  p: { product: string; why?: string; text?: string | null; subject?: string | null; caption?: string | null },
  photos: number,
): { option: Omit<ConversationOption, "id"> } | { problem: string } {
  if (!isProduct(p.product)) return { problem: "That is not something these machines make." };
  const product = PRODUCTS[p.product];
  const out: Omit<ConversationOption, "id"> = { product: p.product, title: "", why: (p.why ?? "").slice(0, 200) };
  if (product.fields.text) {
    const text = lettering(p.text);
    if (!text)
      return {
        problem: p.text
          ? `“${p.text}” can't be engraved: a name tag takes up to 16 letters, digits, spaces and . , ' & ! ? + -.`
          : "A name tag needs the name to put on it.",
      };
    out.text = text;
  }
  if (product.fields.subject) {
    const subject = drawingSubject(p.subject);
    if (!subject) return { problem: "A drawing needs a short subject, up to 40 characters." };
    out.subject = subject;
  }
  if (product.fields.caption && p.caption) {
    const caption = lettering(p.caption);
    if (!caption)
      return { problem: `“${p.caption}” can't be printed as lettering: up to 16 letters, digits, spaces and . , ' & ! ? + -.` };
    out.caption = caption;
  }
  if (product.needsPhoto && !photos) return { problem: "That needs a photo: attach one first." };
  out.title = optionTitle(out);
  return { option: out };
}
const sameOptions = (a: ConversationOption[], b: ConversationOption[]) => {
  const key = (xs: ConversationOption[]) =>
    JSON.stringify(xs.map((o) => [o.product, o.text ?? "", o.subject ?? "", o.caption ?? ""]).sort());
  return key(a) === key(b);
};

/* ---------- local rules: no model, a model failure, and pressed options ---------- */

const RELATION =
  /\b(?:friend|best friend|buddy|brother|sister|mom|mum|mother|dad|father|son|daughter|wife|husband|partner|boyfriend|girlfriend|cousin|colleague|coworker|co-worker|boss|teacher|niece|nephew|grandma|grandpa|grandmother|grandfather|roommate|neighbou?r|aunt|uncle)\s+([A-Z][\p{L}'’-]*(?:\s+[A-Z][\p{L}'’-]*)?)/u;
const SPELL =
  /\b(?:spell(?:ed|t)?|write|make it say|change (?:it|the name) to)\s+(?:it|the name|(?:his|her|their) name)?\s*(?:as\s+)?["“]?([\p{L}][\p{L}0-9 .'’&-]{0,30}?)["”]?\s*[.!]?$/iu;
const OCCASION =
  /\b(birthday|anniversary|graduation|wedding|christmas|hanukkah|holiday|valentine'?s?|farewell|thank[- ]you|housewarming|baby shower|retirement|mother'?s day|father'?s day)\b/i;
const LIKES =
  /\b(?:likes?|loves?|is into|enjoys?|adores?|is obsessed with|is a fan of|collects)\s+([^.!?;]+)/i;

/** What a message tells about the recipient, merged into what is known. */
export function rememberLocally(memory: ConversationMemory, text: string): ConversationMemory {
  const next = structuredClone(memory);
  const spelled = SPELL.exec(text)?.[1]?.replace(/\s+(?:instead|please|thanks|thank you)$/i, "").trim();
  const named =
    RELATION.exec(text)?.[1] ??
    /\bfor\s+([A-Z][\p{L}'’-]+)\b/u.exec(text)?.[1] ??
    nameFromRequest(text) ??
    undefined;
  const recipient = spelled ?? named;
  if (recipient && lettering(recipient)) next.recipient = lettering(recipient);
  const occasion = OCCASION.exec(text)?.[1];
  if (occasion) next.occasion = occasion.toLowerCase();
  const likes = LIKES.exec(text)?.[1];
  if (likes)
    for (const part of likes.split(/\s*(?:,|\band\b|\balso\b)\s*/i)) {
      const interest = part.trim().replace(/^(?:a|an|the|eating|playing|watching)\s+/i, "").split(/\s+/).slice(0, 4).join(" ");
      if (interest && !next.interests.includes(interest.toLowerCase())) next.interests.push(interest.toLowerCase());
    }
  next.interests = next.interests.slice(-8);
  return next;
}
const QUESTION = /\?\s*$|^\s*(?:can|could|does|do|is|are|what|how|which|will|would|why|when|where)\b/i;
const ORDINALS: [RegExp, (n: number) => number][] = [
  [/\b(?:first|1st)\b/i, () => 0],
  [/\b(?:second|2nd)\b/i, () => 1],
  [/\b(?:third|3rd)\b/i, () => 2],
  [/\b(?:last|latter)\b/i, (n) => n - 1],
  [/\bformer\b/i, () => 0],
];
const PRODUCT_WORDS: [RegExp, ProductId[]][] = [
  [/\b(?:name ?tags?|tags?|key ?chains?|keyrings?|3d)\b/i, ["name_tag"]],
  [/\bstickers?\b/i, ["drawn_sticker", "photo_sticker"]],
  [/\b(?:prints?|instax|polaroids?|colou?r)\b/i, ["colour_print", "photo_print"]],
];
const stem = (w: string) => w.toLowerCase().replace(/(?:es|s)$/, "");
/**
 * A choice among the options just offered, by position ("the second one"),
 * product ("the tag") or a word of what it shows ("nugget"). Questions never
 * choose, and a reply that fits several options is ambiguous.
 */
export function resolveChoice(
  text: string,
  offered: ConversationOption[],
): { kind: "none" | "one" | "several" | "ambiguous"; options: ConversationOption[] } {
  const none = { kind: "none" as const, options: [] };
  if (!offered.length || !text.trim() || QUESTION.test(text)) return none;
  if (/\b(?:both|all of them|all three|everything|each of them)\b/i.test(text))
    return { kind: offered.length > 1 ? "several" : "one", options: offered };
  // a plain yes takes the one thing on offer
  if (offered.length === 1 && /^\s*(?:yes|yeah|yep|yup|sure|ok(?:ay)?|sounds (?:good|great)|do it|go ahead|let'?s do (?:it|that)|perfect|great|please)\b/i.test(text))
    return { kind: "one", options: offered };
  const numbered = /^\s*(?:#|no\.?|number|option)?\s*([1-3])\s*[.!]?\s*$|\b(?:option|number|#)\s*([1-3])\b/i.exec(text);
  const position = numbered
    ? Number(numbered[1] ?? numbered[2]) - 1
    : ORDINALS.find(([re]) => re.test(text))?.[1](offered.length);
  if (position !== undefined && offered[position]) return { kind: "one", options: [offered[position]] };
  const words = new Set(text.toLowerCase().match(/[\p{L}0-9]{3,}/gu)?.map(stem) ?? []);
  const matches = offered.filter((o) => {
    const byProduct = PRODUCT_WORDS.some(([re, ids]) => re.test(text) && ids.includes(o.product));
    const subject = (o.subject ?? "").match(/[\p{L}0-9]{3,}/gu)?.map(stem) ?? [];
    return byProduct || subject.some((w) => words.has(w));
  });
  if (!matches.length) return none;
  if (matches.length === 1) return { kind: "one", options: matches };
  return /\band\b|\bplus\b|&/i.test(text) ? { kind: "several", options: matches } : { kind: "ambiguous", options: matches };
}
/** Options that fit what is known: the recipient's name, what they love, any photo. */
function suggest(
  memory: ConversationMemory,
  availability: Record<ProductId, Availability>,
  photos: number,
): Omit<ConversationOption, "id">[] {
  const name = memory.recipient && lettering(memory.recipient);
  const interest = memory.interests[0] && drawingSubject(memory.interests[0]);
  const forWhom = name ?? "them";
  const wanted: Parameters<typeof checkOption>[0][] = [];
  if (name) wanted.push({ product: "name_tag", text: name, why: `A keepsake with ${name}'s name.` });
  if (interest) {
    wanted.push({ product: "drawn_sticker", subject: interest, caption: name ?? null, why: `${forWhom} likes ${interest}.` });
    wanted.push({ product: "colour_print", subject: interest, why: `${interest} in full colour.` });
  }
  if (photos) {
    wanted.push({ product: "photo_print", why: "Your photo, in colour." });
    wanted.push({ product: "photo_sticker", caption: name ?? null, why: "Your photo as a sticker." });
  }
  const out: Omit<ConversationOption, "id">[] = [];
  for (const w of wanted) {
    if (!availability[w.product as ProductId].available) continue;
    // a colour print only when no sticker of the same thing is on offer
    if (w.product === "colour_print" && out.some((o) => o.product === "drawn_sticker")) continue;
    const checked = checkOption(w, photos);
    if ("option" in checked) out.push(checked.option);
  }
  return out.slice(0, 3);
}
function faq(text: string, availability: Record<ProductId, Availability>, order: Order | undefined) {
  const ready = PRODUCT_IDS.filter((id) => availability[id].available).map(aProduct);
  const off = PRODUCT_IDS.filter((id) => !availability[id].available && !PRODUCTS[id].needsPhoto);
  const offLine = off.length ? ` ${PRODUCTS[off[0]].title}s aren't available right now: ${availability[off[0]].reason}` : "";
  if (order && /\b(?:status|where|when|ready|done|progress|order)\b/i.test(text)) return orderLine(order);
  if (/colou?r|black and white|b ?& ?w|mono/i.test(text))
    return `Stickers print in black and white; colour prints come out in full colour on instax mini film; name tags are one colour of PLA.${offLine}`;
  if (/\b(?:big|size|small|large|mm|wide|long|dimensions?)\b/i.test(text))
    return "Stickers are 48 mm wide and as long as the drawing needs; colour prints are instax mini, 54 × 86 mm; name tags are about 70 × 18 mm.";
  if (/\b(?:price|cost|how much|cheap|expensive)\b|\$/i.test(text))
    return "You'll see the exact price with the preview, before anything is paid.";
  if (/\b(?:name|letter|text|words?|writing)\b/i.test(text))
    return "A name tag takes up to 16 letters, and a sticker can have up to 16 letters set under its drawing. Colour prints have no lettering.";
  return ready.length
    ? `Right now I can make ${list(ready)}.${offLine} Tell me who it's for and what they like, and I'll suggest something.`
    : `Nothing can be made right now.${offLine}`;
}
function orderLine(o: Order) {
  if (o.makeIntent) {
    const pay = o.makeIntent.payment.status;
    if (pay === "pending") return "Your payment is being checked; nothing has been made yet.";
    if (pay === "failed") return "The payment failed, so nothing was made.";
    return o.status === "done"
      ? "It's made and ready."
      : "It's confirmed and paid, and the machines are on it.";
  }
  switch (o.draft.stage) {
    case "awaiting_design_choice":
      return "The drafts are ready: pick one on the card above.";
    case "proposed":
      return "The preview and price are ready; nothing is paid until you confirm.";
    case "unavailable":
    case "failed":
      return o.draft.reason ?? "It can't be prepared right now.";
    default:
      return "I'm still preparing it.";
  }
}
function localDecide(
  c: Conversation,
  text: string,
  availability: Record<ProductId, Availability>,
  order: Order | undefined,
): Decision {
  const memory = rememberLocally(c.memory, text);
  const local = (d: Omit<Decision, "memory" | "provider">): Decision => ({ ...d, memory, provider: "local" });
  // A corrected name reaches the options that carried the old one.
  const old = c.memory.recipient;
  if (old && memory.recipient && memory.recipient !== old && SPELL.test(text)) {
    const renamed = (ids: string[]) =>
      ids.map((i) => c.options[i]).filter(Boolean).map((o) => {
        const next = {
          ...o,
          ...(o.text === old ? { text: memory.recipient! } : {}),
          ...(o.caption === old ? { caption: memory.recipient! } : {}),
        };
        return { ...next, title: optionTitle(next) };
      });
    // a confirmed order is refused when the choice is acted on, never re-offered
    if (order && c.chosen.length)
      return local({ message: "", action: "select", select: renamed(c.chosen) });
    if (c.offered.length) {
      const offer = renamed(c.offered).map(({ id: _id, ...o }) => o);
      return local({ message: `Got it: ${memory.recipient}. Here are the same ideas with that spelling. Which would you like?`, action: "offer", offer });
    }
  }
  const choice = resolveChoice(text, c.offered.map((i) => c.options[i]).filter(Boolean));
  if (choice.kind === "one" || choice.kind === "several") return local({ message: "", action: "select", select: choice.options });
  if (choice.kind === "ambiguous")
    return local({ message: `Do you mean ${list(choice.options.map((o) => lower(o.title)))}?`, action: "clarify" });
  // "What can I get him?" asks for ideas; "can it print in colour?" asks a fact.
  const wantsIdeas = /\b(?:what (?:can|should|could|would) (?:i|we) (?:get|make|give|buy|do)|ideas?|suggest|recommend|gift|present)\b/i.test(text);
  if ((QUESTION.test(text) && !wantsIdeas) || (order && !c.offered.length))
    return local({ message: faq(text, availability, order), action: "answer" });
  const offer = suggest(memory, availability, c.photoAssetIds.length);
  if (!offer.length)
    return local({
      message: memory.recipient || memory.interests.length
        ? faq("", availability, undefined)
        : "Who is it for, and what do they love? I can make a name tag, a drawn sticker or a colour print.",
      action: "clarify",
    });
  return local({
    message: `You could get ${memory.recipient ?? "them"} ${list(offer.map((o) => lower(o.title)))}. Which would you prefer?`,
    action: "offer",
    offer,
  });
}

/* ---------- the agent ---------- */

export class ConversationAgent {
  constructor(
    private orchestrator: Orchestrator,
    private deps: ConversationDeps = {},
  ) {}
  private get service() {
    return this.orchestrator.service;
  }
  private get clock() {
    return this.deps.clock ?? Date.now;
  }
  private get model() {
    if (this.deps.converse) return this.deps.converse;
    return process.env.ANTHROPIC_API_KEY
      ? (input: ConversationInput) => createClaudeProvider().converse(input)
      : undefined;
  }
  private availability(s: State, photos: number) {
    return productAvailability(s, {
      allowed: (m) => this.service.modeAllowed(m),
      at: this.clock(),
      drawing: this.orchestrator.designProvider !== "none",
      photos,
    });
  }
  private livePending(c: Conversation) {
    return c.pending && Date.parse(c.pending.expiresAt) > this.clock() ? c.pending : undefined;
  }
  private owned(c: Conversation | undefined, actor: Actor): asserts c is Conversation {
    requireThat(c, "NOT_FOUND", "Conversation not found.", 404);
    requireThat(c.requesterId === actor.id, "FORBIDDEN", "This conversation belongs to a different account.", 403);
  }
  private parseMessage(body: any) {
    const text = typeof body?.text === "string" ? body.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim() : "";
    requireThat(text.length <= MAX_MESSAGE, "MESSAGE_TOO_LONG", `Keep a message to ${MAX_MESSAGE} characters.`, 422);
    const photos: string[] = Array.isArray(body?.photoAssetIds) ? body.photoAssetIds : [];
    const choiceIds: string[] = Array.isArray(body?.choiceIds) ? body.choiceIds : [];
    requireThat(
      photos.length <= 4 && photos.every((p) => typeof p === "string") && new Set(photos).size === photos.length,
      "INVALID_PHOTOS",
      "Add up to four different photos.",
      422,
    );
    requireThat(
      choiceIds.length <= MAX_ITEMS && choiceIds.every((p) => typeof p === "string" && p.length <= 40),
      "INVALID_CHOICE",
      "Choose up to three of the options offered.",
      422,
    );
    requireThat(text || photos.length || choiceIds.length, "MESSAGE_EMPTY", "Write a message, add a photo, or pick an option.", 422);
    return { text, photos, choiceIds };
  }

  /** The first message starts the conversation; the same key replays it. */
  async start(actor: Actor, body: any, key: unknown) {
    requireThat(actor.role === "requester", "REQUESTER_REQUIRED", "Use requester access to start a conversation.", 403);
    requireThat(
      typeof key === "string" && key.length >= 8 && key.length <= 200,
      "IDEMPOTENCY_REQUIRED",
      "Starting a conversation needs a stable key.",
      422,
    );
    const message = this.parseMessage(body);
    requireThat(!message.choiceIds.length, "INVALID_CHOICE", "There is nothing to choose from yet.", 422);
    const requesterName = String(body?.requesterName ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    const { conversation, created } = await mutate(this.service.store, (s) => {
      s.conversations ??= {};
      const existing = Object.values(s.conversations).find((c) => c.requesterId === actor.id && c.creationKey === key);
      if (existing) return { conversation: existing, created: false };
      const at = now();
      const c: Conversation = {
        id: id("conv"),
        requesterId: actor.id,
        creationKey: key as string,
        ...(requesterName ? { requesterName } : {}),
        createdAt: at,
        updatedAt: at,
        version: 1,
        turns: [],
        memory: structuredClone(EMPTY_MEMORY),
        options: {},
        offered: [],
        chosen: [],
        photoAssetIds: [],
        nextOption: 1,
      };
      s.conversations[c.id] = c;
      return { conversation: c, created: true };
    });
    // A retry after the first answer (or during it) only reads.
    const answered = conversation.turns.some((t) => t.messageId === key) || this.livePending(conversation)?.messageId === key;
    const view = answered
      ? await this.view(actor, conversation.id)
      : await this.send(actor, conversation.id, {
          ...body,
          messageId: key,
          expectedVersion: conversation.version,
        });
    return { ...view, created };
  }

  /** One message: claimed, answered, then committed. A retried message id is answered once. */
  async send(actor: Actor, conversationId: string, body: any) {
    const messageId = body?.messageId;
    requireThat(
      typeof messageId === "string" && messageId.length >= 8 && messageId.length <= 200,
      "MESSAGE_ID_REQUIRED",
      "Each message needs a stable id.",
      422,
    );
    const message = this.parseMessage(body);
    const at = this.clock();
    const claim = await mutate(this.service.store, (s) => {
      const c = ownValue(s.conversations ?? {}, conversationId);
      this.owned(c, actor);
      if (c.turns.some((t) => t.messageId === messageId)) return null;
      const pending = this.livePending(c);
      if (pending?.messageId === messageId) return null;
      requireThat(
        body?.expectedVersion === c.version,
        "STALE_CONVERSATION",
        "The conversation moved on. Here is the latest; send it again if it still applies.",
      );
      requireThat(!pending, "CONVERSATION_BUSY", "fabyn is still answering the last message.");
      for (const assetId of message.photos)
        requireThat(ownValue(s.assets, assetId)?.ownerId === actor.id, "ASSET_ACCESS", "Upload your own photos first.", 403);
      for (const choice of message.choiceIds)
        requireThat(ownValue(c.options, choice), "STALE_CHOICE", "That option is no longer on offer. Here is the latest.");
      c.photoAssetIds = [...new Set([...c.photoAssetIds, ...message.photos])].slice(-4);
      const text = message.text || list(message.choiceIds.map((i) => c.options[i].title), "and") || "(a photo)";
      c.turns.push({
        id: id("turn"),
        role: "user",
        text,
        at: now(),
        messageId,
        ...(message.photos.length ? { photoAssetIds: message.photos } : {}),
        ...(message.choiceIds.length ? { choiceIds: message.choiceIds } : {}),
      });
      c.pending = { messageId, expiresAt: new Date(at + LEASE_MS).toISOString() };
      c.version++;
      c.updatedAt = now();
      return { conversation: structuredClone(c), text };
    });
    if (!claim) return this.view(actor, conversationId);
    let reply: Reply;
    try {
      const decision = await this.decide(claim.conversation, claim.text, message.choiceIds);
      reply = await this.act(actor, claim.conversation, decision, messageId);
    } catch (e) {
      const code = e instanceof Problem ? e.code : "";
      console.warn(`[fabyn] conversation ${conversationId} could not answer (${code || (e as Error)?.name || "error"}).`);
      reply = {
        text: /STALE|CHANGED/.test(code)
          ? "The order changed while I was working on it. Nothing was charged; tell me again what you'd like."
          : "Something went wrong on my side, and nothing was ordered. Please say that again.",
        action: "answer",
      };
    }
    await mutate(this.service.store, (s) => {
      const c = s.conversations![conversationId];
      if (c.turns.some((t) => t.replyTo === messageId)) return;
      const { memory, offer, select, ...turn } = reply;
      if (memory) c.memory = memory;
      if (offer) {
        c.offered = offer.map((o) => {
          const optionId = `opt_${c.nextOption++}`;
          c.options[optionId] = { ...o, id: optionId };
          return optionId;
        });
        turn.optionIds = c.offered;
      }
      if (select) {
        // a chosen option with changed details is a new option, recorded like an offered one
        c.chosen = select.map((o) => {
          if (c.options[o.id] && sameOptions([c.options[o.id]], [o])) return o.id;
          const optionId = `opt_${c.nextOption++}`;
          c.options[optionId] = { ...o, id: optionId };
          return optionId;
        });
        turn.optionIds = c.chosen;
      }
      if (turn.orderId) c.orderId = turn.orderId;
      c.turns.push({ id: id("turn"), role: "assistant", at: now(), replyTo: messageId, ...turn });
      if (c.turns.length > MAX_TURNS) c.turns.splice(0, c.turns.length - MAX_TURNS);
      if (c.pending?.messageId === messageId) delete c.pending;
      c.version++;
      c.updatedAt = now();
    });
    return this.view(actor, conversationId);
  }

  /** The model's proposal (or the local rules'), checked against what was offered and what exists. */
  private async decide(c: Conversation, text: string, choiceIds: string[]): Promise<Decision> {
    const s = await this.service.read();
    const availability = this.availability(s, c.photoAssetIds.length);
    const order = c.orderId ? ownValue(s.orders ?? {}, c.orderId) : undefined;
    // A pressed option is an explicit choice: no model is asked.
    if (choiceIds.length)
      return {
        message: "",
        action: "select",
        memory: c.memory,
        select: choiceIds.map((i) => c.options[i]),
        provider: "local",
      };
    const model = this.model;
    if (model) {
      const optionData = (ids: string[]) =>
        ids.map((i) => c.options[i]).filter(Boolean).map((o) => ({
          id: o.id,
          product: o.product,
          title: o.title,
          ...(o.text ? { text: o.text } : {}),
          ...(o.subject ? { subject: o.subject } : {}),
          ...(o.caption ? { caption: o.caption } : {}),
          available: availability[o.product].available,
          ...(availability[o.product].reason ? { reason: availability[o.product].reason } : {}),
        }));
      try {
        const reply = await model({
          turns: c.turns.slice(0, -1).map((t) => ({
            role: t.role,
            text:
              t.role === "assistant" && t.optionIds?.length
                ? `${t.text}\n[${t.action === "select" ? "chosen" : "options shown"}: ${t.optionIds.map((i, n) => `${n + 1}. ${c.options[i]?.title} (${i})`).join("; ")}]`
                : t.text,
          })),
          message: text,
          products: capabilityFacts(availability),
          productIds: PRODUCT_IDS,
          memory: c.memory,
          offered: optionData(c.offered),
          chosen: optionData(c.chosen),
          order: order ? orderFacts(order) : null,
          photos: c.photoAssetIds.length,
        });
        return this.fromModel(c, reply);
      } catch (e) {
        // the error code and the API's own reason, never the request
        const why = /^[A-Z_]+(?:: HTTP \d{3}(?: \([^)]{0,200}\))?)?/.exec(String((e as Error)?.message ?? ""))?.[0];
        console.warn(`[fabyn] the conversation model could not answer ${c.id} (${why ?? (e as Error)?.name ?? "error"}); using the local rules.`);
      }
    }
    return localDecide(c, text, availability, order);
  }
  private fromModel(c: Conversation, reply: ConversationReply): Decision {
    const memory: ConversationMemory = {
      recipient: reply.memory.recipient ?? c.memory.recipient,
      occasion: reply.memory.occasion ?? c.memory.occasion,
      interests: reply.memory.interests.length ? reply.memory.interests : c.memory.interests,
      notes: reply.memory.notes.length ? reply.memory.notes : c.memory.notes,
    };
    const base = { memory, provider: "claude" as const, model: reply.model };
    if (reply.action === "select") {
      const chosen: ConversationOption[] = [];
      for (const pick of reply.select) {
        const known = ownValue(c.options, pick.optionId);
        // Only options this conversation actually offered can be chosen.
        if (!known)
          return { ...base, action: "clarify", message: "I couldn't match that to the options I offered. Which one would you like?" };
        const checked = checkOption(
          {
            product: known.product,
            why: known.why,
            text: pick.text ?? known.text,
            subject: pick.subject ?? known.subject,
            caption: pick.caption ?? known.caption,
          },
          c.photoAssetIds.length,
        );
        if ("problem" in checked) return { ...base, action: "clarify", message: checked.problem };
        chosen.push({ ...checked.option, id: known.id });
      }
      if (!chosen.length) return { ...base, action: "clarify", message: reply.message };
      return { ...base, action: "select", message: reply.message, select: chosen };
    }
    if (reply.action === "offer") {
      const offer: Omit<ConversationOption, "id">[] = [];
      const problems: string[] = [];
      for (const proposed of reply.options as ProposedOption[]) {
        const checked = checkOption(proposed, c.photoAssetIds.length);
        if ("option" in checked) offer.push(checked.option);
        else problems.push(checked.problem);
      }
      if (!offer.length)
        return { ...base, action: "clarify", message: problems[0] ?? reply.message };
      return {
        ...base,
        action: "offer",
        message: problems.length ? `${reply.message} (One idea was left out: ${problems[0]})` : reply.message,
        offer,
      };
    }
    return { ...base, action: reply.action, message: reply.message };
  }

  /** Acts on a checked decision: a choice becomes (or updates) an order, after a fresh availability check. */
  private async act(actor: Actor, c: Conversation, d: Decision, messageId: string) {
    if (d.action !== "select" || !d.select?.length)
      return { text: d.message, action: d.action, memory: d.memory, ...(d.offer ? { offer: d.offer } : {}) };
    const s = await this.service.read();
    const order = c.orderId ? ownValue(s.orders ?? {}, c.orderId) : undefined;
    const say = (text: string, action: TurnAction = "answer") => ({ text, action, memory: d.memory });
    if (order?.makeIntent)
      return say(`Your order is already confirmed, so I can't change it. ${orderLine(order)} For something else, start a new order.`);
    const picks = d.select;
    const processes = picks.map((o) => PRODUCTS[o.product].process);
    if (picks.length > MAX_ITEMS || new Set(processes).size !== processes.length)
      return say("One order makes one of each kind: one name tag, one sticker, one print. Which would you like?", "clarify");
    if (picks.filter((o) => PRODUCTS[o.product].draws).length > 1)
      return say("One order draws one new design. Which drawing would you like first? The other can be a next order.", "clarify");
    // Availability may have changed since the options were offered: ask again now.
    const availability = this.availability(s, c.photoAssetIds.length);
    const blocked = picks.filter((o) => !availability[o.product].available);
    if (blocked.length) {
      const others = PRODUCT_IDS.filter((p) => availability[p].available && !PRODUCTS[p].needsPhoto).map(aProduct);
      return say(
        `I can't start ${lower(blocked[0].title)} right now: ${availability[blocked[0].product].reason}${others.length ? ` I can still make ${list(others)}.` : ""}`,
      );
    }
    const items = picks.map((o) => intentItem(o, c.photoAssetIds));
    const intent: IntentBrief = {
      provider: d.provider,
      ...(d.model ? { model: d.model } : {}),
      outcome: list(picks.map((o) => o.title), "and"),
      items,
      ...(items.length > 1 ? { requested: items.length } : {}),
      question: null,
      reason: "Chosen in the conversation from the options offered.",
    };
    const requestText = picks.map((o) => o.title).join("\n").slice(0, 2000);
    const photoAssetIds = items.some((i) => i.photoAssetIds.length) ? c.photoAssetIds.slice(0, 4) : [];
    const chosenBefore = c.chosen.map((i) => c.options[i]).filter(Boolean);
    const open = order && order.status !== "cancelled" && order.draft.stage !== "superseded";
    const line = (verb: string) => d.message || `${list(picks.map((o) => o.title), "and")}. ${verb}`;
    if (open && sameOptions(chosenBefore, picks))
      return { ...say(d.message || "That's what I'm preparing already.", "select"), select: picks, orderId: order.id };
    if (open) {
      await this.orchestrator.editDraft(
        actor,
        order.id,
        { expectedRevision: order.draft.revision, requestText, photoAssetIds },
        { intent },
      );
      return { ...say(line("I'll update the preview."), "select"), select: picks, orderId: order.id };
    }
    const { order: created } = await this.orchestrator.createOrder(
      actor,
      {
        requestText,
        photoAssetIds,
        experience: "best_single",
        ...(c.requesterName ? { requesterName: c.requesterName } : {}),
      },
      `conv-${c.id}-${messageId}`.slice(0, 200),
      { intent, conversationId: c.id },
    );
    return { ...say(line("I'll prepare a preview."), "select"), select: picks, orderId: created.id };
  }

  async view(actor: Actor, conversationId: string) {
    const s = await this.service.read();
    const c = ownValue(s.conversations ?? {}, conversationId);
    this.owned(c, actor);
    const availability = this.availability(s, c.photoAssetIds.length);
    const option = (optionId: string) => {
      const o = c.options[optionId];
      const a = o && availability[o.product];
      return o ? [{ ...o, available: a.available, ...(a.reason ? { reason: a.reason } : {}), ...(a.practice ? { practice: true } : {}) }] : [];
    };
    return {
      conversation: {
        id: c.id,
        version: c.version,
        pending: !!this.livePending(c),
        memory: c.memory,
        turns: c.turns.map(({ messageId: _m, replyTo: _r, optionIds, ...t }) => ({
          ...t,
          ...(optionIds?.length ? { options: optionIds.flatMap(option) } : {}),
        })),
        offered: c.offered.flatMap(option),
        chosen: c.chosen.flatMap(option),
        orderId: c.orderId ?? null,
      },
      order: c.orderId ? await this.orchestrator.view(actor, c.orderId) : null,
    };
  }
}
/** What the model is told about the order: its state, never ids, codes or payment details. */
function orderFacts(o: Order) {
  return {
    confirmed: !!o.makeIntent,
    stage: o.draft.stage,
    status: o.status,
    items: (o.plan?.items ?? o.intent?.items ?? []).map((i) => i.name),
    ...(o.plan && !o.makeIntent ? { priceShown: true } : {}),
    ...(o.makeIntent ? { payment: o.makeIntent.payment.status } : {}),
    summary: orderLine(o),
  };
}
