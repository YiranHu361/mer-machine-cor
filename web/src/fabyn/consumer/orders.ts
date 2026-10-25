/* Real API calls for the consumer flow. Every mutation goes through api(). */

import { api, ApiError } from "../../api";
import type { OrderView } from "./model";

export type Experience = "best_single" | "gift";

export function newKey() {
  return `${Date.now().toString(36)}-${crypto.randomUUID()}`;
}

/** The anonymous requester session the backend already uses for orders. */
export async function ensureSession() {
  const s = await api<{ role: string | null }>("/session");
  if (s.role === null) await api("/session", { role: "requester" });
}

export async function uploadPhotos(files: File[]): Promise<string[]> {
  const form = new FormData();
  files.forEach((f) => form.append("images", f));
  const { assets } = await api<{ assets: { id: string }[] }>("/uploads", form);
  return assets.map((a) => a.id);
}

/** Same Idempotency-Key on a retry means the server replays the same order. */
export async function createOrder(input: {
  requestText: string;
  photoAssetIds: string[];
  experience: Experience;
  key: string;
}): Promise<OrderView> {
  const { order } = await api<{ order: OrderView }>(
    "/orders",
    {
      requestText: input.requestText,
      photoAssetIds: input.photoAssetIds,
      experience: input.experience,
    },
    "POST",
    { headers: { "Idempotency-Key": input.key } },
  );
  return order;
}

export async function getOrder(id: string): Promise<OrderView> {
  const { order } = await api<{ order: OrderView }>(`/orders/${id}`);
  return order;
}

export async function changeRequest(o: OrderView, requestText: string) {
  const { order } = await api<{ order: OrderView }>(
    `/orders/${o.id}/draft`,
    { expectedRevision: o.draft.revision, requestText },
    "PATCH",
  );
  return order;
}

export async function chooseDesign(o: OrderView, candidateId: string) {
  const { order } = await api<{ order: OrderView }>(`/orders/${o.id}/design-choice`, {
    expectedRevision: o.draft.revision,
    candidateSetId: o.candidates!.id,
    candidateId,
  });
  return order;
}

export async function moreLikeThis(o: OrderView) {
  const { order } = await api<{ order: OrderView }>(`/orders/${o.id}/more-like-this`, {
    expectedRevision: o.draft.revision,
    candidateSetId: o.candidates!.id,
  });
  return order;
}

export async function addSuggestion(o: OrderView, suggestionId: string, operation: "add" | "replace") {
  const { order } = await api<{ order: OrderView }>(
    `/orders/${o.id}/alternatives/${suggestionId}/select`,
    { expectedPlanVersion: o.plan!.version, operation },
  );
  return order;
}

export async function confirmOffer(o: OrderView, idempotencyKey: string) {
  const { order } = await api<{ order: OrderView }>(`/orders/${o.id}/confirm`, {
    offerId: o.offer!.id,
    planVersion: o.plan!.version,
    planDigest: o.plan!.digest,
    permission: true,
    consent: { payment: true, production: true },
    idempotencyKey,
  });
  return order;
}

export async function stopWork(o: OrderView) {
  const { order } = await api<{ order: OrderView }>(`/orders/${o.id}/cancel`, {});
  return order;
}

/** Asset URLs for photos the requester uploaded (session-gated, same origin). */
export const assetUrl = (id: string) => `/assets/${id}`;

/** Codes the server returns that mean "look again, nothing was lost". */
export const REFRESH_CODES = new Set([
  "STALE_OFFER",
  "OFFER_EXPIRED",
  "PLAN_CHANGED",
  "STALE_DRAFT",
  "STALE_CHOICE",
  "STALE_SUGGESTION",
  "PREPARATION_CHANGED",
  "PREPARATION_MISMATCH",
]);

/** Text that came from the producer or the server internals, never for the judge to read. */
const RAW_TEXT = /traceback|File "|Module|PRODUCER_FAILED|Exception|Error:|\/Users\/|\/private\/|\.py\b|python|node_modules|stack/i;
export const PREPARE_FAILED = "We could not prepare that design. Try again or start over.";
const GENERIC = "Something went wrong. Try again.";

/** A reason the backend wrote for people, or the fallback when it carries internals. */
export function plainReason(text: string | null | undefined, fallback = ""): string {
  const t = (text ?? "").trim();
  if (!t || t.length > 280 || RAW_TEXT.test(t)) return fallback;
  return t;
}

export function describeError(e: unknown): { message: string; code: string; unknown: boolean } {
  if (e instanceof ApiError) {
    const raw = e.message ?? "";
    if (e.code === "PRODUCER_FAILED" || RAW_TEXT.test(raw)) {
      console.warn("[fabyn]", e.code, raw);
      const message = e.code === "PRODUCER_FAILED" ? PREPARE_FAILED : GENERIC;
      return { message, code: e.code, unknown: e.outcomeUnknown };
    }
    return { message: raw, code: e.code, unknown: e.outcomeUnknown };
  }
  const raw = (e as Error)?.message || "";
  if (raw && RAW_TEXT.test(raw)) {
    console.warn("[fabyn]", raw);
    return { message: GENERIC, code: "", unknown: false };
  }
  return { message: raw || GENERIC, code: "", unknown: false };
}

