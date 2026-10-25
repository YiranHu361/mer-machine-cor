import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, now, record } from "../server/model.ts";
import { Service, type Config } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import type { NodeBoundary } from "../server/node-client.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabyn-calibration-ordering-"));
  const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  const device: NodeBoundary = {
    token: () => ({
      token: "isolated-status-fixture",
      expires_at: Math.floor(Date.now() / 1000) + 60,
    }),
    async call(tool) {
      if (tool === "get_status") return { execution_status: "running" };
      return { calibrated: true, execution_status: "running" };
    },
  };
  const config: Config = {
    mode: "simulation",
    paymentMode: "mock",
    storeMode: "sqlite-development",
    assetOrigin: "http://127.0.0.1:4318/assets",
    secret: "isolated-status-secret",
    quoteMs: 120000,
    pickupMs: 86400000,
    ownerCode: "isolated-status-owner",
    dataDir: dir,
    nodeUrl: "http://127.0.0.1:1",
  };
  const service = new Service(store, device, new MockPayment(), config);
  await mutate(store, (s) => {
    s.assets.fixture_art = {
      id: "fixture_art",
      ownerId: "team_owner",
      path: "unread-fixture",
      url: "/assets/fixture_art",
      sha256: "a".repeat(64),
      mime: "image/png",
      width: 20,
      height: 20,
      createdAt: now(),
    };
  });
  const spec = {
    assetIds: ["fixture_art"],
    intent: "Isolated calibration fixture",
    outputType: "sticker",
    widthMm: 53,
    heightMm: 50,
    quantity: 1,
    material: "thermal-paper",
    permission: "authorized",
    crop: "contain",
  };
  const artifact = {
    id: "fixture_art",
    url: "/assets/fixture_art",
    sha256: "a".repeat(64),
  };
  const start = (key: string) =>
    service.startCalibration(
      "phomemo_01",
      "team_owner",
      spec,
      artifact,
      key,
      true,
    );
  const calibration = await start("status-ordering-first");
  const saved = async () =>
    (await service.read()).calibrations![calibration.id];
  const resolveFailed = () =>
    service.resolveCalibration("phomemo_01", {
      attemptId: calibration.attemptId,
      inspected: true,
      result: "failed",
      reason: "Owner inspected failed output and cleared the isolated fixture",
    });
  return {
    store,
    service,
    device,
    calibration,
    saved,
    start,
    resolveFailed,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("late calibration status cannot undo a recorded operator failure", async () => {
  const f = await fixture(),
    entered = deferred<void>(),
    pending = deferred<any>();
  try {
    const original = f.device.call.bind(f.device);
    f.device.call = async (tool, input, machine) => {
      if (tool === "get_status") {
        entered.resolve();
        return pending.promise;
      }
      return original(tool, input, machine);
    };
    const old = f.service.calibrationStatus("phomemo_01");
    await entered.promise;
    await f.resolveFailed();
    const before = await f.saved();
    pending.resolve({ execution_status: "running" });
    const reply = await old;
    assert.deepEqual(await f.saved(), before);
    assert.equal(reply.calibration?.productionState, "failed");
    assert.equal(reply.status.execution_status, "failed");
    assert.equal(
      (await f.service.read()).machines.phomemo_01.activeJobId,
      null,
    );
  } finally {
    pending.resolve({ execution_status: "running" });
    f.close();
  }
});

test("an older running observation cannot replace a newer completion", async () => {
  const f = await fixture(),
    entered = deferred<void>(),
    pending = deferred<any>();
  try {
    let calls = 0;
    const original = f.device.call.bind(f.device);
    f.device.call = async (tool, input, machine) => {
      if (tool === "get_status") {
        if (++calls === 1) {
          entered.resolve();
          return pending.promise;
        }
        return { execution_status: "completed" };
      }
      return original(tool, input, machine);
    };
    const old = f.service.calibrationStatus("phomemo_01");
    await entered.promise;
    await f.service.calibrationStatus("phomemo_01");
    const before = await f.saved();
    assert.equal(before.productionState, "produced");
    pending.resolve({ execution_status: "running" });
    const reply = await old;
    assert.deepEqual(await f.saved(), before);
    assert.equal(reply.status.execution_status, "completed");
  } finally {
    pending.resolve({ execution_status: "running" });
    f.close();
  }
});

test("an old status read returns the active newer attempt even when creation timestamps tie", async () => {
  const f = await fixture(),
    entered = deferred<void>(),
    pending = deferred<any>();
  try {
    const original = f.device.call.bind(f.device);
    f.device.call = async (tool, input, machine) => {
      if (tool === "get_status") {
        entered.resolve();
        return pending.promise;
      }
      return original(tool, input, machine);
    };
    const old = f.service.calibrationStatus("phomemo_01");
    await entered.promise;
    await f.resolveFailed();
    const before = await f.saved();
    const next = await f.start("status-ordering-second");
    await mutate(f.store, (s) => {
      s.calibrations![next.id].createdAt =
        s.calibrations![f.calibration.id].createdAt;
    });
    pending.resolve({ execution_status: "running" });
    const reply = await old;
    assert.equal(reply.calibration?.id, next.id);
    assert.equal(
      (await f.service.read()).machines.phomemo_01.activeJobId,
      next.id,
    );
    assert.deepEqual(await f.saved(), before);
  } finally {
    pending.resolve({ execution_status: "running" });
    f.close();
  }
});

test("calibration observation is rechecked after a competing owner resolution wins CAS", async () => {
  const f = await fixture();
  try {
    const originalCall = f.device.call.bind(f.device);
    f.device.call = async (tool, input, machine) =>
      tool === "get_status"
        ? { execution_status: "completed" }
        : originalCall(tool, input, machine);
    const originalCas = f.store.compareAndSet.bind(f.store);
    let armed = true;
    f.store.compareAndSet = async (version, next) => {
      if (
        armed &&
        next.calibrations![f.calibration.id].productionState === "produced"
      ) {
        armed = false;
        await mutate(f.store, (s) => {
          const current = s.calibrations![f.calibration.id];
          current.productionState = "failed";
          record(
            current,
            "calibration_operator_resolution",
            "A newer owner inspection recorded failure during the status save.",
          );
          s.machines.phomemo_01.activeJobId = null;
        });
      }
      return originalCas(version, next);
    };
    const reply = await f.service.calibrationStatus("phomemo_01");
    assert.equal(armed, false);
    assert.equal(reply.calibration?.productionState, "failed");
    assert.equal(reply.status.execution_status, "failed");
    assert.equal(
      (await f.saved()).history.filter(
        (entry) => entry.event === "calibration_status",
      ).length,
      0,
    );
  } finally {
    f.close();
  }
});

test("unknown node status cannot reset a known completed calibration", async () => {
  const f = await fixture();
  try {
    const original = f.device.call.bind(f.device);
    f.device.call = async (tool, input, machine) =>
      tool === "get_status"
        ? { execution_status: "completed" }
        : original(tool, input, machine);
    await f.service.calibrationStatus("phomemo_01");
    const before = await f.saved();
    for (const execution_status of [
      { unexpected: true },
      ["completed"],
      null,
      1,
    ]) {
      f.device.call = async () => ({ execution_status });
      const reply = await f.service.calibrationStatus("phomemo_01");
      assert.deepEqual(await f.saved(), before);
      assert.equal(reply.status.execution_status, "unknown");
      assert.match(reply.status.reason, /saved record is unchanged/);
    }
  } finally {
    f.close();
  }
});

test("unchanged running observations preserve the calibration version and history", async () => {
  const f = await fixture();
  try {
    const before = await f.saved();
    await f.service.calibrationStatus("phomemo_01");
    await f.service.calibrationStatus("phomemo_01");
    assert.deepEqual(await f.saved(), before);
  } finally {
    f.close();
  }
});

test("a device configuration change fences a pending calibration observation", async () => {
  const f = await fixture(),
    entered = deferred<void>(),
    pending = deferred<any>();
  try {
    const original = f.device.call.bind(f.device);
    f.device.call = async (tool, input, machine) => {
      if (tool === "get_status") {
        entered.resolve();
        return pending.promise;
      }
      return original(tool, input, machine);
    };
    const old = f.service.calibrationStatus("phomemo_01");
    await entered.promise;
    const before = await f.saved();
    await mutate(f.store, (s) => {
      s.machines.phomemo_01.adapterVersion = "new-adapter-context";
    });
    pending.resolve({ execution_status: "completed" });
    const reply = await old;
    assert.deepEqual(await f.saved(), before);
    assert.equal(reply.status.execution_status, "running");
    assert.match(reply.status.reason, /changed while/);
    assert.equal(
      (await f.service.read()).machines.phomemo_01.adapterVersion,
      "new-adapter-context",
    );
  } finally {
    pending.resolve({ execution_status: "running" });
    f.close();
  }
});

test("a resolution immediately after a status save is reflected in both response fields", async () => {
  const f = await fixture();
  try {
    const originalCall = f.device.call.bind(f.device);
    f.device.call = async (tool, input, machine) =>
      tool === "get_status"
        ? { execution_status: "completed" }
        : originalCall(tool, input, machine);
    const originalCas = f.store.compareAndSet.bind(f.store);
    let armed = true;
    f.store.compareAndSet = async (version, next) => {
      const accepted = await originalCas(version, next);
      if (
        accepted &&
        armed &&
        next.calibrations![f.calibration.id].productionState === "produced"
      ) {
        armed = false;
        await mutate(f.store, (s) => {
          const current = s.calibrations![f.calibration.id];
          current.productionState = "failed";
          record(
            current,
            "calibration_operator_resolution",
            "Owner inspection recorded failure just after a status save.",
          );
          s.machines.phomemo_01.activeJobId = null;
        });
      }
      return accepted;
    };
    const reply = await f.service.calibrationStatus("phomemo_01");
    assert.equal(armed, false);
    assert.equal(reply.calibration?.productionState, "failed");
    assert.equal(reply.status.execution_status, "failed");
  } finally {
    f.close();
  }
});

test("a delayed status error cannot obscure a newer authoritative operator outcome", async () => {
  const f = await fixture(),
    entered = deferred<void>(),
    pending = deferred<void>();
  try {
    const original = f.device.call.bind(f.device);
    f.device.call = async (tool, input, machine) => {
      if (tool === "get_status") {
        entered.resolve();
        await pending.promise;
        throw Error("Old isolated node read disconnected");
      }
      return original(tool, input, machine);
    };
    const old = f.service.calibrationStatus("phomemo_01");
    await entered.promise;
    await f.resolveFailed();
    const before = await f.saved();
    pending.resolve();
    const reply = await old;
    assert.deepEqual(await f.saved(), before);
    assert.equal(reply.status.execution_status, "failed");
    assert.match(reply.status.reason, /newer saved record/);
  } finally {
    pending.resolve();
    f.close();
  }
});

test("late calibration start success or error preserves an intervening operator resolution", async () => {
  for (const failAcknowledgement of [false, true]) {
    const f = await fixture(),
      entered = deferred<void>(),
      pending = deferred<void>();
    try {
      await f.resolveFailed();
      const original = f.device.call.bind(f.device);
      f.device.call = async (tool, input, machine) => {
        if (tool === "/calibrate" && input.inspected === false) {
          entered.resolve();
          await pending.promise;
          if (failAcknowledgement)
            throw Error("The old start acknowledgement was lost");
          return { execution_status: "running" };
        }
        return original(tool, input, machine);
      };
      const starting = f.start("status-ordering-held-start");
      await entered.promise;
      const active = (await f.service.read()).machines.phomemo_01.activeJobId!;
      const current = (await f.service.read()).calibrations![active];
      await f.service.resolveCalibration("phomemo_01", {
        attemptId: current.attemptId,
        inspected: true,
        result: "failed",
        reason:
          "Owner observed failed output while the start reply was pending",
      });
      const before = await f.service.read();
      pending.resolve();
      const reply = await starting;
      const after = await f.service.read();
      assert.deepEqual(
        after.calibrations![active],
        before.calibrations![active],
      );
      assert.deepEqual(after.machines.phomemo_01, before.machines.phomemo_01);
      assert.equal(reply.productionState, "failed");
      assert.equal(
        reply.history.at(-1)?.event,
        "calibration_operator_resolution",
      );
    } finally {
      pending.resolve();
      f.close();
    }
  }
});

test("late calibration start success or error preserves a newer completed observation", async () => {
  for (const failAcknowledgement of [false, true]) {
    const f = await fixture(),
      entered = deferred<void>(),
      pending = deferred<void>();
    try {
      await f.resolveFailed();
      const original = f.device.call.bind(f.device);
      f.device.call = async (tool, input, machine) => {
        if (tool === "/calibrate" && input.inspected === false) {
          entered.resolve();
          await pending.promise;
          if (failAcknowledgement)
            throw Error("The old start acknowledgement was lost");
          return { execution_status: "running" };
        }
        if (tool === "get_status") return { execution_status: "completed" };
        return original(tool, input, machine);
      };
      const starting = f.start("status-ordering-held-completed-start");
      await entered.promise;
      const active = (await f.service.read()).machines.phomemo_01.activeJobId!;
      await f.service.calibrationStatus("phomemo_01");
      const before = await f.service.read();
      assert.equal(before.calibrations![active].productionState, "produced");
      pending.resolve();
      const reply = await starting;
      const after = await f.service.read();
      assert.deepEqual(
        after.calibrations![active],
        before.calibrations![active],
      );
      assert.deepEqual(after.machines.phomemo_01, before.machines.phomemo_01);
      assert.equal(reply.productionState, "produced");
    } finally {
      pending.resolve();
      f.close();
    }
  }
});
