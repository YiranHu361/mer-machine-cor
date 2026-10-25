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
  type Machine,
  type State,
} from "../server/model.ts";
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
const spec = {
  assetIds: ["audit_art"],
  intent: "Explicit owner supervised finite calibration",
  outputType: "sticker",
  widthMm: 53,
  heightMm: 50,
  quantity: 1,
  material: "thermal-paper",
  permission: "authorized",
  crop: "contain",
};
const artifact = {
  id: "audit_art",
  url: "/assets/audit_art",
  sha256: "a".repeat(64),
};
async function fixture(mode: "simulation" | "hardware" = "hardware") {
  const dir = mkdtempSync(join(tmpdir(), "fabyn-calibration-finalization-")),
    store = new SqliteStore(join(dir, "app.sqlite"), initialState());
  const calls: {
    tool: string;
    adapterVersion?: string;
    inspected?: boolean;
  }[] = [];
  const controls = {
    confirm: null as ((machine: Machine | undefined) => Promise<any>) | null,
  };
  const service = new Service(
    store,
    {
      token() {
        return {
          token: "isolated-no-device",
          expires_at: Math.floor(Date.now() / 1000) + 60,
        };
      },
      async call(tool, body, machine) {
        calls.push({
          tool,
          adapterVersion: machine?.adapterVersion,
          inspected: body.inspected,
        });
        if (tool === "get_capabilities")
          return {
            mode: "hardware",
            paired: true,
            configured: true,
            adapter_version: "replacement-adapter",
          };
        if (tool === "/calibrate" && body.job)
          return { execution_status: "running" };
        if (tool === "/calibrate" && body.inspected) {
          if (controls.confirm) return controls.confirm(machine);
          return { calibrated: true, mode };
        }
        throw Error("Unconfigured isolated calibration operation");
      },
    },
    new MockPayment(),
    {
      mode,
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:4318/assets",
      secret: "isolated-finalization-test",
      quoteMs: 120000,
      pickupMs: 10000,
      ownerCode: "isolated-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
    },
  );
  const app = createApp(service),
    a = request.agent(app),
    b = request.agent(app);
  for (const owner of [a, b])
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "isolated-owner" })
      .expect(200);
  await mutate(store, (s) => {
    Object.assign(s.machines.phomemo_01, {
      mode,
      adapterVersion: "old-adapter",
      paired: true,
      configured: true,
      calibrated: false,
      ready: false,
      paused: true,
      activeJobId: null,
      reason: "Previous output needs owner confirmation.",
    });
    s.assets.audit_art = {
      ...artifact,
      ownerId: "team_owner",
      path: "unread-isolated-fixture",
      mime: "image/png",
      width: 1,
      height: 1,
      createdAt: now(),
    };
    s.calibrations = {
      old_calibration: {
        id: "old_calibration",
        requesterId: "team_owner",
        machineId: "phomemo_01",
        attemptId: "old_attempt",
        specVersion: 1,
        spec: spec as any,
        artifact,
        productionState: "produced",
        paymentState: "unpaid",
        fulfillmentState: "unprepared",
        history: [],
        createdAt: now(),
        updatedAt: now(),
        version: 1,
      },
    };
  });
  const machine = async () => (await store.read()).data.machines.phomemo_01;
  const confirm = (agent = a) =>
    agent.post("/api/owner/machines/phomemo_01/calibrate").send({
      inspected: true,
      attemptId: "old_attempt",
      reason: "Owner inspected this exact completed fixture output",
    });
  const replace = async () => {
    await b
      .post("/api/owner/machines")
      .send({ model: "phomemo-m02pro", mode: "hardware" })
      .expect(201);
    await mutate(store, (s) =>
      Object.assign(s.machines.phomemo_01, {
        policyReconciliationRequired: true,
        ready: false,
        paused: true,
        reason:
          "The replacement setup requires deliberate policy synchronization.",
      }),
    );
    return machine();
  };
  return {
    store,
    service,
    a,
    b,
    calls,
    controls,
    confirm,
    replace,
    machine,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("pre-I/O device movement during the availability CAS retry prevents any old-node confirmation", async () => {
  const f = await fixture(),
    original = f.store.compareAndSet.bind(f.store);
  let freshMachine: Machine | undefined;
  try {
    let armed = true;
    f.store.compareAndSet = async (version, next) => {
      if (
        armed &&
        next.machines.phomemo_01.reason ===
          "Owner calibration confirmation is in progress."
      ) {
        armed = false;
        const fresh = await f.store.read();
        Object.assign(fresh.data.machines.phomemo_01, {
          adapterVersion: "pre-I/O-replacement",
          nodeUrl: "http://127.0.0.1:2",
          policyReconciliationRequired: true,
          reason: "A newer device setup won before confirmation I/O.",
        });
        assert.equal(await original(fresh.version, fresh.data), true);
        freshMachine = structuredClone(fresh.data.machines.phomemo_01);
        return false;
      }
      return original(version, next);
    };
    const response = await f.confirm();
    f.store.compareAndSet = original;
    assert.equal(armed, false);
    assert.equal(
      f.calls.filter((call) => call.tool === "/calibrate").length,
      0,
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await f.machine(), freshMachine);
  } finally {
    f.store.compareAndSet = original;
    f.close();
  }
});

for (const outcome of ["true", "false", "throw"] as const)
  test(`late old-node confirmation ${outcome} preserves replacement configuration, readiness and reconciliation marker`, async () => {
    const f = await fixture(),
      entered = deferred<void>(),
      finish = deferred<void>();
    let pending: Promise<request.Response> | undefined;
    try {
      f.controls.confirm = async () => {
        entered.resolve();
        await finish.promise;
        if (outcome === "throw")
          throw Error("Isolated delayed acknowledgement failure");
        return {
          calibrated: outcome === "true",
          reason: "Old configuration response",
          mode: "hardware",
        };
      };
      pending = f.confirm().then((r) => r);
      await entered.promise;
      const replacement = await f.replace();
      finish.resolve();
      const response = await pending;
      assert(
        response.status >= 400,
        "A stale old confirmation must not report success",
      );
      assert.deepEqual(await f.machine(), replacement);
      assert.equal(
        f.calls.filter((call) => call.tool === "/calibrate").length,
        1,
      );
      assert.deepEqual((await f.store.read()).data.operations, {});
    } finally {
      finish.resolve();
      await pending?.catch(() => {});
      f.close();
    }
  });

for (const outcome of ["false", "throw"] as const)
  test(`a newer successful inactive-attempt confirmation cannot be undone by an older ${outcome}`, async () => {
    const f = await fixture(),
      entered = deferred<void>(),
      finish = deferred<void>();
    let pending: Promise<request.Response> | undefined;
    try {
      let calls = 0;
      f.controls.confirm = async () => {
        calls++;
        if (calls === 1) {
          entered.resolve();
          await finish.promise;
          if (outcome === "throw")
            throw Error("Isolated older confirmation failure");
          return { calibrated: false, reason: "Old rejected observation" };
        }
        return { calibrated: true, mode: "hardware" };
      };
      pending = f.confirm().then((r) => r);
      await entered.promise;
      await f.confirm(f.b).expect(200);
      const passed = await f.machine();
      assert.equal(passed.calibrated, true);
      finish.resolve();
      await pending;
      assert.deepEqual(await f.machine(), passed);
      assert.equal(calls, 2);
    } finally {
      finish.resolve();
      await pending?.catch(() => {});
      f.close();
    }
  });

for (const changed of ["device", "unrelated"] as const)
  test(`confirmation result CAS retries preserve a concurrent ${changed} change`, async () => {
    const f = await fixture(),
      original = f.store.compareAndSet.bind(f.store);
    let freshMachine: Machine | undefined;
    try {
      let armed = true;
      f.store.compareAndSet = async (version, next) => {
        if (armed && next.machines.phomemo_01.calibrated === true) {
          armed = false;
          const fresh = await f.store.read();
          if (changed === "device")
            Object.assign(fresh.data.machines.phomemo_01, {
              adapterVersion: "CAS-replacement",
              policyReconciliationRequired: true,
              reason: "New device state committed during result save.",
            });
          else
            fresh.data.machines.instax_01.reason =
              "Unrelated owner record changed.";
          assert.equal(await original(fresh.version, fresh.data), true);
          freshMachine = structuredClone(fresh.data.machines.phomemo_01);
          return false;
        }
        return original(version, next);
      };
      const response = await f.confirm();
      f.store.compareAndSet = original;
      assert.equal(armed, false);
      assert.equal(response.status, changed === "device" ? 409 : 200);
      if (changed === "device")
        assert.deepEqual(await f.machine(), freshMachine);
      else {
        assert.equal((await f.machine()).calibrated, true);
        assert.equal(
          (await f.store.read()).data.machines.instax_01.reason,
          "Unrelated owner record changed.",
        );
      }
      assert.equal(
        f.calls.filter((call) => call.tool === "/calibrate").length,
        1,
      );
    } finally {
      f.store.compareAndSet = original;
      f.close();
    }
  });

test("an accepted new calibration atomically clears only its expired reservation and can finalize", async () => {
  const f = await fixture();
  try {
    await mutate(f.store, (s) => {
      s.machines.phomemo_01.reservation = {
        jobId: "expired-unpaid-order",
        expiresAt: new Date(Date.now() - 60000).toISOString(),
      };
    });
    const calibration = await f.service.startCalibration(
      "phomemo_01",
      "team_owner",
      spec,
      artifact,
      "fresh-calibration-after-expiry",
      true,
    );
    const response = await f.a
      .post("/api/owner/machines/phomemo_01/calibrate")
      .send({
        inspected: true,
        attemptId: calibration.attemptId,
        reason: "Owner inspected the newly authorized calibration output",
      });
    assert.equal(response.status, 200);
    assert.equal((await f.machine()).reservation, undefined);
    assert.equal((await f.machine()).calibrated, true);
    assert.equal((await f.machine()).activeJobId, null);
    assert.deepEqual((await f.store.read()).data.operations, {});
  } finally {
    f.close();
  }
});

test("a still-live reservation blocks a new calibration without changing state or calling the node", async () => {
  const f = await fixture();
  try {
    await mutate(f.store, (s) => {
      s.machines.phomemo_01.reservation = {
        jobId: "unexpired-unpaid-order",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
    });
    const before = await f.store.read();
    await assert.rejects(
      f.service.startCalibration(
        "phomemo_01",
        "team_owner",
        spec,
        artifact,
        "blocked-calibration-request",
        true,
      ),
      { code: "MACHINE_BUSY" },
    );
    assert.deepEqual(await f.store.read(), before);
    assert.deepEqual(f.calls, []);
  } finally {
    f.close();
  }
});

test("a newer failed simulation confirmation without a target fences an older successful response even when availability flags are identical", async () => {
  const f = await fixture("simulation"),
    entered = deferred<void>(),
    finish = deferred<void>();
  let pending: Promise<request.Response> | undefined;
  try {
    let calls = 0;
    f.controls.confirm = async () => {
      calls++;
      if (calls === 1) {
        entered.resolve();
        await finish.promise;
        return { calibrated: true, mode: "simulation" };
      }
      return {
        calibrated: false,
        mode: "simulation",
        reason: "Newer owner confirmation did not pass",
      };
    };
    pending = f.a
      .post("/api/owner/machines/phomemo_01/calibrate")
      .send({ inspected: true })
      .then((r) => r);
    await entered.promise;
    await f.b
      .post("/api/owner/machines/phomemo_01/calibrate")
      .send({ inspected: true })
      .expect(409);
    const failed = await f.machine();
    assert.equal(failed.calibrated, false);
    finish.resolve();
    assert.equal((await pending).status, 409);
    assert.deepEqual(await f.machine(), failed);
    assert.equal(calls, 2);
  } finally {
    finish.resolve();
    await pending?.catch(() => {});
    f.close();
  }
});

test("a successful calibration acknowledgement must explicitly match the configured mode", async () => {
  for (const [configuredMode, returnedMode] of [
    ["hardware", "simulation"],
    ["hardware", undefined],
    ["hardware", null],
    ["hardware", { malformed: true }],
    ["simulation", "hardware"],
    ["simulation", undefined],
  ] as const) {
    const f = await fixture(configuredMode);
    try {
      await mutate(f.store, (s) => {
        s.machines.phomemo_01.policyReconciliationRequired = true;
      });
      f.controls.confirm = async () => ({
        calibrated: true,
        ...(returnedMode === undefined ? {} : { mode: returnedMode }),
      });
      const response = await f.confirm();
      assert.equal(response.status, 409);
      assert.equal(response.body.error.code, "CALIBRATION_MODE_UNCONFIRMED");
      const current = await f.machine();
      assert.equal(current.calibrated, false);
      assert.equal(current.calibrationAt, undefined);
      assert.equal(current.ready, false);
      assert.equal(current.paused, true);
      assert.equal(current.policyReconciliationRequired, true);
      assert.equal(f.calls.length, 1);
    } finally {
      f.close();
    }
  }
});
