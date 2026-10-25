import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStore, mutate } from "../server/store.ts";
import {
  initialState,
  now,
  record,
  type Machine,
  type Job,
} from "../server/model.ts";
import { calibrationDeviceContext } from "../server/calibration-context.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { createApp } from "../server/app.ts";
const mid = "phomemo_01",
  key = "known-calibration-key";
const spec = {
  assetIds: ["calibration_art"],
  intent: "Owner supervised lifecycle fixture",
  outputType: "sticker",
  widthMm: 53,
  heightMm: 50,
  quantity: 1,
  material: "thermal-paper",
  permission: "authorized",
  crop: "contain",
};
const artifact = {
  id: "calibration_art",
  url: "/assets/calibration_art",
  sha256: "a".repeat(64),
};
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
  const dir = mkdtempSync(join(tmpdir(), "fabyn-calibration-lifecycle-")),
    store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  const calls: { tool: string; input: any }[] = [],
    controls = new Map<string, (input: any) => Promise<any>>();
  const service = new Service(
    store,
    {
      token() {
        return {
          token: "isolated-no-device",
          expires_at: Math.floor(Date.now() / 1000) + 60,
        };
      },
      async call(tool, input) {
        calls.push({ tool, input });
        const handler = controls.get(tool);
        if (handler) return handler(input);
        if (tool === "get_status") return { execution_status: "running" };
        if (tool === "/reconcile") return {};
        if (tool === "/calibrate")
          return { execution_status: "running", calibrated: true };
        throw Error(
          "No camera or unconfigured node operation in lifecycle fixture",
        );
      },
    },
    new MockPayment(),
    {
      mode: "hardware",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:4318/assets",
      secret: "isolated-lifecycle",
      quoteMs: 120000,
      pickupMs: 10000,
      ownerCode: "isolated-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
    },
  );
  await mutate(store, (s) => {
    Object.assign(s.machines[mid], {
      mode: "hardware",
      adapterVersion: "fixture-adapter",
      paired: true,
      configured: true,
      calibrated: false,
      ready: false,
      paused: true,
      activeJobId: null,
    });
    s.assets.calibration_art = {
      ...artifact,
      path: "unread-fixture",
      ownerId: "team_owner",
      mime: "image/png",
      width: 1,
      height: 1,
      createdAt: now(),
    };
    s.calibrations = {
      saved: {
        id: "saved",
        requesterId: "team_owner",
        machineId: mid,
        attemptId: "saved_attempt",
        checkoutKey: key,
        calibrationDeviceContext: calibrationDeviceContext(s.machines[mid]),
        specVersion: 1,
        spec: spec as any,
        artifact,
        productionState: "failed",
        paymentState: "unpaid",
        fulfillmentState: "unprepared",
        history: [],
        createdAt: now(),
        updatedAt: now(),
        version: 1,
      },
    };
  });
  const owner = request.agent(createApp(service));
  await owner
    .post("/api/session")
    .send({ role: "owner", accessCode: "isolated-owner" })
    .expect(200);
  const get = (suffix = "") =>
    owner.get(`/api/owner/machines/${mid}/calibration${suffix}`);
  const start = (requestKey: string, expected?: string) =>
    service.startCalibration(
      mid,
      "team_owner",
      spec,
      artifact,
      requestKey,
      true,
      expected,
    );
  const resolve = (reason = "Owner inspected the exact completed output") =>
    service.resolveCalibration(mid, {
      attemptId: "saved_attempt",
      inspected: true,
      result: "completed",
      reason,
    });
  return {
    store,
    service,
    owner,
    calls,
    controls,
    get,
    start,
    resolve,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("lifecycle metadata gates new requests by the same saved machine snapshot and preserves historical records", async () => {
  const f = await fixture();
  try {
    const base = (await f.store.read()).data,
      machine = structuredClone(base.machines[mid]),
      calibration = structuredClone(base.calibrations!.saved);
    for (const [patch, allowed, reason] of [
      [{}, true, "NEW_CALIBRATION_ALLOWED"],
      [{ activeJobId: "saved" }, false, "ACTIVE_CALIBRATION"],
      [{ activeJobId: "customer_execution" }, false, "ACTIVE_EXECUTION"],
      [
        {
          reservation: {
            jobId: "reserved",
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
        },
        false,
        "RESERVATION_ACTIVE",
      ],
      [
        { reservation: { jobId: "unknown", expiresAt: "invalid" } },
        false,
        "RESERVATION_ACTIVE",
      ],
      [
        {
          reservation: {
            jobId: "expired",
            expiresAt: new Date(Date.now() - 60000).toISOString(),
          },
        },
        true,
        "NEW_CALIBRATION_ALLOWED",
      ],
      [{ mode: "simulation" }, false, "MODE_MISMATCH"],
      [{ paired: false }, false, "DEVICE_UNAVAILABLE"],
      [{ configured: false }, false, "DEVICE_UNAVAILABLE"],
      [{ policyReconciliationRequired: true }, false, "POLICY_RECONCILIATION"],
    ] as const) {
      await mutate(f.store, (s) => {
        s.machines[mid] = Object.assign(structuredClone(machine), patch);
        s.calibrations!.saved = structuredClone(calibration);
      });
      const result = (await f.get().expect(200)).body;
      assert.equal(result.calibration.id, "saved");
      assert.equal(result.lifecycle.canRequestNew, allowed);
      assert.equal(result.lifecycle.reasonCode, reason);
      assert.equal(result.lifecycle.activeJobId, patch.activeJobId ?? null);
      assert.equal(
        result.lifecycle.calibrationActive,
        patch.activeJobId === "saved",
      );
      assert.equal(
        result.lifecycle.context,
        calibrationDeviceContext((await f.store.read()).data.machines[mid]),
      );
      assert.equal(Object.hasOwn(result, "requestedCalibration"), false);
    }
  } finally {
    f.close();
  }
});

test("new attempts store their device context while proved mismatches cannot confirm old output and legacy records remain explicit unknown", async () => {
  const f = await fixture();
  try {
    const initial = (await f.get().expect(200)).body;
    assert.equal(initial.lifecycle.contextMatch, true);
    await mutate(f.store, (s) => {
      s.machines[mid].adapterVersion = "replacement";
    });
    const changed = (await f.get().expect(200)).body;
    assert.equal(changed.lifecycle.contextMatch, false);
    const before = await f.store.read();
    await f.owner
      .post(`/api/owner/machines/${mid}/calibrate`)
      .send({
        inspected: true,
        attemptId: "saved_attempt",
        reason: "Owner inspected the replacement setup",
      })
      .expect(409);
    assert.deepEqual(await f.store.read(), before);
    assert.equal(f.calls.length, 0);
    const next = await f.start(
      "new-calibration-context",
      changed.lifecycle.context,
    );
    assert.equal(next.calibrationDeviceContext, changed.lifecycle.context);
    assert.notEqual(next.id, "saved");
    await mutate(f.store, (s) => {
      s.machines[mid].activeJobId = null;
      delete s.calibrations![next.id].calibrationDeviceContext;
    });
    assert.equal((await f.get().expect(200)).body.lifecycle.contextMatch, null);
  } finally {
    f.close();
  }
});

test("requested-key lookup returns only exact stored machine history with saved machine status and never polls an archived request", async () => {
  const f = await fixture();
  try {
    await mutate(f.store, (s) => {
      const saved = s.calibrations!.saved;
      s.calibrations!.archived = {
        ...structuredClone(saved),
        id: "archived",
        attemptId: "archived_attempt",
        checkoutKey: "archived-request-key",
        createdAt: "2020-01-01T00:00:00.000Z",
      };
      s.calibrations!.other_machine = {
        ...structuredClone(saved),
        id: "other_machine",
        machineId: "instax_01",
        checkoutKey: "other-machine-key",
      };
    });
    const before = await f.store.read();
    const found = (await f.get("?requestKey=archived-request-key").expect(200))
      .body;
    assert.equal(found.calibration.id, "saved");
    assert.equal(found.requestedCalibration.id, "archived");
    assert.equal(found.lifecycle.canRequestNew, true);
    for (const requestKey of ["missing-request-key", "other-machine-key"]) {
      const missing = (await f.get(`?requestKey=${requestKey}`).expect(200))
        .body;
      assert.equal(missing.requestedCalibration, null);
      assert.equal(missing.calibration.id, "saved");
    }
    for (const query of [
      "?requestKey=short",
      `?requestKey=${"x".repeat(201)}`,
      "?requestKey=valid-first&requestKey=valid-second",
    ]) {
      const bad = await f.get(query).expect(400);
      assert.equal(bad.body.error.code, "INVALID_CALIBRATION_REQUEST_KEY");
    }
    await assert.rejects(
      f.service.calibrationStatus(mid, ["valid-key", "another-key"]),
      { code: "INVALID_CALIBRATION_REQUEST_KEY" },
    );
    assert.deepEqual(await f.store.read(), before);
    assert.deepEqual(f.calls, []);
  } finally {
    f.close();
  }
});

test("a late status read returns lifecycle and requested history from the same newer final snapshot", async () => {
  const f = await fixture(),
    entered = deferred<void>(),
    finish = deferred<void>();
  let pending: Promise<any> | undefined;
  try {
    await mutate(f.store, (s) => {
      s.machines[mid].activeJobId = "saved";
      s.calibrations!.saved.productionState = "running";
    });
    f.controls.set("get_status", async () => {
      entered.resolve();
      await finish.promise;
      return { execution_status: "running" };
    });
    pending = f.get("?requestKey=archived-final-key").then((r) => r);
    await entered.promise;
    await mutate(f.store, (s) => {
      const c = s.calibrations!.saved;
      c.productionState = "failed";
      record(c, "calibration_operator_resolution", "Newer inspected failure");
      s.machines[mid].activeJobId = null;
      s.calibrations!.archived = {
        ...structuredClone(c),
        id: "archived",
        createdAt: "2020-01-01T00:00:00.000Z",
        checkoutKey: "archived-final-key",
      };
    });
    finish.resolve();
    const result = (await pending).body;
    assert.equal(result.calibration.productionState, "failed");
    assert.equal(result.status.execution_status, "failed");
    assert.equal(result.lifecycle.activeJobId, null);
    assert.equal(result.lifecycle.canRequestNew, true);
    assert.equal(result.requestedCalibration.id, "archived");
  } finally {
    finish.resolve();
    await pending?.catch(() => {});
    f.close();
  }
});

test("invalid or stale start contexts and known unavailable setup fail before any artwork preparation", async () => {
  const f = await fixture();
  try {
    const context = (await f.get().expect(200)).body.lifecycle.context,
      before = await f.store.read();
    for (const expected of ["invalid", [context], "f".repeat(64)]) {
      const result = await f.owner
        .post(`/api/owner/machines/${mid}/calibration/start`)
        .send({
          spec,
          ownerReady: true,
          idempotencyKey: "context-before-prepare",
          expectedContext: expected,
        });
      assert.equal(
        result.status,
        typeof expected === "string" && expected.length === 64 ? 409 : 400,
      );
      assert.deepEqual(await f.store.read(), before);
    }
    await mutate(f.store, (s) => {
      s.machines[mid].configured = false;
    });
    const unavailable = await f.store.read();
    await f.owner
      .post(`/api/owner/machines/${mid}/calibration/start`)
      .send({
        spec,
        ownerReady: true,
        idempotencyKey: "unavailable-before-prepare",
      })
      .expect(409);
    assert.deepEqual(await f.store.read(), unavailable);
    assert.deepEqual(f.calls, []);
  } finally {
    f.close();
  }
});

test("start CAS retries enforce the expected device context while unrelated updates still accept one attempt", async () => {
  for (const changed of ["device", "unrelated"] as const) {
    const f = await fixture(),
      original = f.store.compareAndSet.bind(f.store);
    try {
      const context = calibrationDeviceContext(
        (await f.store.read()).data.machines[mid],
      );
      let armed = true;
      f.store.compareAndSet = async (version, next) => {
        if (armed && Object.keys(next.calibrations ?? {}).length > 1) {
          armed = false;
          const fresh = await f.store.read();
          if (changed === "device")
            fresh.data.machines[mid].adapterVersion = "CAS replacement";
          else fresh.data.machines.instax_01.reason = "Unrelated saved record";
          assert.equal(await original(fresh.version, fresh.data), true);
          return false;
        }
        return original(version, next);
      };
      if (changed === "device")
        await assert.rejects(f.start("start-cas-context", context), {
          code: "CALIBRATION_CONTEXT_CHANGED",
        });
      else await f.start("start-cas-context", context);
      f.store.compareAndSet = original;
      const state = await f.store.read();
      assert.equal(armed, false);
      assert.equal(
        Object.keys(state.data.calibrations!).length,
        changed === "device" ? 1 : 2,
      );
      assert.equal(f.calls.length, changed === "device" ? 0 : 1);
      if (changed === "unrelated")
        assert.equal(
          state.data.machines.instax_01.reason,
          "Unrelated saved record",
        );
    } finally {
      f.store.compareAndSet = original;
      f.close();
    }
  }
});

test("late same-attempt owner resolution cannot replace the newer saved resolution and reason", async () => {
  const f = await fixture(),
    entered = deferred<void>(),
    finish = deferred<void>();
  let pending: Promise<any> | undefined;
  try {
    await mutate(f.store, (s) => {
      s.machines[mid].activeJobId = "saved";
      s.calibrations!.saved.productionState = "needs_review";
    });
    let calls = 0;
    f.controls.set("/reconcile", async () => {
      calls++;
      if (calls === 1) {
        entered.resolve();
        await finish.promise;
      }
      return {};
    });
    pending = f.resolve("Older owner inspection reason");
    await entered.promise;
    await f.resolve("Newer owner inspection reason");
    const saved = await f.store.read();
    finish.resolve();
    await assert.rejects(pending, { code: "CALIBRATION_NOT_CURRENT" });
    assert.deepEqual((await f.store.read()).data, saved.data);
    assert.equal(calls, 2);
  } finally {
    finish.resolve();
    await pending?.catch(() => {});
    f.close();
  }
});

test("owner resolution fences device movement before I/O and during result CAS without rejecting unrelated state", async () => {
  for (const changed of ["before", "after", "unrelated"] as const) {
    const f = await fixture(),
      original = f.store.compareAndSet.bind(f.store);
    try {
      await mutate(f.store, (s) => {
        s.machines[mid].activeJobId = "saved";
        s.calibrations!.saved.productionState = "needs_review";
      });
      let armed = true,
        freshMachine: Machine | undefined,
        freshCalibration: Job | undefined;
      f.store.compareAndSet = async (version, next) => {
        const event = next.calibrations!.saved.history.at(-1)?.event;
        if (
          armed &&
          event ===
            (changed === "before"
              ? "calibration_resolution_requested"
              : "calibration_operator_resolution")
        ) {
          armed = false;
          const fresh = await f.store.read();
          if (changed === "unrelated")
            fresh.data.machines.instax_01.reason = "Independent owner work";
          else
            Object.assign(fresh.data.machines[mid], {
              adapterVersion: "resolution replacement",
              policyReconciliationRequired: true,
              reason: "New setup preserved",
            });
          assert.equal(await original(fresh.version, fresh.data), true);
          freshMachine = structuredClone(fresh.data.machines[mid]);
          freshCalibration = structuredClone(fresh.data.calibrations!.saved);
          return false;
        }
        return original(version, next);
      };
      const resolving = f.service.resolveCalibration(mid, {
        attemptId: "saved_attempt",
        result: "failed",
        inspected: true,
        reason: "Owner inspected failed exact output",
      });
      if (changed === "unrelated") await resolving;
      else await assert.rejects(resolving, { code: "CALIBRATION_NOT_CURRENT" });
      f.store.compareAndSet = original;
      assert.equal(armed, false);
      const state = await f.store.read();
      if (changed === "unrelated") {
        assert.equal(state.data.calibrations!.saved.productionState, "failed");
        assert.equal(state.data.machines[mid].activeJobId, null);
        assert.equal(
          state.data.machines.instax_01.reason,
          "Independent owner work",
        );
      } else {
        assert.deepEqual(state.data.machines[mid], freshMachine);
        assert.deepEqual(state.data.calibrations!.saved, freshCalibration);
      }
      assert.equal(
        f.calls.filter((c) => c.tool === "/reconcile").length,
        changed === "before" ? 0 : 1,
      );
    } finally {
      f.store.compareAndSet = original;
      f.close();
    }
  }
});
