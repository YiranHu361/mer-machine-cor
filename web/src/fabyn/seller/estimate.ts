// DEMO ESTIMATE. This is the only place the seller side invents numbers.
//
// The backend has no per-item progress yet, so the percent and ETA shown on a
// job come from here. They are based on real timestamps the server recorded
// (the job's dispatch_authorized event), the machine's real limit, the job's
// spec estimate, and the job's real state. To switch to real numbers later,
// replace the body of estimateJob and keep its return shape.
import type { OwnerJob, OwnerMachine } from "./data";

export interface JobEstimate {
  /** 0..100, or null when there is nothing to show (for example, a review is waiting). */
  percent: number | null;
  /** Seconds left, or null when unknown. */
  etaSeconds: number | null;
}

const DEFAULT_RUN_SECONDS = 90;
const RUNNING = ["dispatched", "running", "verifying"];
const QUEUED = ["requested", "specified", "approved", "quoted", "authorized", "payment_confirmed"];

/** How long the job should take on its machine, in seconds. */
export function runSeconds(job: OwnerJob, machine?: OwnerMachine): number {
  const own = job.spec.estimatedSeconds;
  if (typeof own === "number" && own > 0) return own;
  const cap = machine?.maxJobSeconds && machine.maxJobSeconds > 0 ? machine.maxJobSeconds : DEFAULT_RUN_SECONDS;
  return Math.min(DEFAULT_RUN_SECONDS, cap);
}

/** When the machine started this job, from the job's own recorded history. */
export function startedAt(job: OwnerJob): number | null {
  const event = job.history?.find((e) => e.event === "dispatch_authorized");
  return event ? Date.parse(event.at) : null;
}

/**
 * Percent and ETA for one job. `aheadSeconds` is the machine time the jobs in
 * front of it still need (used for queued jobs).
 */
export function estimateJob(job: OwnerJob, machine: OwnerMachine | undefined, aheadSeconds: number, now: number): JobEstimate {
  const total = runSeconds(job, machine);
  if (RUNNING.includes(job.productionState)) {
    const start = startedAt(job) ?? Date.parse(job.updatedAt);
    const elapsed = Math.max(0, (now - start) / 1000);
    const cap = job.productionState === "verifying" ? 0.99 : 0.97;
    const fraction = Math.min(cap, elapsed / total);
    return { percent: Math.round(fraction * 100), etaSeconds: Math.max(0, Math.round(total - elapsed)) };
  }
  if (job.productionState === "produced") return { percent: 100, etaSeconds: 0 };
  if (QUEUED.includes(job.productionState)) return { percent: 0, etaSeconds: Math.round(aheadSeconds + total) };
  return { percent: null, etaSeconds: null };
}

/** Percent and ETA for every job, each machine's queue in order (running first, then oldest). */
export function estimateAll(machines: OwnerMachine[], jobs: OwnerJob[], now: number): Map<string, JobEstimate> {
  const out = new Map<string, JobEstimate>();
  for (const m of machines) {
    const line = jobs
      .filter((j) => j.machineId === m.id && (RUNNING.includes(j.productionState) || QUEUED.includes(j.productionState)))
      .sort((a, b) => Number(!RUNNING.includes(a.productionState)) - Number(!RUNNING.includes(b.productionState)) || a.createdAt.localeCompare(b.createdAt));
    let free = 0;
    for (const j of line) {
      const est = estimateJob(j, m, free, now);
      free = est.etaSeconds ?? free;
      out.set(j.id, est);
    }
  }
  for (const j of jobs) if (!out.has(j.id)) out.set(j.id, estimateJob(j, machines.find((m) => m.id === j.machineId), 0, now));
  return out;
}

export function formatEta(seconds: number | null): string {
  if (seconds === null) return "";
  if (seconds <= 0) return "done";
  if (seconds < 60) return `${seconds} s left`;
  return `${Math.ceil(seconds / 60)} min left`;
}

// ---------------------------------------------------------------------------
// COURIER ESTIMATE. Delivery is display-only for now: no courier service is
// connected, so the courier, their times and their position on the map are
// invented here from the dispatch time and the trip length. To connect a real
// delivery service later, replace these bodies and keep the return shapes.

export interface Courier {
  name: string;
  vehicle: string;
  /** Shown as text only; nothing on the page dials it. */
  phone: string;
}

const COURIERS: Courier[] = [
  { name: "Maya R.", vehicle: "e-bike", phone: "(415) 555-0142" },
  { name: "Diego S.", vehicle: "scooter", phone: "(415) 555-0178" },
  { name: "Priya K.", vehicle: "e-bike", phone: "(415) 555-0119" },
  { name: "Sam W.", vehicle: "car · Prius", phone: "(415) 555-0163" },
];

/** A stable courier for an order, so the same order always shows the same person. */
export function courierFor(key: string): Courier {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COURIERS[h % COURIERS.length];
}

/** Minutes for the courier to reach the workshop after being called. */
export const COURIER_TO_WORKSHOP_MIN = 6;
/** Minutes spent handing over at the workshop. */
export const COURIER_HANDOFF_MIN = 1;

/** Trip minutes from the workshop to the drop-off: about 2.4 min per km in city traffic, at least 5. */
export function tripMinutes(km: number | null | undefined): number {
  if (!km || !Number.isFinite(km)) return 14;
  return Math.max(5, Math.round(km * 2.4 + 3));
}

export type CourierPhase = "to_workshop" | "at_workshop" | "on_the_way" | "delivered";

export interface CourierEstimate {
  phase: CourierPhase;
  /** Minutes until the courier reaches the workshop (0 once there). */
  pickupMin: number;
  /** Minutes until the drop-off (0 once delivered). */
  dropoffMin: number;
  /** 0..1 along workshop → drop-off, for the dot on the map. Before pickup it sits at the workshop. */
  routeFraction: number;
  /** 0..1 along the courier's approach to the workshop. */
  approachFraction: number;
}

export function courierEstimate(dispatchedAt: number, km: number | null | undefined, now: number): CourierEstimate {
  const elapsed = Math.max(0, (now - dispatchedAt) / 60000);
  const trip = tripMinutes(km);
  const atWorkshop = COURIER_TO_WORKSHOP_MIN;
  const leaves = atWorkshop + COURIER_HANDOFF_MIN;
  const arrives = leaves + trip;
  if (elapsed < atWorkshop)
    return { phase: "to_workshop", pickupMin: Math.ceil(atWorkshop - elapsed), dropoffMin: Math.ceil(arrives - elapsed), routeFraction: 0, approachFraction: elapsed / atWorkshop };
  if (elapsed < leaves) return { phase: "at_workshop", pickupMin: 0, dropoffMin: Math.ceil(arrives - elapsed), routeFraction: 0, approachFraction: 1 };
  if (elapsed < arrives)
    return { phase: "on_the_way", pickupMin: 0, dropoffMin: Math.ceil(arrives - elapsed), routeFraction: (elapsed - leaves) / trip, approachFraction: 1 };
  return { phase: "delivered", pickupMin: 0, dropoffMin: 0, routeFraction: 1, approachFraction: 1 };
}

export const PHASE_TEXT: Record<CourierPhase, string> = {
  to_workshop: "Heading to the workshop",
  at_workshop: "Picking it up now",
  on_the_way: "On the way to the customer",
  delivered: "Delivered",
};

/** Clock time for "in N minutes", e.g. 7:42 pm. */
export function clockIn(minutes: number, now: number): string {
  return new Date(now + minutes * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
