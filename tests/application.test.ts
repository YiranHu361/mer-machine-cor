import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState } from "../server/model.ts";
import { Service, type Config } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { createApp } from "../server/app.ts";
import { HttpNode } from "../server/node-client.ts";
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabrary-http-"));
  const store = new SqliteStore(join(dir, "app.sqlite"), initialState());
  const node = new HttpNode(
    "http://127.0.0.1:1",
    "test-key-not-real",
    "test-secret",
  );
  const cfg: Config = {
    mode: "simulation",
    paymentMode: "mock",
    storeMode: "sqlite-development",
    assetOrigin: "http://127.0.0.1:4318/assets",
    secret: "test-secret",
    quoteMs: 120000,
    pickupMs: 10000,
    ownerCode: "test-owner-code",
    dataDir: dir,
    nodeUrl: "http://127.0.0.1:1",
  };
  const service = new Service(store, node, new MockPayment(), cfg);
  const app = createApp(service);
  return {
    store,
    service,
    app,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const spec = (assetId: string) => ({
  assetIds: [assetId],
  intent: "Authorized club sticker",
  outputType: "sticker",
  widthMm: 53,
  heightMm: 50,
  quantity: 1,
  material: "thermal-paper",
  permission: "authorized",
  crop: "contain",
});
test("HTTP authentication, owner boundaries, private cameras and cross-origin writes", async () => {
  const f = fixture();
  try {
    await request(f.app).get("/api/owner/dashboard").expect(401);
    await request(f.app)
      .post("/api/session")
      .send({ role: "owner", accessCode: "wrong" })
      .expect(403);
    await request(f.app)
      .post("/api/session")
      .set("Origin", "https://attacker.example")
      .send({ role: "requester" })
      .expect(403);
    const a = request.agent(f.app);
    await a.post("/api/session").send({ role: "requester" }).expect(200);
    await a.get("/api/owner/dashboard").expect(403);
    await a
      .post("/api/owner/simulation/phomemo_01")
      .send({ outcome: "pass" })
      .expect(403);
    await request(f.app).get("/api/jobs/nonexistent/evidence").expect(401);
  } finally {
    f.close();
  }
});
test("HTTP complete upload->Pillow production preview->approval->quote->mock hold with private assets", async () => {
  const f = fixture();
  try {
    const a = request.agent(f.app),
      stranger = request.agent(f.app);
    await a.post("/api/session").send({ role: "requester" }).expect(200);
    await stranger.post("/api/session").send({ role: "requester" }).expect(200);
    const uploaded = await a
      .post("/api/uploads")
      .attach("images", image, {
        filename: "club.png",
        contentType: "image/png",
      })
      .expect(201);
    const assetId = uploaded.body.assets[0].id;
    await stranger.get(`/assets/${assetId}`).expect(403);
    const created = await a.post("/api/jobs").send(spec(assetId)).expect(201);
    const job = created.body.job;
    assert.equal(job.productionState, "specified");
    const preview = await a.get(job.artifact.url).expect(200);
    assert.equal(preview.headers["content-type"], "image/png");
    const bytes = preview.body as Buffer;
    assert(bytes.length > 0);
    await stranger.get(`/api/jobs/${job.id}`).expect(403);
    await a.post(`/api/jobs/${job.id}/dispatch`).send({}).expect(409);
    await a
      .post(`/api/jobs/${job.id}/approve`)
      .send({
        specVersion: job.specVersion,
        artifactSha256: job.artifact.sha256,
      })
      .expect(200);
    await mutate(f.store, (s) =>
      Object.assign(s.machines.phomemo_01, {
        calibrated: true,
        listed: true,
        ready: true,
        paused: false,
      }),
    );
    await a.post(`/api/jobs/${job.id}/quote`).send({}).expect(200);
    const paid = await a
      .post(`/api/jobs/${job.id}/checkout`)
      .send({ idempotencyKey: "stable-key" })
      .expect(200);
    assert.equal(paid.body.job.paymentState, "held");
    assert.equal(
      (await a.get(`/api/jobs/${job.id}/receipt`).expect(200)).body.mode,
      "mock",
    );
    await a.post(`/api/jobs/${job.id}/cancel`).send({}).expect(200);
    assert.equal(
      (await a.get(`/api/jobs/${job.id}`).expect(200)).body.job.paymentState,
      "refunded",
    );
  } finally {
    f.close();
  }
});
test("HTTP deterministic unsupported input, invalid files, multi-image preview, unconfigured Claude", async () => {
  const f = fixture();
  try {
    const a = request.agent(f.app);
    await a.post("/api/session").send({ role: "requester" });
    await a
      .post("/api/uploads")
      .attach("images", Buffer.from("bad"), {
        filename: "bad.png",
        contentType: "image/png",
      })
      .expect(422);
    const uploaded = await a
      .post("/api/uploads")
      .attach("images", image, { filename: "a.png", contentType: "image/png" })
      .attach("images", image, { filename: "b.png", contentType: "image/png" })
      .expect(201);
    const assetIds = uploaded.body.assets.map((a: any) => a.id);
    await a
      .post("/api/jobs")
      .send({ ...spec(assetIds[0]), widthMm: 70 })
      .expect(422);
    const j = await a
      .post("/api/jobs")
      .send({ ...spec(assetIds[0]), assetIds })
      .expect(201);
    assert.equal(j.body.job.spec.assetIds.length, 2);
    if (!process.env.ANTHROPIC_API_KEY)
      await a
        .post("/api/intake")
        .send({ assetIds, intent: "make a club sticker" })
        .expect(503);
    const response = await a
      .post("/api/jobs")
      .send({
        ...spec(assetIds[0]),
        outputType: "3d",
        material: "pla",
        preparedModelId: "unconfigured",
        depthMm: 5,
        color: "blue",
        estimatedSeconds: 180,
      })
      .expect(422);
    assert.match(response.body.error.message, /prepared/i);
  } finally {
    f.close();
  }
});
test("signed asset URL permits only exact asset and unexpired capability", async () => {
  const f = fixture();
  try {
    const a = request.agent(f.app);
    await a.post("/api/session").send({ role: "requester" });
    const uploaded = await a
      .post("/api/uploads")
      .attach("images", image, { filename: "a.png", contentType: "image/png" })
      .expect(201);
    const assetId = uploaded.body.assets[0].id;
    const url = new URL(f.service.assetUrl(assetId));
    await request(f.app)
      .get(url.pathname + url.search)
      .expect(200);
    url.searchParams.set("sig", "0".repeat(64));
    await request(f.app)
      .get(url.pathname + url.search)
      .expect(401);
  } finally {
    f.close();
  }
});
test("SQLite CAS across two independent connections persists and rejects stale update", async () => {
  const f = fixture();
  const second = new SqliteStore(
    f.service.config.dataDir + "/app.sqlite",
    initialState(),
  );
  try {
    const a = await f.store.read(),
      b = await second.read();
    a.data.machines.phomemo_01.reason = "owner paused A";
    b.data.machines.phomemo_01.reason = "stale B";
    assert.equal(await f.store.compareAndSet(a.version, a.data), true);
    assert.equal(await second.compareAndSet(b.version, b.data), false);
    assert.equal(
      (await second.read()).data.machines.phomemo_01.reason,
      "owner paused A",
    );
  } finally {
    second.close();
    f.close();
  }
});

test("disconnected authoritative store is not advertised as healthy", async () => {
  const f = fixture();
  try {
    const original = f.store.read.bind(f.store);
    f.store.read = async () => {
      throw new Error("SPACETIME_UNAVAILABLE");
    };
    const response = await request(f.app).get("/api/health").expect(503);
    assert.equal(response.body.error.code, "STORE_DISCONNECTED");
    f.store.read = original;
  } finally {
    f.close();
  }
});

test("owner price changes invalidate unpaid approval while preserving an already paid quote", async () => {
  const f = fixture();
  try {
    f.service.node = {
      async call() {
        return { calibrated: true };
      },
      token() {
        throw new Error("No device execution in this HTTP policy test");
      },
    };
    const owner = request.agent(f.app),
      a = request.agent(f.app);
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "test-owner-code" })
      .expect(200);
    await a.post("/api/session").send({ role: "requester" }).expect(200);
    await owner
      .post("/api/owner/machines/phomemo_01/calibrate")
      .send({ inspected: true })
      .expect(200);
    await owner
      .patch("/api/owner/machines/phomemo_01")
      .send({ listed: true, paused: false, inspected: true, cleared: true })
      .expect(200);
    const uploaded = await a
      .post("/api/uploads")
      .attach("images", image, {
        filename: "price.png",
        contentType: "image/png",
      })
      .expect(201);
    const created = await a
      .post("/api/jobs")
      .send(spec(uploaded.body.assets[0].id))
      .expect(201);
    const j = created.body.job;
    await a
      .post(`/api/jobs/${j.id}/approve`)
      .send({ specVersion: j.specVersion, artifactSha256: j.artifact.sha256 })
      .expect(200);
    await a.post(`/api/jobs/${j.id}/quote`).send({}).expect(200);
    await owner
      .patch("/api/owner/machines/phomemo_01")
      .send({
        priceCard: { consumables: 30, machine: 10, handling: 30, platform: 15 },
      })
      .expect(200);
    const invalidated = (await a.get(`/api/jobs/${j.id}`).expect(200)).body.job;
    assert.equal(invalidated.quote, undefined);
    assert.equal(invalidated.approvedSpecHash, undefined);
    await a.post(`/api/jobs/${j.id}/quote`).send({}).expect(409);
    await a
      .post(`/api/jobs/${j.id}/approve`)
      .send({ specVersion: j.specVersion, artifactSha256: j.artifact.sha256 })
      .expect(200);
    const quoted = (
      await a.post(`/api/jobs/${j.id}/quote`).send({}).expect(200)
    ).body.job;
    assert.equal(quoted.quote.totalCents, 85);
    await a
      .post(`/api/jobs/${j.id}/checkout`)
      .send({ idempotencyKey: "price-checkout" })
      .expect(200);
    await owner
      .patch("/api/owner/machines/phomemo_01")
      .send({
        priceCard: { consumables: 50, machine: 10, handling: 30, platform: 15 },
      })
      .expect(200);
    assert.equal((await f.service.job(j.id)).quote!.totalCents, 85);
    assert.equal(
      (await f.service.read()).machines.phomemo_01.reservation!.jobId,
      j.id,
    );
    await a.post(`/api/jobs/${j.id}/cancel`).send({}).expect(200);
    const cancelled = (
      await a
        .post("/api/jobs")
        .send(spec(uploaded.body.assets[0].id))
        .expect(201)
    ).body.job;
    await a
      .post(`/api/jobs/${cancelled.id}/approve`)
      .send({
        specVersion: cancelled.specVersion,
        artifactSha256: cancelled.artifact.sha256,
      })
      .expect(200);
    await a.post(`/api/jobs/${cancelled.id}/quote`).send({}).expect(200);
    await a.post(`/api/jobs/${cancelled.id}/cancel`).send({}).expect(200);
    await owner
      .patch("/api/owner/machines/phomemo_01")
      .send({
        priceCard: { consumables: 55, machine: 10, handling: 30, platform: 15 },
      })
      .expect(200);
    assert.equal(
      (await f.service.job(cancelled.id)).productionState,
      "cancelled",
    );
  } finally {
    f.close();
  }
});

test("built application serves owner deep links without turning unknown API paths into HTML", async () => {
  const f = fixture();
  try {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const webRoot = join(f.service.config.dataDir, ".hidden-project", "web");
    await mkdir(join(webRoot, "assets"), { recursive: true });
    await writeFile(
      join(webRoot, "assets", "app-bundle.js"),
      'console.log("public build fixture");',
    );
    await writeFile(
      join(webRoot, "index.html"),
      "<!doctype html><title>Fabrary owner routing fixture</title>",
    );
    const app = createApp(f.service, webRoot);
    const page = await request(app).get("/owner").expect(200);
    assert.match(page.headers["content-type"], /html/);
    assert.match(page.text, /Fabrary owner routing fixture/);
    const bundle = await request(app).get("/assets/app-bundle.js").expect(200);
    assert.match(bundle.text, /public build fixture/);
    await request(app).get("/api/route-that-does-not-exist").expect(404);
  } finally {
    f.close();
  }
});

test("empty bodies and multibyte invalid credentials return useful validation errors", async () => {
  const f = fixture();
  try {
    const empty = await request(f.app).post("/api/session").expect(422);
    assert.equal(empty.body.error.code, "INVALID_ROLE");
    const invalid = await request(f.app)
      .post("/api/session")
      .send({
        role: "owner",
        accessCode: "é".repeat(f.service.config.ownerCode.length),
      })
      .expect(403);
    assert.equal(invalid.body.error.code, "ACCESS_CODE");
    const a = request.agent(f.app);
    await a.post("/api/session").send({ role: "requester" }).expect(200);
    const uploaded = await a
      .post("/api/uploads")
      .attach("images", image, {
        filename: "credential-check.png",
        contentType: "image/png",
      })
      .expect(201);
    const url = new URL(f.service.assetUrl(uploaded.body.assets[0].id));
    url.searchParams.set("sig", "é".repeat(64));
    await request(f.app)
      .get(url.pathname + url.search)
      .expect(401);
  } finally {
    f.close();
  }
});

test("result frames use the configured authenticated node boundary and preserve requester isolation", async () => {
  const f = fixture();
  try {
    const a = request.agent(f.app),
      stranger = request.agent(f.app);
    await a.post("/api/session").send({ role: "requester" }).expect(200);
    await stranger.post("/api/session").send({ role: "requester" }).expect(200);
    const uploaded = await a
      .post("/api/uploads")
      .attach("images", image, {
        filename: "evidence-check.png",
        contentType: "image/png",
      })
      .expect(201);
    const created = await a
      .post("/api/jobs")
      .send(spec(uploaded.body.assets[0].id))
      .expect(201);
    const jobId = created.body.job.id;
    await mutate(f.store, (s) => {
      s.jobs[jobId].machineId = "phomemo_01";
      s.jobs[jobId].evidence = { url: "/frames/private-fixture.png" };
    });
    let calls = 0;
    f.service.node.fetchFrame = async (url, machine) => {
      calls++;
      assert.equal(url, "/frames/private-fixture.png");
      assert.equal(machine.id, "phomemo_01");
      return image;
    };
    await stranger.get(`/api/jobs/${jobId}/evidence`).expect(403);
    assert.equal(calls, 0);
    const frame = await a.get(`/api/jobs/${jobId}/evidence`).expect(200);
    assert.equal(frame.headers["content-type"], "image/png");
    assert.deepEqual(frame.body, image);
    assert.equal(calls, 1);
    f.service.node.fetchFrame = async () => {
      throw new Error("Node offline");
    };
    const unavailable = await a.get(`/api/jobs/${jobId}/evidence`).expect(502);
    assert.equal(unavailable.body.error.code, "FRAME_UNAVAILABLE");
    assert.match(unavailable.body.error.message, /camera node/);
  } finally {
    f.close();
  }
});

test("in-flight calibration confirmation cannot reserve work or clear a newer calibration", async () => {
  const f = fixture();
  let unblock!: () => void;
  try {
    const owner = request.agent(f.app);
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "test-owner-code" })
      .expect(200);
    const uploaded = await owner
      .post("/api/uploads")
      .attach("images", image, {
        filename: "calibration-race.png",
        contentType: "image/png",
      })
      .expect(201);
    const artworkId = uploaded.body.assets[0].id;
    const artwork = (await f.service.read()).assets[artworkId];
    const artifact = {
      id: artworkId,
      url: artwork.url,
      sha256: artwork.sha256,
    };
    const draft = await f.service.create(
      "team_owner",
      spec(artworkId),
      artifact,
    );
    await f.service.approve(draft.id, {
      specVersion: 1,
      artifactSha256: artifact.sha256,
    });
    await mutate(f.store, (s) =>
      Object.assign(s.machines.phomemo_01, {
        listed: true,
        ready: true,
        paused: false,
        calibrated: true,
      }),
    );
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    f.service.node.call = async (tool, input) => {
      if (tool === "/calibrate" && input.inspected === true) {
        enter();
        await gate;
      }
      return { calibrated: true };
    };
    f.service.node.token = () => ({
      token: "isolated-test-token",
      expires_at: Math.floor(Date.now() / 1000) + 60,
    });
    const confirming = owner
      .post("/api/owner/machines/phomemo_01/calibrate")
      .send({ inspected: true })
      .then((response) => response);
    await entered;
    await assert.rejects(f.service.quote(draft.id), /No ready machine/);
    const calibration = await f.service.startCalibration(
      "phomemo_01",
      "team_owner",
      spec(artworkId),
      artifact,
      "newer-calibration-key",
      true,
    );
    unblock();
    const stale = await confirming;
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "MACHINE_BUSY");
    const machine = (await f.service.read()).machines.phomemo_01;
    assert.equal(machine.activeJobId, calibration.id);
    assert.equal(machine.calibrated, false);
    assert.equal(machine.ready, false);
  } finally {
    unblock?.();
    f.close();
  }
});

test("failed upload batches leave no partial artwork and decoded format controls MIME", async () => {
  const f = fixture();
  try {
    const a = request.agent(f.app);
    await a.post("/api/session").send({ role: "requester" }).expect(200);
    await a
      .post("/api/uploads")
      .attach("images", image, {
        filename: "valid.png",
        contentType: "image/png",
      })
      .attach("images", Buffer.from("not an image"), {
        filename: "invalid.png",
        contentType: "image/png",
      })
      .expect(422);
    const { readdir } = await import("node:fs/promises");
    assert.deepEqual(
      await readdir(join(f.service.config.dataDir, "assets")),
      [],
    );
    assert.equal(Object.keys((await f.service.read()).assets).length, 0);
    const uploaded = await a
      .post("/api/uploads")
      .attach("images", image, {
        filename: "misidentified.jpg",
        contentType: "image/jpeg",
      })
      .expect(201);
    assert.equal(uploaded.body.assets[0].mime, "image/png");
    const served = await a.get(uploaded.body.assets[0].url).expect(200);
    assert.equal(served.headers["content-type"], "image/png");
  } finally {
    f.close();
  }
});

test("refresh endpoints expose monotonic authoritative revisions bound to their exact data snapshot", async () => {
  const f = fixture();
  try {
    const owner = request.agent(f.app),
      requester = request.agent(f.app);
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "test-owner-code" })
      .expect(200);
    const actor = (
      await requester
        .post("/api/session")
        .send({ role: "requester" })
        .expect(200)
    ).body;
    await mutate(f.store, (s) => {
      s.assets.revision_fixture = {
        id: "revision_fixture",
        ownerId: actor.id,
        path: "unused-fixture-path",
        url: "/assets/revision_fixture",
        sha256: "a".repeat(64),
        mime: "image/png",
        width: 1,
        height: 1,
        createdAt: new Date().toISOString(),
      };
    });
    const job = await f.service.create(actor.id, spec("revision_fixture"), {
      id: "revision_fixture",
      url: "/assets/revision_fixture",
      sha256: "a".repeat(64),
    });
    const originalRead = f.store.read.bind(f.store);
    for (const [client, path, authReads] of [
      [requester, "/api/machines", 0],
      [requester, "/api/jobs", 1],
      [owner, "/api/owner/dashboard", 1],
    ] as const) {
      const before = await originalRead();
      let reads = 0,
        interleaved = false;
      f.store.read = async () => {
        const snapshot = await originalRead();
        if (++reads === authReads + 1) {
          const newer = structuredClone(snapshot.data);
          newer.machines.phomemo_01.reason =
            "Committed after the response snapshot was read";
          newer.jobs[job.id].spec.intent = "Newer committed artwork intent";
          assert.equal(
            await f.store.compareAndSet(snapshot.version, newer),
            true,
          );
          interleaved = true;
        }
        return snapshot;
      };
      const response = await client.get(path).expect(200);
      f.store.read = originalRead;
      assert.equal(interleaved, true);
      assert.equal(response.body.revision, before.version);
      if (path !== "/api/jobs") {
        assert.equal(
          response.body.machines.find((m: any) => m.id === "phomemo_01").reason,
          before.data.machines.phomemo_01.reason,
        );
      }
      if (path !== "/api/machines") {
        assert.equal(
          response.body.jobs.find((j: any) => j.id === job.id).spec.intent,
          before.data.jobs[job.id].spec.intent,
        );
      }
      const refreshed = await client.get(path).expect(200);
      assert.equal(refreshed.body.revision, before.version + 1);
      assert(refreshed.body.revision > response.body.revision);
      if (path === "/api/machines") {
        assert.equal(refreshed.body.machines[0].ownerId, undefined);
        assert.equal(refreshed.body.machines[0].nodeUrl, undefined);
        assert.equal(refreshed.body.machines[0].ownerAddress, undefined);
      }
    }
  } finally {
    f.close();
  }
});

test("session lookup failures remain service errors and preserve the existing requester identity", async () => {
  const f = fixture();
  const originalRead = f.store.read.bind(f.store);
  try {
    const anonymous = await request(f.app).get("/api/session").expect(200);
    assert.deepEqual(anonymous.body, { role: null });
    const a = request.agent(f.app);
    const original = (
      await a.post("/api/session").send({ role: "requester" }).expect(200)
    ).body;
    const sessionsBefore = (await originalRead()).data.sessions;
    f.store.read = async () => {
      throw new Error("Authoritative session store temporarily unavailable");
    };
    const unavailable = await a.get("/api/session").expect(500);
    assert.equal(unavailable.body.error.code, "SERVICE_ERROR");
    assert.equal(unavailable.body.role, undefined);
    assert.equal(unavailable.headers["set-cookie"], undefined);
    f.store.read = originalRead;
    const recovered = await a.get("/api/session").expect(200);
    assert.equal(recovered.body.id, original.id);
    assert.equal(recovered.body.role, "requester");
    assert.deepEqual((await originalRead()).data.sessions, sessionsBefore);
    await mutate(f.store, (s) => {
      for (const session of Object.values(s.sessions))
        session.expiresAt = new Date(Date.now() - 1000).toISOString();
    });
    assert.deepEqual((await a.get("/api/session").expect(200)).body, {
      role: null,
    });
  } finally {
    f.store.read = originalRead;
    f.close();
  }
});

test("inherited dictionary names never resolve to orders, artwork, sessions or supported machines", async () => {
  const f = fixture();
  try {
    let nodeCalls = 0;
    f.service.node.call = async () => {
      nodeCalls++;
      throw new Error("No device calls allowed in lookup validation");
    };
    const owner = request.agent(f.app),
      requester = request.agent(f.app);
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "test-owner-code" })
      .expect(200);
    await requester
      .post("/api/session")
      .send({ role: "requester" })
      .expect(200);
    const before = await f.store.read();
    for (const key of ["constructor", "toString", "__proto__"]) {
      await owner.get(`/api/jobs/${key}`).expect(404);
      await requester.get(`/api/jobs/${key}`).expect(404);
      await owner.post(`/api/owner/jobs/${key}/reconcile`).send({}).expect(404);
      await owner.get(`/assets/${key}`).expect(404);
      await owner.patch(`/api/owner/machines/${key}`).send({}).expect(404);
      await owner.get(`/api/owner/machines/${key}/calibration`).expect(404);
      await owner
        .get(`/api/owner/machines/${key}/calibration/evidence`)
        .expect(404);
      await owner
        .post(`/api/owner/machines/${key}/calibrate`)
        .send({ inspected: true })
        .expect(404);
      await owner
        .post(`/api/owner/machines/${key}/calibration/resolve`)
        .send({
          inspected: true,
          result: "failed",
          attemptId: "nonexistent",
          reason: "Unknown device must not reach the node",
        })
        .expect(404);
      await owner
        .post("/api/owner/machines")
        .send({ model: key, mode: "simulation" })
        .expect(422);
      await requester.post("/api/jobs").send(spec(key)).expect(403);
      await requester
        .post("/api/intake")
        .send({
          assetIds: [key],
          intent: "Unknown artwork must never reach a provider",
        })
        .expect(403);
      assert.deepEqual(
        (
          await request(f.app)
            .get("/api/session")
            .set("Cookie", `fabrary_session=${key}`)
            .expect(200)
        ).body,
        { role: null },
      );
    }
    assert.equal(nodeCalls, 0);
    assert.deepEqual(await f.store.read(), before);
  } finally {
    f.close();
  }
});

test("owner inspection reasons reject malformed or oversized values without changing review state", async () => {
  const f = fixture();
  try {
    const owner = request.agent(f.app);
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "test-owner-code" })
      .expect(200);
    await mutate(f.store, (s) => {
      s.assets.review_art = {
        id: "review_art",
        ownerId: "review_requester",
        path: "unused-fixture",
        url: "/assets/review_art",
        sha256: "a".repeat(64),
        mime: "image/png",
        width: 1,
        height: 1,
        createdAt: new Date().toISOString(),
      };
    });
    const j = await f.service.create(
      "review_requester",
      { ...spec("review_art"), permission: "unclear" },
      { id: "review_art", url: "/assets/review_art", sha256: "a".repeat(64) },
    );
    const before = await f.store.read();
    for (const reason of [
      { observed: true },
      [],
      7,
      true,
      null,
      "        ",
      "x".repeat(1001),
    ]) {
      const response = await owner
        .post(`/api/owner/jobs/${j.id}/review`)
        .send({ result: "pass", reason })
        .expect(422);
      assert.equal(response.body.error.code, "REASON_REQUIRED");
      await owner
        .post(`/api/owner/jobs/${j.id}/payment-reference`)
        .send({
          operationId: "constructor",
          transactionHash: "0x" + "b".repeat(64),
          reason,
        })
        .expect(422);
      assert.deepEqual(await f.store.read(), before);
    }
    const reviewed = await owner
      .post(`/api/owner/jobs/${j.id}/review`)
      .send({
        result: "pass",
        reason: "所有者が図案の利用許可を確認しました 😊",
      })
      .expect(200);
    assert.equal(reviewed.body.job.spec.permission, "authorized");
    assert.equal(reviewed.body.job.productionState, "specified");
    assert.equal(reviewed.body.job.approvedSpecHash, undefined);
  } finally {
    f.close();
  }
});

test("numeric budget and quantity errors reject before preview creation, while collection references normalize whitespace", async () => {
  const f = fixture();
  try {
    const requester = request.agent(f.app),
      owner = request.agent(f.app);
    await requester
      .post("/api/session")
      .send({ role: "requester" })
      .expect(200);
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "test-owner-code" })
      .expect(200);
    const before = await f.store.read();
    for (const change of [
      { quantity: "2" },
      { quantity: true },
      { quantity: 1.5 },
      { quantity: 1e100 },
      { budgetMandate: { enabled: true, capCents: 0.5 } },
      { budgetMandate: { enabled: true, capCents: 1e100 } },
      { budgetMandate: { enabled: true, capCents: "100" } },
      { budgetMandate: { enabled: true, capCents: -1 } },
      { widthMm: 1e100 },
      { heightMm: 1e100 },
    ]) {
      const response = await requester
        .post("/api/jobs")
        .send({ ...spec("unused_asset"), ...change })
        .expect(422);
      assert.equal(response.body.error.code, "INVALID_SPEC");
      assert.deepEqual(await f.store.read(), before);
    }
    f.service.node.call = async () => ({});
    await owner
      .patch("/api/owner/machines/phomemo_01")
      .send({ collectionPoint: "   " })
      .expect(422);
    assert.deepEqual(await f.store.read(), before);
    const updated = await owner
      .patch("/api/owner/machines/phomemo_01")
      .send({ collectionPoint: "  工坊领取处 😊  " })
      .expect(200);
    assert.equal(updated.body.machine.collectionPoint, "工坊领取处 😊");
  } finally {
    f.close();
  }
});

test("calibration authorization and machine lookup fail before generating orphan previews", async () => {
  const f = fixture();
  try {
    const owner = request.agent(f.app);
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "test-owner-code" })
      .expect(200);
    const uploaded = await owner
      .post("/api/uploads")
      .attach("images", image, {
        filename: "calibration-preconditions.png",
        contentType: "image/png",
      })
      .expect(201);
    const input = spec(uploaded.body.assets[0].id);
    const before = await f.store.read();
    const { readdir } = await import("node:fs/promises");
    const filesBefore = await readdir(join(f.service.config.dataDir, "assets"));
    let calls = 0;
    f.service.node.call = async () => {
      calls++;
      throw new Error("No node calls before calibration authorization");
    };
    for (const [body, status] of [
      [{ idempotencyKey: { length: 8 }, ownerReady: true }, 422],
      [{ idempotencyKey: "x".repeat(201), ownerReady: true }, 422],
      [{ ownerReady: true }, 422],
      [{ idempotencyKey: "valid-stable-key", ownerReady: false }, 409],
      [{ idempotencyKey: "valid-stable-key", ownerReady: "true" }, 409],
    ] as const) {
      await owner
        .post("/api/owner/machines/phomemo_01/calibration/start")
        .send({ ...body, spec: input })
        .expect(status);
      assert.deepEqual(await f.store.read(), before);
      assert.deepEqual(
        await readdir(join(f.service.config.dataDir, "assets")),
        filesBefore,
      );
    }
    await owner
      .post("/api/owner/machines/constructor/calibration/start")
      .send({
        spec: input,
        idempotencyKey: "valid-stable-key",
        ownerReady: true,
      })
      .expect(404);
    assert.deepEqual(await f.store.read(), before);
    assert.deepEqual(
      await readdir(join(f.service.config.dataDir, "assets")),
      filesBefore,
    );
    assert.equal(calls, 0);
  } finally {
    f.close();
  }
});

test("owner payout address updates distinguish omission, valid replacement and explicit clear without storing null", async () => {
  const f = fixture();
  try {
    const nodePolicies: Record<string, unknown>[] = [];
    f.service.node.call = async (path, body) => {
      assert.equal(path, "/machines/phomemo_01/policy");
      nodePolicies.push(body as Record<string, unknown>);
      return { updated: true };
    };
    const owner = request.agent(f.app);
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "test-owner-code" })
      .expect(200);
    const address = "0x" + "12".repeat(20);
    const assigned = await owner
      .patch("/api/owner/machines/phomemo_01")
      .send({ ownerAddress: address })
      .expect(200);
    assert.equal(assigned.body.machine.ownerAddress, address);
    assert.equal(
      (await f.store.read()).data.machines.phomemo_01.ownerAddress,
      address,
    );
    const omitted = await owner
      .patch("/api/owner/machines/phomemo_01")
      .send({ listed: false })
      .expect(200);
    assert.equal(omitted.body.machine.ownerAddress, address);
    assert.equal(
      (await f.store.read()).data.machines.phomemo_01.ownerAddress,
      address,
    );
    const cleared = await owner
      .patch("/api/owner/machines/phomemo_01")
      .send({ ownerAddress: null })
      .expect(200);
    assert.equal(Object.hasOwn(cleared.body.machine, "ownerAddress"), false);
    assert.equal(
      Object.hasOwn(
        (await f.store.read()).data.machines.phomemo_01,
        "ownerAddress",
      ),
      false,
    );
    const omittedAfterClear = await owner
      .patch("/api/owner/machines/phomemo_01")
      .send({ listed: false })
      .expect(200);
    assert.equal(
      Object.hasOwn(omittedAfterClear.body.machine, "ownerAddress"),
      false,
    );
    const replacement = "0x" + "aB".repeat(20);
    await owner
      .patch("/api/owner/machines/phomemo_01")
      .send({ ownerAddress: replacement })
      .expect(200);
    assert.equal(
      (await f.store.read()).data.machines.phomemo_01.ownerAddress,
      replacement,
    );
    const before = await f.store.read(),
      calls = nodePolicies.length;
    for (const invalid of [
      "",
      " ",
      "0x" + "a".repeat(39),
      "0x" + "a".repeat(41),
      "0x" + "z".repeat(40),
      12,
      {},
      false,
    ]) {
      const response = await owner
        .patch("/api/owner/machines/phomemo_01")
        .send({ ownerAddress: invalid })
        .expect(422);
      assert.equal(response.body.error.code, "INVALID_INPUT");
      assert.deepEqual(await f.store.read(), before);
    }
    assert.equal(nodePolicies.length, calls);
    for (const policy of nodePolicies)
      assert.equal(Object.hasOwn(policy, "ownerAddress"), false);
    assert.deepEqual(before.data.operations, {});
    assert.equal(f.service.payment.mode, "mock");
  } finally {
    f.close();
  }
});

test("unchanged full settings preserve the quoted approval, exact history and reservation", async () => {
  const f = fixture();
  try {
    f.service.node.call = async (path) => {
      assert.equal(path, "/machines/phomemo_01/policy");
      return { updated: true };
    };
    const owner = request.agent(f.app),
      requester = request.agent(f.app);
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "test-owner-code" })
      .expect(200);
    await requester
      .post("/api/session")
      .send({ role: "requester" })
      .expect(200);
    const uploaded = await requester
      .post("/api/uploads")
      .attach("images", image, {
        filename: "settings.png",
        contentType: "image/png",
      })
      .expect(201);
    const created = await requester
      .post("/api/jobs")
      .send(spec(uploaded.body.assets[0].id))
      .expect(201);
    const jobId = created.body.job.id;
    await mutate(f.store, (s) =>
      Object.assign(s.machines.phomemo_01, {
        calibrated: true,
        listed: true,
        ready: true,
        paused: false,
        hours: { start: 0, end: 24 },
      }),
    );
    const approveAndQuote = async () => {
      const job = await f.service.job(jobId);
      await requester
        .post(`/api/jobs/${jobId}/approve`)
        .send({
          specVersion: job.specVersion,
          artifactSha256: job.artifact.sha256,
        })
        .expect(200);
      await requester.post(`/api/jobs/${jobId}/quote`).send({}).expect(200);
    };
    await approveAndQuote();
    const before = await f.service.read(),
      m = before.machines.phomemo_01;
    const settings = {
      listed: m.listed,
      paused: m.paused,
      inspected: true,
      cleared: true,
      mediaRemaining: m.mediaRemaining,
      material: m.material,
      priceCard: m.priceCard,
      hours: m.hours,
      maxJobSeconds: m.maxJobSeconds,
      collectionPoint: m.collectionPoint,
      policy: m.policy,
    };
    await owner
      .patch("/api/owner/machines/phomemo_01")
      .send(settings)
      .expect(200);
    const unchanged = await f.service.read();
    assert.deepEqual(unchanged.jobs[jobId], before.jobs[jobId]);
    assert.deepEqual(unchanged.machines.phomemo_01.reservation, m.reservation);

    assert.deepEqual(unchanged.operations, {});
  } finally {
    f.close();
  }
});
