import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initialState,
  now,
  Problem,
  record,
  type Job,
  type Machine,
  type Operation,
} from "../server/model.ts";
import { SqliteStore, mutate } from "../server/store.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value: T) => resolve(value),
  };
}
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabrary-operator-cancel-"));
  const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  const gate = deferred<void>();
  let pending: Promise<void> | undefined;
  const controls = {
    cancelled: false,
    executions: 0,
    pending: false,
    refundCalls: 0,
    cancelCalls: 0,
    cancel: undefined as undefined | ((body: any) => Promise<any>),
  };
  const calls: string[] = [];
  class Payment extends MockPayment {
    override async transfer(job: Job, machine: Machine, op: Operation) {
      if (op.kind === "refund") controls.refundCalls++;
      return super.transfer(job, machine, op);
    }
  }
  const service = new Service(
    store,
    {
      token: () => ({
        token: "isolated-cancel-signed",
        expires_at: Math.floor(Date.now() / 1000) + 300,
      }),
      async call(tool, body) {
        calls.push(tool);
        if (tool === "camera_snapshot")
          throw new Problem(
            "camera_unavailable",
            "No camera in isolated fixture",
            503,
          );
        if (tool === "run_job") {
          controls.pending = true;
          pending = gate.promise.then(() => {
            controls.pending = false;
            if (!controls.cancelled) controls.executions++;
          });
          throw new Problem(
            "NODE_REJECTED",
            "Caller timed out while remote artifact download is pending",
            502,
          );
        }
        if (tool === "get_status")
          throw new Problem(
            "unknown_attempt",
            "Remote request has not reached durable acceptance",
            404,
          );
        if (tool === "cancel_before_acceptance") {
          controls.cancelCalls++;
          if (controls.cancel) return controls.cancel(body);
          controls.cancelled = true;
          return {
            status: "cancelled_before_acceptance",
            machine_id: body.machine_id,
            job_id: body.job_id,
            attempt_id: body.attempt_id,
            artifact_sha256: body.artifact_sha256,
            parameters: body.parameters,
            target_scope: "dispatch",
            expected_mode: "simulation",
            cancelled_at: now(),
          };
        }
        throw Error("No unconfigured mutation in isolated fixture");
      },
    },
    new Payment(),
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:1/assets",
      secret: "isolated-operator-cancel",
      quoteMs: 120000,
      pickupMs: 86400000,
      ownerCode: "isolated-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
    },
  );
  await mutate(store, (s) => {
    s.assets.fixture = {
      id: "fixture",
      ownerId: "requester",
      path: "no-file",
      url: "/assets/fixture",
      sha256: "a".repeat(64),
      mime: "image/png",
      width: 20,
      height: 20,
      createdAt: now(),
    };
    Object.assign(s.machines.phomemo_01, {
      calibrated: true,
      listed: true,
      ready: true,
      paused: false,
    });
  });
  const j = await service.create(
    "requester",
    {
      assetIds: ["fixture"],
      intent: "Authorized isolated order",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    { id: "fixture", url: "/assets/fixture", sha256: "a".repeat(64) },
  );
  await service.approve(j.id, {
    specVersion: j.specVersion,
    artifactSha256: j.artifact.sha256,
  });
  await service.quote(j.id);
  await service.checkout(j.id, "isolated-checkout");
  await service.dispatch(j.id);
  assert.equal((await service.job(j.id)).productionState, "needs_review");
  assert(controls.pending);
  return {
    store,
    service,
    controls,
    calls,
    jobId: j.id,
    async release() {
      gate.resolve();
      await pending;
    },
    async close() {
      gate.resolve();
      await pending;
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const reason =
  "Owner inspected the empty tray and requested cancellation of the unaccepted authorization";

test("customer404 alone cannot fail or refund while original remote request remains pending", async () => {
  const f = await fixture();
  try {
    f.controls.cancel = async () => {
      throw new Problem(
        "unknown_tool",
        "Node has no cancellation barrier",
        404,
      );
    };
    await assert.rejects(f.service.operatorReview(f.jobId, "fail", reason));
    const j = await f.service.job(f.jobId);
    assert.equal(j.productionState, "needs_review");
    assert.equal(j.paymentState, "held");
    assert.equal(j.executionCancellation, undefined);
    assert.equal(f.controls.refundCalls, 0);
    assert(f.controls.pending);
    assert.equal(f.controls.cancelCalls, 1);
    assert.equal(
      Object.values((await f.service.read()).operations).filter(
        (o) => o.kind === "refund",
      ).length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("matching durable cancellation permits one refund and prevents late fake acceptance", async () => {
  const f = await fixture();
  try {
    const reviewed = await f.service.operatorReview(f.jobId, "fail", reason);
    assert.equal(reviewed.productionState, "failed");
    assert.equal(reviewed.paymentState, "refunded");
    assert.equal(reviewed.executionCancellation?.target_scope, "dispatch");
    assert.equal(f.controls.refundCalls, 1);
    assert.equal(f.controls.cancelCalls, 1);
    await f.release();
    assert.equal(f.controls.executions, 0);
    await assert.rejects(f.service.operatorReview(f.jobId, "fail", reason), {
      code: "REVIEW_REQUIRED",
    });
    assert.equal(f.controls.refundCalls, 1);
    assert(!f.calls.includes("/reconcile"));
    assert(!f.calls.includes("abort"));
  } finally {
    await f.close();
  }
});

test("foreign calibration cancellation proof cannot refund a customer dispatch", async () => {
  const f = await fixture();
  try {
    f.controls.cancel = async (body) => ({
      status: "cancelled_before_acceptance",
      machine_id: body.machine_id,
      job_id: body.job_id,
      attempt_id: body.attempt_id,
      artifact_sha256: body.artifact_sha256,
      parameters: body.parameters,
      target_scope: "calibration",
      expected_mode: "simulation",
      cancelled_at: now(),
    });
    await assert.rejects(f.service.operatorReview(f.jobId, "fail", reason), {
      code: "CANCELLATION_UNCONFIRMED",
    });
    const j = await f.service.job(f.jobId);
    assert.equal(j.productionState, "needs_review");
    assert.equal(j.paymentState, "held");
    assert.equal(f.controls.refundCalls, 0);
  } finally {
    await f.close();
  }
});

test("held old cancellation proof cannot override newer order or machine state", async () => {
  const f = await fixture(),
    entered = deferred<void>(),
    finish = deferred<void>();
  let pending: Promise<any> | undefined;
  try {
    f.controls.cancel = async (body) => {
      entered.resolve();
      await finish.promise;
      return {
        status: "cancelled_before_acceptance",
        machine_id: body.machine_id,
        job_id: body.job_id,
        attempt_id: body.attempt_id,
        artifact_sha256: body.artifact_sha256,
        parameters: body.parameters,
        target_scope: "dispatch",
        expected_mode: "simulation",
        cancelled_at: now(),
      };
    };
    pending = f.service.operatorReview(f.jobId, "fail", reason);
    await entered.promise;
    await mutate(f.store, (s) => {
      record(
        s.jobs[f.jobId],
        "newer_owner_action",
        "A newer inspection supersedes the pending action",
      );
      s.machines.phomemo_01.reason = "Newer preserved state";
      s.machines.phomemo_01.policyObservationId = "new-policy";
    });
    const newer = await f.service.read();
    finish.resolve();
    await assert.rejects(pending, { code: "CANCELLATION_NOT_CURRENT" });
    assert.deepEqual(await f.service.read(), newer);
    assert.equal(f.controls.refundCalls, 0);
  } finally {
    finish.resolve();
    await pending?.catch(() => {});
    await f.close();
  }
});

test("throw-after-commit cancellation keeps its proof and reconciles exactly one refund", async () => {
  const f = await fixture();
  try {
    const cas = f.store.compareAndSet.bind(f.store);
    let armed = true;
    f.store.compareAndSet = async (version, data) => {
      const committed = await cas(version, data);
      if (armed && committed && data.jobs[f.jobId].executionCancellation) {
        armed = false;
        throw Error("Isolated response loss after committed cancellation");
      }
      return committed;
    };
    await assert.rejects(f.service.operatorReview(f.jobId, "fail", reason));
    const saved = await f.service.job(f.jobId);
    assert.equal(saved.productionState, "failed");
    assert.equal(saved.paymentState, "held");
    assert.equal(
      saved.executionCancellation?.status,
      "cancelled_before_acceptance",
    );
    assert.equal(f.controls.refundCalls, 0);
    await f.release();
    assert.equal(f.controls.executions, 0);
    await f.service.reconcile(f.jobId);
    await f.service.reconcile(f.jobId);
    assert.equal((await f.service.job(f.jobId)).paymentState, "refunded");
    assert.equal(f.controls.refundCalls, 1);
    assert.equal(f.controls.cancelCalls, 1);
  } finally {
    await f.close();
  }
});
