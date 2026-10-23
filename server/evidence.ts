import { hash, ownValue, requireThat, type Job, type State } from "./model.ts";

/** Prefer the active attempt, then insertion order when creation times tie. */
export function latestCalibration(state: State, machineId: string) {
  const active = ownValue(
    state.calibrations ?? {},
    state.machines[machineId]?.activeJobId ?? "",
  );
  return active?.machineId === machineId
    ? active
    : Object.values(state.calibrations ?? {})
        .filter((item) => item.machineId === machineId)
        .reverse()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** Bind public image reads to the exact frame described by saved metadata. */
export function evidenceFingerprint(job: Job) {
  return hash({
    id: job.id,
    machineId: job.machineId,
    attemptId: job.attemptId,
    frame: {
      url: job.evidence?.url,
      capturedAt: job.evidence?.capturedAt,
      jobId: job.evidence?.jobId,
      machineId: job.evidence?.machineId,
      attemptId: job.evidence?.attemptId,
      source: job.evidence?.source,
    },
  });
}

export function evidenceUrl(job: Job, calibration = false) {
  if (!job.evidence?.url) return undefined;
  const query = new URLSearchParams({ frame: evidenceFingerprint(job) });
  if (calibration) query.set("calibration", job.id);
  return calibration
    ? `/api/owner/machines/${encodeURIComponent(job.machineId!)}/calibration/evidence?${query}`
    : `/api/jobs/${encodeURIComponent(job.id)}/evidence?${query}`;
}

export function expectedEvidenceFrame(value: unknown) {
  requireThat(
    value === undefined ||
      (typeof value === "string" && /^[0-9a-f]{64}$/.test(value)),
    "INVALID_EVIDENCE_BINDING",
    "Refresh the saved result before loading its image.",
    400,
  );
  return value as string | undefined;
}

export function requireEvidenceFrame(job: Job, expected: string | undefined) {
  requireThat(
    expected === undefined || expected === evidenceFingerprint(job),
    "EVIDENCE_CHANGED",
    "The saved result frame changed. Refresh the saved order or calibration before loading its image again.",
    409,
  );
}
