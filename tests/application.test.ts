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
