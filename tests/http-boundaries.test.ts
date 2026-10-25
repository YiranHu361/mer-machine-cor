import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { SqliteStore } from "../server/store.ts";
import { initialState } from "../server/model.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { createApp } from "../server/app.ts";

const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabyn-http-boundary-"));
  const store = new SqliteStore(join(dir, "app.sqlite"), initialState());
  let nodeCalls = 0;
  const service = new Service(
    store,
    {
      async call() {
        nodeCalls++;
        throw new Error("No device calls in HTTP boundary fixtures");
      },
      token() {
        throw new Error("No dispatch in HTTP boundary fixtures");
      },
    },
    new MockPayment(),
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:4318/assets",
      secret: "http-boundary-fixture",
      quoteMs: 120000,
      pickupMs: 10000,
      ownerCode: "http-boundary-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
    },
  );
  const app = createApp(service, join(dir, "absent-web-build"));
  const files = () => {
    try {
      return readdirSync(join(dir, "assets")).sort();
    } catch {
      return [];
    }
  };
  return {
    dir,
    store,
    app,
    files,
    nodeCalls: () => nodeCalls,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
function privateError(
  response: { headers: Record<string, string>; body: any; text: string },
  code: string,
) {
  assert.match(response.headers["content-type"], /application\/json/);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.body.error.code, code);
  assert.equal(typeof response.body.error.message, "string");
  assert.equal(response.body.error.stack, undefined);
  assert.equal(response.body.error.body, undefined);
}

test("malformed JSON and invalid compression return safe private errors without echoing submitted artwork", async () => {
  const f = fixture();
  try {
    const before = await f.store.read();
    const malformed = await request(f.app)
      .post("/api/session")
      .set("Content-Type", "application/json")
      .send('"PRIVATE_ARTWORK_REQUEST_SENTINEL"')
      .expect(400);
    assert.equal(malformed.text.includes("PRIVATE_"), false);
    privateError(malformed, "INVALID_JSON");
    const corrupt = await request(f.app)
      .post("/api/session")
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .serialize((value) => value)
      .send(Buffer.from("PRIVATE_CORRUPT_COMPRESSED_SENTINEL"))
      .expect(400);
    privateError(corrupt, "INVALID_JSON");
    assert.equal(corrupt.text.includes("Z_DATA_ERROR"), false);
    assert.deepEqual(await f.store.read(), before);
    assert.deepEqual(f.files(), []);
    assert.equal(f.nodeCalls(), 0);
    await request(f.app)
      .post("/api/session")
      .send({ role: "requester" })
      .expect(200);
  } finally {
    f.close();
  }
});

test("JSON size limits apply after decompression and preserve the existing identity", async () => {
  const f = fixture();
  try {
    const a = request.agent(f.app);
    const session = (
      await a.post("/api/session").send({ role: "requester" }).expect(200)
    ).body;
    const before = await f.store.read(),
      payload = JSON.stringify({
        role: "requester",
        privateArtwork: "x".repeat(101 * 1024),
      });
    for (const compressed of [false, true]) {
      const req = a
        .post("/api/session")
        .set("Content-Type", "application/json")
        .serialize((value) => value);
      if (compressed) req.set("Content-Encoding", "gzip");
      const response = await req
        .send(compressed ? gzipSync(payload) : payload)
        .expect(413);
      privateError(response, "REQUEST_TOO_LARGE");
      assert.deepEqual(await f.store.read(), before);
    }
    assert.equal((await a.get("/api/session").expect(200)).body.id, session.id);
    assert.equal(f.nodeCalls(), 0);
  } finally {
    f.close();
  }
});

test("unsupported nonempty bodies cannot silently sign out an existing requester", async () => {
  const f = fixture();
  try {
    const a = request.agent(f.app);
    const session = (
      await a.post("/api/session").send({ role: "requester" }).expect(200)
    ).body;
    const before = await f.store.read();
    for (const type of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "application/octet-stream",
    ]) {
      const response = await a
        .delete("/api/session")
        .set("Content-Type", type)
        .send("PRIVATE_IGNORED_BODY")
        .expect(415);
      privateError(response, "UNSUPPORTED_CONTENT_TYPE");
      assert.deepEqual(await f.store.read(), before);
      assert.equal(
        (await a.get("/api/session").expect(200)).body.id,
        session.id,
      );
    }
    // Empty actions still work without an invented JSON body or content type.
    await a.delete("/api/session").expect(200);
    assert.deepEqual((await a.get("/api/session").expect(200)).body, {
      role: null,
    });
    assert.equal(f.nodeCalls(), 0);
  } finally {
    f.close();
  }
});

test("unsupported JSON encoding and charset errors do not echo arbitrary request headers", async () => {
  const f = fixture();
  try {
    const before = await f.store.read();
    const encoding = await request(f.app)
      .post("/api/session")
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "PRIVATE_ENCODING_SENTINEL")
      .send('{"role":"requester"}')
      .expect(415);
    assert.equal(
      encoding.text.toUpperCase().includes("PRIVATE_ENCODING"),
      false,
    );
    privateError(encoding, "UNSUPPORTED_ENCODING");
    const charset = await request(f.app)
      .post("/api/session")
      .set("Content-Type", "application/json; charset=PRIVATE_CHARSET_SENTINEL")
      .send('{"role":"requester"}')
      .expect(415);
    assert.equal(charset.text.toUpperCase().includes("PRIVATE_CHARSET"), false);
    privateError(charset, "UNSUPPORTED_ENCODING");
    assert.deepEqual(await f.store.read(), before);
  } finally {
    f.close();
  }
});

test("malformed multipart requests reject as client errors without partial assets and allow a clean retry", async () => {
  const f = fixture();
  try {
    const a = request.agent(f.app);
    await a.post("/api/session").send({ role: "requester" }).expect(200);
    const before = await f.store.read();
    for (const [type, body] of [
      ["multipart/form-data", "PRIVATE_MISSING_BOUNDARY"],
      [
        "multipart/form-data; boundary=fixture",
        '--fixture\r\nContent-Disposition: form-data; name="images"; filename="PRIVATE_FILENAME.png"\r\nContent-Type: image/png\r\n\r\ntruncated',
      ],
      [
        "multipart/form-data; boundary=fixture",
        "--fixture\r\nINVALID_PRIVATE_HEADER\r\n\r\ndata\r\n--fixture--\r\n",
      ],
    ]) {
      const response = await a
        .post("/api/uploads")
        .set("Content-Type", type)
        .send(body)
        .expect(400);
      privateError(response, "INVALID_MULTIPART");
      assert.equal(response.text.includes("PRIVATE_"), false);
      assert.deepEqual(await f.store.read(), before);
      assert.deepEqual(f.files(), []);
    }
    const wrongType = await a
      .post("/api/uploads")
      .send({ images: "not multipart" })
      .expect(415);
    privateError(wrongType, "UNSUPPORTED_CONTENT_TYPE");
    assert.deepEqual(await f.store.read(), before);
    const recovered = await a
      .post("/API/uploads/")
      .attach("images", image, {
        filename: "recovered.png",
        contentType: "image/png",
      })
      .expect(201);
    await a.get(recovered.body.assets[0].url).expect(200);
    assert.equal(f.nodeCalls(), 0);
  } finally {
    f.close();
  }
});

test("multipart file-size, file-count and wrong-field limits reject before asset registration", async () => {
  const f = fixture();
  try {
    const a = request.agent(f.app);
    await a.post("/api/session").send({ role: "requester" }).expect(200);
    const before = await f.store.read();
    const large = await a
      .post("/api/uploads")
      .attach("images", Buffer.alloc(12 * 1024 * 1024 + 1), {
        filename: "PRIVATE_LARGE.png",
        contentType: "image/png",
      })
      .expect(413);
    privateError(large, "LIMIT_FILE_SIZE");
    const excess = a.post("/api/uploads");
    for (let index = 0; index < 5; index++)
      excess.attach("images", image, {
        filename: `${index}.png`,
        contentType: "image/png",
      });
    privateError(await excess.expect(422), "LIMIT_FILE_COUNT");
    const unexpected = await a
      .post("/api/uploads")
      .attach("PRIVATE_FIELD", image, {
        filename: "PRIVATE_FILE.png",
        contentType: "image/png",
      })
      .expect(422);
    privateError(unexpected, "LIMIT_UNEXPECTED_FILE");
    assert.equal(unexpected.text.includes("PRIVATE_"), false);
    assert.deepEqual(await f.store.read(), before);
    assert.deepEqual(f.files(), []);
    assert.equal(f.nodeCalls(), 0);
  } finally {
    f.close();
  }
});

test("invalid URL encoding, origins and unknown API methods return private errors without mutation", async () => {
  const f = fixture();
  try {
    const before = await f.store.read();
    const invalid = await request(f.app)
      .get("/api/jobs/%E0%A4%A_PRIVATE_URL_SENTINEL")
      .expect(400);
    assert.equal(invalid.text.includes("PRIVATE_"), false);
    privateError(invalid, "INVALID_URL");
    const origin = await request(f.app)
      .post("/api/session")
      .set("Origin", "PRIVATE_INVALID_ORIGIN")
      .send({ role: "requester" })
      .expect(403);
    privateError(origin, "ORIGIN_REJECTED");
    privateError(
      await request(f.app)
        .put("/api/session")
        .send({ role: "requester" })
        .expect(404),
      "NOT_FOUND",
    );
    privateError(
      await request(f.app).get("/api/PRIVATE_UNKNOWN_PATH").expect(404),
      "NOT_FOUND",
    );
    assert.deepEqual(await f.store.read(), before);
    assert.equal(f.nodeCalls(), 0);
    await request(f.app).get("/api/owner/dashboard").expect(401);
  } finally {
    f.close();
  }
});

test("missing private asset and web-build files never expose local filesystem paths", async () => {
  const f = fixture();
  try {
    const a = request.agent(f.app),
      stranger = request.agent(f.app);
    await a.post("/api/session").send({ role: "requester" }).expect(200);
    await stranger.post("/api/session").send({ role: "requester" }).expect(200);
    const uploaded = await a
      .post("/api/uploads")
      .attach("images", image, {
        filename: "private.png",
        contentType: "image/png",
      })
      .expect(201);
    const asset = (await f.store.read()).data.assets[
      uploaded.body.assets[0].id
    ];
    unlinkSync(asset.path); // Only this temporary fixture's file is faulted.
    const before = await f.store.read();
    await stranger.get(asset.url).expect(403);
    for (const [path, status, code] of [
      [asset.url, 500, "SERVICE_ERROR"],
      ["/owner", 404, "NOT_FOUND"],
    ] as const) {
      const response = await a.get(path).expect(status);
      privateError(response, code);
      assert.equal(response.text.includes(f.dir), false);
      assert.equal(response.text.includes("ENOENT"), false);
      assert.equal(response.text.includes(".sqlite"), false);
    }
    assert.deepEqual(await f.store.read(), before);
    assert.equal(f.nodeCalls(), 0);
  } finally {
    f.close();
  }
});
