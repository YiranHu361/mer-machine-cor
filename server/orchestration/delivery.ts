import { Problem } from "../model.ts";
import type { Delivery, DeliveryCourier } from "./types.ts";

/* Getting a finished order to the person: pickup at the workshop, or a courier.
   No delivery service is connected, so the courier is a person from a fixed
   list and their times are estimates fixed when the owner calls them. The
   phase is read from those times on each side; nothing here runs in the tick. */

type Point = { lat: number; lng: number };

/** The courier rides up to this far from the workshop (the consumer page uses the same rule). */
export const DELIVERY_RADIUS_KM = 4;
/** Closer than this the person is at the workshop already. */
export const HERE_KM = 0.3;
/** Minutes for the courier to reach the workshop after being called. */
export const COURIER_TO_WORKSHOP_MIN = 6;
/** Minutes spent handing over at the workshop. */
export const COURIER_HANDOFF_MIN = 1;
/** City traffic: about 2.4 minutes per km, never under 5 minutes. */
export const TRIP_MIN_PER_KM = 2.4;
export const MIN_TRIP_MIN = 5;
const MAX_LABEL = 60;
const MAX_KM = 50;

export const COURIERS: { name: string; vehicle: string; phone: string }[] = [
  { name: "Maya R.", vehicle: "e-bike", phone: "(415) 555-0142" },
  { name: "Diego S.", vehicle: "scooter", phone: "(415) 555-0178" },
  { name: "Priya K.", vehicle: "e-bike", phone: "(415) 555-0119" },
  { name: "Sam W.", vehicle: "car · Prius", phone: "(415) 555-0163" },
];

/** The same order always gets the same courier. */
export function courierFor(orderId: string) {
  let h = 0;
  for (const c of orderId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COURIERS[h % COURIERS.length];
}

export function distanceKm(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export const tripMinutes = (km: number) =>
  Math.max(MIN_TRIP_MIN, km * TRIP_MIN_PER_KM);

const invalid = (message: string) =>
  new Problem("INVALID_DELIVERY", message, 422);
const finite = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);
const round = (x: number, places: number) =>
  Math.round(x * 10 ** places) / 10 ** places;

/**
 * The person's choice from `POST /api/orders/:id/delivery`, checked against
 * the workshop it leaves from. Delivery needs a spot within the courier's reach.
 */
export function parseChoice(
  body: any,
  from: Point & { label: string },
): Pick<Delivery, "mode" | "to" | "km"> {
  const mode = body?.mode;
  if (mode !== "pickup" && mode !== "delivery")
    throw invalid('Choose "pickup" or "delivery".');
  if (mode === "pickup") return { mode, km: null };
  const to = body?.to;
  if (
    !to ||
    typeof to !== "object" ||
    !finite(to.lat) ||
    !finite(to.lng) ||
    Math.abs(to.lat) > 90 ||
    Math.abs(to.lng) > 180
  )
    throw invalid("Delivery needs where you are: a latitude and longitude.");
  const label =
    typeof to.label === "string"
      ? to.label.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim()
      : "";
  if (!label || label.length > MAX_LABEL)
    throw invalid(`Name the place in 1 to ${MAX_LABEL} characters.`);
  if (to.source !== "gps" && to.source !== "map")
    throw invalid('Say whether the spot came from "gps" or the "map".');
  const km = body?.km ?? null;
  if (km !== null && !(finite(km) && km > 0 && km <= MAX_KM))
    throw invalid(`The route length must be a number of km up to ${MAX_KM}.`);
  const spot = { lat: round(to.lat, 4), lng: round(to.lng, 4) };
  const away = distanceKm(from, spot);
  const place = from.label.split(",")[0];
  if (away < HERE_KM)
    throw new Problem(
      "OUT_OF_REACH",
      `You're at the ${place} already, so pick it up there.`,
      422,
    );
  if (away > DELIVERY_RADIUS_KM)
    throw new Problem(
      "OUT_OF_REACH",
      `The courier rides up to ${DELIVERY_RADIUS_KM} km from the ${place}; you are ${away.toFixed(1)} km away, so it's pickup only.`,
      422,
    );
  return {
    mode,
    to: { ...spot, label, source: to.source },
    km: km === null ? null : round(km, 2),
  };
}

/** The same choice again changes nothing (a retried request writes no event). */
export function sameChoice(
  a: Delivery | undefined,
  b: Pick<Delivery, "mode" | "to" | "km">,
) {
  return (
    !!a &&
    a.mode === b.mode &&
    a.km === b.km &&
    JSON.stringify(a.to ?? null) === JSON.stringify(b.to ?? null)
  );
}

/** A courier called now, with the times both sides show. */
export function callCourier(
  orderId: string,
  delivery: Delivery,
  from: Point,
  at: number,
): DeliveryCourier {
  const km = delivery.km ?? (delivery.to ? distanceKm(from, delivery.to) : 0);
  const pickup = at + (COURIER_TO_WORKSHOP_MIN + COURIER_HANDOFF_MIN) * 60_000;
  const arrive = pickup + Math.round(tripMinutes(km) * 60) * 1000;
  return {
    ...courierFor(orderId),
    calledAt: new Date(at).toISOString(),
    pickupAt: new Date(pickup).toISOString(),
    arriveAt: new Date(arrive).toISOString(),
  };
}
