import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, type Machine } from "../server/model.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { createApp } from "../server/app.ts";
function deferred() {
  let release!: () => void;
  return {
    promise: new Promise<void>((done) => {
      release = done;
    }),
    release: () => release(),
  };
}
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabrary-machine-settings-"));
  const store = new SqliteStore(join(dir, "app.sqlite"), initialState());
  const calls: { path: string; body: any; machine?: Machine }[] = [];
  const controls = {
    policy: null as ((path: string, body: any) => Promise<void>) | null,
  };
  const service = new Service(
    store,
    {
      async call(path, body, machine) {
        assert.match(path, /^\/machines\/\w+\/policy$/);
        calls.push({ path, body, machine: structuredClone(machine) });
        await controls.policy?.(path, body);
        return { updated: true };
      },
      token() {
        throw new Error("No dispatch in machine-settings fixtures");
      },
    },
    new MockPayment(),
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:4318/assets",
      secret: "isolated-machine-settings",
      quoteMs: 120000,
      pickupMs: 10000,
      ownerCode: "isolated-machine-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
    },
  );
  const app = createApp(service),
    owner = request.agent(app),
    other = request.agent(app);
  for (const agent of [owner, other])
    await agent
      .post("/api/session")
      .send({ role: "owner", accessCode: "isolated-machine-owner" })
      .expect(200);
  return {
    store,
    owner,
    other,
    calls,
    controls,
    async machine(id = "phomemo_01") {
      return (
        await owner.get("/api/owner/dashboard").expect(200)
      ).body.machines.find((m: Machine) => m.id === id) as Machine & {
        settingsFingerprint: string;
      };
    },
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const settings = (m: Machine) => ({
  listed: m.listed,
  mediaRemaining: m.mediaRemaining,
  material: m.material,
  priceCard: m.priceCard,
  hours: m.hours,
  maxJobSeconds: m.maxJobSeconds,
  collectionPoint: m.collectionPoint,
  policy: m.policy,
  ownerAddress: m.ownerAddress ?? null,
});
const match = (fingerprint: string) => `"${fingerprint}"`;

test("stale settings fingerprints reject before node I/O and preserve a newer owner save", async () => {
  const f = await fixture();
  try {
    const base = await f.machine();
    assert.match(base.settingsFingerprint, /^[0-9a-f]{64}$/);
    const saved = await f.other
      .patch("/api/owner/machines/phomemo_01")
      .set("If-Match", match(base.settingsFingerprint))
      .send({
        ...settings(base),
        collectionPoint: "Newer owner desk",
        priceCard: { ...base.priceCard, consumables: 65 },
        ownerAddress: "0x" + "bb".repeat(20),
      })
      .expect(200);
    assert.notEqual(
      saved.body.machine.settingsFingerprint,
      base.settingsFingerprint,
    );
    const before = await f.store.read(),
      calls = f.calls.length;
    const stale = await f.owner
      .patch("/api/owner/machines/phomemo_01")
      .set("If-Match", match(base.settingsFingerprint))
      .send({ ...settings(base), collectionPoint: "Stale draft desk" })
      .expect(412);
    assert.equal(stale.body.error.code, "STALE_MACHINE_SETTINGS");
    assert.deepEqual(await f.store.read(), before);
    assert.equal(f.calls.length, calls);
    for (const invalid of [
      base.settingsFingerprint,
      "*",
      `W/"${base.settingsFingerprint}"`,
      '"invalid"',
    ]) {
      await f.owner
        .patch("/api/owner/machines/phomemo_01")
        .set("If-Match", invalid)
        .send({ collectionPoint: "Invalid conditional save" })
        .expect(400);
      assert.deepEqual(await f.store.read(), before);
    }
    assert.equal(f.calls.length, calls);
    assert.equal((await f.machine()).nodeUrl, undefined);
    assert.equal(
      Object.hasOwn(before.data.machines.phomemo_01, "settingsFingerprint"),
      false,
    );
  } finally {
    f.close();
  }
});

test("job, reservation and readiness changes do not invalidate an editable-settings fingerprint", async () => {
  const f = await fixture();
  try {
    const base = await f.machine();
    await mutate(f.store, (s) =>
      Object.assign(s.machines.phomemo_01, {
        ready: true,
        paused: false,
        calibrated: true,
        calibrationAt: "2026-10-23T12:00:00.000Z",
        reason: "New operational status",
        activeJobId: "active_fixture",
        reservation: {
          jobId: "reserved_fixture",
          expiresAt: "2026-10-23T13:00:00.000Z",
        },
      }),
    );
    const refreshed = await f.machine();
    assert.equal(refreshed.settingsFingerprint, base.settingsFingerprint);
    const saved = await f.owner
      .patch("/api/owner/machines/phomemo_01")
      .set("If-Match", match(base.settingsFingerprint))
      .send({ ...settings(base), collectionPoint: "Same-base owner desk" })
      .expect(200);
    assert.equal(saved.body.machine.activeJobId, "active_fixture");
    assert.equal(saved.body.machine.reservation.jobId, "reserved_fixture");
    assert.equal(saved.body.machine.ready, true);
    assert.equal(saved.body.machine.paused, false);
    assert.equal(saved.body.machine.reason, "New operational status");
  } finally {
    f.close();
  }
});

test("machine PATCH peers serialize policy I/O while a different machine remains independent", async () => {
  const f = await fixture(),
    entered = deferred(),
    release = deferred();
  try {
    const base = await f.machine();
    f.controls.policy = async (path) => {
      if (path === "/machines/phomemo_01/policy") {
        entered.release();
        await release.promise;
      }
    };
    const first = f.owner
      .patch("/api/owner/machines/phomemo_01")
      .set("If-Match", match(base.settingsFingerprint))
      .send({ collectionPoint: "First serial save" })
      .then((response) => response);
    await entered.promise;
    const second = f.other
      .patch("/api/owner/machines/phomemo_01")
      .set("If-Match", match(base.settingsFingerprint))
      .send({ collectionPoint: "Second stale serial save" })
      .then((response) => response);
    await f.other
      .patch("/api/owner/machines/instax_01")
      .send({ collectionPoint: "Independent machine save" })
      .expect(200);
    assert.equal(
      f.calls.filter((c) => c.path === "/machines/phomemo_01/policy").length,
      1,
    );
    release.release();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 412);
    assert.equal(
      f.calls.filter((c) => c.path === "/machines/phomemo_01/policy").length,
      1,
    );
    assert.equal((await f.machine()).collectionPoint, "First serial save");
    f.controls.policy = null;
    await f.owner
      .patch("/api/owner/machines/phomemo_01")
      .send({ collectionPoint: "Queue remains usable" })
      .expect(200);
  } finally {
    release.release();
    f.close();
  }
});

test("a post-policy configuration conflict preserves newer settings and requires synchronization before resume", async () => {
  const f = await fixture();
  try {
    await mutate(f.store, (s) =>
      Object.assign(s.machines.phomemo_01, {
        calibrated: true,
        ready: true,
        paused: false,
      }),
    );
    const base = await f.machine();
    f.controls.policy = async () => {
      f.controls.policy = null;
      await mutate(f.store, (s) =>
        Object.assign(s.machines.phomemo_01, {
          collectionPoint: "Newer workflow location",
          mediaRemaining: 37,
          priceCard: { ...base.priceCard, consumables: 88 },
        }),
      );
    };
    const response = await f.owner
      .patch("/api/owner/machines/phomemo_01")
      .set("If-Match", match(base.settingsFingerprint))
      .send({ ...settings(base), collectionPoint: "Old outgoing location" })
      .expect(409);
    assert.equal(response.body.error.code, "MACHINE_POLICY_RECONCILIATION");
    assert.match(response.body.error.message, /node may already have applied/);
    const newer = await f.machine();
    assert.equal(newer.collectionPoint, "Newer workflow location");
    assert.equal(newer.mediaRemaining, 37);
    assert.equal(newer.priceCard.consumables, 88);
    assert.equal(newer.ready, false);
    assert.equal(newer.paused, true);
    assert.equal(newer.policyReconciliationRequired, true);
    const calls = f.calls.length;
    await f.owner
      .patch("/api/owner/machines/phomemo_01")
      .send({ paused: false, inspected: true, cleared: true })
      .expect(409);
    assert.equal(f.calls.length, calls);
    const synchronized = await f.owner
      .patch("/api/owner/machines/phomemo_01")
      .set("If-Match", match(newer.settingsFingerprint))
      .send(settings(newer))
      .expect(200);
    assert.equal(
      synchronized.body.machine.policyReconciliationRequired,
      undefined,
    );
    assert.equal(synchronized.body.machine.ready, false);
    assert.equal(synchronized.body.machine.paused, true);
    await f.owner
      .patch("/api/owner/machines/phomemo_01")
      .send({ paused: false, inspected: true, cleared: true })
      .expect(200);
    assert.deepEqual((await f.store.read()).data.operations, {});
  } finally {
    f.close();
  }
});

test("a CAS retry rechecks editable settings but preserves concurrent runtime-only updates", async () => {
  for (const change of ["editable", "runtime"] as const) {
    const f = await fixture();
    try {
      const base = await f.machine(),
        originalCas = f.store.compareAndSet.bind(f.store);
      let injected = false;
      f.store.compareAndSet = async (version, data) => {
        if (!injected) {
          injected = true;
          const fresh = await f.store.read();
          if (change === "editable")
            fresh.data.machines.phomemo_01.collectionPoint =
              "Concurrent CAS location";
          else
            Object.assign(fresh.data.machines.phomemo_01, {
              activeJobId: "new_execution",
              ready: false,
              paused: true,
              reason: "Concurrent runtime update",
            });
          assert.equal(await originalCas(fresh.version, fresh.data), true);
          return false;
        }
        return originalCas(version, data);
      };
      const response = await f.owner
        .patch("/api/owner/machines/phomemo_01")
        .set("If-Match", match(base.settingsFingerprint))
        .send({ collectionPoint: "Owner CAS draft" });
      f.store.compareAndSet = originalCas;
      const current = await f.machine();
      assert.equal(response.status, change === "editable" ? 412 : 200);
      assert.equal(
        current.collectionPoint,
        change === "editable" ? "Concurrent CAS location" : "Owner CAS draft",
      );
      if (change === "runtime") {
        assert.equal(current.activeJobId, "new_execution");
        assert.equal(current.reason, "Concurrent runtime update");
      }
      assert.equal(f.calls.length, 1);
    } finally {
      f.close();
    }
  }
});

test("a lost policy acknowledgement pauses availability without overwriting saved configuration or retrying the node", async () => {
  for (const concurrentSave of [false, true]) {
    const f = await fixture();
    try {
      await mutate(f.store, (s) =>
        Object.assign(s.machines.phomemo_01, {
          calibrated: true,
          ready: true,
          paused: false,
        }),
      );
      const base = await f.machine();
      let appliedPolicy: unknown;
      f.controls.policy = async (_path, body) => {
        appliedPolicy = structuredClone(body);
        f.controls.policy = null;
        if (concurrentSave)
          await mutate(f.store, (s) =>
            Object.assign(s.machines.phomemo_01, {
              collectionPoint: "Concurrent saved owner desk",
              mediaRemaining: 37,
            }),
          );
        throw new Error("Isolated transport lost the policy acknowledgement");
      };
      const response = await f.owner
        .patch("/api/owner/machines/phomemo_01")
        .set("If-Match", match(base.settingsFingerprint))
        .send({ ...settings(base), mediaRemaining: 5 })
        .expect(503);
      assert.equal(response.body.error.code, "MACHINE_POLICY_RECONCILIATION");
      assert.match(response.body.error.message, /could not be confirmed/);
      assert.doesNotMatch(response.body.error.message, /Isolated transport/);
      assert.equal((appliedPolicy as any).mediaRemaining, 5);
      assert.equal(
        f.calls.length,
        1,
        "An uncertain policy is never retried automatically",
      );
      const current = await f.machine();
      assert.equal(
        current.mediaRemaining,
        concurrentSave ? 37 : base.mediaRemaining,
      );
      assert.equal(
        current.collectionPoint,
        concurrentSave ? "Concurrent saved owner desk" : base.collectionPoint,
      );
      assert.equal(current.ready, false);
      assert.equal(current.paused, true);
      assert.equal(current.policyReconciliationRequired, true);
      if (!concurrentSave)
        assert.equal(current.settingsFingerprint, base.settingsFingerprint);
      await f.owner
        .patch("/api/owner/machines/phomemo_01")
        .send({ paused: false, inspected: true, cleared: true })
        .expect(409);
      assert.equal(f.calls.length, 1);
      const synchronized = await f.owner
        .patch("/api/owner/machines/phomemo_01")
        .set("If-Match", match(current.settingsFingerprint))
        .send(settings(current))
        .expect(200);
      assert.equal(
        synchronized.body.machine.policyReconciliationRequired,
        undefined,
      );
      assert.equal(synchronized.body.machine.ready, false);
      assert.equal(synchronized.body.machine.paused, true);
      assert.equal(f.calls.length, 2);
      assert.deepEqual((await f.store.read()).data.operations, {});
    } finally {
      f.close();
    }
  }
});

test("post-policy persistence uncertainty preserves whichever settings committed and reports an unconfirmed availability fence honestly", async () => {
  for (const outcome of [
    "before-commit",
    "after-commit",
    "fence-failed",
  ] as const) {
    const f = await fixture();
    const originalCas = f.store.compareAndSet.bind(f.store);
    try {
      await mutate(f.store, (s) =>
        Object.assign(s.machines.phomemo_01, {
          calibrated: true,
          ready: true,
          paused: false,
        }),
      );
      const base = await f.machine();
      f.controls.policy = async () => {
        f.controls.policy = null;
        let writes = 0;
        f.store.compareAndSet = async (version, data) => {
          writes++;
          if (outcome === "fence-failed" || writes === 1) {
            if (outcome === "after-commit")
              assert.equal(await originalCas(version, data), true);
            throw new Error("Isolated uncertain persistence result");
          }
          return originalCas(version, data);
        };
      };
      const response = await f.owner
        .patch("/api/owner/machines/phomemo_01")
        .set("If-Match", match(base.settingsFingerprint))
        .send({ ...settings(base), mediaRemaining: 5 })
        .expect(503);
      f.store.compareAndSet = originalCas;
      assert.equal(response.body.error.code, "MACHINE_POLICY_RECONCILIATION");
      assert.doesNotMatch(response.body.error.message, /Isolated uncertain/);
      assert.match(
        response.body.error.message,
        outcome === "fence-failed"
          ? /Machine availability could not be confirmed/
          : /Machine availability is paused/,
      );
      const current = await f.machine();
      assert.equal(
        current.mediaRemaining,
        outcome === "after-commit" ? 5 : base.mediaRemaining,
      );
      assert.equal(current.collectionPoint, base.collectionPoint);
      assert.equal(
        current.policyReconciliationRequired,
        outcome === "fence-failed" ? undefined : true,
      );
      assert.equal(current.ready, outcome === "fence-failed");
      assert.equal(current.paused, outcome !== "fence-failed");
      assert.equal(f.calls.length, 1);
      assert.deepEqual((await f.store.read()).data.operations, {});
    } finally {
      f.store.compareAndSet = originalCas;
      f.close();
    }
  }
});

test("an in-flight resume cannot reuse owner clearance after calibration, adapter or execution context changes", async () => {
  for (const changed of [
    { calibrated: false, calibrationAt: "2026-10-23T14:00:00.000Z" },
    { adapterVersion: "new-adapter", nodeUrl: "http://127.0.0.1:2" },
    { paired: false, configured: false, mode: "hardware" as const },
    { activeJobId: "new_execution" },
    {
      reservation: {
        jobId: "new_reservation",
        expiresAt: "2026-10-23T15:00:00.000Z",
      },
    },
  ]) {
    const f = await fixture();
    try {
      await mutate(f.store, (s) =>
        Object.assign(s.machines.phomemo_01, {
          calibrated: true,
          ready: false,
          paused: true,
        }),
      );
      const base = await f.machine();
      f.controls.policy = async (_path, body) => {
        assert.equal(body.ready, true);
        f.controls.policy = null;
        await mutate(f.store, (s) =>
          Object.assign(s.machines.phomemo_01, changed),
        );
      };
      const response = await f.owner
        .patch("/api/owner/machines/phomemo_01")
        .send({ paused: false, inspected: true, cleared: true })
        .expect(409);
      assert.equal(response.body.error.code, "MACHINE_POLICY_RECONCILIATION");
      assert.match(
        response.body.error.message,
        /machine changed after inspection/,
      );
      const current = (await f.store.read()).data.machines.phomemo_01;
      for (const [key, value] of Object.entries(changed))
        assert.deepEqual(current[key as keyof Machine], value);
      assert.equal(current.ready, false);
      assert.equal(current.paused, true);
      assert.equal(current.policyReconciliationRequired, true);
      assert.equal(
        (await f.machine()).settingsFingerprint,
        base.settingsFingerprint,
      );
      assert.equal(f.calls.length, 1);
      await f.owner
        .patch("/api/owner/machines/phomemo_01")
        .send({ paused: false, inspected: true, cleared: true })
        .expect(409);
      assert.equal(f.calls.length, 1);
      assert.deepEqual((await f.store.read()).data.operations, {});
    } finally {
      f.close();
    }
  }
});

test("a non-resume policy save cannot apply old-node settings to a concurrently replaced device", async () => {
  const f = await fixture();
  try {
    await mutate(f.store, (s) =>
      Object.assign(s.machines.phomemo_01, {
        nodeUrl: "http://127.0.0.1:1",
        calibrated: true,
        ready: true,
        paused: false,
      }),
    );
    const base = await f.machine();
    f.controls.policy = async (_path, body) => {
      assert.equal(body.mediaRemaining, 5);
      f.controls.policy = null;
      await mutate(f.store, (s) =>
        Object.assign(s.machines.phomemo_01, {
          adapterVersion: "replacement-adapter",
          nodeUrl: "http://127.0.0.1:2",
          mode: "hardware",
          paired: false,
          configured: false,
          calibrated: false,
        }),
      );
    };
    const response = await f.owner
      .patch("/api/owner/machines/phomemo_01")
      .set("If-Match", match(base.settingsFingerprint))
      .send({ mediaRemaining: 5 })
      .expect(409);
    assert.equal(response.body.error.code, "MACHINE_POLICY_RECONCILIATION");
    assert.match(response.body.error.message, /registered device changed/);
    const replacement = (await f.store.read()).data.machines.phomemo_01;
    assert.equal(replacement.mediaRemaining, base.mediaRemaining);
    assert.equal(replacement.adapterVersion, "replacement-adapter");
    assert.equal(replacement.nodeUrl, "http://127.0.0.1:2");
    assert.equal(replacement.mode, "hardware");
    assert.equal(replacement.paired, false);
    assert.equal(replacement.configured, false);
    assert.equal(replacement.calibrated, false);
    assert.equal(replacement.policyReconciliationRequired, true);
    assert.equal(replacement.ready, false);
    assert.equal(replacement.paused, true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].machine?.adapterVersion, base.adapterVersion);
    assert.equal(f.calls[0].machine?.nodeUrl, "http://127.0.0.1:1");
    const current = await f.machine();
    assert.equal(current.settingsFingerprint, base.settingsFingerprint);
    const synchronized = await f.owner
      .patch("/api/owner/machines/phomemo_01")
      .set("If-Match", match(current.settingsFingerprint))
      .send(settings(current))
      .expect(200);
    assert.equal(
      synchronized.body.machine.policyReconciliationRequired,
      undefined,
    );
    assert.equal(synchronized.body.machine.ready, false);
    assert.equal(synchronized.body.machine.paused, true);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].machine?.nodeUrl, "http://127.0.0.1:2");
    assert.equal(f.calls[1].body.mediaRemaining, base.mediaRemaining);
    assert.deepEqual((await f.store.read()).data.operations, {});
  } finally {
    f.close();
  }
});
