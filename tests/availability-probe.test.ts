import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, type Machine } from "../server/model.ts";
import { machineInspectionFingerprint } from "../server/machine-settings.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { createApp } from "../server/app.ts";
function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value: T) => resolve(value),
  };
}
const mid = "phomemo_01",
  at = "2026-10-23T12:00:00.000Z";
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabyn-availability-probe-")),
    store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  const controls = {
    status: null as null | ((machine: Machine) => Promise<any>),
  };
  const calls: string[] = [];
  const service = new Service(
    store,
    {
      token() {
        throw Error("No execution in availability fixture");
      },
      async call(tool, body, machine) {
        calls.push(tool);
        if (tool === "get_status") {
          if (controls.status) return controls.status(machine!);
          return {
            machine_id: body.machine_id,
            mode: machine!.mode,
            ready: true,
            calibrated: true,
          };
        }
        if (tool === "get_capabilities")
          return {
            mode: "simulation",
            adapter_version: "replacement-device",
            paired: true,
            configured: true,
          };
        if (tool === "/calibrate")
          return { calibrated: true, mode: "simulation" };
        if (tool.endsWith("/policy")) return { updated: true };
        throw Error("Unconfigured isolated operation");
      },
    },
    new MockPayment(),
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:4318/assets",
      secret: "isolated-probe",
      quoteMs: 120000,
      pickupMs: 10000,
      ownerCode: "isolated-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
    },
  );
  await mutate(store, (s) => {
    for (const m of Object.values(s.machines)) {
      m.ready = false;
      m.paused = true;
    }
    Object.assign(s.machines[mid], {
      paired: true,
      configured: true,
      calibrated: true,
      ready: true,
      paused: false,
      calibrationAt: at,
      reason: "Owner inspected and cleared the machine.",
    });
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
    calls,
    controls,
    machine: async () => (await store.read()).data.machines[mid],
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const negative = (m: Machine) => ({
  machine_id: m.id,
  mode: m.mode,
  ready: false,
  calibrated: false,
  reason: "Old configured device was unavailable",
});

test("a delayed old probe cannot revoke a newer registration, explicit calibration and resume", async () => {
  const f = await fixture(),
    entered = deferred<void>(),
    finish = deferred<void>();
  let pending: Promise<void> | undefined;
  try {
    f.controls.status = async (m) => {
      entered.resolve();
      await finish.promise;
      return negative(m);
    };
    pending = f.service.probeAvailability();
    await entered.promise;
    await f.owner
      .post("/api/owner/machines")
      .send({ model: "phomemo-m02pro", mode: "simulation" })
      .expect(201);
    await f.owner
      .post(`/api/owner/machines/${mid}/calibrate`)
      .send({ inspected: true })
      .expect(200);
    await f.owner
      .patch(`/api/owner/machines/${mid}`)
      .send({ paused: false, inspected: true, cleared: true })
      .expect(200);
    const newer = await f.machine();
    assert.equal(newer.calibrated, true);
    assert.notEqual(newer.calibrationAt, at);
    assert(newer.registrationId);
    assert(newer.calibrationConfirmationId);
    assert(newer.policyObservationId);
    finish.resolve();
    await pending;
    assert.deepEqual(await f.machine(), newer);
    assert.deepEqual((await f.store.read()).data.operations, {});
  } finally {
    finish.resolve();
    await pending?.catch(() => {});
    f.close();
  }
});

test("a newer no-op owner resume acknowledgement supersedes an old negative or disconnected probe", async () => {
  for (const disconnected of [false, true]) {
    const f = await fixture(),
      entered = deferred<void>(),
      finish = deferred<void>();
    let pending: Promise<void> | undefined;
    try {
      const before = await f.machine();
      f.controls.status = async (m) => {
        entered.resolve();
        await finish.promise;
        if (disconnected) throw Error("Isolated old connection loss");
        return negative(m);
      };
      pending = f.service.probeAvailability();
      await entered.promise;
      await f.owner
        .patch(`/api/owner/machines/${mid}`)
        .send({ paused: false, inspected: true, cleared: true })
        .expect(200);
      const current = await f.machine();
      assert.equal(
        machineInspectionFingerprint(current),
        machineInspectionFingerprint(before),
      );
      assert.notEqual(current.policyObservationId, before.policyObservationId);
      finish.resolve();
      await pending;
      assert.deepEqual(await f.machine(), current);
    } finally {
      finish.resolve();
      await pending?.catch(() => {});
      f.close();
    }
  }
});

test("current coherent negative status revokes calibration only on an explicit matching false, while connection loss preserves provenance", async () => {
  for (const outcome of ["revoked", "unready", "disconnected"] as const) {
    const f = await fixture();
    try {
      f.controls.status = async (m) => {
        if (outcome === "disconnected") throw Error("Isolated connection loss");
        return { ...negative(m), calibrated: outcome !== "revoked" };
      };
      await f.service.probeAvailability();
      const current = await f.machine();
      assert.equal(current.ready, false);
      assert.equal(current.paused, true);
      assert.equal(current.calibrated, outcome !== "revoked");
      assert.equal(
        current.calibrationAt,
        outcome === "revoked" ? undefined : at,
      );
    } finally {
      f.close();
    }
  }
});

test("malformed, foreign or mode-mismatched status pauses availability without inventing calibration revocation", async () => {
  for (const status of [
    null,
    [],
    {},
    { machine_id: mid, mode: "simulation", ready: "false", calibrated: false },
    {
      machine_id: "other_machine",
      mode: "simulation",
      ready: false,
      calibrated: false,
    },
    { machine_id: mid, mode: "hardware", ready: false, calibrated: false },
    { machine_id: mid, mode: "simulation", ready: false },
  ]) {
    const f = await fixture();
    try {
      f.controls.status = async () => status;
      await f.service.probeAvailability();
      const current = await f.machine();
      assert.equal(current.ready, false);
      assert.equal(current.paused, true);
      assert.equal(current.calibrated, true);
      assert.equal(current.calibrationAt, at);
      assert.match(current.reason, /could not be confirmed/);
    } finally {
      f.close();
    }
  }
});

test("a null status cannot throw out of tick or starve the remaining ready machines", async () => {
  const f = await fixture();
  try {
    await mutate(f.store, (s) =>
      Object.assign(s.machines.instax_01, {
        paired: true,
        configured: true,
        calibrated: true,
        ready: true,
        paused: false,
        calibrationAt: at,
      }),
    );
    f.controls.status = async (m) => (m.id === mid ? null : negative(m));
    await f.service.tick();
    const state = await f.store.read();
    assert.equal(state.data.machines[mid].ready, false);
    assert.equal(state.data.machines[mid].calibrationAt, at);
    assert.equal(state.data.machines.instax_01.ready, false);
    assert.equal(state.data.machines.instax_01.calibrationAt, undefined);
    assert.equal(f.calls.filter((c) => c === "get_status").length, 2);
  } finally {
    f.close();
  }
});

test("negative probe CAS retries fence new inspection and policy observations while preserving unrelated writes", async () => {
  for (const change of ["inspection", "policy", "unrelated"] as const) {
    const f = await fixture(),
      original = f.store.compareAndSet.bind(f.store);
    try {
      f.controls.status = async (m) => negative(m);
      let armed = true,
        newer: Machine | undefined;
      f.store.compareAndSet = async (version, next) => {
        if (armed && next.machines[mid].ready === false) {
          armed = false;
          const fresh = await f.store.read();
          if (change === "inspection")
            Object.assign(fresh.data.machines[mid], {
              calibrationConfirmationId: "new_confirmation",
              calibrationAt: "2026-10-23T13:00:00.000Z",
              reason: "New owner inspection",
            });
          else if (change === "policy")
            fresh.data.machines[mid].policyObservationId =
              "new_policy_acknowledgement";
          else fresh.data.machines.instax_01.reason = "Independent owner work";
          assert.equal(await original(fresh.version, fresh.data), true);
          newer = structuredClone(fresh.data.machines[mid]);
          return false;
        }
        return original(version, next);
      };
      await f.service.probeAvailability();
      f.store.compareAndSet = original;
      assert.equal(armed, false);
      const current = await f.machine();
      if (change === "unrelated") {
        assert.equal(current.calibrated, false);
        assert.equal(current.ready, false);
        assert.equal(
          (await f.store.read()).data.machines.instax_01.reason,
          "Independent owner work",
        );
      } else assert.deepEqual(current, newer);
    } finally {
      f.store.compareAndSet = original;
      f.close();
    }
  }
});

test("a coherent healthy idle probe does not mutate saved machine state or revision", async () => {
  const f = await fixture();
  try {
    const before = await f.store.read();
    await f.service.probeAvailability();
    assert.deepEqual(await f.store.read(), before);
    assert.deepEqual(f.calls, ["get_status"]);
  } finally {
    f.close();
  }
});
