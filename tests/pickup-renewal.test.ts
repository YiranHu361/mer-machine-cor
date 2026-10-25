import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, now, type Job } from "../server/model.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { createApp } from "../server/app.ts";

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabyn-pickup-renewal-"));
  let store = new SqliteStore(join(dir, "app.sqlite"), initialState());
  let calls = 0;
  const payment = new MockPayment();
  for (const name of ["collect", "transfer", "reconcile"] as const)
    payment[name] = async () => {
      calls++;
      throw Error("Renewal must not call payment");
    };
  const service = new Service(
    store,
    {
      token() {
        calls++;
        throw Error("Renewal must not authorize output");
      },
      async call() {
        calls++;
        throw Error("Renewal must not call Node");
      },
    },
    payment,
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:1/assets",
      secret: "isolated-renewal",
      quoteMs: 120000,
      pickupMs: 60000,
      ownerCode: "isolated-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
    },
  );
  await mutate(store, (s) => {
    const job: Job = {
      id: "pickup_item",
      requesterId: "requester",
      machineId: "phomemo_01",
      attemptId: "original_attempt",
      specVersion: 1,
      spec: {
        assetIds: ["fixture"],
        intent: "Stored item",
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
      productionState: "produced",
      paymentState: "released",
      fulfillmentState: "ready_for_pickup",
      pickup: {
        code: "OLDSECRET123",
        expiresAt: new Date(Date.now() - 10000).toISOString(),
      },
      history: [],
      createdAt: now(),
      updatedAt: now(),
      version: 7,
    };
    s.jobs[job.id] = job;
    s.jobs.next_item = {
      ...structuredClone(job),
      id: "next_item",
      productionState: "running",
      fulfillmentState: "unprepared",
      pickup: undefined,
    };
    s.machines.phomemo_01.activeJobId = "next_item";
    s.machines.phomemo_01.mediaRemaining = 37;
  });
  return {
    service,
    dir,
    get store() {
      return store;
    },
    calls: () => calls,
    async body(key = "explicit-renewal-one") {
      const job = await service.job("pickup_item");
      return {
        idempotencyKey: key,
        expectedVersion: job.version,
        expectedExpiresAt: job.pickup!.expiresAt,
      };
    },
    reopen() {
      store.close();
      store = new SqliteStore(join(dir, "app.sqlite"), initialState());
      service.store = store;
    },
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("owner renewal changes only the expired pickup epoch; old code fails and new code redeems once", async () => {
  const f = await fixture();
  try {
    const before = await f.service.read(),
      prior = before.jobs.pickup_item;
    const renewed = await f.service.renewPickup(prior.id, await f.body());
    assert.notEqual(renewed.pickup!.code, prior.pickup!.code);
    assert(Date.parse(renewed.pickup!.expiresAt) > Date.now());
    const after = await f.service.read();
    assert.deepEqual(after.machines, before.machines);
    assert.deepEqual(after.operations, before.operations);
    assert.deepEqual(after.jobs.next_item, before.jobs.next_item);
    for (const key of Object.keys(prior) as (keyof Job)[])
      if (!["pickup", "history", "version", "updatedAt"].includes(key))
        assert.deepEqual(renewed[key], prior[key]);
    assert.equal(renewed.fulfillmentState, "ready_for_pickup");
    await assert.rejects(f.service.redeem(prior.id, prior.pickup!.code), {
      code: "PICKUP_INVALID",
    });
    assert.equal(
      (await f.service.redeem(prior.id, renewed.pickup!.code)).fulfillmentState,
      "collected",
    );
    await assert.rejects(f.service.redeem(prior.id, renewed.pickup!.code), {
      code: "PICKUP_USED",
    });
    assert.equal(f.calls(), 0);
  } finally {
    f.close();
  }
});
test("live, unprepared, nonproduced, collected, redeemed and unknown-expiry pickups cannot renew", async () => {
  for (const change of [
    (j: Job) => {
      j.pickup!.expiresAt = new Date(Date.now() + 60000).toISOString();
    },
    (j: Job) => {
      j.fulfillmentState = "unprepared";
    },
    (j: Job) => {
      j.productionState = "failed";
    },
    (j: Job) => {
      j.fulfillmentState = "collected";
    },
    (j: Job) => {
      j.pickup!.redeemedAt = now();
    },
    (j: Job) => {
      j.pickup!.expiresAt = "unknown";
    },
  ]) {
    const f = await fixture();
    try {
      await mutate(f.store, (s) => change(s.jobs.pickup_item));
      const before = await f.store.read();
      await assert.rejects(
        f.service.renewPickup("pickup_item", await f.body()),
      );
      assert.deepEqual(await f.store.read(), before);
      assert.equal(f.calls(), 0);
    } finally {
      f.close();
    }
  }
});
test("exact expiry equality is renewable for the configured pickup duration", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-10-23T14:00:00.000Z"),
  });
  const f = await fixture();
  try {
    await mutate(f.store, (s) => {
      s.jobs.pickup_item.pickup!.expiresAt = now();
    });
    const renewed = await f.service.renewPickup("pickup_item", await f.body());
    assert.equal(renewed.pickup!.expiresAt, "2026-10-23T14:01:00.000Z");
    assert.equal(
      renewed.pickupRenewals![0].renewedAt,
      "2026-10-23T14:00:00.000Z",
    );
  } finally {
    f.close();
  }
});
test("same-key concurrent renewal commits one code and one event", async () => {
  const f = await fixture();
  try {
    const body = await f.body();
    const results = await Promise.all([
      f.service.renewPickup("pickup_item", body),
      f.service.renewPickup("pickup_item", body),
    ]);
    assert.equal(results[0].pickup!.code, results[1].pickup!.code);
    const job = await f.service.job("pickup_item");
    assert.equal(job.pickupRenewals!.length, 1);
    assert.equal(
      job.history.filter((h) => h.event === "pickup_code_renewed").length,
      1,
    );
  } finally {
    f.close();
  }
});
test("different-key concurrent intents cannot replace the winning valid code", async () => {
  const f = await fixture();
  try {
    const a = await f.body(),
      b = { ...a, idempotencyKey: "explicit-renewal-two" };
    const results = await Promise.allSettled([
      f.service.renewPickup("pickup_item", a),
      f.service.renewPickup("pickup_item", b),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.equal(
      (await f.service.job("pickup_item")).pickupRenewals!.length,
      1,
    );
  } finally {
    f.close();
  }
});
test("all exact renewal identities survive newer generations, collection and store reopen", async () => {
  const f = await fixture();
  try {
    const a = await f.body();
    await f.service.renewPickup("pickup_item", a);
    await mutate(f.store, (s) => {
      s.jobs.pickup_item.pickup!.expiresAt = new Date(
        Date.now() - 1,
      ).toISOString();
    });
    const b = await f.body("explicit-renewal-two"),
      latest = await f.service.renewPickup("pickup_item", b);
    const collected = await f.service.redeem(
      "pickup_item",
      latest.pickup!.code,
    );
    f.reopen();
    const before = await f.store.read();
    for (const body of [a, b])
      assert.deepEqual(
        await f.service.renewPickup("pickup_item", body),
        collected,
      );
    assert.deepEqual(await f.store.read(), before);
    await assert.rejects(
      f.service.renewPickup(
        "pickup_item",
        await f.body("explicit-renewal-three"),
      ),
      { code: "PICKUP_UNAVAILABLE" },
    );
  } finally {
    f.close();
  }
});
test("a lost acknowledgement after commit replays the saved epoch without rotation", async () => {
  const f = await fixture();
  try {
    const body = await f.body(),
      cas = f.store.compareAndSet.bind(f.store);
    let armed = true;
    f.store.compareAndSet = async (v, s) => {
      const ok = await cas(v, s);
      if (ok && armed && s.jobs.pickup_item.pickupRenewals?.length) {
        armed = false;
        throw Error("lost commit acknowledgement");
      }
      return ok;
    };
    await assert.rejects(
      f.service.renewPickup("pickup_item", body),
      /lost commit acknowledgement/,
    );
    const before = await f.store.read();
    f.reopen();
    assert.deepEqual(
      await f.service.renewPickup("pickup_item", body),
      before.data.jobs.pickup_item,
    );
    assert.deepEqual(await f.store.read(), before);
  } finally {
    f.close();
  }
});
test("CAS retry sees a competing collection and cannot reopen pickup", async () => {
  const f = await fixture();
  try {
    const body = await f.body(),
      cas = f.store.compareAndSet.bind(f.store);
    let armed = true;
    f.store.compareAndSet = async (v, s) => {
      if (armed && s.jobs.pickup_item.pickupRenewals?.length) {
        armed = false;
        await mutate(f.store, (fresh) => {
          fresh.jobs.pickup_item.fulfillmentState = "collected";
          fresh.jobs.pickup_item.pickup!.redeemedAt = now();
        });
      }
      return cas(v, s);
    };
    await assert.rejects(f.service.renewPickup("pickup_item", body), {
      code: "PICKUP_UNAVAILABLE",
    });
    const job = await f.service.job("pickup_item");
    assert.equal(job.fulfillmentState, "collected");
    assert.equal(job.pickupRenewals, undefined);
  } finally {
    f.close();
  }
});
test("malformed, changed-body and stale pickup intents preserve exact state", async () => {
  const f = await fixture();
  try {
    const body = await f.body();
    for (const invalid of [
      null,
      [],
      {},
      { ...body, extra: true },
      { ...body, expectedVersion: "7" },
      { ...body, expectedVersion: 0 },
      { ...body, expectedExpiresAt: "unknown" },
      { ...body, idempotencyKey: "short" },
      { ...body, idempotencyKey: " ".repeat(8) },
    ]) {
      const before = await f.store.read();
      await assert.rejects(f.service.renewPickup("pickup_item", invalid), {
        code: "PICKUP_RENEWAL_REQUIRED",
      });
      assert.deepEqual(await f.store.read(), before);
    }
    await assert.rejects(
      f.service.renewPickup("pickup_item", {
        ...body,
        expectedVersion: body.expectedVersion + 1,
      }),
      { code: "PICKUP_CHANGED" },
    );
    await f.service.renewPickup("pickup_item", body);
    const before = await f.store.read();
    await assert.rejects(
      f.service.renewPickup("pickup_item", {
        ...body,
        expectedVersion: body.expectedVersion + 1,
      }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    assert.deepEqual(await f.store.read(), before);
  } finally {
    f.close();
  }
});
test("HTTP renewal is owner-only and uses current requester reads for the new code", async () => {
  const f = await fixture();
  try {
    const app = createApp(f.service),
      body = await f.body(),
      path = "/api/owner/jobs/pickup_item/renew-pickup";
    await request(app).post(path).send(body).expect(401);
    const requester = request.agent(app),
      owner = request.agent(app);
    const login = await requester
      .post("/api/session")
      .send({ role: "requester" })
      .expect(200);
    await mutate(f.store, (s) => {
      s.jobs.pickup_item.requesterId = login.body.id;
    });
    await requester.post(path).send(body).expect(403);
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "isolated-owner" })
      .expect(200);
    const renewed = await owner.post(path).send(body).expect(200);
    assert.equal(renewed.body.job.fulfillmentState, "ready_for_pickup");
    const read = await requester.get("/api/jobs/pickup_item").expect(200);
    assert.equal(read.body.job.pickup.code, renewed.body.job.pickup.code);
    assert.notEqual(read.body.job.pickup.code, "OLDSECRET123");
    const foreign = request.agent(app);
    await foreign.post("/api/session").send({ role: "requester" }).expect(200);
    await foreign.get("/api/jobs/pickup_item").expect(403);
    assert.equal(f.calls(), 0);
  } finally {
    f.close();
  }
});

test("independent SQLite clients cannot let competing renewal intents rotate the winning code", async () => {
  const f = await fixture();
  const secondStore = new SqliteStore(
    join(f.dir, "app.sqlite"),
    initialState(),
  );
  const second = new Service(
    secondStore,
    f.service.node,
    f.service.payment,
    f.service.config,
  );
  try {
    const body = await f.body();
    const results = await Promise.allSettled([
      f.service.renewPickup("pickup_item", body),
      second.renewPickup("pickup_item", {
        ...body,
        idempotencyKey: "independent-other-intent",
      }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    const saved = await f.store.read();
    assert.equal(saved.data.jobs.pickup_item.pickupRenewals?.length, 1);
    assert.equal(
      saved.data.jobs.pickup_item.history.filter(
        (h) => h.event === "pickup_code_renewed",
      ).length,
      1,
    );
    const winner = saved.data.jobs.pickup_item.pickupRenewals![0];
    const replay = await second.renewPickup("pickup_item", {
      idempotencyKey: winner.key,
      expectedVersion: winner.expectedVersion,
      expectedExpiresAt: winner.expectedExpiresAt,
    });
    assert.equal(replay.pickup!.code, saved.data.jobs.pickup_item.pickup!.code);
    assert.deepEqual(await f.store.read(), saved);
    assert.equal(f.calls(), 0);
  } finally {
    secondStore.close();
    f.close();
  }
});

test("renewal HTTP malformed/unknown identities preserve state after owner authentication", async () => {
  const f = await fixture();
  try {
    const app = createApp(f.service),
      owner = request.agent(app);
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "isolated-owner" })
      .expect(200);
    const before = await f.store.read(),
      body = await f.body();
    for (const id of ["missing", "__proto__", "constructor", "toString"])
      await owner
        .post(`/api/owner/jobs/${id}/renew-pickup`)
        .send(body)
        .expect(404);
    for (const b of [
      { ...body, idempotencyKey: 123456789 },
      { ...body, idempotencyKey: "a".repeat(201) },
      { ...body, expectedVersion: 7.5 },
      { ...body, expectedExpiresAt: {} },
      [body],
    ])
      await owner
        .post("/api/owner/jobs/pickup_item/renew-pickup")
        .send(b)
        .expect(422);
    await owner.get("/api/owner/jobs/pickup_item/renew-pickup").expect(404);
    assert.deepEqual(await f.store.read(), before);
    assert.equal(f.calls(), 0);
  } finally {
    f.close();
  }
});
