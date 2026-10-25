// How each finished order leaves the workshop: a courier the seller called, or
// pickup at the table. No delivery service is connected yet, so the choice is
// kept in this browser only (the courier itself is display-only, see estimate.ts).
import { useCallback, useEffect, useState } from "react";
import { pathLengthKm, ROUTE_PALACE_TO_HOME } from "../shared/map";
import { courierEstimate } from "./estimate";

export type Handoff = { mode: "courier"; at: number } | { mode: "pickup"; at: number; collectedAt?: number };
type Book = Record<string, Handoff>;

const KEY = "fabyn.seller.handoffs.v1";
const EVENT = "fabyn-handoffs";

function load(): Book {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function save(book: Book) {
  try {
    localStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    // Private windows refuse storage; the choice still holds until reload.
  }
  window.dispatchEvent(new Event(EVENT));
}

let memory: Book | null = null;
const current = () => (memory ??= load());

export function useHandoffs() {
  const [book, setBook] = useState<Book>(current);
  useEffect(() => {
    const sync = () => {
      memory = load();
      setBook({ ...memory });
    };
    const local = () => setBook({ ...current() });
    window.addEventListener("storage", sync);
    window.addEventListener(EVENT, local);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(EVENT, local);
    };
  }, []);
  const set = useCallback((key: string, value: Handoff | null) => {
    const next = { ...current() };
    if (value) next[key] = value;
    else delete next[key];
    memory = next;
    save(next);
  }, []);
  return {
    book,
    callCourier: (key: string) => set(key, { mode: "courier", at: Date.now() }),
    markPickup: (key: string) => set(key, { mode: "pickup", at: Date.now() }),
    markCollected: (key: string) => {
      const h = current()[key];
      if (h?.mode === "pickup") set(key, { ...h, collectedAt: Date.now() });
    },
    undo: (key: string) => set(key, null),
  };
}

/** The trip every courier makes for now: the Palace to Henry in Cow Hollow. */
export const TRIP_KM = pathLengthKm(ROUTE_PALACE_TO_HOME);

/** Orders that have left the workshop: the courier dropped them off, or the customer collected them. */
export function sentOut(book: Record<string, Handoff>, now: number): Set<string> {
  const keys = new Set<string>();
  for (const [key, h] of Object.entries(book)) {
    if (h.mode === "courier" ? courierEstimate(h.at, TRIP_KM, now).phase === "delivered" : h.collectedAt) keys.add(key);
  }
  return keys;
}
