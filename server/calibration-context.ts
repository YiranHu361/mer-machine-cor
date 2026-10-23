import {
  hash,
  ownValue,
  requireThat,
  type Machine,
  type State,
} from "./model.ts";
import {
  machineDeviceFingerprint,
  machineInspectionFingerprint,
} from "./machine-settings.ts";
import { latestCalibration } from "./evidence.ts";

export const calibrationDeviceContext = (machine: Machine) =>
  hash({
    device: machineDeviceFingerprint(machine),
    material: machine.material,
  });

/** A single owner authorization must not survive a newer attempt/clearance cycle. */
export function calibrationStartObservation(state: State, machineId: string) {
  const machine = ownValue(state.machines, machineId);
  requireThat(machine, "NOT_FOUND", "Machine not found.", 404);
  const latest = latestCalibration(state, machineId);
  return hash({
    inspection: machineInspectionFingerprint(machine),
    policyObservationId: machine.policyObservationId ?? null,
    calibration: latest
      ? {
          id: latest.id,
          attemptId: latest.attemptId,
          version: latest.version,
          productionState: latest.productionState,
          evidence: latest.evidence ?? null,
        }
      : null,
  });
}

export function expectedCalibrationContext(value: unknown) {
  requireThat(
    value === undefined ||
      (typeof value === "string" && /^[0-9a-f]{64}$/.test(value)),
    "INVALID_CALIBRATION_CONTEXT",
    "Refresh the saved calibration before authorizing a new attempt.",
    400,
  );
  return value as string | undefined;
}
export function requestedCalibrationKey(value: unknown) {
  requireThat(
    value === undefined ||
      (typeof value === "string" && value.length >= 8 && value.length <= 200),
    "INVALID_CALIBRATION_REQUEST_KEY",
    "The saved calibration request key must be one string of 8 to 200 characters.",
    400,
  );
  return value as string | undefined;
}

export function calibrationLifecycle(
  state: State,
  machineId: string,
  mode: string,
  calibrationId?: string,
) {
  const machine = ownValue(state.machines, machineId);
  requireThat(machine, "NOT_FOUND", "Machine not found.", 404);
  const calibration = calibrationId
    ? ownValue(state.calibrations ?? {}, calibrationId)
    : undefined;
  const context = calibrationDeviceContext(machine);
  const reservationExpires = machine.reservation
    ? Date.parse(machine.reservation.expiresAt)
    : undefined;
  let reasonCode = "NEW_CALIBRATION_ALLOWED",
    reason =
      "The saved machine state permits requesting a new supervised calibration. The node must still accept the finite job.";
  if (machine.activeJobId) {
    reasonCode =
      machine.activeJobId === calibration?.id
        ? "ACTIVE_CALIBRATION"
        : "ACTIVE_EXECUTION";
    reason =
      "Resolve or finish the current machine attempt before requesting another calibration.";
  } else if (
    reservationExpires !== undefined &&
    (!Number.isFinite(reservationExpires) || reservationExpires > Date.now())
  ) {
    reasonCode = "RESERVATION_ACTIVE";
    reason =
      "A machine reservation must expire or be cancelled before a new calibration.";
  } else if (machine.mode !== mode) {
    reasonCode = "MODE_MISMATCH";
    reason =
      "The configured service and machine mode must match before calibration.";
  } else if (!machine.paired || !machine.configured) {
    reasonCode = "DEVICE_UNAVAILABLE";
    reason =
      "Pair and configure this device before requesting a new calibration.";
  } else if (machine.policyReconciliationRequired) {
    reasonCode = "POLICY_RECONCILIATION";
    reason =
      "Synchronize the current machine policy before requesting a new calibration.";
  }
  return {
    activeJobId: machine.activeJobId ?? null,
    calibrationActive: Boolean(
      calibration && machine.activeJobId === calibration.id,
    ),
    canRequestNew: reasonCode === "NEW_CALIBRATION_ALLOWED",
    canRequestCancellation: Boolean(
      calibration &&
      machine.activeJobId === calibration.id &&
      ["dispatched", "needs_review"].includes(calibration.productionState) &&
      !calibration.executionCancellation &&
      !calibration.evidence &&
      !calibration.history.some((entry) =>
        [
          "calibration_accepted",
          "calibration_status",
          "calibration_operator_resolution",
          "calibration_inspected",
        ].includes(entry.event),
      ) &&
      (!calibration.calibrationDeviceContext ||
        calibration.calibrationDeviceContext === context),
    ),
    context,
    contextMatch: calibration?.calibrationDeviceContext
      ? calibration.calibrationDeviceContext === context
      : null,
    reasonCode,
    reason,
  };
}

export function calibrationRetirement(
  state: State,
  machineId: string,
  body: any,
) {
  requireThat(
    body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.keys(body).every((key) =>
        [
          "attemptId",
          "expectedVersion",
          "expectedContext",
          "inspected",
          "reason",
        ].includes(key),
      ) &&
      typeof body.attemptId === "string" &&
      body.attemptId.length >= 1 &&
      body.attemptId.length <= 128 &&
      Number.isSafeInteger(body.expectedVersion) &&
      body.expectedVersion > 0 &&
      typeof body.expectedContext === "string" &&
      /^[0-9a-f]{64}$/.test(body.expectedContext) &&
      body.inspected === true &&
      typeof body.reason === "string" &&
      body.reason.trim().length >= 10 &&
      body.reason.length <= 1000,
    "INSPECTION_REQUIRED",
    "Refresh the exact saved calibration and record its version, current device context, inspection and a specific reason of 10 to 1000 characters.",
    422,
  );
  const machine = ownValue(state.machines, machineId);
  requireThat(machine, "NOT_FOUND", "Machine not found.", 404);
  const calibration = Object.values(state.calibrations ?? {}).find(
    (c) => c.machineId === machineId && c.attemptId === body.attemptId,
  );
  requireThat(
    calibration,
    "CALIBRATION_NOT_FOUND",
    "This calibration attempt does not belong to the machine.",
    404,
  );
  requireThat(
    machine.activeJobId === calibration.id &&
      calibration.version === body.expectedVersion,
    "CALIBRATION_NOT_CURRENT",
    "The saved calibration changed. Refresh before inspecting this attempt again.",
  );
  requireThat(
    body.expectedContext === calibrationDeviceContext(machine) &&
      (!calibration.calibrationDeviceContext ||
        calibration.calibrationDeviceContext === body.expectedContext),
    "CALIBRATION_CONTEXT_CHANGED",
    "This calibration belongs to a different device setup. Keep it blocked and inspect the current configuration.",
  );
  return { machine, calibration, reason: body.reason.trim() as string };
}

export function requireCalibrationStart(
  state: State,
  machineId: string,
  ownerId: string,
  mode: string,
  key: string,
  expected?: string,
) {
  const machine = ownValue(state.machines, machineId);
  requireThat(machine, "NOT_FOUND", "Machine not found.", 404);
  requireThat(
    machine.ownerId === ownerId,
    "FORBIDDEN",
    "This machine belongs to another owner.",
    403,
  );
  requireThat(
    expected === undefined || expected === calibrationDeviceContext(machine),
    "CALIBRATION_CONTEXT_CHANGED",
    "The configured device changed. Refresh before authorizing a new calibration.",
  );
  const existing = Object.values(state.calibrations ?? {}).find(
    (c) => c.machineId === machineId && c.checkoutKey === key,
  );
  if (!existing) {
    const lifecycle = calibrationLifecycle(state, machineId, mode);
    requireThat(lifecycle.canRequestNew, "MACHINE_BUSY", lifecycle.reason);
  }
  return machine;
}

/** Facts one owner inspection/resolution is allowed to confirm. Unrelated state is excluded. */
export function calibrationOperationContext(
  state: State,
  machineId: string,
  calibrationId?: string,
) {
  const machine = state.machines[machineId],
    calibration = calibrationId
      ? state.calibrations?.[calibrationId]
      : undefined;
  return hash({
    device: calibrationDeviceContext(machine),
    activeJobId: machine.activeJobId ?? null,
    reservation: machine.reservation ?? null,
    calibrated: machine.calibrated,
    calibrationAt: machine.calibrationAt ?? null,
    calibrationConfirmationId: machine.calibrationConfirmationId ?? null,
    ready: machine.ready,
    paused: machine.paused,
    policyReconciliationRequired: machine.policyReconciliationRequired === true,
    calibration: calibration
      ? {
          id: calibration.id,
          attemptId: calibration.attemptId,
          version: calibration.version,
          productionState: calibration.productionState,
          evidence: calibration.evidence ?? null,
        }
      : null,
  });
}
