/* Progress and ETA for one job on one machine.

   The backend has no per-item progress yet. Everything here is derived from
   real saved state first (the job's production and fulfilment states, the
   plan's start event, the plan's readyEstimateMinutes and the assignment's
   schedule). Only the percentage between "started" and "finished" is an
   estimate. When the backend gains real progress numbers, replace the body of
   estimateJob and nothing else needs to change. */

import type { Assignment, DeliveryCourier, OrderEvent } from "./model";

export interface JobProgress {
  /** 0..100 */
  percent: number;
  /** seconds left, null when not started or finished */
  etaSeconds: number | null;
  /** handover: the print is done and the owner is taking it off the machine */
  state: "queued" | "making" | "handover" | "finished" | "failed";
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Display only: a demo machine can finish in a few seconds; its print still
   plays for this long after the making started before "handover" shows. */
const MIN_MAKING_SECONDS = 24;

/** When the making started, from the saved event log (real timestamp). */
export function makingStartedAt(events: OrderEvent[]): number | null {
  const e = events.find((x) => x.type === "plan.in_progress");
  return e ? Date.parse(e.at) : null;
}

export function estimateJob(
  a: Assignment,
  opts: { now: number; startedAt: number | null; readyEstimateMinutes: number },
): JobProgress {
  const c = a.child;
  if (c?.productionState === "failed" || c?.productionState === "cancelled")
    return { percent: 0, etaSeconds: null, state: "failed" };
  if (
    c &&
    ["ready_for_pickup", "collected", "simulation_complete"].includes(
      c.fulfillmentState,
    )
  )
    return { percent: 100, etaSeconds: null, state: "finished" };
  const sinceStart = opts.startedAt === null ? Infinity : (opts.now - opts.startedAt) / 1000;
  // printed and waiting for the owner to take it off the machine (no camera check any more)
  const printed =
    c?.fulfillmentState === "awaiting_owner" || (c && ["produced", "verifying", "needs_review"].includes(c.productionState));
  if (printed && sinceStart < MIN_MAKING_SECONDS)
    return {
      percent: Math.round(clamp((sinceStart / MIN_MAKING_SECONDS) * 100, 1, 97)),
      etaSeconds: Math.ceil(MIN_MAKING_SECONDS - sinceStart),
      state: "making",
    };
  if (printed) return { percent: 100, etaSeconds: null, state: "handover" };
  if (opts.startedAt === null)
    return { percent: 0, etaSeconds: null, state: "queued" };

  const sched = a.schedule;
  const planned = sched ? Math.max(5, sched.finishSeconds - sched.startSeconds) : Math.max(60, opts.readyEstimateMinutes * 60);
  // a demo machine plays its print in MIN_MAKING_SECONDS; jobs queued behind it wait their turn
  const demo = a.executionMode === "simulation";
  const duration = demo ? MIN_MAKING_SECONDS : planned;
  const offset = sched ? (demo ? Math.round(sched.startSeconds / planned) * MIN_MAKING_SECONDS : sched.startSeconds) : 0;
  const elapsed = (opts.now - opts.startedAt) / 1000 - offset;
  if (elapsed < 0)
    return { percent: 0, etaSeconds: Math.ceil(duration - elapsed), state: "queued" };
  let percent = clamp((elapsed / duration) * 100, 0, 97);
  if (a.sim && typeof a.sim.progress === "number")
    percent = Math.max(percent, clamp(a.sim.progress * 100, 0, 97));
  return {
    percent: Math.round(percent),
    etaSeconds: Math.max(0, Math.ceil(duration * (1 - percent / 100))),
    state: "making",
  };
}

export function mmss(seconds: number | null) {
  if (seconds === null) return "--:--";
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/* ---------- delivery ----------

   No delivery service is connected. The maker calls a courier from the seller
   side; the server picks the person and fixes the pickup and arrival times
   (server/orchestration/delivery.ts), so both sides show the same ones. Before
   a courier is called, the trip uses the server's rule. */

/** City traffic: about 2.4 minutes per km, never under 5 minutes (the server's rule). */
export const tripMinutes = (km: number) => Math.max(5, km * 2.4);

export interface CourierProgress {
  phase: "to_workshop" | "on_the_way" | "delivered";
  /** 0..1 along the route, from the pickup to the arrival */
  t: number;
  /** whole minutes until the courier arrives at the person */
  minutesLeft: number;
}

export function courierProgress(c: DeliveryCourier, now: number): CourierProgress {
  const pickup = Date.parse(c.pickupAt);
  const arrive = Date.parse(c.arriveAt);
  const minutesLeft = Math.max(0, Math.ceil((arrive - now) / 60000));
  if (now < pickup) return { phase: "to_workshop", t: 0, minutesLeft };
  if (now >= arrive) return { phase: "delivered", t: 1, minutesLeft: 0 };
  return { phase: "on_the_way", t: clamp((now - pickup) / Math.max(1, arrive - pickup), 0, 1), minutesLeft };
}

/** "3:12 pm" in the viewer's clock. */
export const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();

/** Walking time for a distance, at about 5 km/h. */
export const walkMinutes = (km: number) => Math.max(1, Math.round((km / 5) * 60));
