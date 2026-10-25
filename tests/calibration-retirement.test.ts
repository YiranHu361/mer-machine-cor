import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initialState,
  now,
  parameters,
  record,
  type Job,
  type State,
} from "../server/model.ts";
import { SqliteStore, mutate } from "../server/store.ts";
import { Service } from "../server/service.ts";
import { HttpNode } from "../server/node-client.ts";
import { MockPayment } from "../server/payments.ts";
import { createApp } from "../server/app.ts";
import { calibrationDeviceContext } from "../server/calibration-context.ts";

const mid = "phomemo_01",
  cid = "calibration_retirement",
  aid = "attempt_retirement";
const reason =
  "Owner inspected the finished pattern and found unusable alignment";
function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value: T) => resolve(value),
  };
}
async function fixture(state = "produced", legacy = false) {
  const dir = mkdtempSync(join(tmpdir(), "fabyn-retirement-"));
  const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  const calls: { tool: string; body: any }[] = [];
  const controls: { node?: (tool: string, body: any) => Promise<any> } = {};
  const signer = new HttpNode(
    "http://127.0.0.1:1",
    "isolated",
    "isolated-retirement-signature",
  );
  const service = new Service(
    store,
    {
      token: signer.token.bind(signer),
      async call(tool, body) {
        calls.push({ tool, body });
        if (controls.node) return controls.node(tool, body);
        if (tool === "/reconcile")
          return {
            machine_id: mid,
            job_id: cid,
            attempt_id: aid,
            mode: "simulation",
            execution_status: "completed",
            stop_pending: false,
          };
        if (tool === "cancel_before_acceptance")
          return {
            status: "cancelled_before_acceptance",
            machine_id: mid,
            job_id: cid,
            attempt_id: aid,
            artifact_sha256: body.artifact_sha256,
            parameters: body.parameters,
            target_scope: "calibration",
            expected_mode: "simulation",
            cancelled_at: now(),
          };
        throw Error("No execution or camera in retirement fixture");
      },
    },
    new MockPayment(),
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:1/assets",
      secret: "isolated-retirement",
      quoteMs: 120000,
      pickupMs: 86400000,
      ownerCode: "isolated-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
    },
  );
  await mutate(store, (s) => {
    const m = s.machines[mid];
    m.activeJobId = cid;
    m.ready = false;
    m.paused = true;
    m.calibrated = false;
    const timestamp = new Date(Date.now() - 1000).toISOString();
    const c: Job = {
      id: cid,
      requesterId: "team_owner",
      machineId: mid,
      specVersion: 1,
      spec: {
        assetIds: ["fixture"],
        intent: "Authorized calibration fixture",
        outputType: "sticker",
        widthMm: 53,
        heightMm: 50,
        quantity: 1,
        material: "thermal-paper",
        permission: "authorized",
        crop: "contain",
      },
      artifact: {
        id: "fixture",
        url: "/assets/fixture",
        sha256: "a".repeat(64),
      },
      productionState: state,
      paymentState: "unpaid",
      fulfillmentState: "unprepared",
      history: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      attemptId: aid,
      checkoutKey: "retirement-request-key",
      ...(legacy
        ? {}
        : { calibrationDeviceContext: calibrationDeviceContext(m) }),
    };
    s.calibrations = { [cid]: c };
  });
  const owner = request.agent(createApp(service));
  await owner
    .post("/api/session")
    .send({ role: "owner", accessCode: "isolated-owner" })
    .expect(200);
  return {
    store,
    service,
    owner,
    controls,
    calls,
    snapshot: () => service.read(),
    body: async () => {
      const s = await service.read();
      return {
        attemptId: aid,
        expectedVersion: s.calibrations![cid].version,
        expectedContext: calibrationDeviceContext(s.machines[mid]),
        inspected: true,
        reason,
      };
    },
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
function interpose(
  f: Awaited<ReturnType<typeof fixture>>,
  change: (s: State) => void,
  when: (s: State) => boolean = () => true,
) {
  const cas = f.store.compareAndSet.bind(f.store);
  let armed = true;
  f.store.compareAndSet = async (v, data) => {
    if (armed && when(data)) {
      armed = false;
      await mutate(f.store, change);
    }
    return cas(v, data);
  };
}

test("completed unusable calibration is rejected without rewriting execution and cannot later confirm", async () => {
  const f = await fixture();
  try {
    const before = (await f.snapshot()).calibrations![cid];
    const result = await f.owner
      .post(`/api/owner/machines/${mid}/calibration/reject`)
      .send(await f.body())
      .expect(200);
    const s = await f.snapshot(),
      c = s.calibrations![cid],
      m = s.machines[mid];
    assert.equal(c.productionState, "produced");
    assert.deepEqual(c.artifact, before.artifact);
    assert.equal(c.calibrationInspection?.outcome, "rejected");
    assert.equal(c.calibrationInspection?.attemptId, aid);
    assert.equal(result.body.status.execution_status, "completed");
    assert.equal(result.body.lifecycle.canRequestNew, true);
    assert.equal(m.activeJobId, null);
    assert.equal(m.calibrated, false);
    assert.equal(m.ready, false);
    assert.equal(m.paused, true);
    assert.equal(f.calls[0].body.result, "completed");
    await f.owner
      .post(`/api/owner/machines/${mid}/calibrate`)
      .send({ inspected: true, attemptId: aid })
      .expect(409)
      .then((r) => assert.equal(r.body.error.code, "CALIBRATION_REJECTED"));
    assert.equal(f.calls.length, 1);
    assert.deepEqual((await f.snapshot()).operations, {});
  } finally {
    f.close();
  }
});

test("negative retirement permits legacy missing device context using current exact inspection", async () => {
  for (const state of ["produced", "needs_review"]) {
    const f = await fixture(state, true);
    try {
      const result =
        state === "produced"
          ? await f.service.rejectCalibration(mid, await f.body())
          : await f.service.cancelCalibrationBeforeAcceptance(
              mid,
              await f.body(),
            );
      assert.equal(result.lifecycle.canRequestNew, true);
      assert.equal((await f.snapshot()).machines[mid].calibrated, false);
    } finally {
      f.close();
    }
  }
});

test("invalid or stale retirement request is rejected before node I/O or store mutation", async () => {
  const changes = [
    { expectedVersion: undefined },
    { expectedVersion: 0 },
    { expectedVersion: 2 },
    { expectedContext: "b".repeat(64) },
    { inspected: false },
    { reason: "short" },
    { reason: "x".repeat(1001) },
    { attemptId: "foreign" },
    { unexpected: true },
  ];
  for (const change of changes) {
    const f = await fixture();
    try {
      const before = await f.snapshot();
      await assert.rejects(
        f.service.rejectCalibration(mid, { ...(await f.body()), ...change }),
      );
      assert.deepEqual(await f.snapshot(), before);
      assert.equal(f.calls.length, 0);
    } finally {
      f.close();
    }
  }
});

test("only current produced output permits quality rejection", async () => {
  for (const state of ["running", "failed", "needs_review", "cancelled"]) {
    const f = await fixture(state);
    try {
      const before = await f.snapshot();
      await assert.rejects(f.service.rejectCalibration(mid, await f.body()));
      assert.deepEqual(await f.snapshot(), before);
      assert.equal(f.calls.length, 0);
    } finally {
      f.close();
    }
  }
});

test("rejection requires exact completed settled node acknowledgement", async () => {
  for (const change of [
    {},
    { mode: "hardware" },
    { job_id: "foreign" },
    { attempt_id: "foreign" },
    { execution_status: "failed" },
    { stop_pending: true },
  ]) {
    const f = await fixture();
    try {
      f.controls.node = async () =>
        Object.keys(change).length
          ? {
              machine_id: mid,
              job_id: cid,
              attempt_id: aid,
              mode: "simulation",
              execution_status: "completed",
              stop_pending: false,
              ...change,
            }
          : {};
      await assert.rejects(f.service.rejectCalibration(mid, await f.body()), {
        code: "CALIBRATION_COMPLETION_UNCONFIRMED",
      });
      const s = await f.snapshot();
      assert.equal(s.machines[mid].activeJobId, cid);
      assert.equal(s.calibrations![cid].productionState, "produced");
      assert.equal(s.calibrations![cid].calibrationInspection, undefined);
    } finally {
      f.close();
    }
  }
});

test("held old rejection cannot clear newer device or owner inspection", async () => {
  const f = await fixture(),
    entered = deferred<void>(),
    finish = deferred<void>();
  let pending: Promise<any> | undefined;
  try {
    f.controls.node = async () => {
      entered.resolve();
      await finish.promise;
      return {
        machine_id: mid,
        job_id: cid,
        attempt_id: aid,
        mode: "simulation",
        execution_status: "completed",
        stop_pending: false,
      };
    };
    pending = f.service.rejectCalibration(mid, await f.body());
    await entered.promise;
    await mutate(f.store, (s) => {
      Object.assign(s.machines[mid], {
        registrationId: "new-registration",
        adapterVersion: "replacement",
        activeJobId: null,
        calibrated: true,
        ready: true,
        paused: false,
      });
      record(
        s.calibrations![cid],
        "newer_inspection",
        "Newer authorized owner inspection",
      );
    });
    const newer = await f.snapshot();
    finish.resolve();
    await assert.rejects(pending, { code: "CALIBRATION_NOT_CURRENT" });
    assert.deepEqual(await f.snapshot(), newer);
  } finally {
    finish.resolve();
    await pending?.catch(() => {});
    f.close();
  }
});

test("pre-I/O CAS movement prevents rejection while unrelated CAS retries remain allowed", async () => {
  for (const related of [true, false]) {
    const f = await fixture();
    try {
      interpose(f, (s) => {
        if (related)
          record(
            s.calibrations![cid],
            "newer_status",
            "Newer current frame inspected",
          );
        else s.machines.instax_01.reason = "Unrelated workshop refresh";
      });
      if (related) {
        await assert.rejects(f.service.rejectCalibration(mid, await f.body()), {
          code: "CALIBRATION_NOT_CURRENT",
        });
        assert.equal(f.calls.length, 0);
      } else {
        await f.service.rejectCalibration(mid, await f.body());
        assert.equal(
          (await f.snapshot()).calibrations![cid].calibrationInspection
            ?.outcome,
          "rejected",
        );
      }
    } finally {
      f.close();
    }
  }
});

test("unaccepted calibration cancellation saves exact proof and truthfully releases only its authorization", async () => {
  const f = await fixture("needs_review");
  try {
    assert.equal(
      (await f.service.calibrationStatus(mid)).lifecycle.canRequestCancellation,
      true,
    );
    const result = await f.owner
      .post(`/api/owner/machines/${mid}/calibration/cancel-before-acceptance`)
      .send(await f.body())
      .expect(200);
    const s = await f.snapshot(),
      c = s.calibrations![cid];
    assert.equal(c.productionState, "cancelled");
    assert.equal(
      c.executionCancellation?.status,
      "cancelled_before_acceptance",
    );
    assert.deepEqual(c.executionCancellation?.parameters, parameters(c));
    assert.equal(
      result.body.status.execution_status,
      "cancelled_before_acceptance",
    );
    assert.equal(result.body.lifecycle.canRequestNew, true);
    const call = f.calls.find(
      (item) => item.tool === "cancel_before_acceptance",
    )!;
    assert.equal(Object.hasOwn(call.body, "artifact_url"), false);
    assert.equal(Object.hasOwn(call.body, "expected_mode"), false);
    const signed = JSON.parse(
      Buffer.from(call.body.token.split(".")[0], "base64url").toString(),
    );
    assert.equal(signed.scope, "cancel_before_acceptance");
    assert.equal(signed.target_scope, "calibration");
    assert.equal(signed.expected_mode, "simulation");
    assert.equal(s.machines[mid].activeJobId, null);
    assert.equal(s.machines[mid].paused, true);
    assert.equal(s.machines[mid].calibrated, false);
    assert.deepEqual(s.operations, {});
  } finally {
    f.close();
  }
});

test("known accepted calibration never offers cancellation based on a later missing lookup", async () => {
  const f = await fixture("needs_review");
  try {
    await mutate(f.store, (s) =>
      record(
        s.calibrations![cid],
        "calibration_accepted",
        "Node acceptance already observed",
      ),
    );
    const before = await f.snapshot();
    await assert.rejects(
      f.service.cancelCalibrationBeforeAcceptance(mid, await f.body()),
      { code: "CALIBRATION_CANCELLATION_UNAVAILABLE" },
    );
    assert.deepEqual(await f.snapshot(), before);
    assert.equal(f.calls.length, 0);
  } finally {
    f.close();
  }
});

test("malformed or different cancellation proof cannot release a calibration", async () => {
  for (const change of [
    { status: "ok" },
    { machine_id: "foreign" },
    { attempt_id: "foreign" },
    { artifact_sha256: "b".repeat(64) },
    { parameters: undefined },
    { parameters: { quantity: 2 } },
    { target_scope: "dispatch" },
    { expected_mode: "hardware" },
    { cancelled_at: "invalid" },
    { cancelled_at: "2000-01-01T00:00:00Z" },
  ]) {
    const f = await fixture("needs_review");
    try {
      f.controls.node = async (_tool, body) => ({
        status: "cancelled_before_acceptance",
        machine_id: mid,
        job_id: cid,
        attempt_id: aid,
        artifact_sha256: body.artifact_sha256,
        parameters: body.parameters,
        target_scope: "calibration",
        expected_mode: "simulation",
        cancelled_at: now(),
        ...change,
      });
      await assert.rejects(
        f.service.cancelCalibrationBeforeAcceptance(mid, await f.body()),
        { code: "CANCELLATION_UNCONFIRMED" },
      );
      const s = await f.snapshot();
      assert.equal(s.machines[mid].activeJobId, cid);
      assert.equal(s.calibrations![cid].productionState, "needs_review");
      assert.equal(s.calibrations![cid].executionCancellation, undefined);
    } finally {
      f.close();
    }
  }
});

test("lost cancellation reply remains blocked until deliberate exact recovery", async () => {
  const f = await fixture("needs_review");
  let proof: any;
  try {
    f.controls.node = async (_tool, body) => {
      if (!proof) {
        proof = {
          status: "cancelled_before_acceptance",
          machine_id: mid,
          job_id: cid,
          attempt_id: aid,
          artifact_sha256: body.artifact_sha256,
          parameters: body.parameters,
          target_scope: "calibration",
          expected_mode: "simulation",
          cancelled_at: now(),
        };
        throw Error(
          "Isolated lost cancellation reply after durable node tombstone",
        );
      }
      return proof;
    };
    await assert.rejects(
      f.service.cancelCalibrationBeforeAcceptance(mid, await f.body()),
    );
    assert.equal((await f.snapshot()).machines[mid].activeJobId, cid);
    assert.equal(
      (await f.snapshot()).calibrations![cid].executionCancellation,
      undefined,
    );
    assert.equal(f.calls.length, 1);
    await f.service.cancelCalibrationBeforeAcceptance(mid, await f.body());
    assert.equal(
      (await f.snapshot()).calibrations![cid].executionCancellation
        ?.cancelled_at,
      proof.cancelled_at,
    );
    assert.equal(f.calls.length, 2);
  } finally {
    f.close();
  }
});

test("late cancellation proof and post-I/O CAS retries preserve newer state", async () => {
  for (const related of [true, false]) {
    const f = await fixture("needs_review");
    try {
      interpose(
        f,
        (s) => {
          if (related) {
            s.machines[mid].policyObservationId = "new-policy";
            s.machines[mid].reason = "Newer policy observation";
          } else s.machines.bambu_01.reason = "Unrelated refresh";
        },
        (s) => Boolean(s.calibrations![cid].executionCancellation),
      );
      if (related) {
        await assert.rejects(
          f.service.cancelCalibrationBeforeAcceptance(mid, await f.body()),
          { code: "CANCELLATION_NOT_CURRENT" },
        );
        assert.equal(
          (await f.snapshot()).machines[mid].reason,
          "Newer policy observation",
        );
        assert.equal(
          (await f.snapshot()).calibrations![cid].executionCancellation,
          undefined,
        );
      } else {
        await f.service.cancelCalibrationBeforeAcceptance(mid, await f.body());
        assert.equal(
          (await f.snapshot()).calibrations![cid].productionState,
          "cancelled",
        );
      }
    } finally {
      f.close();
    }
  }
});

test("exact cancellation proof tolerates a five-second node clock skew but rejects timestamps outside the sixty-second bounds", async () => {
  for (const skew of [-5000, -61000, 62000]) {
    const f = await fixture("needs_review");
    try {
      const c = (await f.snapshot()).calibrations![cid];
      f.controls.node = async (_tool, body) => ({
        status: "cancelled_before_acceptance",
        machine_id: mid,
        job_id: cid,
        attempt_id: aid,
        artifact_sha256: body.artifact_sha256,
        parameters: body.parameters,
        target_scope: "calibration",
        expected_mode: "simulation",
        cancelled_at: new Date(Date.parse(c.createdAt) + skew).toISOString(),
      });
      if (skew === -5000) {
        await f.service.cancelCalibrationBeforeAcceptance(mid, await f.body());
        assert.equal(
          (await f.snapshot()).calibrations![cid].executionCancellation
            ?.cancelled_at,
          new Date(Date.parse(c.createdAt) + skew).toISOString(),
        );
      } else {
        await assert.rejects(
          f.service.cancelCalibrationBeforeAcceptance(mid, await f.body()),
          { code: "CANCELLATION_UNCONFIRMED" },
        );
        assert.equal((await f.snapshot()).machines[mid].activeJobId, cid);
        assert.equal(
          (await f.snapshot()).calibrations![cid].executionCancellation,
          undefined,
        );
      }
    } finally {
      f.close();
    }
  }
});
