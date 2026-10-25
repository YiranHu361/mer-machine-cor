import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { initialState } from "../server/model.ts";
import { SqliteStore } from "../server/store.ts";
import { CloudProducer } from "../server/cloud-producer.ts";
import { digest, type FileStorage } from "../server/cloud-files.ts";
import { createApp } from "../server/app.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { HttpNode } from "../server/node-client.ts";
import { ConnectorRelay, RoutingNode } from "../server/connectors.ts";

test("cloud sessions, upload tickets, private files and the new main Connections panel share the same boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fabyn-cloud-app-"));
  const store = new SqliteStore(
    join(directory, "state.sqlite"),
    initialState(),
  );
  const artwork = Buffer.from("validated-by-test-inspector");
  const files: FileStorage = {
    async upload() {
      return "storage1";
    },
    async download() {
      return artwork;
    },
    async url() {
      return "https://storage.test/file";
    },
    async uploadUrl() {
      return "https://storage.test/upload";
    },
    signedUrl() {
      return "https://storage.test/signed";
    },
  };
  const producer = new CloudProducer(
    store,
    files,
    "producer-test-key-0123456789-abcdef",
    directory,
  );
  producer.rpc = async () => ({ width: 10, height: 10, mime: "image/png" });
  const service = new Service(
    store,
    new RoutingNode(
      new HttpNode("http://127.0.0.1:9", "unused", "secret"),
      new ConnectorRelay(),
      "secret",
      producer,
    ),
    new MockPayment(),
    {
      cloud: true,
      mode: "hardware",
      paymentMode: "mock",
      storeMode: "test",
      assetOrigin: "https://app.test/assets",
      publicOrigin: "https://app.test",
      secret: "secret",
      quoteMs: 120000,
      pickupMs: 86400000,
      ownerCode: "private-owner-code",
      dataDir: directory,
      nodeUrl: "http://127.0.0.1:9",
    },
  );
  const app = createApp(service, undefined, { producer });
  const login = async (role: string, accessCode?: string) => {
    const result = await request(app)
      .post("/api/session")
      .set("Origin", "https://app.test")
      .send({ role, accessCode })
      .expect(200);
    assert.match(result.headers["set-cookie"][0], /Secure/);
    return result.headers["set-cookie"][0].split(";")[0];
  };
  try {
    const alice = await login("requester"),
      bob = await login("requester"),
      owner = await login("owner", "private-owner-code");
    await request(app)
      .post("/api/session")
      .set("Origin", "https://other.test")
      .send({ role: "requester" })
      .expect(403);
    await request(app).post("/api/session").send({ role: "owner" }).expect(403);
    const ticket = await request(app)
      .post("/api/uploads/storage")
      .set("Cookie", alice)
      .send({ files: [{ size: artwork.length, sha256: digest(artwork) }] })
      .expect(200);
    const completion = {
      uploads: [
        { ticketId: ticket.body.uploads[0].ticketId, storageId: "storage1" },
      ],
    };
    await request(app)
      .post("/api/uploads/complete")
      .set("Cookie", bob)
      .send(completion)
      .expect(403);
    const uploaded = await request(app)
      .post("/api/uploads/complete")
      .set("Cookie", alice)
      .send(completion)
      .expect(201);
    assert.equal(uploaded.body.assets[0].storageId, undefined);
    assert.equal(uploaded.body.assets[0].path, undefined);
    const assetPath = uploaded.body.assets[0].url;
    await request(app).get(assetPath).set("Cookie", bob).expect(403);
    await request(app)
      .get(assetPath)
      .set("Cookie", alice)
      .expect(302)
      .expect("Location", "https://storage.test/signed");
    await request(app)
      .post("/api/uploads/complete")
      .set("Cookie", alice)
      .send(completion)
      .expect(201);
    assert.equal(
      Object.keys((await store.read()).data.assets).length,
      1,
      "finalizing again reuses the same private asset",
    );
    await request(app)
      .get("/api/owner/mvp/status")
      .set("Cookie", alice)
      .expect(403);
    const connections = await request(app)
      .get("/api/owner/mvp/status")
      .set("Cookie", `${alice}; ${owner}`)
      .expect(200);
    assert.equal(connections.body.cloud, true);
    assert.equal(connections.body.machines.length, 3);
    await request(app)
      .post("/api/owner/mvp/steps/set-access-code")
      .set("Cookie", owner)
      .send({ machine: "m_fdm_01", code: "should-stay-local" })
      .expect(409);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
