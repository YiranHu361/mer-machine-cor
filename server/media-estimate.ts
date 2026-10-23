import {
  hash,
  now,
  record,
  type Job,
  type Machine,
  type State,
} from "./model.ts";
import { machineDeviceFingerprint } from "./machine-settings.ts";

export function mediaEstimateSnapshot(machine: Machine) {
  return {
    mode: machine.mode,
    fingerprint: hash({
      device: machineDeviceFingerprint(machine),
      material: machine.material,
      policyObservationId: machine.policyObservationId ?? null,
      remaining: machine.mediaRemaining,
    }),
  };
}

/** A Node estimate is bookkeeping, not measured physical consumption. */
export function observeMediaEstimate(
  state: State,
  job: Job,
  snapshot: ReturnType<typeof mediaEstimateSnapshot>,
  status: any,
) {
  const previous = job.mediaEstimateObserved;
  if (
    previous?.applied ||
    job.executionCancellation ||
    !job.attemptId ||
    !status ||
    typeof status !== "object" ||
    Array.isArray(status) ||
    status.machine_id !== job.machineId ||
    status.job_id !== job.id ||
    status.attempt_id !== job.attemptId ||
    status.mode !== snapshot.mode ||
    !["completed", "failed"].includes(status.execution_status) ||
    !Number.isSafeInteger(status.media_remaining) ||
    status.media_remaining < 0 ||
    status.media_remaining > 100000
  )
    return false;
  const machine = state.machines[job.machineId!];
  if (!machine) return false;
  const applied =
    machine.activeJobId === job.id &&
    mediaEstimateSnapshot(machine).fingerprint === snapshot.fingerprint;
  if (previous && !applied) return false;
  if (applied)
    machine.mediaRemaining = Math.min(
      machine.mediaRemaining,
      status.media_remaining,
    );
  job.mediaEstimateObserved = {
    machineId: machine.id,
    attemptId: job.attemptId,
    remaining: status.media_remaining,
    observedAt: now(),
    applied,
  };
  record(
    job,
    previous ? "media_estimate_refreshed" : "media_estimate_observed",
    applied
      ? "Saved the matching terminal node's remaining-media estimate once; this is not a physical measurement."
      : "A matching terminal node estimate was observed after newer machine or owner stock state; the newer estimate was preserved and pickup will not deduct this attempt again.",
  );
  return true;
}

/** Compatibility fallback only; a newer explicit owner estimate wins. */
export function accountPreparedEstimate(machine: Machine, job: Job) {
  if (job.mediaEstimateObserved || job.executionCancellation) return false;
  const current = mediaEstimateSnapshot(machine).fingerprint;
  const unchanged = job.mediaEstimateBaseline
    ? job.mediaEstimateBaseline === current
    : machine.policyObservationId === undefined;
  if (!unchanged) return false;
  machine.mediaRemaining = Math.max(
    0,
    machine.mediaRemaining - job.spec.quantity,
  );
  return true;
}
