/* Where the person is, asked when the map of makers first shows (never on page
   load). A found or tapped spot is remembered for this tab in sessionStorage so
   later steps reuse it. Without one, nothing pretends a fixed spot is theirs:
   distances say so, and delivery waits until they set a spot or pick up. */

import { useEffect, useState, useSyncExternalStore } from "react";
import { PALACE, areaLabel, distanceKm, formatKm, type LatLng } from "../shared/map";

export type Where =
  | { state: "idle" }
  | { state: "asking" }
  | { state: "found"; at: LatLng; accuracyM: number }
  | { state: "set"; at: LatLng }
  | { state: "denied" }
  | { state: "unavailable"; why: "insecure" | "unsupported" | "timeout" | "error" };

const KEY = "fabyn.consumer.where";

function readSaved(): Where {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n);
    if ((v?.state === "found" || v?.state === "set") && ok(v.at?.lat) && ok(v.at?.lng))
      return v.state === "found" ? { state: "found", at: v.at, accuracyM: ok(v.accuracyM) ? v.accuracyM : 0 } : { state: "set", at: v.at };
  } catch {
    /* storage blocked: ask again */
  }
  return { state: "idle" };
}

let current: Where = typeof window === "undefined" ? { state: "idle" } : readSaved();
const listeners = new Set<() => void>();

function update(next: Where) {
  current = next;
  if (next.state === "found" || next.state === "set")
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* kept in memory for this visit */
    }
  listeners.forEach((l) => l());
}

/** Ask the browser once. Over plain http (a phone on the LAN address) browsers refuse, so say so. */
export function askLocation() {
  if (current.state === "asking") return;
  if (typeof window !== "undefined" && !window.isSecureContext) return update({ state: "unavailable", why: "insecure" });
  if (typeof navigator === "undefined" || !navigator.geolocation) return update({ state: "unavailable", why: "unsupported" });
  update({ state: "asking" });
  navigator.geolocation.getCurrentPosition(
    (pos) => update({ state: "found", at: { lat: pos.coords.latitude, lng: pos.coords.longitude }, accuracyM: Math.round(pos.coords.accuracy) }),
    (err) =>
      update(
        err.code === err.PERMISSION_DENIED
          ? { state: "denied" }
          : { state: "unavailable", why: err.code === err.TIMEOUT ? "timeout" : "error" },
      ),
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
  );
}

export const setLocation = (at: LatLng) => update({ state: "set", at });

export function useWhere(): Where {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

/** The person's spot, when they have one. */
export const spotOf = (w: Where): LatLng | null => (w.state === "found" || w.state === "set" ? w.at : null);

/** Why there is no spot, in one line. */
export function whyNoSpot(w: Where): string {
  if (w.state === "denied") return "Location is turned off for this page.";
  if (w.state === "unavailable")
    return w.why === "insecure"
      ? "This page is opened over plain http, so the browser won't share your location."
      : w.why === "timeout"
        ? "Finding your location took too long."
        : "This browser can't share your location.";
  return "";
}

/** "Mission · 5.6 km from the Palace", or "outside San Francisco · 18 km away". */
export function placeText(at: LatLng, from: LatLng = PALACE) {
  const km = distanceKm(at, from);
  const area = areaLabel(at);
  return { area, km, text: `${area} · ${formatKm(km)}` };
}

/* ---------- delivery ---------- */

/** How far the e-bike courier goes from the machine. Further away, or with no spot, it is pickup only. */
export const DELIVERY_RADIUS_KM = 4;
/** Closer than this you are at the Palace already. */
export const HERE_KM = 0.3;

export function deliveryFor(spot: LatLng | null, from: LatLng = PALACE): { ok: boolean; why: string } {
  if (!spot) return { ok: false, why: "Set where you are on the map to get it delivered." };
  const km = distanceKm(spot, from);
  if (km < HERE_KM) return { ok: false, why: `You're at the ${PALACE.short} already, so pick it up from Lucas.` };
  if (km > DELIVERY_RADIUS_KM)
    return { ok: false, why: `The courier rides up to ${DELIVERY_RADIUS_KM} km from the ${PALACE.short}; you are ${formatKm(km)} away, so it's pickup only.` };
  return { ok: true, why: "" };
}

/* ---------- the courier's street route ----------

   The public OSRM demo server gives the route over real streets. If it fails or
   takes longer than 4 s the route is a straight line, and says so. Routes are
   kept for the tab, keyed by both ends rounded to about 10 m. */

export interface StreetRoute {
  path: LatLng[];
  km: number;
  streets: boolean;
}

const OSRM = "https://router.project-osrm.org/route/v1/driving";
const routeKey = (a: LatLng, b: LatLng) => `fabyn.consumer.route.${[a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(4)).join(",")}`;

export async function streetRoute(from: LatLng, to: LatLng): Promise<StreetRoute> {
  const key = routeKey(from, to);
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (saved?.path?.length > 1) return saved;
  } catch {
    /* fetch again */
  }
  const straight: StreetRoute = { path: [from, to], km: distanceKm(from, to), streets: false };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const res = await fetch(`${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`, { signal: ctl.signal });
    const j = await res.json();
    const r = j?.routes?.[0];
    const coords: [number, number][] | undefined = r?.geometry?.coordinates;
    if (!res.ok || j?.code !== "Ok" || !coords?.length || !Number.isFinite(r.distance)) return straight;
    const route: StreetRoute = { path: coords.map(([lng, lat]) => ({ lat, lng })), km: r.distance / 1000, streets: true };
    try {
      sessionStorage.setItem(key, JSON.stringify(route));
    } catch {
      /* fine, fetch again next time */
    }
    return route;
  } catch {
    return straight;
  } finally {
    clearTimeout(timer);
  }
}

/** The courier's route from the machine to the spot, null while it loads or with no spot. */
export function useStreetRoute(from: LatLng, to: LatLng | null): StreetRoute | null {
  const [route, setRoute] = useState<StreetRoute | null>(null);
  const k = to ? routeKey(from, to) : "";
  useEffect(() => {
    if (!to) {
      setRoute(null);
      return;
    }
    let alive = true;
    void streetRoute(from, to).then((r) => alive && setRoute(r));
    return () => {
      alive = false;
    };
    // the key covers both ends
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return route;
}
