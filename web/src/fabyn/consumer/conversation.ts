/* The conversation with fabyn before (and around) an order. The server keeps
   it, memory and all, so a reload or another server instance carries on; this
   tab only remembers which conversation is open (fabyn.conversation). */

import { api } from "../../api";
import type { OrderView } from "./model";

export type ProductId = "name_tag" | "drawn_sticker" | "photo_sticker" | "colour_print" | "photo_print";

export interface ConversationOption {
  id: string;
  product: ProductId;
  title: string;
  why: string;
  text?: string;
  subject?: string;
  caption?: string;
  /** checked again on every read: a printer can go quiet after the offer */
  available: boolean;
  reason?: string;
  /** made on a simulated machine: nothing physical comes out */
  practice?: boolean;
}

export interface ConversationTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  action?: "answer" | "offer" | "clarify" | "select";
  orderId?: string;
  photoAssetIds?: string[];
  choiceIds?: string[];
  /** offered (or chosen) with this reply */
  options?: ConversationOption[];
}

export interface ConversationView {
  id: string;
  version: number;
  /** a message is still being answered */
  pending: boolean;
  memory: { recipient: string | null; occasion: string | null; interests: string[]; notes: string[] };
  turns: ConversationTurn[];
  offered: ConversationOption[];
  chosen: ConversationOption[];
  orderId: string | null;
}

export interface ConversationReply {
  conversation: ConversationView;
  order: OrderView | null;
}

const ACTIVE = "fabyn.conversation";

export function activeConversation(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE);
  } catch {
    return null;
  }
}

export function rememberConversation(id: string | null) {
  try {
    if (id) sessionStorage.setItem(ACTIVE, id);
    else sessionStorage.removeItem(ACTIVE);
  } catch {
    /* the conversation still lives on the server; only this tab forgets it */
  }
}

/** The first message. Same key on a retry means the server replays the same conversation. */
export function startConversation(input: { text: string; photoAssetIds: string[]; key: string; requesterName?: string }) {
  return api<ConversationReply>(
    "/conversations",
    {
      text: input.text,
      photoAssetIds: input.photoAssetIds,
      ...(input.requesterName ? { requesterName: input.requesterName } : {}),
    },
    "POST",
    { headers: { "Idempotency-Key": input.key } },
  );
}

export function getConversation(id: string) {
  return api<ConversationReply>(`/conversations/${id}`);
}

/** One message, or a pressed option. The same messageId on a retry is answered once. */
export function sendMessage(
  c: ConversationView,
  input: { messageId: string; text?: string; choiceIds?: string[]; photoAssetIds?: string[] },
) {
  return api<ConversationReply>(`/conversations/${c.id}/messages`, { expectedVersion: c.version, ...input });
}

/** A retry that landed while fabyn was still answering: wait for that answer. */
export async function settled(reply: ConversationReply, tries = 40): Promise<ConversationReply> {
  let r = reply;
  for (let i = 0; r.conversation.pending && i < tries; i++) {
    await new Promise((done) => setTimeout(done, 1500));
    r = await getConversation(r.conversation.id);
  }
  return r;
}

/** The options a person can still press: the latest offer, while nothing is chosen from it. */
export function liveOptions(c: ConversationView): ConversationOption[] {
  const last = [...c.turns].reverse().find((t) => t.role === "assistant");
  return last?.action === "offer" || last?.action === "clarify" || last?.action === "answer" ? c.offered : [];
}
