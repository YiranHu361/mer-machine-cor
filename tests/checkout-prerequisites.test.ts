import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, now, type Machine } from "../server/model.ts";
import { Service, type Config } from "../server/service.ts";
import type { PaymentBoundary } from "../server/payments.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(testnet = false, preparedModel = false) {
  const dir = mkdtempSync(join(tmpdir(), "fabrary-checkout-prerequisites-"));
  const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  const counts = { challenge: 0, collect: 0 };
  const outcome = { pending: false };
  const payment: PaymentBoundary = {
    mode: testnet ? "testnet" : "mock",
    async challenge() {
      counts.challenge++;
      return { fixture: "offline authorization offer" };
    },
    async collect(_job, operation) {
      counts.collect++;
      return {
        status: outcome.pending ? "pending" : "confirmed",
        reference: `offline:${operation.id}`,
        reason: "Offline fixture; no funds moved.",
      };
    },
    async transfer() {
      throw Error("No transfer may occur in this fixture");
    },
    async reconcile() {
      throw Error("No settlement lookup may occur in this fixture");
    },
  };
  // Metadata-only capacity fixture; no sliced file or device is used.
  const model = {
    id: "short_model",
    artifactId: "art",
    sha256: "a".repeat(64),
    widthMm: 40,
    heightMm: 40,
    depthMm: 10,
    material: "pla",
    color: "white",
    estimatedSeconds: 30,
  };
  const config: Config = {
    mode: "simulation",
    paymentMode: payment.mode,
    storeMode: "sqlite-development",
    assetOrigin: "http://127.0.0.1:1/assets",
    secret: "offline-checkout-secret",
    quoteMs: 120000,
    pickupMs: 10000,
    ownerCode: "offline-checkout-owner",
    dataDir: dir,
    nodeUrl: "http://127.0.0.1:1",
    ...(preparedModel ? { catalog: [model] } : {}),
  };
  const service = new Service(
    store,
    {
      token() {
        throw Error("No device token may be issued");
      },
      async call() {
        throw Error("No physical device may be called");
      },
    },
    payment,
    config,
  );
  const machineId = preparedModel ? "bambu_01" : "phomemo_01";
  await mutate(store, (s) => {
    Object.assign(s.machines[machineId], {
      paired: true,
      configured: true,
      calibrated: true,
      listed: true,
      ready: true,
      paused: false,
      mediaRemaining: 20,
      hours: { start: 0, end: 24 },
      maxJobSeconds: 60,
    });
    s.assets.art = {
      id: "art",
      ownerId: "requester",
      path: "unread-fixture",
      url: "/assets/art",
      sha256: "a".repeat(64),
      mime: "image/png",
      width: 1,
      height: 1,
      createdAt: now(),
    };
  });
  const artifact = { id: "art", url: "/assets/art", sha256: "a".repeat(64) };
  const spec = preparedModel
    ? {
        assetIds: ["art"],
        intent: "Offline prepared model checkout",
        outputType: "3d",
        widthMm: 40,
        heightMm: 40,
        depthMm: 10,
        material: "pla",
        color: "white",
        estimatedSeconds: 30,
        preparedModelId: model.id,
        permission: "authorized",
        crop: "contain",
        quantity: 1,
      }
    : {
        assetIds: ["art"],
        intent: "Offline checkout prerequisites",
        outputType: "sticker",
        widthMm: 53,
        heightMm: 50,
        quantity: 1,
        material: "thermal-paper",
        permission: "authorized",
        crop: "contain",
      };
  const created = await service.create("requester", spec, artifact);
  await service.approve(created.id, {
    specVersion: created.specVersion,
    artifactSha256: created.artifact.sha256,
  });
  const job = await service.quote(created.id);
  const change = (patch: Partial<Machine>) =>
    mutate(store, (s) => {
      Object.assign(s.machines[machineId], patch);
    });
  return {
    store,
    service,
    payment,
    counts,
    outcome,
    machineId,
    job,
    artifact,
    change,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const key = "offline-prerequisite-checkout";

test("known machine unavailability blocks a fresh collection without changing the order or ledger", async () => {
  const changes: Partial<Machine>[] = [
    { ready: false, paused: true },
    { calibrated: false },
    { listed: false },
    { paired: false },
    { configured: false },
    { mode: "hardware" },
    { activeJobId: "a-newer-execution" },
    { policyReconciliationRequired: true },
    {
      hours:
        new Date().getUTCHours() === 0
          ? { start: 1, end: 2 }
          : { start: 0, end: 1 },
    },
  ];
  for (const patch of changes) {
    const f = await fixture();
    try {
      await f.change(patch);
      const before = await f.service.read();
      await assert.rejects(f.service.checkout(f.job.id, key), {
        code: "MACHINE_NOT_READY",
      });
      assert.deepEqual(await f.service.read(), before);
      assert.deepEqual(f.counts, { challenge: 0, collect: 0 });
    } finally {
      f.close();
    }
  }
});

test("media and owner-policy changes block a fresh collection before allocating an operation", async () => {
  for (const patch of [
    { mediaRemaining: 0 },
    { material: "a-different-material" },
    { policy: { authorizedArtwork: true, maxQuantity: 0 } },
    { policy: { authorizedArtwork: false, maxQuantity: 10 } },
  ]) {
    const f = await fixture();
    try {
      await f.change(patch);
      const before = await f.service.read();
      await assert.rejects(f.service.checkout(f.job.id, key), {
        code: "POLICY_CHANGED",
      });
      assert.deepEqual(await f.service.read(), before);
      assert.equal(f.counts.collect, 0);
    } finally {
      f.close();
    }
  }
});

test("lowered prepared-model duration capacity blocks checkout for the old quote", async () => {
  const f = await fixture(false, true);
  try {
    await f.change({ maxJobSeconds: 20 });
    const before = await f.service.read();
    await assert.rejects(f.service.checkout(f.job.id, key), {
      code: "POLICY_CHANGED",
    });
    assert.deepEqual(await f.service.read(), before);
    assert.equal(f.counts.collect, 0);
  } finally {
    f.close();
  }
});

test("testnet authorization is not offered for a known unready reserved machine", async () => {
  const f = await fixture(true);
  try {
    await f.change({ paused: true, ready: false });
    await assert.rejects(f.service.checkout(f.job.id, key), {
      code: "MACHINE_NOT_READY",
    });
    assert.deepEqual(f.counts, { challenge: 0, collect: 0 });
    await f.change({ paused: false, ready: true });
    await assert.rejects(f.service.checkout(f.job.id, key), {
      code: "PAYMENT_REQUIRED",
      status: 402,
    });
    assert.deepEqual(f.counts, { challenge: 1, collect: 0 });
    assert.equal(Object.keys((await f.service.read()).operations).length, 0);
  } finally {
    f.close();
  }
});

test("a machine becoming unavailable while authorization is prepared prevents a stale payment offer", async () => {
  const f = await fixture(true),
    entered = deferred<void>(),
    pending = deferred<void>();
  try {
    f.payment.challenge = async () => {
      f.counts.challenge++;
      entered.resolve();
      await pending.promise;
      return { fixture: "held offer" };
    };
    const checkout = f.service.checkout(f.job.id, key);
    await entered.promise;
    await f.change({ ready: false, paused: true });
    pending.resolve();
    await assert.rejects(checkout, { code: "MACHINE_NOT_READY" });
    assert.equal(f.counts.collect, 0);
    assert.equal(Object.keys((await f.service.read()).operations).length, 0);
    assert.equal((await f.service.job(f.job.id)).paymentState, "unpaid");
  } finally {
    pending.resolve();
    f.close();
  }
});

test("a changed specification while authorization is prepared cannot receive the old payment offer", async () => {
  const f = await fixture(true),
    entered = deferred<void>(),
    pending = deferred<void>();
  try {
    f.payment.challenge = async () => {
      entered.resolve();
      await pending.promise;
      return { fixture: "stale offer" };
    };
    const checkout = f.service.checkout(f.job.id, key);
    await entered.promise;
    const revised = await f.service.revise(
      f.job.id,
      { ...f.job.spec, heightMm: 60 },
      f.artifact,
    );
    pending.resolve();
    await assert.rejects(checkout, { code: "QUOTE_REQUIRED" });
    assert.deepEqual(await f.service.job(f.job.id), revised);
    assert.equal(f.counts.collect, 0);
    assert.equal(Object.keys((await f.service.read()).operations).length, 0);
  } finally {
    pending.resolve();
    f.close();
  }
});

test("an existing same-key pending collection wins over a delayed authorization offer", async () => {
  const f = await fixture(true),
    entered = deferred<void>(),
    pending = deferred<void>();
  try {
    f.outcome.pending = true;
    f.payment.challenge = async () => {
      f.counts.challenge++;
      entered.resolve();
      await pending.promise;
      return { fixture: "no second signature" };
    };
    const first = f.service.checkout(f.job.id, key);
    await entered.promise;
    await f.service.checkout(f.job.id, key, { fixtureAuthorization: true });
    await f.change({ ready: false, paused: true });
    const before = await f.service.read();
    pending.resolve();
    const reply = await first;
    assert.equal(reply.paymentState, "collection_pending");
    assert.deepEqual(await f.service.read(), before);
    assert.deepEqual(f.counts, { challenge: 1, collect: 1 });
    assert.equal(Object.keys(before.operations).length, 1);
  } finally {
    pending.resolve();
    f.close();
  }
});

test("a competing machine pause is rechecked inside the collection allocation CAS retry", async () => {
  const f = await fixture();
  try {
    const original = f.store.compareAndSet.bind(f.store);
    let armed = true;
    f.store.compareAndSet = async (version, next) => {
      if (armed && Object.keys(next.operations).length) {
        armed = false;
        await f.change({ ready: false, paused: true });
      }
      return original(version, next);
    };
    await assert.rejects(f.service.checkout(f.job.id, key), {
      code: "MACHINE_NOT_READY",
    });
    const state = await f.service.read();
    assert.equal(armed, false);
    assert.equal(state.jobs[f.job.id].paymentState, "unpaid");
    assert.equal(state.machines[f.machineId].paused, true);
    assert.equal(Object.keys(state.operations).length, 0);
    assert.equal(f.counts.collect, 0);
  } finally {
    f.close();
  }
});

test("unready machines cannot erase or repeat a pending or held same-key collection", async () => {
  for (const pending of [false, true]) {
    const f = await fixture();
    try {
      f.outcome.pending = pending;
      await f.service.checkout(f.job.id, key);
      await f.change({
        ready: false,
        paused: true,
        mediaRemaining: 0,
        policyReconciliationRequired: true,
      });
      const before = await f.service.read();
      const reply = await f.service.checkout(f.job.id, key);
      assert.equal(reply.paymentState, pending ? "collection_pending" : "held");
      assert.deepEqual(await f.service.read(), before);
      await assert.rejects(
        f.service.checkout(f.job.id, "a-different-checkout-key"),
        { code: "CHECKOUT_EXISTS" },
      );
      assert.equal(f.counts.collect, 1);
      assert.equal(Object.keys(before.operations).length, 1);
    } finally {
      f.close();
    }
  }
});

test("owner repair after a rejected checkout permits one deliberate collection", async () => {
  const f = await fixture();
  try {
    await f.change({ ready: false, paused: true });
    await assert.rejects(f.service.checkout(f.job.id, key), {
      code: "MACHINE_NOT_READY",
    });
    await f.change({ ready: true, paused: false });
    const paid = await f.service.checkout(f.job.id, key);
    assert.equal(paid.paymentState, "held");
    await f.service.checkout(f.job.id, key);
    assert.equal(f.counts.collect, 1);
    assert.equal(Object.keys((await f.service.read()).operations).length, 1);
  } finally {
    f.close();
  }
});
