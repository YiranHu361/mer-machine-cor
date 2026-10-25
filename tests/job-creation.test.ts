import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, type Spec, type Job } from "../server/model.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { createApp } from "../server/app.ts";

const key = "create-request-fixture-001";
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const specification = (assetId = "creation_art_a"): Spec => ({
  assetIds: [assetId],
  intent: "Authorized repeated club sticker",
  outputType: "sticker",
  widthMm: 53,
  heightMm: 50,
  quantity: 1,
  material: "thermal-paper",
  permission: "authorized",
  crop: "contain",
});
async function until(check: () => boolean | Promise<boolean>) {
  const limit = Date.now() + 5000;
  while (!(await check())) {
    assert(
      Date.now() < limit,
      "The controlled preparation gate did not settle",
    );
    await new Promise((done) => setTimeout(done, 5));
  }
}
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabyn-creation-")),
    originalPath = process.env.PATH;
  mkdirSync(join(dir, "assets"));
  mkdirSync(join(dir, "bin"));
  const gate = join(dir, "gate-next-preparation"),
    entered = join(dir, "preparation-entered"),
    release = join(dir, "release-preparation"),
    preparations = join(dir, "preparations");
  writeFileSync(
    join(dir, "bin", "uv"),
    `#!${process.execPath}\nconst fs=require('node:fs'); const a=process.argv.slice(2); if(a[3]!=='fabyn-prepare')process.exit(90); async function main(){let held=false;try{fs.renameSync(${JSON.stringify(gate)},${JSON.stringify(entered)});held=true;}catch{} fs.appendFileSync(${JSON.stringify(preparations)},a[5]+'\\n');if(held){while(!fs.existsSync(${JSON.stringify(release)}))await new Promise(r=>setTimeout(r,5));}fs.copyFileSync(a[4],a[5]);}main().catch(()=>process.exit(91));\n`,
    { mode: 0o755 },
  );
  process.env.PATH = `${join(dir, "bin")}:${originalPath ?? ""}`;
  const dbPath = join(dir, "app.sqlite"),
    store = new SqliteStore(dbPath, initialState()),
    peerStore = new SqliteStore(dbPath, initialState());
  const config = {
    mode: "simulation" as const,
    paymentMode: "mock" as const,
    storeMode: "sqlite-development",
    assetOrigin: "http://127.0.0.1:4318/assets",
    secret: "isolated-creation-test",
    quoteMs: 120000,
    pickupMs: 10000,
    ownerCode: "isolated-creation-owner",
    dataDir: dir,
    nodeUrl: "http://127.0.0.1:1",
  };
  const noNode = {
    async call() {
      throw new Error("No node calls in creation fixtures");
    },
    token() {
      throw new Error("No dispatch in creation fixtures");
    },
  };
  const service = new Service(store, noNode, new MockPayment(), config),
    peerService = new Service(peerStore, noNode, new MockPayment(), config),
    app = createApp(service),
    peerApp = createApp(peerService),
    a = request.agent(app),
    b = request.agent(app),
    owner = request.agent(app);
  const session = await a
      .post("/api/session")
      .send({ role: "requester" })
      .expect(200),
    otherSession = await b
      .post("/api/session")
      .send({ role: "requester" })
      .expect(200);
  await owner
    .post("/api/session")
    .send({ role: "owner", accessCode: config.ownerCode })
    .expect(200);
  const cookie = (
    session.headers["set-cookie"] as unknown as string[]
  )[0].split(";")[0];
  await mutate(store, (state) => {
    for (const [id, ownerId] of [
      ["creation_art_a", session.body.id],
      ["creation_art_b", otherSession.body.id],
    ]) {
      const path = join(dir, "assets", id);
      writeFileSync(path, image);
      state.assets[id] = {
        id,
        ownerId,
        path,
        url: `/assets/${id}`,
        mime: "image/png",
        sha256: createHash("sha256").update(image).digest("hex"),
        width: 1,
        height: 1,
        createdAt: new Date().toISOString(),
      };
    }
  });
  const preparedPaths = () =>
    existsSync(preparations)
      ? readFileSync(preparations, "utf8").trim().split("\n")
      : [];
  return {
    dir,
    store,
    peerStore,
    service,
    peerService,
    app,
    peerApp,
    a,
    b,
    owner,
    cookie,
    requesterId: session.body.id as string,
    preparedPaths,
    async holdNext() {
      writeFileSync(gate, "hold");
    },
    async waitEntered() {
      await until(() => existsSync(entered));
    },
    release() {
      writeFileSync(release, "release");
    },
    close() {
      writeFileSync(release, "release");
      store.close();
      peerStore.close();
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("creation keys validate before preparation or mutation while omitted keys retain distinct-order semantics", async () => {
  const f = await fixture();
  try {
    const before = await f.store.read();
    for (const invalid of [
      "",
      "short",
      "a".repeat(201),
      "request one",
      "request,one",
      "request-éé",
      "request-one, request-two",
    ]) {
      const response = await f.a
        .post("/api/jobs")
        .set("Idempotency-Key", invalid)
        .send(specification())
        .expect(400);
      assert.equal(response.body.error.code, "INVALID_CREATION_REQUEST_ID");
      assert.deepEqual(await f.store.read(), before);
      assert.equal(f.preparedPaths().length, 0);
    }
    await f.a
      .post("/api/jobs")
      .set("Idempotency-Key", key)
      .send({ ...specification(), heightMm: 0 })
      .expect(422);
    assert.deepEqual(await f.store.read(), before);
    assert.equal(f.preparedPaths().length, 0);
    const legacyA = await f.a
        .post("/api/jobs")
        .send(specification())
        .expect(201),
      legacyB = await f.a.post("/api/jobs").send(specification()).expect(201);
    assert.notEqual(legacyA.body.job.id, legacyB.body.job.id);
    assert.equal(legacyA.body.job.creationRequestId, undefined);
    for (const valid of ["key00001", "a".repeat(200)])
      await f.a
        .post("/api/jobs")
        .set("Idempotency-Key", valid)
        .send(specification())
        .expect(201);
    assert.equal(f.preparedPaths().length, 4);
  } finally {
    f.close();
  }
});

test("a replay returns the current order for its original normalized payload after revision and cancellation without preparing again", async () => {
  const f = await fixture();
  try {
    const first = await f.a
        .post("/api/jobs")
        .set("Idempotency-Key", key)
        .send({ ...specification(), intent: `  ${specification().intent}  ` })
        .expect(201),
      id = first.body.job.id;
    assert.equal(first.body.job.creationRequestId, key);
    assert.equal(first.body.job.creationSpecHash, undefined);
    const storedHash = (await f.store.read()).data.jobs[id].creationSpecHash;
    assert.match(storedHash!, /^[0-9a-f]{64}$/);
    await f.a
      .patch(`/api/jobs/${id}/spec`)
      .send({ ...specification(), heightMm: 51 })
      .expect(200);
    const revised = await f.store.read();
    const replay = await f.a
      .post("/api/jobs")
      .set("Idempotency-Key", key)
      .send(specification())
      .expect(200);
    assert.equal(replay.body.job.id, id);
    assert.equal(replay.body.job.spec.heightMm, 51);
    assert.equal(replay.body.job.version, revised.data.jobs[id].version);
    assert.deepEqual(await f.store.read(), revised);
    const conflicting = await f.a
      .post("/api/jobs")
      .set("Idempotency-Key", key)
      .send({ ...specification(), heightMm: 51 })
      .expect(409);
    assert.equal(conflicting.body.error.code, "CREATION_REQUEST_CONFLICT");
    assert.deepEqual(await f.store.read(), revised);
    assert.equal(f.preparedPaths().length, 2);
    await f.service.cancel(id);
    unlinkSync(join(f.dir, "assets", "creation_art_a"));
    const cancelled = await f.store.read();
    const cancelledReplay = await f.a
      .post("/api/jobs")
      .set("Idempotency-Key", key)
      .send(specification())
      .expect(200);
    assert.equal(cancelledReplay.body.job.productionState, "cancelled");
    assert.equal(cancelledReplay.body.job.id, id);
    assert.deepEqual(await f.store.read(), cancelled);
    assert.equal(cancelled.data.jobs[id].creationSpecHash, storedHash);
    assert.equal(f.preparedPaths().length, 2);
    for (const jobs of [
      (await f.a.get("/api/jobs").expect(200)).body.jobs,
      (await f.owner.get("/api/owner/dashboard").expect(200)).body.jobs,
    ]) {
      assert.equal(jobs[0].creationRequestId, key);
      assert.equal(Object.hasOwn(jobs[0], "creationSpecHash"), false);
    }
    const detail = (await f.a.get(`/api/jobs/${id}`).expect(200)).body.job;
    assert.equal(Object.hasOwn(detail, "creationSpecHash"), false);
  } finally {
    f.close();
  }
});

test("same-request peers share one preparation while other keys remain independent and queued conflicts never prepare", async () => {
  const f = await fixture();
  const pending: Promise<request.Response>[] = [];
  try {
    await f.holdNext();
    pending.push(
      f.a
        .post("/api/jobs")
        .set("Idempotency-Key", key)
        .send(specification())
        .then((r) => r),
    );
    await f.waitEntered();
    pending.push(
      f.a
        .post("/api/jobs")
        .set("Idempotency-Key", key)
        .send(specification())
        .then((r) => r),
    );
    pending.push(
      f.a
        .post("/api/jobs")
        .set("Idempotency-Key", key)
        .send({ ...specification(), heightMm: 52 })
        .then((r) => r),
    );
    await f.a
      .post("/api/jobs")
      .set("Idempotency-Key", "independent-request")
      .send(specification())
      .expect(201);
    assert.equal(f.preparedPaths().length, 2);
    assert.equal(Object.keys((await f.store.read()).data.jobs).length, 1);
    f.release();
    const [first, replay, conflict] = await Promise.all(pending);
    assert.equal(first.status, 201);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.job.id, first.body.job.id);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, "CREATION_REQUEST_CONFLICT");
    assert.equal(f.preparedPaths().length, 2);
    assert.equal(Object.keys((await f.store.read()).data.jobs).length, 2);
  } finally {
    f.release();
    await Promise.allSettled(pending);
    f.close();
  }
});

test("independent backend queues may prepare twice but bind concurrent same-key HTTP requests to one saved job", async () => {
  for (const conflictingPayload of [false, true]) {
    const f = await fixture();
    let first: Promise<request.Response> | undefined;
    try {
      await f.holdNext();
      first = f.a
        .post("/api/jobs")
        .set("Idempotency-Key", key)
        .send(specification())
        .then((r) => r);
      await f.waitEntered();
      const peer = await request(f.peerApp)
        .post("/api/jobs")
        .set("Cookie", f.cookie)
        .set("Idempotency-Key", key)
        .send({ ...specification(), heightMm: conflictingPayload ? 51 : 50 })
        .expect(201);
      f.release();
      const replay = await first;
      assert.equal(replay.status, conflictingPayload ? 409 : 200);
      if (conflictingPayload)
        assert.equal(replay.body.error.code, "CREATION_REQUEST_CONFLICT");
      else assert.equal(replay.body.job.id, peer.body.job.id);
      const saved = await f.store.read();
      assert.equal(Object.keys(saved.data.jobs).length, 1);
      assert.equal(
        saved.data.jobs[peer.body.job.id].spec.heightMm,
        conflictingPayload ? 51 : 50,
      );
      assert.equal(f.preparedPaths().length, 2);
      for (const path of f.preparedPaths())
        assert(
          existsSync(path),
          "Registered concurrent previews remain private retained assets",
        );
      assert.equal(
        Object.values(saved.data.assets).filter((asset) =>
          asset.id.startsWith("preview_"),
        ).length,
        2,
      );
      assert.deepEqual(saved.data.operations, {});
    } finally {
      f.release();
      await first?.catch(() => {});
      f.close();
    }
  }
});

test("CAS retries recheck the scoped original payload binding before inserting another job", async () => {
  const f = await fixture();
  const originalCas = f.store.compareAndSet.bind(f.store);
  try {
    let winner: Job | undefined;
    f.store.compareAndSet = async (version, data) => {
      const attempted = Object.values(data.jobs).find(
        (job) => job.creationRequestId === key,
      );
      if (!winner && attempted) {
        winner = await f.peerService.create(
          f.requesterId,
          specification(),
          attempted.artifact,
          key,
        );
        return false;
      }
      return originalCas(version, data);
    };
    const response = await f.a
      .post("/api/jobs")
      .set("Idempotency-Key", key)
      .send(specification())
      .expect(200);
    f.store.compareAndSet = originalCas;
    assert.equal(response.body.job.id, winner!.id);
    assert.equal(Object.keys((await f.store.read()).data.jobs).length, 1);
    assert.equal(f.preparedPaths().length, 1);
    await assert.rejects(
      f.service.create(
        f.requesterId,
        { ...specification(), heightMm: 51 },
        winner!.artifact,
        key,
      ),
      (error: any) => error.code === "CREATION_REQUEST_CONFLICT",
    );
  } finally {
    f.store.compareAndSet = originalCas;
    f.close();
  }
});

test("creation keys belong to one requester and cannot expose or reuse another requester's order", async () => {
  const f = await fixture();
  try {
    const a = await f.a
      .post("/api/jobs")
      .set("Idempotency-Key", key)
      .send(specification())
      .expect(201);
    await f.b
      .post("/api/jobs")
      .set("Idempotency-Key", key)
      .send(specification())
      .expect(403);
    const b = await f.b
      .post("/api/jobs")
      .set("Idempotency-Key", key)
      .send(specification("creation_art_b"))
      .expect(201);
    assert.notEqual(a.body.job.id, b.body.job.id);
    assert.equal(a.body.job.creationRequestId, b.body.job.creationRequestId);
    assert.equal((await f.a.get("/api/jobs").expect(200)).body.jobs.length, 1);
    assert.equal(
      (await f.b.get("/api/jobs").expect(200)).body.jobs[0].id,
      b.body.job.id,
    );
    await f.b.get(`/api/jobs/${a.body.job.id}`).expect(403);
    await request(f.app)
      .post("/api/jobs")
      .set("Idempotency-Key", key)
      .send(specification())
      .expect(401);
    await f.owner
      .post("/api/jobs")
      .set("Idempotency-Key", key)
      .send(specification())
      .expect(403);
    assert.equal(f.preparedPaths().length, 2);
  } finally {
    f.close();
  }
});

test("throw-after-commit creation replays the same job without another preparation or state mutation", async () => {
  const f = await fixture();
  const originalCas = f.store.compareAndSet.bind(f.store);
  try {
    let injected = false;
    f.store.compareAndSet = async (version, data) => {
      if (
        !injected &&
        Object.values(data.jobs).some((job) => job.creationRequestId === key)
      ) {
        injected = true;
        assert.equal(await originalCas(version, data), true);
        throw new Error("Isolated lost create acknowledgement after commit");
      }
      return originalCas(version, data);
    };
    const uncertain = await f.a
      .post("/api/jobs")
      .set("Idempotency-Key", key)
      .send(specification())
      .expect(500);
    f.store.compareAndSet = originalCas;
    assert.doesNotMatch(uncertain.body.error.message, /Isolated lost/);
    const committed = await f.store.read(),
      saved = Object.values(committed.data.jobs)[0];
    assert.equal(saved.creationRequestId, key);
    assert(existsSync(committed.data.assets[saved.artifact.id].path));
    const replay = await f.a
      .post("/api/jobs")
      .set("Idempotency-Key", key)
      .send(specification())
      .expect(200);
    assert.equal(replay.body.job.id, saved.id);
    assert.equal(replay.body.job.creationSpecHash, undefined);
    assert.deepEqual(await f.store.read(), committed);
    assert.equal(f.preparedPaths().length, 1);
    assert.deepEqual(committed.data.operations, {});
  } finally {
    f.store.compareAndSet = originalCas;
    f.close();
  }
});
