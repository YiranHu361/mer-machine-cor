import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, type Machine } from "../server/model.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { createApp } from "../server/app.ts";
import { calibrationDeviceContext } from "../server/calibration-context.ts";
import { machineInspectionFingerprint } from "../server/machine-settings.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve() };
}
const manifest = (version: string, media = 17, seconds = 100) => ({
  mode: "simulation",
  paired: true,
  configured: true,
  adapter_version: version,
  media_remaining: media,
  max_job_seconds: seconds,
  blockers: [],
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabrary-registration-regression-"));
  const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  const calls: { tool: string; body: any; selected: Machine | undefined }[] =
    [];
  const controls = {
    capabilities: null as
      null | ((selected: Machine | undefined) => Promise<any>),
    policyError: false,
  };
  const service = new Service(
    store,
    {
      token() {
        throw new Error("No execution in isolated registration fixtures");
      },
      async call(tool, body, selected) {
        calls.push({
          tool,
          body: structuredClone(body),
          selected: structuredClone(selected),
        });
        if (tool === "get_capabilities")
          return controls.capabilities
            ? controls.capabilities(selected)
            : manifest("new-adapter");
        assert.equal(tool, "/machines/phomemo_01/policy");
        if (controls.policyError)
          throw Error("Isolated lost policy acknowledgement");
        return { updated: true };
      },
    },
    new MockPayment(),
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:1/assets",
      secret: "isolated-registration-secret",
      quoteMs: 120000,
      pickupMs: 10000,
      ownerCode: "isolated-registration-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:2",
    },
  );
  const app = createApp(service),
    owner = request.agent(app),
    peer = request.agent(app);
  for (const agent of [owner, peer])
    await agent
      .post("/api/session")
      .send({ role: "owner", accessCode: "isolated-registration-owner" })
      .expect(200);
  return {
    store,
    service,
    owner,
    peer,
    calls,
    controls,
    registration(agent = owner) {
      return agent
        .post("/api/owner/machines")
        .send({ model: "phomemo-m02pro", mode: "simulation" });
    },
    async machine() {
      return (await service.read()).machines.phomemo_01;
    },
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("a late registration cannot replace a newer accepted adapter observation", async () => {
  const f = await fixture(),
    entered = deferred(),
    release = deferred();
  let old: Promise<request.Response> | undefined;
  try {
    let observations = 0;
    f.controls.capabilities = async () => {
      if (++observations === 1) {
        entered.resolve();
        await release.promise;
        return manifest("old-adapter-A");
      }
      return manifest("new-adapter-B", 77, 170);
    };
    old = f.registration().then((response) => response);
    await entered.promise;
    await f.registration(f.peer).expect(201);
    const saved = await f.store.read();
    release.resolve();
    const rejected = await old;
    assert.equal(rejected.status, 409);
    assert.deepEqual(await f.store.read(), saved);
    assert.equal((await f.machine()).adapterVersion, "new-adapter-B");
    assert.equal(
      f.calls.length,
      2,
      "Capabilities reads are not replayed on conflict",
    );
  } finally {
    release.resolve();
    if (old) await old;
    f.close();
  }
});

test("a newer no-op registration still invalidates an older pending manifest", async () => {
  const f = await fixture(),
    entered = deferred(),
    release = deferred();
  let old: Promise<request.Response> | undefined;
  try {
    f.controls.capabilities = async () => manifest("same-adapter", 77, 170);
    await f.registration().expect(201);
    const before = await f.machine();
    let observations = 0;
    f.controls.capabilities = async () => {
      if (++observations === 1) {
        entered.resolve();
        await release.promise;
        return manifest("old-adapter-A");
      }
      return manifest("same-adapter", 77, 170);
    };
    old = f.registration().then((response) => response);
    await entered.promise;
    await f.registration(f.peer).expect(201);
    const saved = await f.store.read(),
      after = await f.machine();
    const { registrationId: oldId, ...beforeValues } = before as Machine & {
      registrationId?: string;
    };
    const { registrationId: newId, ...afterValues } = after as Machine & {
      registrationId?: string;
    };
    assert.deepEqual(
      afterValues,
      beforeValues,
      "Reconfirmation changes no configuration or operational values",
    );
    release.resolve();
    assert.equal((await old).status, 409);
    assert.notEqual(
      newId,
      oldId,
      "Each accepted registration must advance its persisted identity",
    );
    assert.deepEqual(await f.store.read(), saved);
  } finally {
    release.resolve();
    if (old) await old;
    f.close();
  }
});

test("a late registration preserves owner stock and policy settings applied while capabilities were pending", async () => {
  const f = await fixture(),
    entered = deferred(),
    release = deferred();
  let old: Promise<request.Response> | undefined;
  try {
    f.controls.capabilities = async () => {
      entered.resolve();
      await release.promise;
      return manifest("old-adapter-A");
    };
    old = f.registration().then((response) => response);
    await entered.promise;
    await f.peer
      .patch("/api/owner/machines/phomemo_01")
      .send({
        mediaRemaining: 77,
        maxJobSeconds: 170,
        policy: { authorizedArtwork: true, maxQuantity: 2 },
      })
      .expect(200);
    const saved = await f.store.read();
    release.resolve();
    assert.equal((await old).status, 409);
    assert.deepEqual(await f.store.read(), saved);
    const current = await f.machine();
    assert.equal(current.mediaRemaining, 77);
    assert.equal(current.maxJobSeconds, 170);
    assert.equal(current.policy?.maxQuantity, 2);
    assert.equal(
      f.calls.filter((call) => call.tool.startsWith("/machines/")).length,
      1,
    );
  } finally {
    release.resolve();
    if (old) await old;
    f.close();
  }
});

for (const acknowledgement of ["accepted", "unconfirmed"] as const)
  test(`a newer ${acknowledgement} identical policy observation fences an older registration without changing calibration context`, async () => {
    const f = await fixture(),
      entered = deferred(),
      release = deferred();
    let old: Promise<request.Response> | undefined;
    try {
      if (acknowledgement === "unconfirmed") {
        await mutate(f.store, (state) => {
          Object.assign(state.machines.phomemo_01, {
            policyReconciliationRequired: true,
            ready: false,
            paused: true,
            reason:
              "Machine policy may differ from saved settings. Synchronize current settings, inspect and resume.",
          });
        });
        f.controls.policyError = true;
      }
      const before = await f.machine();
      f.controls.capabilities = async () => {
        entered.resolve();
        await release.promise;
        return manifest("outdated-adapter");
      };
      old = f.registration().then((response) => response);
      await entered.promise;
      await f.peer
        .patch("/api/owner/machines/phomemo_01")
        .send({
          mediaRemaining: before.mediaRemaining,
          maxJobSeconds: before.maxJobSeconds,
          policy: before.policy,
        })
        .expect(acknowledgement === "accepted" ? 200 : 503);
      const saved = await f.store.read(),
        after = await f.machine();
      const { policyObservationId: beforeObservation, ...beforeValues } =
        before;
      const { policyObservationId: afterObservation, ...afterValues } = after;
      assert.deepEqual(afterValues, beforeValues);
      assert.equal(
        calibrationDeviceContext(after),
        calibrationDeviceContext(before),
      );
      assert.equal(
        machineInspectionFingerprint(after),
        machineInspectionFingerprint(before),
      );
      assert.equal(typeof afterObservation, "string");
      assert.notEqual(afterObservation, beforeObservation);
      release.resolve();
      assert.equal((await old).status, 409);
      assert.deepEqual(await f.store.read(), saved);
      assert.equal(
        f.calls.filter((call) => call.tool.endsWith("/policy")).length,
        1,
      );
    } finally {
      release.resolve();
      if (old) await old;
      f.close();
    }
  });

test("registration rechecks device, editable settings and inspection context on a CAS retry", async () => {
  for (const changed of [
    { adapterVersion: "replacement-adapter", nodeUrl: "http://127.0.0.1:3" },
    { mediaRemaining: 77, maxJobSeconds: 170 },
    { activeJobId: "new-customer-execution" },
    {
      reservation: {
        jobId: "new-reserved-order",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    },
    {
      calibrated: true,
      calibrationAt: "2026-10-23T14:00:00.000Z",
      ready: true,
      paused: false,
      reason: "New owner inspection",
    },
  ]) {
    const f = await fixture(),
      original = f.store.compareAndSet.bind(f.store);
    let winner: Awaited<ReturnType<typeof f.store.read>> | undefined;
    try {
      let injected = false;
      f.store.compareAndSet = async (version, state) => {
        if (!injected) {
          injected = true;
          const fresh = await f.store.read();
          Object.assign(fresh.data.machines.phomemo_01, changed);
          assert.equal(await original(fresh.version, fresh.data), true);
          winner = await f.store.read();
          return false;
        }
        return original(version, state);
      };
      const rejected = await f.registration();
      f.store.compareAndSet = original;
      assert.equal(rejected.status, 409);
      assert(winner);
      assert.deepEqual(await f.store.read(), winner);
      assert.equal(f.calls.length, 1);
    } finally {
      f.store.compareAndSet = original;
      f.close();
    }
  }
});

test("unrelated global revisions do not reject registration and configured URL overlay does not invalidate its original snapshot", async () => {
  const f = await fixture(),
    original = f.store.compareAndSet.bind(f.store);
  let armRegistrationCas = false;
  try {
    assert.equal((await f.machine()).nodeUrl, undefined);
    f.controls.capabilities = async (selected) => {
      assert.equal(
        selected?.nodeUrl,
        process.env.FABRARY_PHOMEMO_NODE_URL ?? "http://127.0.0.1:2",
      );
      await mutate(f.store, (state) => {
        state.machines.instax_01.reason =
          "Unrelated machine change during capabilities";
      });
      armRegistrationCas = true;
      return manifest("accepted-adapter");
    };
    let injected = false;
    f.store.compareAndSet = async (version, state) => {
      if (armRegistrationCas && !injected) {
        injected = true;
        const fresh = await f.store.read();
        fresh.data.machines.bambu_01.reason = "Unrelated CAS winner";
        assert.equal(await original(fresh.version, fresh.data), true);
        return false;
      }
      return original(version, state);
    };
    await f.registration().expect(201);
    f.store.compareAndSet = original;
    const state = await f.service.read();
    assert.equal(state.machines.phomemo_01.adapterVersion, "accepted-adapter");
    assert.equal(
      state.machines.phomemo_01.nodeUrl,
      process.env.FABRARY_PHOMEMO_NODE_URL ?? "http://127.0.0.1:2",
    );
    assert.equal(
      state.machines.instax_01.reason,
      "Unrelated machine change during capabilities",
    );
    assert.equal(state.machines.bambu_01.reason, "Unrelated CAS winner");
    assert.deepEqual(state.jobs, {});
    assert.deepEqual(state.operations, {});
    assert.equal(f.calls.length, 1);
  } finally {
    f.store.compareAndSet = original;
    f.close();
  }
});
