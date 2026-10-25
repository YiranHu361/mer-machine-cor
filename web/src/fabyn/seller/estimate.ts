// DEMO ESTIMATE. This is the only place the seller side invents numbers.
//
// The backend has no per-item progress yet, so the percent and ETA shown on a
// job come from here. They are based on real timestamps the server recorded
// (the job's dispatch_authorized event), the machine's real limit, the job's
// spec estimate, and the job's real state. To switch to real numbers later,
// replace the body of estimateJob and keep its return shape.
import type { OwnerJob, OwnerMachine } from "./data";
import type { CourierPhase } from "./deliveries";

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
// The courier's phase and times come from the order (deliveries.ts); these are
// only the words and clock times shown for them.

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
