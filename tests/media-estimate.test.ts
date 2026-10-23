import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, now, type Job } from "../server/model.ts";
import {
  mediaEstimateSnapshot,
  observeMediaEstimate,
  accountPreparedEstimate,
} from "../server/media-estimate.ts";
function fixture() {
  const state = initialState(),
    machine = state.machines.phomemo_01;
  const job: Job = {
    id: "job_media",
    requesterId: "fixture",
    machineId: machine.id,
    attemptId: "attempt_media",
    specVersion: 1,
    spec: {
      assetIds: ["fixture"],
      intent: "Authorized estimate fixture",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    artifact: { id: "fixture", url: "/assets/fixture", sha256: "a".repeat(64) },
    productionState: "running",
    paymentState: "held",
    fulfillmentState: "unprepared",
    history: [],
    createdAt: now(),
    updatedAt: now(),
    version: 1,
  };
  machine.activeJobId = job.id;
  job.mediaEstimateBaseline = mediaEstimateSnapshot(machine).fingerprint;
  state.jobs[job.id] = job;
  const status = {
    machine_id: machine.id,
    job_id: job.id,
    attempt_id: job.attemptId,
    mode: "simulation",
    execution_status: "completed",
    media_remaining: 99,
  };
  return {
    state,
    machine,
    job,
    status,
    snapshot: mediaEstimateSnapshot(machine),
  };
}
test("terminal estimates account once for completed and failed outcomes without pickup double debit", () => {
  for (const terminal of ["completed", "failed"]) {
    const f = fixture();
    assert(
      observeMediaEstimate(f.state, f.job, f.snapshot, {
        ...f.status,
        execution_status: terminal,
      }),
    );
    assert.equal(f.machine.mediaRemaining, 99);
    assert.equal(
      observeMediaEstimate(f.state, f.job, f.snapshot, f.status),
      false,
    );
    assert.equal(accountPreparedEstimate(f.machine, f.job), false);
    assert.equal(f.machine.mediaRemaining, 99);
  }
});
test("newer same-value owner reset, policy acknowledgement and replacement device preserve saved estimate but mark observed attempt", () => {
  for (const change of [
    () => ({ policyObservationId: "new-owner-reset" }),
    () => ({ registrationId: "replacement-registration" }),
    () => ({ mediaRemaining: 80 }),
  ]) {
    const f = fixture();
    Object.assign(f.machine, change());
    const estimate = f.machine.mediaRemaining;
    assert(observeMediaEstimate(f.state, f.job, f.snapshot, f.status));
    assert.equal(f.machine.mediaRemaining, estimate);
    assert.equal(f.job.mediaEstimateObserved?.applied, false);
    const version = f.job.version;
    assert.equal(
      observeMediaEstimate(f.state, f.job, f.snapshot, f.status),
      false,
    );
    assert.equal(
      f.job.version,
      version,
      "Repeated stale skipped replies do not churn saved observation history",
    );
    assert.equal(accountPreparedEstimate(f.machine, f.job), false);
    assert.equal(f.machine.mediaRemaining, estimate);
  }
});
test("a late old attempt cannot touch the next execution's stock", () => {
  const f = fixture();
  f.machine.activeJobId = "new-job";
  assert(observeMediaEstimate(f.state, f.job, f.snapshot, f.status));
  assert.equal(f.machine.mediaRemaining, 100);
  assert.equal(f.job.mediaEstimateObserved?.applied, false);
});
test("foreign, malformed, unaccepted and incomplete status observations never infer consumption", () => {
  for (const change of [
    { machine_id: "foreign" },
    { job_id: "foreign" },
    { attempt_id: "foreign" },
    { mode: "hardware" },
    { execution_status: "accepted" },
    { execution_status: "running" },
    { execution_status: "uncertain" },
    { media_remaining: undefined },
    { media_remaining: -1 },
    { media_remaining: 1.5 },
    { media_remaining: 100001 },
  ]) {
    const f = fixture();
    assert.equal(
      observeMediaEstimate(f.state, f.job, f.snapshot, {
        ...f.status,
        ...change,
      }),
      false,
    );
    assert.equal(f.machine.mediaRemaining, 100);
    assert.equal(f.job.mediaEstimateObserved, undefined);
  }
});
test("Node estimate cannot invent a refill and cancellation/tombstones never debit media", () => {
  const f = fixture();
  observeMediaEstimate(f.state, f.job, f.snapshot, {
    ...f.status,
    media_remaining: 101,
  });
  assert.equal(f.machine.mediaRemaining, 100);
  const c = fixture();
  c.job.executionCancellation = {
    status: "cancelled_before_acceptance",
    machine_id: c.machine.id,
    job_id: c.job.id,
    attempt_id: c.job.attemptId!,
    artifact_sha256: c.job.artifact.sha256,
    parameters: {},
    target_scope: "dispatch",
    expected_mode: "simulation",
    cancelled_at: now(),
  };
  assert.equal(
    observeMediaEstimate(c.state, c.job, c.snapshot, c.status),
    false,
  );
  assert.equal(accountPreparedEstimate(c.machine, c.job), false);
  assert.equal(c.machine.mediaRemaining, 100);
});
test("compatibility pickup estimate cannot debit a newer owner reset or known policy observation", () => {
  const f = fixture();
  f.machine.policyObservationId = "new-owner-estimate";
  assert.equal(accountPreparedEstimate(f.machine, f.job), false);
  assert.equal(f.machine.mediaRemaining, 100);
  const legacy = fixture();
  delete legacy.job.mediaEstimateBaseline;
  legacy.machine.policyObservationId = "known-owner-policy";
  assert.equal(accountPreparedEstimate(legacy.machine, legacy.job), false);
  assert.equal(legacy.machine.mediaRemaining, 100);
  const unchanged = fixture();
  assert(accountPreparedEstimate(unchanged.machine, unchanged.job));
  assert.equal(unchanged.machine.mediaRemaining, 99);
});
