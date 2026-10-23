import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, type State } from "../server/model.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { createApp } from "../server/app.ts";

const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
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
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabrary-storage-fault-"));
  const store = new SqliteStore(join(dir, "app.sqlite"), initialState());
  const service = new Service(
    store,
    {
      async call() {
        throw new Error("No node calls allowed in storage tests");
      },
      token() {
        throw new Error("No dispatch allowed in storage tests");
      },
    },
    new MockPayment(),
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:4318/assets",
      secret: "isolated-storage-test",
      quoteMs: 120000,
      pickupMs: 10000,
      ownerCode: "isolated-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
    },
  );
  const app = createApp(service);
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
    service,
    app,
    files,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
async function upload(agent: ReturnType<typeof request.agent>) {
  return (
    await agent
      .post("/api/uploads")
      .attach("images", image, {
        filename: "art.png",
        contentType: "image/png",
      })
      .expect(201)
  ).body.assets[0].id as string;
}

test("a failed SQLite subscriber cannot change a committed result or suppress other subscribers", async () => {
  const f = fixture();
  try {
    let notified = 0;
    f.store.subscribe(() => {
      throw new Error("Disconnected refresh consumer");
    });
    f.store.subscribe(() => {
      notified++;
    });
    await mutate(f.store, (s) => {
      s.machines.phomemo_01.reason = "Owner paused after inspection";
    });
    assert.equal(notified, 1);
    const reopened = new SqliteStore(join(f.dir, "app.sqlite"), initialState());
    try {
      assert.equal(
        (await reopened.read()).data.machines.phomemo_01.reason,
        "Owner paused after inspection",
      );
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});

test("upload registration cleans only a definitely uncommitted read failure or exhausted conflicts", async () => {
  for (const fault of ["read", "conflict"] as const) {
    const f = fixture();
    try {
      const a = request.agent(f.app);
      await a.post("/api/session").send({ role: "requester" }).expect(200);
      const before = await f.store.read(),
        originalRead = f.store.read.bind(f.store),
        originalCas = f.store.compareAndSet.bind(f.store);
      let conflicts = 0;
      if (fault === "read")
        f.store.read = async () => {
          if (f.files().length)
            throw new Error("Registration read disconnected");
          return originalRead();
        };
      else
        f.store.compareAndSet = async () => {
          conflicts++;
          return false;
        };
      await a
        .post("/api/uploads")
        .attach("images", image, {
          filename: "art.png",
          contentType: "image/png",
        })
        .expect(500);
      f.store.read = originalRead;
      f.store.compareAndSet = originalCas;
      assert.deepEqual(await f.store.read(), before);
      assert.deepEqual(f.files(), []);
      if (fault === "conflict") assert.equal(conflicts, 25);
    } finally {
      f.close();
    }
  }
});

test("preview registration failure removes only its new output and keeps uploaded artwork", async () => {
  for (const fault of ["read", "conflict"] as const) {
    const f = fixture();
    try {
      const a = request.agent(f.app);
      await a.post("/api/session").send({ role: "requester" }).expect(200);
      const assetId = await upload(a),
        files = f.files(),
        before = await f.store.read();
      const originalRead = f.store.read.bind(f.store),
        originalCas = f.store.compareAndSet.bind(f.store);
      let conflicts = 0;
      if (fault === "read")
        f.store.read = async () => {
          if (f.files().length > files.length)
            throw new Error("Preview registration disconnected");
          return originalRead();
        };
      else
        f.store.compareAndSet = async () => {
          conflicts++;
          return false;
        };
      await a.post("/api/jobs").send(spec(assetId)).expect(500);
      f.store.read = originalRead;
      f.store.compareAndSet = originalCas;
      assert.deepEqual(await f.store.read(), before);
      assert.deepEqual(f.files(), files);
      await a.get(`/assets/${assetId}`).expect(200);
      if (fault === "conflict") assert.equal(conflicts, 25);
    } finally {
      f.close();
    }
  }
});

test("a failed preparer removes its partial new output without touching existing private assets", async () => {
  const f = fixture(),
    originalPath = process.env.PATH;
  try {
    const a = request.agent(f.app);
    await a.post("/api/session").send({ role: "requester" }).expect(200);
    const assetId = await upload(a),
      files = f.files(),
      before = await f.store.read();
    const bin = join(f.dir, "bin");
    mkdirSync(bin);
    // This isolated executable models an encoder/disk failure after writing a partial PNG.
    writeFileSync(
      join(bin, "uv"),
      `#!${process.execPath}\nconst fs = require('node:fs'); const args = process.argv.slice(2); if (args[3] !== 'fabrary-prepare') process.exit(90); fs.writeFileSync(args[5], 'partial PNG'); process.exit(2);\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${bin}:${originalPath ?? ""}`;
    await a.post("/api/jobs").send(spec(assetId)).expect(500);
    process.env.PATH = originalPath;
    assert.deepEqual(await f.store.read(), before);
    assert.deepEqual(f.files(), files);
    await a.get(`/assets/${assetId}`).expect(200);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    f.close();
  }
});

test("lost upload or preview registration replies preserve already committed asset files", async () => {
  for (const stage of ["upload", "preview"] as const) {
    const f = fixture();
    try {
      const a = request.agent(f.app);
      await a.post("/api/session").send({ role: "requester" }).expect(200);
      const assetId = stage === "preview" ? await upload(a) : undefined;
      const originalCas = f.store.compareAndSet.bind(f.store);
      f.store.compareAndSet = async (version, data) => {
        assert.equal(await originalCas(version, data), true);
        throw new Error("Committed reply lost");
      };
      if (stage === "upload")
        await a
          .post("/api/uploads")
          .attach("images", image, {
            filename: "art.png",
            contentType: "image/png",
          })
          .expect(500);
      else await a.post("/api/jobs").send(spec(assetId!)).expect(500);
      f.store.compareAndSet = originalCas;
      const state = (await f.store.read()).data;
      assert.equal(
        Object.keys(state.assets).length,
        stage === "upload" ? 1 : 2,
      );
      for (const asset of Object.values(state.assets)) {
        assert.equal(
          createHash("sha256").update(readFileSync(asset.path)).digest("hex"),
          asset.sha256,
        );
        await a.get(asset.url).expect(200);
      }
      assert.equal(Object.keys(state.jobs).length, 0);
    } finally {
      f.close();
    }
  }
});

test("an uncertain registration keeps its file even when a stale read shows no asset before a late commit", async () => {
  const f = fixture();
  try {
    const a = request.agent(f.app);
    await a.post("/api/session").send({ role: "requester" }).expect(200);
    const originalCas = f.store.compareAndSet.bind(f.store);
    let pending: { version: number; data: State } | undefined;
    f.store.compareAndSet = async (version, data) => {
      pending = { version, data: structuredClone(data) };
      throw new Error("Transport disconnected with reducer pending");
    };
    await a
      .post("/api/uploads")
      .attach("images", image, {
        filename: "art.png",
        contentType: "image/png",
      })
      .expect(500);
    assert.equal(Object.keys((await f.store.read()).data.assets).length, 0);
    assert.equal(f.files().length, 1);
    assert(pending);
    f.store.compareAndSet = originalCas;
    assert.equal(await originalCas(pending.version, pending.data), true);
    const asset = Object.values((await f.store.read()).data.assets)[0];
    await a.get(asset.url).expect(200);
  } finally {
    f.close();
  }
});

test("a lost committed order response preserves the exact original and production preview across store reopen", async () => {
  const f = fixture();
  try {
    const a = request.agent(f.app);
    await a.post("/api/session").send({ role: "requester" }).expect(200);
    const assetId = await upload(a),
      originalCas = f.store.compareAndSet.bind(f.store);
    f.store.compareAndSet = async (version, data) => {
      const committed = await originalCas(version, data);
      if (Object.keys(data.jobs).length)
        throw new Error("Order response lost after commit");
      return committed;
    };
    await a.post("/api/jobs").send(spec(assetId)).expect(500);
    f.store.compareAndSet = originalCas;
    const reopened = new SqliteStore(join(f.dir, "app.sqlite"), initialState());
    try {
      const state = (await reopened.read()).data,
        jobs = Object.values(state.jobs);
      assert.equal(jobs.length, 1);
      const job = jobs[0];
      assert.equal(job.productionState, "specified");
      assert.deepEqual(job.spec.assetIds, [assetId]);
      const artifact = state.assets[job.artifact.id];
      assert.equal(artifact.sha256, job.artifact.sha256);
      assert.equal(
        createHash("sha256").update(readFileSync(artifact.path)).digest("hex"),
        job.artifact.sha256,
      );
      await a.get(`/assets/${assetId}`).expect(200);
      await a.get(job.artifact.url).expect(200);
      const response = await a.get(`/api/jobs/${job.id}`).expect(200);
      assert.equal(response.body.job.artifact.sha256, job.artifact.sha256);
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});

test("definite mutation cleanup runs once and cannot mask read, validation or conflict failures", async () => {
  for (const stage of ["read", "validation", "conflicts"] as const) {
    const f = fixture();
    try {
      const originalFailure = new Error(`${stage} failed before commit`);
      let cleanups = 0,
        conflicts = 0;
      if (stage === "read")
        f.store.read = async () => {
          throw originalFailure;
        };
      if (stage === "conflicts")
        f.store.compareAndSet = async () => {
          conflicts++;
          return false;
        };
      await assert.rejects(
        mutate(
          f.store,
          () => {
            if (stage === "validation") throw originalFailure;
          },
          {
            onNotCommitted() {
              cleanups++;
              throw new Error("Cleanup also failed");
            },
          },
        ),
        (error: unknown) =>
          stage === "conflicts"
            ? error instanceof Error &&
              /Concurrent state changes exceeded retry limit/.test(
                error.message,
              )
            : error === originalFailure,
      );
      assert.equal(cleanups, 1);
      if (stage === "conflicts") assert.equal(conflicts, 25);
    } finally {
      f.close();
    }
  }
  const f = fixture();
  try {
    let cleanups = 0;
    await mutate(
      f.store,
      (s) => {
        s.machines.phomemo_01.reason = "Successful mutation";
      },
      {
        onNotCommitted() {
          cleanups++;
        },
      },
    );
    assert.equal(cleanups, 0);
  } finally {
    f.close();
  }
});
