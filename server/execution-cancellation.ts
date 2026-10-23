import {
  hash,
  parameters,
  requireThat,
  type ExecutionCancellation,
  type Job,
  type Machine,
  type State,
} from "./model.ts";
import { machineInspectionFingerprint } from "./machine-settings.ts";

/** Exact saved facts this negative authorization is permitted to retire. */
export function executionCancellationContext(state: State, job: Job) {
  const machine = state.machines[job.machineId!];
  return hash({
    inspection: machineInspectionFingerprint(machine),
    policyObservationId: machine.policyObservationId ?? null,
    job,
    operations: Object.values(state.operations).filter(
      (op) => op.jobId === job.id,
    ),
  });
}

export function cancellationProof(
  value: unknown,
  job: Job,
  machine: Machine,
  scope: "dispatch" | "calibration",
): ExecutionCancellation {
  const proof = value as Partial<ExecutionCancellation> | null;
  const timestamp =
    typeof proof?.cancelled_at === "string"
      ? Date.parse(proof.cancelled_at)
      : NaN;
  requireThat(
    proof !== null &&
      typeof proof === "object" &&
      !Array.isArray(proof) &&
      proof.status === "cancelled_before_acceptance" &&
      proof.machine_id === machine.id &&
      proof.job_id === job.id &&
      proof.attempt_id === job.attemptId &&
      proof.artifact_sha256 === job.artifact.sha256 &&
      proof.parameters !== null &&
      typeof proof.parameters === "object" &&
      !Array.isArray(proof.parameters) &&
      hash(proof.parameters) === hash(parameters(job)) &&
      proof.target_scope === scope &&
      proof.expected_mode === machine.mode &&
      Number.isFinite(timestamp) &&
      timestamp >= Date.parse(job.createdAt) - 60000 &&
      timestamp <= Date.now() + 60000,
    "CANCELLATION_UNCONFIRMED",
    "The node did not confirm cancellation of this exact authorization. Keep the saved attempt blocked and refresh its status before deciding what to do next.",
    502,
  );
  // Persist only the confirmed public contract, without arbitrary reply fields.
  return {
    status: "cancelled_before_acceptance",
    machine_id: machine.id,
    job_id: job.id,
    attempt_id: job.attemptId!,
    artifact_sha256: job.artifact.sha256,
    parameters: parameters(job),
    target_scope: scope,
    expected_mode: machine.mode,
    cancelled_at: proof.cancelled_at!,
  };
}
