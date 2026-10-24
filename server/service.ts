import {
  mediaEstimateSnapshot,
  observeMediaEstimate,
  accountPreparedEstimate,
} from "./media-estimate.ts";
import { createHmac, randomBytes } from "node:crypto";
import { mutate, type Store } from "./store.ts";
import { latestCalibration } from "./evidence.ts";
import {
  id,
  hash,
  now,
  record,
  specificationHash,
  parameters,
  requireThat,
  Problem,
  specSchema,
  ownValue,
  type State,
  type Job,
  type Machine,
  type Spec,
  type Asset,
  type Operation,
} from "./model.ts";
import type { NodeBoundary } from "./node-client.ts";
import type { PaymentBoundary, PaymentResult } from "./payments.ts";
import { readFile } from "node:fs/promises";
import { createClaudeProvider } from "../integrations/src/claude.ts";
import { machineSupportsSpec } from "./recommendations.ts";
import { parseJobCreation, findCreatedJob } from "./job-creation.ts";
import { machineInspectionFingerprint } from "./machine-settings.ts";
import {
  calibrationDeviceContext,
  calibrationLifecycle,
  calibrationOperationContext,
  calibrationStartObservation,
  expectedCalibrationContext,
  requestedCalibrationKey,
  requireCalibrationStart,
  calibrationRetirement,
} from "./calibration-context.ts";
import {
  cancellationProof,
  executionCancellationContext,
} from "./execution-cancellation.ts";
export interface Config {
  mode: "simulation" | "hardware";
  paymentMode: "mock" | "testnet";
  storeMode: string;
  assetOrigin: string;
  secret: string;
  quoteMs: number;
  pickupMs: number;
  ownerCode: string;
  dataDir: string;
  nodeUrl: string;
  catalog?: any[];
  /** Execution modes this deployment may authorize; defaults to [mode]. */
  allowedModes?: ("simulation" | "hardware")[];
}
export class Service {
  private busy = new Set<string>();
  private lastProbe = 0;
  constructor(
    public store: Store,
    public node: NodeBoundary,
    public payment: PaymentBoundary,
    public config: Config,
  ) {}
  async read() {
    return (await this.store.read()).data;
  }
  /** A job's fixed execution mode; jobs from before per-assignment modes use the configured one. */
  jobMode(job: Pick<Job, "executionMode">) {
    return job.executionMode ?? this.config.mode;
  }
  modeAllowed(mode: Machine["mode"]) {
    return (this.config.allowedModes ?? [this.config.mode]).includes(mode);
  }
  /** The mode a machine may be operated in here, or the configured mode when its own is not allowed. */
  machineMode(machine: Machine | undefined) {
    return machine && this.modeAllowed(machine.mode)
      ? machine.mode
      : this.config.mode;
  }
  async job(jobId: string, actor?: { id: string; role: string }) {
    const s = await this.read();
    const j = ownValue(s.jobs, jobId);
    requireThat(j, "NOT_FOUND", "Order not found.", 404);
    if (actor)
      requireThat(
        actor.role === "owner"
          ? s.machines[j.machineId ?? ""]?.ownerId === actor.id ||
              actor.id === "team_owner"
          : j.requesterId === actor.id,
        "FORBIDDEN",
        "This order belongs to a different account.",
        403,
      );
    return j;
  }
  validateCalibrationIntent(key: unknown, ownerReady: unknown) {
    requireThat(
      ownerReady === true,
      "OWNER_READY_REQUIRED",
      "Confirm loaded media, a clear output area and supervision before the finite calibration job.",
    );
    requireThat(
      typeof key === "string" && key.length >= 8 && key.length <= 200,
      "IDEMPOTENCY_REQUIRED",
      "Calibration needs a stable idempotency key between 8 and 200 characters.",
      422,
    );
  }
  async startCalibration(
    machineId: string,
    ownerId: string,
    input: unknown,
    artifact: Job["artifact"],
    key: string,
    ownerReady: boolean,
    expectedContext?: string,
    observedStart?: string,
  ) {
    this.validateCalibrationIntent(key, ownerReady);
    const expected = expectedCalibrationContext(expectedContext);
    const spec = specSchema.parse(input);
    if (spec.outputType === "3d") this.validateCatalog(spec, artifact);
    const observed =
      observedStart ??
      calibrationStartObservation(await this.read(), machineId);
    const accepted = await mutate(this.store, (s) => {
      const m = requireCalibrationStart(
        s,
        machineId,
        ownerId,
        this.machineMode(ownValue(s.machines, machineId)),
        key,
        expected,
      );
      s.calibrations ??= {};
      const existing = Object.values(s.calibrations).find(
        (j) => j.machineId === machineId && j.checkoutKey === key,
      );
      if (existing) {
        requireThat(
          hash(existing.spec) === hash(spec) &&
            existing.artifact.sha256 === artifact.sha256,
          "IDEMPOTENCY_CONFLICT",
          "This calibration key already binds a different specification or artifact.",
        );
        return { calibration: existing, start: false };
      }
      requireThat(
        calibrationStartObservation(s, machineId) === observed,
        "CALIBRATION_AUTHORIZATION_CHANGED",
        "A newer calibration or owner clearance changed while this request was being prepared. Refresh before explicitly authorizing another calibration.",
      );
      requireThat(
        !m.activeJobId &&
          (!m.reservation || Date.parse(m.reservation.expiresAt) <= Date.now()),
        "MACHINE_BUSY",
        "Calibration requires an idle machine.",
      );
      requireThat(
        m.outputType === spec.outputType &&
          m.material === spec.material &&
          spec.quantity === 1 &&
          m.mode === this.machineMode(m),
        "CALIBRATION_SPEC",
        "Calibration must match this device, loaded media and a single output.",
      );
      for (const assetId of spec.assetIds)
        requireThat(
          ownValue(s.assets, assetId)?.ownerId === ownerId ||
            ownValue(s.assets, assetId)?.ownerId === "catalog",
          "ASSET_ACCESS",
          "Use owner calibration artwork or a reviewed prepared model.",
          403,
        );
      const timestamp = now();
      const calibration: Job = {
        id: id("calibration"),
        requesterId: ownerId,
        machineId,
        calibrationDeviceContext: calibrationDeviceContext(m),
        mediaEstimateBaseline: mediaEstimateSnapshot(m).fingerprint,
        specVersion: 1,
        spec,
        artifact,
        productionState: "dispatched",
        paymentState: "unpaid",
        fulfillmentState: "unprepared",
        history: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
        attemptId: id("calibration_attempt"),
        checkoutKey: key,
      };
      record(
        calibration,
        "calibration_authorized",
        "Owner explicitly authorized this finite calibration job; it is not a paid customer order.",
      );
      s.calibrations[calibration.id] = calibration;
      // A finite calibration accepted after quote expiry owns the idle slot.
      // Retaining the expired reservation would prevent its later inspection.
      if (m.reservation && Date.parse(m.reservation.expiresAt) <= Date.now())
        delete m.reservation;
      m.activeJobId = calibration.id;
      m.ready = false;
      m.paused = true;
      m.calibrated = false;
      return { calibration, start: true };
    });
    if (accepted.start) {
      const c = accepted.calibration,
        m = (await this.read()).machines[machineId];
      const deviceContext = (machine: Machine) =>
        JSON.stringify([calibrationDeviceContext(machine), machine.calibrated]);
      const observedContext = deviceContext(m);
      const stillCurrent = (state: State) => {
        const current = state.calibrations?.[c.id];
        const machine = state.machines[machineId];
        return (
          current !== undefined &&
          current.attemptId === c.attemptId &&
          current.version === c.version &&
          current.productionState === c.productionState &&
          JSON.stringify(current.evidence) === JSON.stringify(c.evidence) &&
          machine.activeJobId === c.id &&
          deviceContext(machine) === observedContext
        );
      };
      try {
        const result = await this.node.call(
          "/calibrate",
          {
            machine_id: machineId,
            inspected: false,
            job: {
              ...this.node.token(c, m, "calibration"),
              job_id: c.id,
              attempt_id: c.attemptId,
              machine_id: machineId,
              artifact_url: this.assetUrl(c.artifact.id),
              artifact_sha256: c.artifact.sha256,
              parameters: parameters(c),
            },
          },
          m,
        );
        await mutate(this.store, (s) => {
          if (!stillCurrent(s)) return;
          const current = s.calibrations![c.id];
          current.productionState =
            result.execution_status === "running" ? "running" : "dispatched";
          record(
            current,
            "calibration_accepted",
            "Node acceptance journaled; inspect result before confirming calibration.",
          );
        });
      } catch (e) {
        await mutate(this.store, (s) => {
          if (!stillCurrent(s)) return;
          const current = s.calibrations![c.id];
          current.productionState = "needs_review";
          record(current, "calibration_uncertain", (e as Error).message);
          s.machines[machineId].reason =
            "Calibration acknowledgment uncertain; reconcile existing attempt and inspect. Never automatically print again.";
        });
      }
    }
    return (await this.read()).calibrations![accepted.calibration.id];
  }
  async calibrationStatus(machineId: string, requestKey?: unknown) {
    const requestedKey = requestedCalibrationKey(requestKey);
    const s = await this.read();
    requireThat(
      ownValue(s.machines, machineId),
      "NOT_FOUND",
      "Machine not found.",
      404,
    );
    const latest = (state: State) => latestCalibration(state, machineId);
    const response = (
      state: State,
      calibration: Job | undefined,
      status: any,
    ) => ({
      calibration: calibration ?? null,
      status,
      lifecycle: calibrationLifecycle(
        state,
        machineId,
        this.machineMode(ownValue(state.machines, machineId)),
        calibration?.id,
      ),
      ...(requestedKey === undefined
        ? {}
        : {
            requestedCalibration:
              Object.values(state.calibrations ?? {}).find(
                (item) =>
                  item.machineId === machineId &&
                  item.checkoutKey === requestedKey,
              ) ?? null,
          }),
    });
    const savedStatus = (calibration: Job, reason?: string) => ({
      execution_status:
        (
          {
            produced: "completed",
            failed: "failed",
            needs_review: "uncertain",
            running: "running",
            dispatched: "accepted",
            cancelled: "cancelled_before_acceptance",
          } as Record<string, string>
        )[calibration.productionState] ?? "unknown",
      ...(reason ? { reason } : {}),
    });
    const c = latest(s);
    if (!c) return response(s, undefined, null);
    if (s.machines[machineId].activeJobId !== c.id)
      return response(
        s,
        c,
        savedStatus(
          c,
          "Showing the saved calibration; it is no longer the active machine attempt.",
        ),
      );
    const context = (state: State) => {
      const machine = state.machines[machineId];
      return JSON.stringify([
        machine.activeJobId,
        calibrationDeviceContext(machine),
        machine.calibrated,
      ]);
    };
    const observedContext = context(s);
    const snapshot = (calibration: Job) =>
      JSON.stringify([
        calibration.version,
        calibration.productionState,
        calibration.evidence,
      ]);
    let observedSnapshot = snapshot(c);
    let status: any;
    try {
      // The durable owner resolution is authoritative for this attempt. A later
      // read may capture fresh evidence, but cannot undo the observed outcome.
      status = c.history.some(
        (entry) => entry.event === "calibration_operator_resolution",
      )
        ? savedStatus(
            c,
            "Showing the outcome recorded by the owner after inspection.",
          )
        : await this.node.call(
            "get_status",
            { machine_id: machineId, job_id: c.id, attempt_id: c.attemptId },
            s.machines[machineId],
          );
      const state =
        status &&
        typeof status === "object" &&
        !Array.isArray(status) &&
        typeof status.execution_status === "string"
          ? ownValue(
              {
                completed: "produced",
                failed: "failed",
                uncertain: "needs_review",
                running: "running",
                accepted: "dispatched",
              } as const,
              status.execution_status,
            )
          : undefined;
      requireThat(
        state,
        "INVALID_STATUS",
        "The node did not confirm this calibration status. The saved record is unchanged.",
      );
      let evidence: Job["evidence"];
      if (
        ["completed", "failed", "uncertain"].includes(status.execution_status)
      ) {
        try {
          const frame = await this.node.call(
            "camera_snapshot",
            {
              token: this.node.token(c, s.machines[machineId], "camera").token,
              machine_id: machineId,
              job_id: c.id,
              attempt_id: c.attemptId,
              phase: "result",
            },
            s.machines[machineId],
          );
          requireThat(
            frame.machine_id === machineId &&
              frame.job_id === c.id &&
              frame.attempt_id === c.attemptId &&
              frame.source ===
                (s.machines[machineId].mode === "simulation"
                  ? "simulation"
                  : "camera") &&
              Date.parse(frame.captured_at) >= Date.parse(c.createdAt) &&
              Math.abs(Date.now() - Date.parse(frame.captured_at)) < 60000,
            "INVALID_FRAME",
            "Calibration evidence does not match this attempt or capture time.",
          );
          evidence = {
            url: frame.frame_url,
            capturedAt: frame.captured_at,
            machineId,
            jobId: c.id,
            frame,
          };
        } catch {}
      }
      const applied = await mutate(this.store, (currentState) => {
        const current = currentState.calibrations?.[c.id];
        // Check inside every CAS retry: another status read, owner resolution,
        // final inspection or device change may have won while I/O was pending.
        if (
          !current ||
          latest(currentState)?.id !== c.id ||
          context(currentState) !== observedContext ||
          current.version !== c.version ||
          current.productionState !== c.productionState ||
          JSON.stringify(current.evidence) !== JSON.stringify(c.evidence)
        )
          return false;
        observeMediaEstimate(
          currentState,
          current,
          mediaEstimateSnapshot(s.machines[machineId]),
          status,
        );
        const freshEvidence =
          evidence &&
          (!current.evidence ||
            Date.parse(evidence.capturedAt) >=
              Date.parse(current.evidence.capturedAt))
            ? evidence
            : undefined;
        if (
          current.productionState !== state ||
          !current.history.some((entry) =>
            [
              "calibration_accepted",
              "calibration_status",
              "calibration_operator_resolution",
            ].includes(entry.event),
          ) ||
          (freshEvidence &&
            JSON.stringify(freshEvidence) !== JSON.stringify(current.evidence))
        ) {
          current.productionState = state;
          if (freshEvidence) current.evidence = freshEvidence;
          record(
            current,
            "calibration_status",
            "Saved the current node observation and matching result evidence.",
          );
        }
        return snapshot(current);
      });
      if (!applied) status = null;
      else observedSnapshot = applied;
    } catch (e) {
      status = { execution_status: "unknown", reason: (e as Error).message };
    }
    const finalState = await this.read();
    const current = latest(finalState);
    return response(
      finalState,
      current,
      current &&
        (!status ||
          current.id !== c.id ||
          snapshot(current) !== observedSnapshot ||
          context(finalState) !== observedContext ||
          (status.execution_status !== "unknown" &&
            status.execution_status !== savedStatus(current).execution_status))
        ? savedStatus(
            current,
            "The calibration changed while its status was checked. Showing the newer saved record.",
          )
        : status,
    );
  }
  private async requestExecutionCancellation(
    state: State,
    job: Job,
    machine: Machine,
    scope: "dispatch" | "calibration",
    reason: string,
  ) {
    const observed = executionCancellationContext(state, job);
    const pending = await mutate(this.store, (s) => {
      const current =
        scope === "calibration" ? s.calibrations?.[job.id] : s.jobs[job.id];
      requireThat(
        current &&
          executionCancellationContext(s, current) === observed &&
          s.machines[machine.id].activeJobId === job.id,
        "CANCELLATION_NOT_CURRENT",
        "The saved attempt changed. Keep it blocked and refresh before requesting cancellation again.",
      );
      s.machines[machine.id].ready = false;
      s.machines[machine.id].paused = true;
      record(current, "execution_cancellation_requested", reason);
      return executionCancellationContext(s, current);
    });
    const proof = cancellationProof(
      await this.node.call(
        "cancel_before_acceptance",
        {
          ...this.node.token(job, machine, "cancel_before_acceptance", {
            targetScope: scope,
          }),
          machine_id: machine.id,
          job_id: job.id,
          attempt_id: job.attemptId,
          artifact_sha256: job.artifact.sha256,
          parameters: parameters(job),
          target_scope: scope,
        },
        machine,
      ),
      job,
      machine,
      scope,
    );
    return { pending, proof };
  }
  async rejectCalibration(machineId: string, body: any) {
    const state = await this.read();
    const { machine, calibration, reason } = calibrationRetirement(
      state,
      machineId,
      body,
    );
    requireThat(
      calibration.productionState === "produced" &&
        !calibration.calibrationInspection,
      "CALIBRATION_NOT_COMPLETED",
      "Only the current completed calibration output can be rejected as unusable.",
    );
    const observed = calibrationOperationContext(
      state,
      machineId,
      calibration.id,
    );
    const pending = await mutate(this.store, (s) => {
      requireThat(
        calibrationOperationContext(s, machineId, calibration.id) === observed,
        "CALIBRATION_NOT_CURRENT",
        "The calibration changed before inspection. Refresh its saved result.",
      );
      s.machines[machineId].ready = false;
      s.machines[machineId].paused = true;
      s.machines[machineId].calibrated = false;
      record(
        s.calibrations![calibration.id],
        "calibration_rejection_requested",
        reason,
      );
      return calibrationOperationContext(s, machineId, calibration.id);
    });
    const result = await this.node.call(
      "/reconcile",
      {
        machine_id: machineId,
        job_id: calibration.id,
        attempt_id: calibration.attemptId,
        inspected: true,
        result: "completed",
        reason,
      },
      machine,
    );
    requireThat(
      result &&
        result.machine_id === machineId &&
        result.job_id === calibration.id &&
        result.attempt_id === calibration.attemptId &&
        result.mode === machine.mode &&
        result.execution_status === "completed" &&
        result.stop_pending === false,
      "CALIBRATION_COMPLETION_UNCONFIRMED",
      "The node did not confirm that this exact completed execution has settled. Keep the calibration blocked and refresh its status.",
      502,
    );
    const retired = await mutate(this.store, (s) => {
      requireThat(
        calibrationOperationContext(s, machineId, calibration.id) === pending,
        "CALIBRATION_NOT_CURRENT",
        "The calibration changed while inspection was recorded. The newer saved state was preserved.",
      );
      const current = s.calibrations![calibration.id],
        m = s.machines[machineId];
      observeMediaEstimate(s, current, mediaEstimateSnapshot(machine), result);
      if (current.mediaEstimateObserved?.applied === false) return false;
      current.calibrationInspection = {
        outcome: "rejected",
        reason,
        recordedAt: now(),
        attemptId: current.attemptId!,
      };
      record(current, "calibration_output_rejected", reason);
      m.activeJobId = null;
      m.calibrated = false;
      delete m.calibrationAt;
      m.ready = false;
      m.paused = true;
      m.reason =
        "Completed calibration output was inspected and rejected as unusable. Fix the cause before explicitly authorizing a new supervised calibration.";
      return true;
    });
    requireThat(
      retired,
      "CALIBRATION_NOT_CURRENT",
      "The saved stock or policy changed during inspection. This calibration remains active here. Refresh its saved status and explicitly retry the inspection.",
    );
    return this.calibrationStatus(machineId, calibration.checkoutKey);
  }
  async cancelCalibrationBeforeAcceptance(machineId: string, body: any) {
    const state = await this.read();
    const { machine, calibration, reason } = calibrationRetirement(
      state,
      machineId,
      body,
    );
    requireThat(
      calibrationLifecycle(
        state,
        machineId,
        this.machineMode(ownValue(state.machines, machineId)),
        calibration.id,
      ).canRequestCancellation,
      "CALIBRATION_CANCELLATION_UNAVAILABLE",
      "This saved attempt is already known to the node or is no longer eligible. Refresh and resolve its existing execution; never start it again.",
    );
    const { pending, proof } = await this.requestExecutionCancellation(
      state,
      calibration,
      machine,
      "calibration",
      reason,
    );
    await mutate(this.store, (s) => {
      const current = s.calibrations![calibration.id],
        m = s.machines[machineId];
      requireThat(
        executionCancellationContext(s, current) === pending,
        "CANCELLATION_NOT_CURRENT",
        "The saved calibration changed while cancellation was confirmed. The newer state was preserved; refresh its exact record.",
      );
      current.executionCancellation = proof;
      current.productionState = "cancelled";
      record(current, "calibration_cancelled_before_acceptance", reason);
      m.activeJobId = null;
      m.calibrated = false;
      delete m.calibrationAt;
      m.ready = false;
      m.paused = true;
      m.reason =
        "The node confirmed this exact calibration authorization was cancelled before acceptance. A new supervised calibration requires fresh explicit authorization.";
    });
    return this.calibrationStatus(machineId, calibration.checkoutKey);
  }
  async resolveCalibration(machineId: string, body: any) {
    requireThat(
      body.inspected === true &&
        ["completed", "failed"].includes(body.result) &&
        typeof body.reason === "string" &&
        body.reason.trim().length >= 10,
      "INSPECTION_REQUIRED",
      "Record the observed result, inspection and a specific reason.",
    );
    const s = await this.read(),
      m = ownValue(s.machines, machineId);
    requireThat(m, "NOT_FOUND", "Machine not found.", 404);
    const c = Object.values(s.calibrations ?? {}).find(
      (c) => c.machineId === machineId && c.attemptId === body.attemptId,
    );
    requireThat(
      c,
      "CALIBRATION_NOT_FOUND",
      "This calibration attempt does not belong to the machine.",
    );
    requireThat(
      m.activeJobId === c.id,
      "CALIBRATION_NOT_CURRENT",
      "This calibration is no longer the active machine attempt. Refresh before resolving it.",
    );
    const observed = calibrationOperationContext(s, machineId, c.id);
    const pending = await mutate(this.store, (state) => {
      requireThat(
        calibrationOperationContext(state, machineId, c.id) === observed,
        "CALIBRATION_NOT_CURRENT",
        "The machine or calibration changed before resolution. Refresh before inspecting again.",
      );
      record(
        state.calibrations![c.id],
        "calibration_resolution_requested",
        "Owner requested a recorded resolution of this exact attempt.",
      );
      return calibrationOperationContext(state, machineId, c.id);
    });
    const result = await this.node.call(
      "/reconcile",
      {
        machine_id: machineId,
        job_id: c.id,
        attempt_id: c.attemptId,
        inspected: true,
        result: body.result,
        reason: body.reason,
      },
      m,
    );
    const resolved = await mutate(this.store, (s) => {
      const current = s.calibrations![c.id];
      requireThat(
        calibrationOperationContext(s, machineId, c.id) === pending,
        "CALIBRATION_NOT_CURRENT",
        "The machine moved to another attempt while this calibration was being resolved.",
      );
      observeMediaEstimate(s, current, mediaEstimateSnapshot(m), result);
      if (
        body.result === "failed" &&
        current.mediaEstimateObserved?.applied === false
      )
        return false;
      current.productionState =
        body.result === "completed" ? "produced" : "failed";
      record(current, "calibration_operator_resolution", body.reason);
      if (body.result === "failed") {
        s.machines[machineId].activeJobId = null;
        s.machines[machineId].calibrated = false;
        s.machines[machineId].reason =
          "Calibration failed; inspect and fix before repeating a newly authorized calibration.";
      }
      return true;
    });
    requireThat(
      resolved,
      "CALIBRATION_NOT_CURRENT",
      "The saved stock or policy changed during inspection. This calibration remains active here. Refresh its saved status and explicitly retry the inspection.",
    );
    return this.calibrationStatus(machineId);
  }
  async create(
    requesterId: string,
    input: unknown,
    artifact: Job["artifact"],
    key?: string,
  ) {
    return (await this.createWithResult(requesterId, input, artifact, key)).job;
  }
  async createWithResult(
    requesterId: string,
    input: unknown,
    artifact: Job["artifact"],
    key?: string,
  ) {
    const { spec, request } = parseJobCreation(input, key);
    return mutate(this.store, (s) => {
      const existing = request && findCreatedJob(s, requesterId, request);
      if (existing) return { job: existing, created: false };
      if (spec.outputType === "3d") this.validateCatalog(spec, artifact);
      for (const a of spec.assetIds)
        requireThat(
          ownValue(s.assets, a)?.ownerId === requesterId ||
            (spec.outputType === "3d" &&
              ownValue(s.assets, a)?.ownerId === "catalog"),
          "ASSET_ACCESS",
          "Upload your own artwork first.",
          403,
        );
      const timestamp = now();
      const job: Job = {
        id: id("job"),
        requesterId,
        ...(request
          ? {
              creationRequestId: request.id,
              creationSpecHash: request.specHash,
            }
          : {}),
        machineId: null,
        specVersion: 1,
        spec,
        artifact,
        productionState:
          spec.permission === "unclear" ? "needs_review" : "specified",
        paymentState: "unpaid",
        fulfillmentState: "unprepared",
        history: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      record(
        job,
        "specified",
        spec.permission === "unclear"
          ? "Artwork permission needs operator review."
          : "Production preview prepared; approve it before quoting.",
      );
      s.jobs[job.id] = job;
      return { job, created: true };
    });
  }
  validateCatalog(spec: Spec, artifact: Job["artifact"]) {
    const model = this.config.catalog?.find(
      (m) => m.id === spec.preparedModelId,
    );
    requireThat(
      model &&
        model.widthMm === spec.widthMm &&
        model.heightMm === spec.heightMm &&
        model.depthMm === spec.depthMm &&
        model.color === spec.color &&
        model.estimatedSeconds === spec.estimatedSeconds &&
        model.material === spec.material &&
        spec.assetIds.length === 1 &&
        spec.assetIds[0] === model.artifactId &&
        artifact.sha256 === model.sha256,
      "MODEL_UNCONFIGURED",
      "Choose the exact dimensions, material and artifact from the reviewed prepared model catalog.",
      422,
    );
  }
  async revise(
    jobId: string,
    input: unknown,
    artifact: Job["artifact"],
    observed?: Pick<Job, "version" | "specVersion">,
  ) {
    const spec = specSchema.parse(input);
    if (spec.outputType === "3d") this.validateCatalog(spec, artifact);
    const baseline = observed ?? (await this.job(jobId));
    const expected = {
      version: baseline.version,
      specVersion: baseline.specVersion,
    };
    return mutate(this.store, (s) => {
      const j = s.jobs[jobId];
      requireThat(
        j.paymentState === "unpaid" &&
          !j.attemptId &&
          j.productionState !== "cancelled",
        "LOCKED",
        "A cancelled, paid or dispatched specification cannot be edited.",
      );
      requireThat(
        j.version === expected.version &&
          j.specVersion === expected.specVersion,
        "STALE_SPECIFICATION",
        "This order changed while its preview was being prepared. Refresh the existing order before editing again.",
        409,
      );
      for (const a of spec.assetIds)
        requireThat(
          ownValue(s.assets, a)?.ownerId === j.requesterId ||
            (spec.outputType === "3d" &&
              ownValue(s.assets, a)?.ownerId === "catalog"),
          "ASSET_ACCESS",
          "Artwork is not owned by this requester.",
          403,
        );
      if (j.machineId && s.machines[j.machineId]?.reservation?.jobId === j.id)
        delete s.machines[j.machineId].reservation;
      j.spec = spec;
      j.specVersion++;
      j.artifact = artifact;
      delete j.approvedSpecHash;
      delete j.quote;
      j.machineId = null;
      j.productionState =
        spec.permission === "unclear" ? "needs_review" : "specified";
      record(
        j,
        "approval_invalidated",
        "Artwork or specification changed; approve the new production preview.",
      );
      return j;
    });
  }
  async approve(jobId: string, body: any) {
    return mutate(this.store, (s) => this.approveInState(s, jobId, body));
  }
  private approveInState(s: State, jobId: string, body: any) {
    const j = s.jobs[jobId];
    requireThat(
      j.spec.permission === "authorized",
      "CONTENT_REVIEW",
      "An operator must resolve unclear artwork permission before checkout.",
    );
    requireThat(
      j.paymentState === "unpaid" &&
        !j.attemptId &&
        j.productionState !== "cancelled",
      "LOCKED",
      "This order cannot be reapproved.",
    );
    requireThat(
      body.specVersion === j.specVersion &&
        body.artifactSha256 === j.artifact.sha256,
      "STALE_APPROVAL",
      "Approve the current preview and specification.",
    );
    const currentHash = specificationHash(j);
    // Retried approval must preserve a quote and its reservation instead of
    // moving an already quoted order back to a state checkout cannot use.
    if (
      j.approvedSpecHash === currentHash &&
      ["approved", "quoted"].includes(j.productionState)
    )
      return j;
    j.approvedSpecHash = currentHash;
    j.productionState = "approved";
    record(
      j,
      "specification_approved",
      "Requester approved the exact production artifact and parameters.",
    );
    return j;
  }
  async quote(jobId: string, autoAccept = false) {
    return mutate(this.store, (s) => this.quoteInState(s, jobId, autoAccept));
  }
  private quoteInState(
    s: State,
    jobId: string,
    autoAccept: boolean,
    preserveLiveReplay = false,
  ) {
    const j = s.jobs[jobId];
    requireThat(
      j.approvedSpecHash === specificationHash(j),
      "APPROVAL_REQUIRED",
      "Approve the current production preview first.",
    );
    requireThat(
      j.paymentState === "unpaid" && !j.attemptId,
      "LOCKED",
      "This order already has a payment or dispatch.",
    );
    requireThat(
      ["approved", "quoted"].includes(j.productionState),
      "ORDER_CLOSED",
      "Only an approved active order can be quoted.",
    );
    const reservedMachine = ownValue(s.machines, j.machineId ?? "");
    const liveQuote =
      j.quote &&
      Date.parse(j.quote.expiresAt) > Date.now() &&
      reservedMachine?.reservation?.jobId === j.id &&
      (!preserveLiveReplay ||
        (j.quote.specHash === j.approvedSpecHash &&
          (!j.spec.recommendedMachineId ||
            reservedMachine.id === j.spec.recommendedMachineId) &&
          Date.parse(reservedMachine.reservation.expiresAt) > Date.now()))
        ? j.quote
        : null;
    // A lost reply may be retried after readiness changes. Returning an already
    // saved live quote authorizes no new work; checkout rechecks readiness.
    if (preserveLiveReplay && liveQuote && (!autoAccept || liveQuote.accepted))
      return j;
    if (j.spec.recommendedMachineId) {
      const recommended = ownValue(s.machines, j.spec.recommendedMachineId);
      requireThat(
        recommended &&
          this.modeAllowed(this.jobMode(j)) &&
          machineSupportsSpec(
            recommended,
            j.spec,
            this.jobMode(j),
            Date.now(),
            j.id,
          ),
        "RECOMMENDED_MACHINE_UNAVAILABLE",
        "The recommended machine is no longer available for this artwork. Request and approve a fresh recommendation before quoting; another machine was not substituted.",
      );
    }
    if (liveQuote) {
      if (autoAccept) {
        requireThat(
          j.spec.budgetMandate?.enabled &&
            liveQuote.totalCents <= j.spec.budgetMandate.capCents,
          "MANDATE_REQUIRED",
          "Automatic acceptance needs an explicit mandate covering the approved quote.",
        );
        if (!preserveLiveReplay || !liveQuote.accepted) {
          liveQuote.accepted = true;
          record(
            j,
            "mandate_accepted",
            "Existing approved quote accepted within explicit budget mandate.",
          );
        }
      }
      return j;
    }
    const machine = Object.values(s.machines)
      .filter(
        (m) =>
          (!j.spec.recommendedMachineId ||
            m.id === j.spec.recommendedMachineId) &&
          this.modeAllowed(this.jobMode(j)) &&
          machineSupportsSpec(m, j.spec, this.jobMode(j)),
      )
      .sort((a, b) => this.price(a, j) - this.price(b, j))[0];
    requireThat(
      machine,
      "NO_MACHINE",
      "No ready machine supports this output. Ask the owner to calibrate, list and resume a matching machine.",
    );
    const card = machine.priceCard;
    const items = [
      { label: "Consumables", cents: card.consumables * j.spec.quantity },
      { label: "Machine time", cents: card.machine * j.spec.quantity },
      { label: "Owner handling", cents: card.handling },
      { label: "Platform fee", cents: card.platform },
    ];
    const totalCents = items.reduce((a, b) => a + b.cents, 0);
    if (autoAccept)
      requireThat(
        j.spec.budgetMandate?.enabled &&
          totalCents <= j.spec.budgetMandate.capCents,
        "MANDATE_REQUIRED",
        "Automatic acceptance needs an explicit budget mandate covering this approved quote.",
      );
    const expiresAt = new Date(Date.now() + this.config.quoteMs).toISOString();
    j.machineId = machine.id;
    j.quote = {
      id: id("quote"),
      version: (j.quote?.version ?? 0) + 1,
      expiresAt,
      specHash: j.approvedSpecHash!,
      items,
      totalCents,
      ownerCents: totalCents - card.platform,
      platformCents: card.platform,
      currency: "USD",
      paymentMode: this.config.paymentMode,
      collectionPoint: machine.collectionPoint,
      accepted: autoAccept,
    };
    machine.reservation = { jobId: j.id, expiresAt };
    j.productionState = "quoted";
    record(
      j,
      "quoted",
      "Machine reserved until quote expiry. Prices are an unmeasured development price card.",
    );
    return j;
  }
  async approveAndQuote(
    jobId: string,
    body: {
      artifactSha256: string;
      specVersion: number;
      recommendedMachineId: string | null;
      autoAccept?: boolean;
    },
  ) {
    requireThat(
      body &&
        typeof body === "object" &&
        typeof body.artifactSha256 === "string" &&
        /^[a-f0-9]{64}$/.test(body.artifactSha256) &&
        Number.isSafeInteger(body.specVersion) &&
        body.specVersion > 0 &&
        (body.recommendedMachineId === null ||
          (typeof body.recommendedMachineId === "string" &&
            /^[A-Za-z0-9_-]{1,128}$/.test(body.recommendedMachineId))) &&
        (body.autoAccept === undefined || typeof body.autoAccept === "boolean"),
      "INVALID_APPROVAL",
      "Confirm the displayed production artifact, specification version and recommended machine before requesting its quote.",
      422,
    );
    return mutate(this.store, (s) => {
      const j = ownValue(s.jobs, jobId);
      requireThat(j, "NOT_FOUND", "Order not found.", 404);
      requireThat(
        (j.spec.recommendedMachineId ?? null) === body.recommendedMachineId,
        "STALE_APPROVAL",
        "The recommended machine changed. Review the current production preview before requesting a quote.",
      );
      this.approveInState(s, jobId, body);
      return this.quoteInState(s, jobId, body.autoAccept === true, true);
    });
  }
  price(m: Machine, j: Job) {
    return (
      (m.priceCard.consumables + m.priceCard.machine) * j.spec.quantity +
      m.priceCard.handling +
      m.priceCard.platform
    );
  }
  inHours(m: Machine) {
    const h = new Date().getUTCHours();
    return m.hours.start <= h && h < m.hours.end;
  }
  private checkoutPrerequisites(state: State, job: Job) {
    const machine = ownValue(state.machines, job.machineId ?? "");
    requireThat(
      machine &&
        machine.reservation?.jobId === job.id &&
        Date.parse(machine.reservation.expiresAt) > Date.now(),
      "RESERVATION_EXPIRED",
      "The machine reservation expired. Request a new quote.",
    );
    requireThat(
      machine.outputType === job.spec.outputType &&
        (!job.spec.recommendedMachineId ||
          machine.id === job.spec.recommendedMachineId) &&
        machine.mode === this.jobMode(job) &&
        this.modeAllowed(machine.mode) &&
        machine.paired &&
        machine.configured &&
        machine.calibrated &&
        machine.listed &&
        machine.ready &&
        !machine.paused &&
        !machine.activeJobId &&
        !machine.policyReconciliationRequired &&
        this.inHours(machine),
      "MACHINE_NOT_READY",
      "The reserved machine is not ready. No new payment was requested. Ask the owner to restore readiness, or cancel this unpaid order.",
    );
    requireThat(
      machine.mediaRemaining >= job.spec.quantity &&
        machine.material === job.spec.material &&
        machine.policy.maxQuantity >= job.spec.quantity &&
        machine.policy.authorizedArtwork &&
        (job.spec.outputType !== "3d" ||
          (job.spec.estimatedSeconds ?? Infinity) <= machine.maxJobSeconds),
      "POLICY_CHANGED",
      "The saved media or owner policy no longer supports this order. No new payment was requested. Ask the owner to restore it, or cancel and revise the order.",
    );
  }
  async checkout(jobId: string, key: string, payload?: any) {
    requireThat(
      typeof key === "string" && key.length >= 8 && key.length <= 200,
      "IDEMPOTENCY_REQUIRED",
      "Checkout needs a stable idempotency key.",
      422,
    );
    const state = await this.read();
    const current = ownValue(state.jobs, jobId);
    requireThat(current, "NOT_FOUND", "Order not found.", 404);
    if (current.paymentState !== "unpaid") {
      requireThat(
        current.checkoutKey === key,
        "CHECKOUT_EXISTS",
        "Use the existing checkout for this order.",
      );
      return current;
    }
    requireThat(
      current.productionState === "quoted" &&
        current.quote &&
        current.quote.specHash === current.approvedSpecHash,
      "QUOTE_REQUIRED",
      "Get a current approved quote before checkout.",
    );
    requireThat(
      Date.parse(current.quote.expiresAt) > Date.now(),
      "QUOTE_EXPIRED",
      "This quote expired. Request a new quote before paying.",
    );
    this.checkoutPrerequisites(state, current);
    if (this.payment.mode === "testnet" && !payload && this.payment.challenge) {
      const challenge = await this.payment.challenge(current);
      const latestState = await this.read();
      const latest = ownValue(latestState.jobs, jobId);
      requireThat(latest, "NOT_FOUND", "Order not found.", 404);
      if (latest.paymentState !== "unpaid") {
        requireThat(
          latest.checkoutKey === key,
          "CHECKOUT_EXISTS",
          "Use the existing checkout for this order.",
        );
        return latest;
      }
      requireThat(
        latest.productionState === "quoted" &&
          latest.quote?.id === current.quote.id &&
          latest.quote.specHash === specificationHash(latest) &&
          latest.approvedSpecHash === latest.quote.specHash,
        "QUOTE_REQUIRED",
        "The order changed while checkout was being prepared. Get the current approved quote before paying.",
      );
      requireThat(
        Date.parse(latest.quote.expiresAt) > Date.now(),
        "QUOTE_EXPIRED",
        "This quote expired. Request a new quote before paying.",
      );
      this.checkoutPrerequisites(latestState, latest);
      throw Object.assign(
        new Problem(
          "PAYMENT_REQUIRED",
          "Base Sepolia test payment is required.",
          402,
        ),
        { challenge },
      );
    }
    const op = await mutate(this.store, (s) => {
      const j = s.jobs[jobId];
      if (j.paymentState !== "unpaid") {
        requireThat(
          j.checkoutKey === key,
          "CHECKOUT_EXISTS",
          "Use the existing checkout.",
        );
        return null;
      }
      requireThat(
        j.productionState === "quoted",
        "ORDER_CLOSED",
        "Only an active quoted order can enter checkout.",
      );
      requireThat(
        j.quote &&
          j.quote.specHash === specificationHash(j) &&
          j.approvedSpecHash === j.quote.specHash,
        "QUOTE_REQUIRED",
        "Get a current quote first.",
      );
      requireThat(
        Date.parse(j.quote.expiresAt) > Date.now(),
        "QUOTE_EXPIRED",
        "This quote expired. Request a new quote before paying.",
      );
      this.checkoutPrerequisites(s, j);
      j.checkoutKey = key;
      j.quote.accepted = true;
      j.paymentState = "collection_pending";
      record(
        j,
        "collection_pending",
        "Payment collection is awaiting confirmation.",
      );
      const operation: Operation = {
        id: `collect:${j.id}:${j.quote.id}:${id("collection_attempt")}`,
        jobId: j.id,
        kind: "collection",
        status: "submitting",
        createdAt: now(),
        updatedAt: now(),
        amountCents: j.quote.totalCents,
        mode: this.payment.mode,
      };
      s.operations[operation.id] = operation;
      j.collectionOperationId = operation.id;
      return operation;
    });
    if (op) {
      try {
        await this.applyPayment(
          op.id,
          await this.payment.collect(await this.job(jobId), op, payload),
        );
      } catch (e) {
        if ((e as any).safeToRetry === true)
          await this.applyPayment(op.id, {
            status: "failed",
            reference: `unsubmitted:${op.id}`,
            reason: `Payment was not collected. ${(e as Error).message}`,
          });
        else
          await this.pending(
            op.id,
            `Collection outcome unknown: ${(e as Error).message}`,
          );
      }
    }
    return this.job(jobId);
  }
  async pending(operationId: string, reason: string) {
    await mutate(this.store, (s) => {
      const op = s.operations[operationId];
      if (op.status === "confirmed" || op.status === "failed") return;
      op.status = "pending";
      op.reason = reason;
      op.updatedAt = now();
      record(s.jobs[op.jobId], "payment_pending", reason);
    });
  }
  async applyPayment(operationId: string, result: PaymentResult) {
    await mutate(this.store, (s) => {
      const op = s.operations[operationId];
      if (
        op.status === "confirmed" ||
        (op.status === "failed" && result.status !== "confirmed")
      )
        return;
      const j = s.jobs[op.jobId];
      if (
        op.kind === "collection" &&
        j.collectionOperationId &&
        j.collectionOperationId !== op.id
      ) {
        requireThat(
          result.status !== "confirmed",
          "STALE_COLLECTION",
          "An earlier failed collection cannot fund a later attempt; operator review required.",
        );
        return;
      }
      if (result.status === "confirmed") {
        const previous = s.paymentReferences[result.reference];
        requireThat(
          !previous || previous === op.id,
          "PAYMENT_REPLAY",
          "This payment reference is already assigned to another operation.",
        );
        s.paymentReferences[result.reference] = op.id;
      }
      Object.assign(op, result, { updatedAt: now() });
      if (result.status === "pending") {
        record(
          j,
          "payment_pending",
          result.reason ?? "Awaiting transaction confirmation.",
        );
        return;
      }
      if (result.status === "failed") {
        if (op.kind === "collection") {
          j.paymentState = "unpaid";
          delete j.checkoutKey;
        }
        record(
          j,
          "payment_failed",
          result.reason ??
            "Payment operation failed; operator reconciliation required.",
        );
        return;
      }
      if (op.kind === "collection") {
        if (result.receipt?.payer) j.requesterAddress = result.receipt.payer;
        j.paymentState = "held";
        const m = s.machines[j.machineId!];
        const valid =
          j.productionState !== "cancelled" &&
          j.quote &&
          Date.parse(j.quote.expiresAt) > Date.now() &&
          m.reservation?.jobId === j.id &&
          !m.activeJobId;
        if (valid) j.productionState = "payment_confirmed";
        else {
          j.paymentState = "refund_pending";
          j.productionState =
            j.productionState === "cancelled" ? "cancelled" : "needs_review";
          if (m.reservation?.jobId === j.id) delete m.reservation;
          record(
            j,
            "late_payment",
            "Collection confirmed after reservation expiry or cancellation; refund pending, dispatch prohibited.",
          );
        }
      }
      if (op.kind === "release") j.paymentState = "released";
      if (op.kind === "refund") j.paymentState = "refunded";
      record(
        j,
        `${op.kind}_confirmed`,
        result.reason ?? "Transaction confirmed.",
      );
    });
    const j = await this.job((await this.read()).operations[operationId].jobId);
    if (j.paymentState === "refund_pending")
      await this.transfer(j.id, "refund");
  }
  async transfer(jobId: string, kind: "release" | "refund") {
    // Estimate-only simulated children never collected funds to move.
    if ((await this.job(jobId)).chargeable === false) return this.job(jobId);
    const op = await mutate(this.store, (s) => {
      const j = s.jobs[jobId];
      const existing = Object.values(s.operations).find(
        (o) => o.jobId === j.id && o.kind === kind,
      );
      if (existing) {
        if (
          existing.status === "failed" &&
          existing.retryable === true &&
          !existing.transactionHash
        ) {
          existing.status = "submitting";
          existing.retryable = false;
          existing.updatedAt = now();
          record(
            j,
            `${kind}_retry`,
            "Retrying a definite pre-submission prerequisite failure using the same allocation.",
          );
          return existing;
        }
        return null;
      }
      const other = Object.values(s.operations).find(
        (o) =>
          o.jobId === j.id &&
          o.kind === (kind === "release" ? "refund" : "release"),
      );
      requireThat(
        !other,
        "LEDGER_CONFLICT",
        "Release and refund are mutually exclusive.",
      );
      requireThat(
        [
          "held",
          kind === "release" ? "release_pending" : "refund_pending",
        ].includes(j.paymentState),
        "NOT_HELD",
        "A confirmed collected hold is required.",
      );
      if (kind === "release")
        requireThat(
          j.evidence?.result === "pass",
          "VERIFICATION_REQUIRED",
          "Only passing verified output can release funds.",
        );
      const operation: Operation = {
        id: `${kind}:${j.id}`,
        jobId: j.id,
        kind,
        status: "submitting",
        createdAt: now(),
        updatedAt: now(),
        amountCents:
          kind === "release" ? j.quote!.ownerCents : j.quote!.totalCents,
        mode: this.payment.mode,
      };
      s.operations[operation.id] = operation;
      j.paymentState =
        kind === "release" ? "release_pending" : "refund_pending";
      record(
        j,
        `${kind}_pending`,
        "Ledger allocated; transfer confirmation pending.",
      );
      return operation;
    });
    if (!op) return this.job(jobId);
    try {
      const s = await this.read();
      await this.applyPayment(
        op.id,
        await this.payment.transfer(
          s.jobs[jobId],
          s.machines[s.jobs[jobId].machineId!],
          op,
        ),
      );
    } catch (e) {
      const message = (e as Error).message;
      const stored = (await this.read()).operations[op.id];
      if (
        !stored.transactionHash &&
        !stored.receipt &&
        ((e as any).safeToRetry === true ||
          /^(TREASURY_PRIVATE_KEY_REQUIRED|OWNER_ADDRESS_REQUIRED|REQUESTER_ADDRESS_REQUIRED|WRONG_CHAIN|TREASURY_KEY_ADDRESS_MISMATCH)/.test(
            message,
          ))
      ) {
        await mutate(this.store, (s) => {
          const allocation = s.operations[op.id];
          allocation.status = "failed";
          allocation.retryable = true;
          allocation.reason = `Transfer not submitted: ${message}`;
          allocation.updatedAt = now();
          record(s.jobs[jobId], "transfer_blocked", allocation.reason);
        });
      } else await this.pending(op.id, `Transfer outcome unknown: ${message}`);
    }
    return this.job(jobId);
  }
  async attachConfirmedPaymentReference(
    jobId: string,
    operationId: string,
    transactionHash: string,
    reason: string,
  ) {
    requireThat(
      /^0x[0-9a-fA-F]{64}$/.test(transactionHash) &&
        reason?.trim().length >= 10,
      "REFERENCE_REQUIRED",
      "Supply a transaction hash and a specific reconciliation reason.",
      422,
    );
    const state = await this.read(),
      j = state.jobs[jobId],
      op = ownValue(state.operations, operationId);
    requireThat(
      this.payment.mode === "testnet" &&
        op?.jobId === jobId &&
        op.receipt &&
        ["pending", "submitting"].includes(op.status),
      "NOT_PENDING",
      "Only a recorded pending testnet operation can be reconciled by reference.",
    );
    requireThat(
      !op.transactionHash ||
        op.transactionHash.toLowerCase() === transactionHash.toLowerCase(),
      "REFERENCE_CONFLICT",
      "Reconcile the already recorded transaction hash; replacements are not permitted.",
    );
    const candidate = {
      ...op,
      transactionHash,
      receipt: { ...op.receipt, transactionHash },
    };
    const result = await this.payment.reconcile(
      j,
      state.machines[j.machineId!],
      candidate,
    );
    requireThat(
      result.status === "confirmed",
      "REFERENCE_UNCONFIRMED",
      "This transaction is not confirmed as the exact expected Base Sepolia token transfer. The existing operation remains pending.",
    );
    await mutate(this.store, (s) =>
      record(s.jobs[jobId], "operator_payment_reconciliation", reason),
    );
    await this.applyPayment(op.id, result);
    return this.job(jobId);
  }
  async cancel(jobId: string) {
    const j = await mutate(this.store, (s) => {
      const j = s.jobs[jobId];
      if (j.productionState === "cancelled") return j;
      requireThat(
        !j.attemptId &&
          ![
            "dispatched",
            "running",
            "verifying",
            "produced",
            "failed",
          ].includes(j.productionState),
        "DISPATCH_STARTED",
        "Dispatch has started. Ask the owner to resolve the order; cancellation cannot confirm physical stoppage.",
      );
      j.productionState = "cancelled";
      if (j.paymentState === "held") j.paymentState = "refund_pending";
      if (j.machineId && s.machines[j.machineId].reservation?.jobId === j.id)
        delete s.machines[j.machineId].reservation;
      record(
        j,
        "cancelled",
        j.paymentState === "refund_pending"
          ? "Cancelled before dispatch; refund pending confirmation."
          : "Cancelled before dispatch. Any pending collection must reconcile.",
      );
      return j;
    });
    if (j.paymentState === "refund_pending")
      await this.transfer(j.id, "refund");
    return this.job(jobId);
  }
  assetUrl(assetId: string) {
    const expires = Math.floor(Date.now() / 1000) + 300;
    const sig = createHmac("sha256", this.config.secret)
      .update(`${assetId}:${expires}`)
      .digest("hex");
    return `${this.config.assetOrigin}/${assetId}?expires=${expires}&sig=${sig}`;
  }
  async dispatch(jobId: string) {
    const result = await mutate(this.store, (s) => {
      const j = s.jobs[jobId];
      if (j.attemptId) return { job: j, start: false };
      requireThat(
        (j.paymentState === "held" &&
          j.productionState === "payment_confirmed") ||
          (j.chargeable === false &&
            j.paymentState === "not_charged" &&
            j.productionState === "authorized"),
        "UNPAID",
        "A confirmed collected payment is required before dispatch.",
      );
      requireThat(
        j.quote &&
          j.approvedSpecHash === specificationHash(j) &&
          j.quote.specHash === j.approvedSpecHash,
        "STALE_ARTIFACT",
        "Specification approval no longer matches the artifact.",
      );
      const m = s.machines[j.machineId!];
      requireThat(
        m.mode === this.jobMode(j) && this.modeAllowed(m.mode),
        "MODE_MISMATCH",
        "This job's execution mode no longer matches its machine. Nothing was sent; review the order.",
      );
      requireThat(
        m.ready &&
          !m.paused &&
          m.calibrated &&
          m.listed &&
          m.reservation?.jobId === j.id &&
          Date.parse(m.reservation.expiresAt) > Date.now() &&
          !m.activeJobId &&
          this.inHours(m),
        "MACHINE_NOT_READY",
        "The reserved machine is no longer ready. Reconcile or refund this held payment.",
      );
      requireThat(
        m.mediaRemaining >= j.spec.quantity &&
          m.policy.maxQuantity >= j.spec.quantity &&
          m.material === j.spec.material &&
          m.policy.authorizedArtwork,
        "POLICY_CHANGED",
        "The owner policy or media no longer supports this job.",
      );
      m.activeJobId = j.id;
      m.ready = false;
      delete m.reservation;
      j.attemptId = id("attempt");
      j.mediaEstimateBaseline = mediaEstimateSnapshot(m).fingerprint;
      j.productionState = "dispatched";
      record(
        j,
        "dispatch_authorized",
        "Execution attempt persisted before contacting the node. Cancellation and dispatch are resolved atomically.",
      );
      return { job: j, start: true };
    });
    if (!result.start) return result.job;
    const s = await this.read();
    const j = s.jobs[jobId],
      m = s.machines[j.machineId!];
    try {
      const baseline = await this.node.call(
        "camera_snapshot",
        {
          token: this.node.token(j, m, "camera").token,
          machine_id: m.id,
          job_id: j.id,
          attempt_id: j.attemptId,
          phase: "baseline",
        },
        m,
      );
      await mutate(this.store, (s) => {
        s.jobs[jobId].baseline = baseline;
      });
    } catch (e) {
      await mutate(this.store, (s) =>
        record(s.jobs[jobId], "baseline_unavailable", (e as Error).message),
      );
    }
    try {
      const response = await this.node.call(
        "run_job",
        {
          ...this.node.token(j, m, "dispatch"),
          job_id: j.id,
          attempt_id: j.attemptId,
          machine_id: m.id,
          artifact_url: this.assetUrl(j.artifact.id),
          artifact_sha256: j.artifact.sha256,
          parameters: parameters(j),
        },
        m,
      );
      if (response.status === "rejected")
        throw new Error(response.reason ?? "Node rejected execution.");
      await this.applyNodeStatus(jobId, response, mediaEstimateSnapshot(m));
    } catch (e) {
      await this.reviewUncertain(
        jobId,
        `Dispatch acknowledgment uncertain: ${(e as Error).message}. Reconcile this attempt; do not print again.`,
      );
    }
    return this.job(jobId);
  }
  async reviewUncertain(jobId: string, reason: string) {
    await mutate(this.store, (s) => {
      const j = s.jobs[jobId];
      // An earlier request may fail after another reconciler has completed the
      // attempt and the owner has already cleared this machine for its next job.
      if (["produced", "failed", "cancelled"].includes(j.productionState))
        return;
      j.productionState = "needs_review";
      const m = s.machines[j.machineId!];
      m.paused = true;
      m.ready = false;
      m.reason = reason;
      record(j, "execution_uncertain", reason);
    });
  }
  async applyNodeStatus(
    jobId: string,
    response: any,
    mediaSnapshot?: ReturnType<typeof mediaEstimateSnapshot>,
  ) {
    const execution =
      response.execution_status ?? response.executionStatus ?? response.state;
    await mutate(this.store, (s) => {
      const j = s.jobs[jobId];
      if (mediaSnapshot) observeMediaEstimate(s, j, mediaSnapshot, response);
      if (["produced", "failed"].includes(j.productionState)) return;
      if (execution === "completed") {
        if (response.completion_credible !== true) {
          j.productionState = "needs_review";
          s.machines[j.machineId!].paused = true;
          s.machines[j.machineId!].ready = false;
          record(
            j,
            "completion_review",
            "Device completion is not independently credible; owner review required.",
          );
          return;
        }
        j.deviceCompletedAt = response.completed_at ?? now();
        j.productionState = "verifying";
        record(
          j,
          "device_completed",
          "Node reports credible completion; fresh evidence still required.",
        );
      } else if (["uncertain", "unknown"].includes(execution)) {
        j.productionState = "needs_review";
        const m = s.machines[j.machineId!];
        m.paused = true;
        m.ready = false;
        m.reason = "Execution may have started. Owner reconciliation required.";
        record(j, "execution_uncertain", response.reason ?? m.reason);
      } else if (execution === "failed") {
        j.productionState = "failed";
        const m = s.machines[j.machineId!];
        m.paused = true;
        m.ready = false;
        m.reason =
          response.reason ?? "Device failure; inspect before resuming.";
        record(j, "device_failed", m.reason);
      } else if (["running", "started", "accepted"].includes(execution)) {
        // Ignore an older progress response while a credible completion is
        // already awaiting its result frame.
        if (j.productionState === "verifying") return;
        const next = execution === "accepted" ? "dispatched" : "running";
        if (j.productionState !== next) {
          j.productionState = next;
          record(j, "execution_progress", `Node reports ${execution}.`);
        }
      }
    });
    const j = await this.job(jobId);
    if (j.productionState === "verifying") await this.verify(jobId);
    if (j.productionState === "failed" && j.paymentState === "held")
      await this.transfer(jobId, "refund");
  }
  async reconcile(jobId: string) {
    let j = await this.job(jobId);
    const s = await this.read();
    const m = s.machines[j.machineId!];
    for (const op of Object.values(s.operations).filter(
      (o) => o.jobId === jobId && ["pending", "submitting"].includes(o.status),
    )) {
      try {
        await this.applyPayment(op.id, await this.payment.reconcile(j, m, op));
      } catch (e) {
        await this.pending(op.id, (e as Error).message);
      }
    }
    for (const op of Object.values((await this.read()).operations).filter(
      (o) => o.jobId === jobId && o.status === "failed" && o.retryable === true,
    ))
      await this.transfer(jobId, op.kind as "release" | "refund");
    j = await this.job(jobId);
    // A process may stop after the durable production outcome but before its
    // transfer allocation. Recover that boundary from the recorded outcome,
    // while transfer() keeps release/refund allocation mutually exclusive.
    if (j.paymentState === "held") {
      if (j.productionState === "produced" && j.evidence?.result === "pass")
        await this.transfer(jobId, "release");
      else if (j.productionState === "failed")
        await this.transfer(jobId, "refund");
      j = await this.job(jobId);
    }
    if (
      j.paymentState === "refund_pending" &&
      !Object.values((await this.read()).operations).some(
        (o) => o.jobId === jobId && o.kind === "refund",
      )
    )
      await this.transfer(jobId, "refund");
    if (
      j.attemptId &&
      (!["produced", "failed"].includes(j.productionState) ||
        (j.mediaEstimateObserved?.applied === false && m.activeJobId === j.id))
    ) {
      try {
        const status = await this.node.call(
          "get_status",
          { machine_id: m.id, job_id: j.id, attempt_id: j.attemptId },
          m,
        );
        await this.applyNodeStatus(jobId, status, mediaEstimateSnapshot(m));
      } catch (e) {
        await this.reviewUncertain(
          jobId,
          `Node disconnected: ${(e as Error).message}`,
        );
      }
    }
    return this.job(jobId);
  }
  async verify(jobId: string) {
    const j = await this.job(jobId);
    requireThat(
      j.productionState === "verifying",
      "COMPLETION_REQUIRED",
      "Fresh verification requires a credible device completion.",
    );
    const s = await this.read(),
      m = s.machines[j.machineId!];
    let evidence: any;
    try {
      const frame = await this.node.call(
        "camera_snapshot",
        {
          token: this.node.token(j, m, "camera").token,
          machine_id: m.id,
          job_id: j.id,
          attempt_id: j.attemptId,
          phase: "result",
        },
        m,
      );
      const captured = Date.parse(frame.captured_at);
      const fresh =
        Number.isFinite(captured) &&
        captured >= Date.parse(j.deviceCompletedAt ?? j.createdAt) &&
        Date.now() - captured < 60000 &&
        captured <= Date.now() + 1000;
      const associated =
        frame.machine_id === m.id &&
        frame.job_id === j.id &&
        frame.attempt_id === j.attemptId;
      const credible = frame.completion_credible === true && associated;
      let result = "review",
        reason = "Evidence needs operator review.";
      if (!fresh || !credible)
        reason = "Evidence is stale, missing, or completion is not credible.";
      else if (
        (frame.source === "simulation") !==
        (this.jobMode(j) === "simulation")
      )
        reason =
          "The evidence source does not match this job's execution mode; owner review required.";
      else if (
        frame.source === "simulation" &&
        this.jobMode(j) === "simulation" &&
        m.mode === "simulation"
      ) {
        result =
          frame.observation === "visible"
            ? "pass"
            : frame.observation === "missing"
              ? "fail"
              : "review";
        reason =
          result === "pass"
            ? "Simulated visible output after simulated completion."
            : result === "fail"
              ? "Simulated output is missing."
              : "Simulated frame is ambiguous.";
      } else {
        reason =
          "Camera frame captured. Claude verification is unavailable; owner review required.";
        try {
          requireThat(
            this.node.fetchFrame,
            "CAMERA_UNAVAILABLE",
            "Camera fetch boundary unavailable.",
          );
          const state = await this.read();
          const approved = await readFile(state.assets[j.artifact.id].path);
          const bytes = await this.node.fetchFrame(frame.frame_url, m);
          const baseline = j.baseline?.frame_url
            ? await this.node
                .fetchFrame(j.baseline.frame_url, m)
                .catch(() => undefined)
            : undefined;
          const checked = await createClaudeProvider().verifyOutput({
            approvedArtifact: { bytes: approved, mediaType: "image/png" },
            resultFrame: { bytes, mediaType: "image/png" },
            baselineFrame: baseline
              ? { bytes: baseline, mediaType: "image/png" }
              : undefined,
            capturedAt: frame.captured_at,
            completionCredible: credible,
            jobId: j.id,
            machineId: m.id,
            expected: j.spec,
          });
          result = checked.result;
          reason = checked.reason;
        } catch (e) {
          reason = (e as Error).message.includes("CLAUDE_BLOCKED")
            ? "Claude verification is not configured; fresh camera evidence needs owner review."
            : "Automated visual verification is unavailable; owner review required.";
        }
      }
      evidence = {
        url: frame.frame_url,
        capturedAt: frame.captured_at,
        machineId: m.id,
        jobId: j.id,
        attemptId: j.attemptId,
        result,
        reason,
        source: frame.source,
        completionCredible: credible,
        frame,
      };
    } catch (e) {
      evidence = {
        capturedAt: now(),
        machineId: m.id,
        jobId: j.id,
        result: "review",
        reason: `Fresh evidence unavailable: ${(e as Error).message}`,
        source: m.mode === "simulation" ? "simulation" : "camera",
        completionCredible: false,
      };
    }
    await this.resolveEvidence(jobId, evidence);
    return this.job(jobId);
  }
  async resolveEvidence(
    jobId: string,
    evidence: any,
    operatorReason?: string,
    media?: { snapshot: ReturnType<typeof mediaEstimateSnapshot>; status: any },
  ) {
    const accepted = await mutate(this.store, (s) => {
      const j = s.jobs[jobId],
        m = s.machines[j.machineId!];
      // Camera/model requests and owner reviews may overlap. Only the first
      // resolution of the current state may change the outcome or allocate a
      // transfer; a delayed result must never undo handling or pause a new job.
      const expectedState = operatorReason ? "needs_review" : "verifying";
      if (j.productionState !== expectedState) return false;
      if (media) observeMediaEstimate(s, j, media.snapshot, media.status);
      j.evidence = evidence;
      j.productionState =
        evidence.result === "pass"
          ? "produced"
          : evidence.result === "fail"
            ? "failed"
            : "needs_review";
      j.fulfillmentState = "awaiting_owner";
      m.ready = false;
      m.paused = true;
      m.reason =
        evidence.result === "pass"
          ? "Owner must remove, label and store the output, clear the machine, then resume."
          : evidence.reason;
      record(
        j,
        operatorReason
          ? "operator_override"
          : `verification_${evidence.result}`,
        operatorReason ?? evidence.reason,
      );
      return true;
    });
    if (!accepted) return;
    if (evidence.result === "pass") await this.transfer(jobId, "release");
    if (evidence.result === "fail") await this.transfer(jobId, "refund");
  }
  async operatorReview(jobId: string, result: "pass" | "fail", reason: string) {
    requireThat(
      ["pass", "fail"].includes(result),
      "INVALID_REVIEW",
      "Choose pass or fail.",
      422,
    );
    requireThat(
      typeof reason === "string" &&
        reason.trim().length >= 8 &&
        reason.length <= 1000,
      "REASON_REQUIRED",
      "Provide a specific inspection reason between 8 and 1000 characters.",
      422,
    );
    const j = await this.job(jobId);
    requireThat(
      j.productionState === "needs_review",
      "REVIEW_REQUIRED",
      "Only an order awaiting owner review can be resolved.",
    );
    if (j.spec.permission === "unclear" && !j.attemptId) {
      return mutate(this.store, (s) => {
        const current = s.jobs[jobId];
        requireThat(
          current.paymentState === "unpaid" &&
            current.productionState === "needs_review" &&
            current.spec.permission === "unclear" &&
            current.specVersion === j.specVersion &&
            current.artifact.sha256 === j.artifact.sha256 &&
            !current.attemptId,
          "LOCKED",
          "Content review is no longer current. Refresh the order before reviewing it.",
        );
        if (result === "pass") {
          current.spec.permission = "authorized";
          current.specVersion++;
          current.productionState = "specified";
          delete current.approvedSpecHash;
          delete current.quote;
        } else current.productionState = "cancelled";
        record(current, "content_review", reason);
        return current;
      });
    }
    if (!j.evidence) {
      const s = await this.read(),
        m = s.machines[j.machineId!];
      requireThat(
        j.attemptId,
        "EXECUTION_REQUIRED",
        "A reviewed physical attempt is required.",
      );
      let absent = false;
      if (result === "fail") {
        try {
          await this.node.call(
            "get_status",
            { machine_id: m.id, job_id: j.id, attempt_id: j.attemptId },
            m,
          );
        } catch (e) {
          if (
            e instanceof Problem &&
            e.code === "unknown_attempt" &&
            e.status === 404
          )
            absent = true;
          else throw e;
        }
      }
      let resolvedStatus: any;
      if (!absent)
        resolvedStatus = await this.node.call(
          "/reconcile",
          {
            machine_id: m.id,
            job_id: j.id,
            attempt_id: j.attemptId,
            inspected: true,
            result: result === "pass" ? "completed" : "failed",
            reason,
          },
          m,
        );
      else {
        const { pending, proof } = await this.requestExecutionCancellation(
          s,
          j,
          m,
          "dispatch",
          reason,
        );
        await mutate(this.store, (currentState) => {
          const current = currentState.jobs[jobId],
            machine = currentState.machines[m.id];
          requireThat(
            executionCancellationContext(currentState, current) === pending,
            "CANCELLATION_NOT_CURRENT",
            "The saved order changed while cancellation was confirmed. Its newer state and payment were preserved; refresh before deciding what to do next.",
          );
          current.executionCancellation = proof;
          current.evidence = {
            capturedAt: now(),
            machineId: m.id,
            jobId: j.id,
            result: "fail",
            reason:
              "The node durably cancelled this exact authorization before acceptance. " +
              reason,
            source: m.mode,
            completionCredible: false,
            operatorOverride: true,
          };
          current.productionState = "failed";
          current.fulfillmentState = "awaiting_owner";
          machine.ready = false;
          machine.paused = true;
          machine.reason = current.evidence.reason;
          record(current, "operator_override", reason);
        });
        await this.transfer(jobId, "refund");
        return this.job(jobId);
      }
      let evidence: any;
      try {
        const frame = await this.node.call(
          "camera_snapshot",
          {
            token: this.node.token(j, m, "camera").token,
            machine_id: m.id,
            job_id: j.id,
            attempt_id: j.attemptId,
            phase: "result",
          },
          m,
        );
        requireThat(
          frame.machine_id === m.id &&
            frame.job_id === j.id &&
            frame.attempt_id === j.attemptId &&
            Date.parse(frame.captured_at) >= Date.parse(j.createdAt) &&
            Math.abs(Date.now() - Date.parse(frame.captured_at)) < 60000,
          "INVALID_FRAME",
          "The result frame is stale or belongs to another attempt.",
        );
        evidence = {
          url: frame.frame_url,
          capturedAt: frame.captured_at,
          machineId: m.id,
          jobId: j.id,
          source: frame.source,
          completionCredible: frame.completion_credible,
          frame,
          result,
          reason,
          operatorOverride: true,
        };
      } catch (e) {
        requireThat(
          result === "fail",
          "EVIDENCE_REQUIRED",
          "A passing override requires a usable fresh result frame.",
        );
        evidence = {
          capturedAt: now(),
          machineId: m.id,
          jobId: j.id,
          result: "fail",
          source: m.mode,
          completionCredible: false,
          reason,
          operatorOverride: true,
        };
      }
      await this.resolveEvidence(jobId, evidence, reason, {
        snapshot: mediaEstimateSnapshot(m),
        status: resolvedStatus,
      });
      return this.job(jobId);
    }
    await this.resolveEvidence(
      jobId,
      {
        ...j.evidence,
        result,
        reason: `Owner inspection: ${reason}`,
        operatorOverride: true,
      },
      reason,
    );
    return this.job(jobId);
  }
  async prepare(jobId: string, body: any) {
    return mutate(this.store, (s) => {
      const j = s.jobs[jobId];
      requireThat(
        j.productionState === "produced",
        "NOT_PRODUCED",
        "Only produced items can be made ready for collection.",
      );
      requireThat(
        body.removed === true &&
          body.labeled === true &&
          body.stored === true &&
          body.cleared === true,
        "HANDLING_REQUIRED",
        "Confirm removal, labeling, safe storage and a cleared machine.",
      );
      if (
        ["ready_for_pickup", "collected", "simulation_complete"].includes(
          j.fulfillmentState,
        )
      )
        return j;
      const m = s.machines[j.machineId!];
      requireThat(
        m.activeJobId !== j.id || j.mediaEstimateObserved?.applied !== false,
        "MEDIA_ESTIMATE_NOT_CURRENT",
        "The remaining-media estimate changed during this attempt. Use Recovery & order history → Reconcile saved outcome, then confirm handling again. The machine remains assigned to this order.",
      );
      const simulatedChild =
        j.chargeable === false && this.jobMode(j) === "simulation";
      if (simulatedChild) j.fulfillmentState = "simulation_complete";
      else {
        j.fulfillmentState = "ready_for_pickup";
        j.pickup = {
          code: randomBytes(6).toString("hex").toUpperCase(),
          expiresAt: new Date(Date.now() + this.config.pickupMs).toISOString(),
        };
      }
      m.activeJobId = null;
      accountPreparedEstimate(m, j);
      m.paused = true;
      m.ready = false;
      m.reason =
        "Output stored and machine cleared. Owner may resume for the next job now.";
      record(
        j,
        simulatedChild ? "simulation_complete" : "ready_for_pickup",
        simulatedChild
          ? "Owner cleared the simulated machine. A simulated job has no physical item or pickup code."
          : "Owner prepared and stored the item. Pickup is independent of machine availability.",
      );
      return j;
    });
  }
  async recordEconomics(
    jobId: string,
    values: {
      consumablesCents: number;
      machineSeconds: number;
      handlingSeconds: number;
      failedAttempts: number;
      apiCostCents: number;
      machineCostCents: number;
    },
  ) {
    return mutate(this.store, (s) => {
      const j = s.jobs[jobId];
      requireThat(
        j.quote && ["produced", "failed"].includes(j.productionState),
        "TRIAL_INCOMPLETE",
        "Record costs after a trial has a known result.",
      );
      const ownerPayoutCents =
        j.paymentState === "released" ? j.quote.ownerCents : 0;
      const platformFeeCents =
        j.paymentState === "released" ? j.quote.platformCents : 0;
      const ownerNetCents =
        ownerPayoutCents - values.consumablesCents - values.machineCostCents;
      j.economics = {
        ...values,
        quoteCents: j.quote.totalCents,
        platformFeeCents,
        ownerPayoutCents,
        quotedOwnerPayoutCents: j.quote.ownerCents,
        quotedPlatformFeeCents: j.quote.platformCents,
        paymentStateAtRecording: j.paymentState,
        ownerNetCents,
        platformMarginCents: platformFeeCents - values.apiCostCents,
        ownerEarningsPerHandlingMinuteCents:
          values.handlingSeconds > 0
            ? Math.round((ownerNetCents * 60) / values.handlingSeconds)
            : null,
        recordedAt: now(),
      };
      record(
        j,
        "trial_economics",
        "Owner recorded measured costs and handling time; simulation is not physical cost evidence.",
      );
      return j;
    });
  }
  async clearFailed(jobId: string, body: any) {
    return mutate(this.store, (s) => {
      const j = s.jobs[jobId];
      requireThat(
        j.productionState === "failed",
        "NOT_FAILED",
        "Resolve execution and verification before clearing a failed job.",
      );
      requireThat(
        body.inspected === true &&
          body.cleared === true &&
          typeof body.reason === "string" &&
          body.reason.trim().length >= 8,
        "RECOVERY_REQUIRED",
        "Inspect and clear the machine and record the recovery reason.",
      );
      const m = s.machines[j.machineId!];
      if (m.activeJobId !== j.id) return j;
      requireThat(
        j.mediaEstimateObserved?.applied !== false,
        "MEDIA_ESTIMATE_NOT_CURRENT",
        "The remaining-media estimate changed during this attempt. Use Recovery & order history → Reconcile saved outcome, then confirm clearing again. The machine remains assigned to this order.",
      );
      m.activeJobId = null;
      m.paused = true;
      m.ready = false;
      m.reason =
        "Failed job inspected and cleared. Owner may explicitly resume.";
      record(j, "owner_recovery", body.reason);
      return j;
    });
  }
  async renewPickup(jobId: string, body: any) {
    requireThat(
      body &&
        typeof body === "object" &&
        !Array.isArray(body) &&
        Object.keys(body).every((key) =>
          ["idempotencyKey", "expectedVersion", "expectedExpiresAt"].includes(
            key,
          ),
        ) &&
        typeof body.idempotencyKey === "string" &&
        body.idempotencyKey.trim().length >= 8 &&
        body.idempotencyKey.length <= 200 &&
        Number.isSafeInteger(body.expectedVersion) &&
        body.expectedVersion > 0 &&
        typeof body.expectedExpiresAt === "string" &&
        Number.isFinite(Date.parse(body.expectedExpiresAt)),
      "PICKUP_RENEWAL_REQUIRED",
      "Refresh the saved order before asking for a replacement expired pickup code.",
      422,
    );
    const replay = (job: Job) => {
      const previous = job.pickupRenewals?.find(
        (request) => request.key === body.idempotencyKey,
      );
      if (!previous) return false;
      requireThat(
        previous.expectedVersion === body.expectedVersion &&
          previous.expectedExpiresAt === body.expectedExpiresAt,
        "IDEMPOTENCY_CONFLICT",
        "This renewal request already belongs to another saved pickup-code state.",
        409,
      );
      return true;
    };
    const known = await this.job(jobId);
    if (replay(known)) return known;
    return mutate(this.store, (state) => {
      const job = ownValue(state.jobs, jobId);
      requireThat(job, "NOT_FOUND", "Order not found.", 404);
      if (replay(job)) return job;
      requireThat(
        job.productionState === "produced" &&
          job.fulfillmentState === "ready_for_pickup" &&
          job.pickup &&
          !job.pickup.redeemedAt,
        "PICKUP_UNAVAILABLE",
        "Only an uncollected prepared item with an expired pickup code can receive a new code.",
        409,
      );
      requireThat(
        job.version === body.expectedVersion &&
          job.pickup.expiresAt === body.expectedExpiresAt,
        "PICKUP_CHANGED",
        "The saved pickup state changed. Refresh the order before deciding whether a new code is still needed.",
        409,
      );
      requireThat(
        Number.isFinite(Date.parse(job.pickup.expiresAt)) &&
          Date.parse(job.pickup.expiresAt) <= Date.now(),
        "PICKUP_NOT_EXPIRED",
        "The current pickup code is still valid. Use that code for handoff.",
        409,
      );
      const renewedMs = Date.now();
      const renewedAt = new Date(renewedMs).toISOString();
      let code: string;
      do {
        code = randomBytes(6).toString("hex").toUpperCase();
      } while (code === job.pickup.code);
      job.pickup = {
        code,
        expiresAt: new Date(renewedMs + this.config.pickupMs).toISOString(),
      };
      job.pickupRenewals ??= [];
      job.pickupRenewals.push({
        key: body.idempotencyKey,
        expectedVersion: body.expectedVersion,
        expectedExpiresAt: body.expectedExpiresAt,
        renewedAt,
      });
      record(
        job,
        "pickup_code_renewed",
        "Owner replaced the expired pickup code for this prepared item; production, payment and machine availability were unchanged.",
      );
      return job;
    });
  }

  async redeem(jobId: string, code: string) {
    return mutate(this.store, (s) => {
      const j = s.jobs[jobId];
      requireThat(
        j.fulfillmentState === "ready_for_pickup" &&
          j.pickup &&
          !j.pickup.redeemedAt,
        "PICKUP_USED",
        "Pickup is unavailable or this code has already been used.",
      );
      requireThat(
        Date.parse(j.pickup.expiresAt) > Date.now(),
        "PICKUP_EXPIRED",
        "Pickup code expired; ask the owner for a new code.",
      );
      requireThat(
        typeof code === "string" && j.pickup.code === code.toUpperCase(),
        "PICKUP_INVALID",
        "Pickup code does not match.",
        403,
      );
      j.pickup.redeemedAt = now();
      j.fulfillmentState = "collected";
      record(
        j,
        "collected",
        "Pickup code redeemed once and owner recorded handoff.",
      );
      return j;
    });
  }
  async abort(jobId: string) {
    const j = await this.job(jobId),
      s = await this.read(),
      m = s.machines[j.machineId!];
    requireThat(j.attemptId, "NOT_DISPATCHED", "No execution attempt exists.");
    let response;
    try {
      response = await this.node.call(
        "abort",
        {
          token: this.node.token(j, m, "abort").token,
          job_id: j.id,
          machine_id: m.id,
          attempt_id: j.attemptId,
        },
        m,
      );
    } catch {
      response = {
        status: "unknown",
        reason: "Node unavailable; physical stop is unknown.",
      };
    }
    await mutate(this.store, (s) => {
      s.jobs[jobId].abortStatus = response.status;
      record(
        s.jobs[jobId],
        "abort",
        `Stop status: ${response.status}. ${response.reason ?? ""}`,
      );
    });
    return { job: await this.job(jobId), abort: response };
  }
  async probeAvailability() {
    const state = await this.read();
    const candidates = Object.values(state.machines).filter(
      (m) => m.ready && !m.paused && !m.activeJobId,
    );
    const observation = (machine: Machine) =>
      JSON.stringify([
        machineInspectionFingerprint(machine),
        machine.policyObservationId ?? null,
      ]);
    const results = await Promise.allSettled(
      candidates.map(async (machine) => {
        const status = await this.node.call(
          "get_status",
          { machine_id: machine.id },
          machine,
        );
        return { machine, status };
      }),
    );
    for (let i = 0; i < results.length; i++) {
      const result = results[i],
        machine = candidates[i];
      const status =
        result.status === "fulfilled" ? result.value.status : undefined;
      const known =
        status !== null &&
        typeof status === "object" &&
        !Array.isArray(status) &&
        status.machine_id === machine.id &&
        status.mode === machine.mode &&
        typeof status.ready === "boolean" &&
        typeof status.calibrated === "boolean";
      const unavailable =
        result.status === "rejected" ||
        !known ||
        status.ready !== true ||
        status.calibrated === false;
      if (unavailable)
        await mutate(this.store, (s) => {
          const current = s.machines[machine.id];
          if (
            !current ||
            observation(current) !== observation(machine) ||
            current.activeJobId ||
            !current.ready
          )
            return;
          current.ready = false;
          current.paused = true;
          // A configured authenticated node may revoke calibration after its
          // physical identity/capture configuration changes. Connectivity loss
          // alone provides no evidence that the recorded inspection is invalid.
          if (known && status.calibrated === false) {
            current.calibrated = false;
            delete current.calibrationAt;
          }
          current.reason =
            result.status === "rejected"
              ? "Node disconnected. Reconnect, inspect and explicitly resume."
              : !known
                ? "Node status could not be confirmed. Check the configured device, inspect and explicitly resume."
                : typeof status.reason === "string"
                  ? status.reason
                  : "Node is not ready. Owner inspection and explicit resume required.";
        });
    }
  }
  async tick() {
    if (this.busy.has("tick")) return;
    this.busy.add("tick");
    try {
      if (Date.now() - this.lastProbe >= 10000) {
        this.lastProbe = Date.now();
        await this.probeAvailability();
      }
      const s = await this.read();
      for (const j of Object.values(s.jobs)) {
        if (
          ["dispatched", "running", "verifying"].includes(j.productionState) ||
          (j.paymentState === "held" &&
            ["produced", "failed"].includes(j.productionState)) ||
          Object.values(s.operations).some(
            (o) =>
              o.jobId === j.id &&
              (["pending", "submitting"].includes(o.status) ||
                (o.status === "failed" && o.retryable === true)),
          ) ||
          (j.paymentState === "refund_pending" &&
            !Object.values(s.operations).some(
              (o) => o.jobId === j.id && o.kind === "refund",
            ))
        )
          await this.reconcile(j.id);
      }
    } finally {
      this.busy.delete("tick");
    }
  }
}
