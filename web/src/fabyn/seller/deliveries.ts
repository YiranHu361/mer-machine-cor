// How each finished order leaves the workshop. The customer chooses pickup or
// delivery on their side and the seller calls the courier here; both are saved
// on the order (dash.deliveries), so both sides show the same courier and times.
// No delivery service is connected: the courier and their times are estimates
// the server fixed when the courier was called (server/orchestration/delivery.ts).
import { useEffect, useState } from "react";
import { BOUNDS, PALACE, distanceKm, type Bounds, type LatLng } from "../shared/map";
import type { Dashboard, OrderDelivery, DeliveryCourier } from "./data";

export type { OrderDelivery, DeliveryCourier };

export type CourierPhase = "to_workshop" | "at_workshop" | "on_the_way" | "delivered";

export interface CourierEstimate {
  phase: CourierPhase;
  /** Minutes until the courier reaches the workshop (0 once there). */
  pickupMin: number;
  /** Minutes until the drop-off (0 once delivered). */
  dropoffMin: number;
  /** 0..1 along workshop → drop-off, for the dot on the map. Before pickup it sits at the workshop. */
  routeFraction: number;
}

const HANDOVER_MS = 60_000;

/** Where the courier is now, read from the times the server fixed. */
export function courierEstimate(c: DeliveryCourier, now: number): CourierEstimate {
  const pickup = Date.parse(c.pickupAt);
  const arrive = Date.parse(c.arriveAt);
  const mins = (ms: number) => Math.max(0, Math.ceil(ms / 60000));
  if (now < pickup - HANDOVER_MS) return { phase: "to_workshop", pickupMin: mins(pickup - HANDOVER_MS - now), dropoffMin: mins(arrive - now), routeFraction: 0 };
  if (now < pickup) return { phase: "at_workshop", pickupMin: 0, dropoffMin: mins(arrive - now), routeFraction: 0 };
  if (now < arrive) return { phase: "on_the_way", pickupMin: 0, dropoffMin: mins(arrive - now), routeFraction: (now - pickup) / Math.max(1, arrive - pickup) };
  return { phase: "delivered", pickupMin: 0, dropoffMin: 0, routeFraction: 1 };
}

export type HandoffKind = "awaiting_courier" | "courier" | "pickup";

/** Delivery waiting for a courier, out with one, or pickup at the table (also when the customer has not chosen). */
export function handoffKind(d: OrderDelivery | undefined): HandoffKind {
  if (d?.mode === "delivery") return d.courier ? "courier" : "awaiting_courier";
  return "pickup";
}

export const deliveriesOf = (dash: Dashboard): Record<string, OrderDelivery> => dash.deliveries ?? {};

/** Orders that have left the workshop: the courier dropped them off, or they were handed over without a code. */
export function sentOut(deliveries: Record<string, OrderDelivery>, now: number): Set<string> {
  const keys = new Set<string>();
  for (const [key, d] of Object.entries(deliveries)) {
    if (d.handedOverAt || (d.courier && courierEstimate(d.courier, now).phase === "delivered")) keys.add(key);
  }
  return keys;
}

/** The trip length: the customer's street route when their page had one, else the straight line. */
export function tripKm(d: OrderDelivery, from: LatLng = PALACE): number | null {
  if (d.km) return d.km;
  return d.to ? distanceKm(from, d.to) : null;
}

/** A map frame around the points, with a margin, never thinner than about 1.6 km. */
export function frameAround(points: LatLng[], within: Bounds = BOUNDS.city): Bounds {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minSpan = 0.0145;
  const pad = 0.2;
  const cLat = (Math.max(...lats) + Math.min(...lats)) / 2;
  const cLng = (Math.max(...lngs) + Math.min(...lngs)) / 2;
  const hLat = Math.max(minSpan, (Math.max(...lats) - Math.min(...lats)) * (1 + pad)) / 2;
  const hLng = Math.max(minSpan * 1.27, (Math.max(...lngs) - Math.min(...lngs)) * (1 + pad)) / 2;
  return {
    north: Math.min(within.north, cLat + hLat),
    south: Math.max(within.south, cLat - hLat),
    west: Math.max(within.west, cLng - hLng),
    east: Math.min(within.east, cLng + hLng),
  };
}

const routes = new Map<string, LatLng[]>();

/**
 * The street route from the workshop to the customer, from the public OSRM
 * router (the customer's page asks the same one). A straight line until it
 * answers, and for good if it does not answer within 4 seconds.
 */
export function useStreetRoute(from: LatLng, to: LatLng | undefined): LatLng[] | undefined {
  const key = to ? `${from.lat},${from.lng};${to.lat},${to.lng}` : "";
  const [path, setPath] = useState<LatLng[] | undefined>(() => (to ? routes.get(key) ?? [from, to] : undefined));
  useEffect(() => {
    if (!to) return setPath(undefined);
    const known = routes.get(key);
    if (known) return setPath(known);
    setPath([from, to]);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    fetch(`https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const coords: [number, number][] | undefined = body?.routes?.[0]?.geometry?.coordinates;
        if (!coords?.length) return;
        const street = coords.map(([lng, lat]) => ({ lat, lng }));
        routes.set(key, street);
        setPath(street);
      })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return path;
}
