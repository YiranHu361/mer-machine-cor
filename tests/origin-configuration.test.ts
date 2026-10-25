import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { SqliteStore } from "../server/store.ts";
import { initialState } from "../server/model.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { createApp } from "../server/app.ts";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabyn-origin-"));
  const store = new SqliteStore(join(dir, "app.sqlite"), initialState());
  const service = new Service(
    store,
    {
      token() {
        throw Error("No device authorization in origin fixtures");
      },
      async call() {
        throw Error("No device operation in origin fixtures");
      },
    },
    new MockPayment(),
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:4329/assets",
      secret: "isolated-origin",
      quoteMs: 120000,
      pickupMs: 60000,
      ownerCode: "isolated-origin-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
    },
  );
  return {
    store,
    service,
    app: createApp(service),
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("configured local application port and Vite remain accepted; other hosts and ports reject without mutation", async () => {
  const f = fixture();
  try {
    for (const origin of [
      "http://127.0.0.1:4329",
      "http://localhost:4329",
      "http://127.0.0.1:4317",
      "http://localhost:4317",
    ])
      await request(f.app)
        .post("/api/session")
        .set("Origin", origin)
        .send({ role: "requester" })
        .expect(200);
    const before = await f.store.read();
    for (const origin of [
      "http://127.0.0.1:4330",
      "http://localhost:4318",
      "https://outside.invalid:4329",
      "http://localhost.outside.invalid:4329",
      "ftp://localhost:4329",
      "null",
    ]) {
      const response = await request(f.app)
        .post("/api/session")
        .set("Origin", origin)
        .send({ role: "requester" })
        .expect(403);
      assert.equal(response.body.error.code, "ORIGIN_REJECTED");
      assert.deepEqual(await f.store.read(), before);
    }
  } finally {
    f.close();
  }
});
test("the configured public address may act; look-alike addresses still reject without mutation", async () => {
  const f = fixture();
  f.service.config.publicOrigin = "https://fabyn.vercel.app";
  try {
    await request(f.app)
      .post("/api/session")
      .set("Origin", "https://fabyn.vercel.app")
      .send({ role: "requester" })
      .expect(200);
    const before = await f.store.read();
    for (const origin of [
      "http://fabyn.vercel.app",
      "https://fabyn.vercel.app:8443",
      "https://fabyn.vercel.app.outside.invalid",
      "https://other.vercel.app",
    ]) {
      const response = await request(f.app)
        .post("/api/session")
        .set("Origin", origin)
        .send({ role: "requester" })
        .expect(403);
      assert.equal(response.body.error.code, "ORIGIN_REJECTED");
      assert.deepEqual(await f.store.read(), before);
    }
  } finally {
    f.close();
  }
});
test("an actual configured dynamic loopback app accepts its browser origin and rejects a different port", async () => {
  const f = fixture(),
    server = f.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  f.service.config.assetOrigin = origin + "/assets";
  try {
    const response = await fetch(origin + "/api/session", {
      method: "POST",
      headers: { Origin: origin, "content-type": "application/json" },
      body: JSON.stringify({ role: "requester" }),
    });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as any).role, "requester");
    const before = await f.store.read();
    const wrong = await fetch(origin + "/api/session", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ role: "requester" }),
    });
    assert.equal(wrong.status, 403);
    assert.equal(((await wrong.json()) as any).error.code, "ORIGIN_REJECTED");
    assert.deepEqual(await f.store.read(), before);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    f.close();
  }
});
