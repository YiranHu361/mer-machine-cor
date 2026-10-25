import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import request from "supertest";
import { CloudProducer } from "../server/cloud-producer.ts";
import { digest, type FileStorage } from "../server/cloud-files.ts";
import { initialState } from "../server/model.ts";
import { SqliteStore, mutate } from "../server/store.ts";

const key = "test-producer-key-0123456789-abcdef";
const pause = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

test("cloud queue authenticates, deduplicates dispatch, expires unreceived work, and records ambiguous delivery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fabyn-cloud-queue-"));
  const store = new SqliteStore(
    join(directory, "state.sqlite"),
    initialState(),
  );
  const files: FileStorage = {
    async upload() {
      return "file";
    },
    async download() {
      return Buffer.alloc(0);
    },
    async url() {
      return "https://example.test/file";
    },
    async uploadUrl() {
      return "https://example.test/upload";
    },
  };
  let now = Date.now();
  const cloud = new CloudProducer(store, files, key, directory, () => now);
  const app = express();
  app.use(express.json());
  cloud.register(
    app,
    (id) => `https://app.test/assets/${id}`,
    async () => {},
  );
  app.use((e: any, _req: any, res: any, _next: any) =>
    res.status(e.status ?? 500).json({ error: e.message }),
  );
  const machine = {
    ...initialState().machines.phomemo_01,
    producerHub: { machineId: "m_sticker_01", since: "now" },
  };
  const input = {
    job_id: "job1",
    attempt_id: "attempt1",
    artifact_url: "https://app.test/assets/artwork?sig=x",
    artifact_sha256: "a".repeat(64),
    parameters: {
      outputType: "sticker",
      widthMm: 48,
      heightMm: 30,
      quantity: 1,
    },
  };
  const poll = (body = {}) =>
    request(app)
      .post("/api/producer/poll")
      .set("Authorization", `Bearer ${key}`)
      .send({ machines: [], ...body });
  try {
    await request(app)
      .post("/api/producer/poll")
      .send({ machines: [] })
      .expect(401);
    await Promise.all([
      cloud.call("run_job", input, machine),
      cloud.call("run_job", input, machine),
    ]);
    assert.equal(
      Object.keys((await store.read()).data.producer!.tasks).length,
      1,
    );
    const first = await poll().expect(200);
    assert.equal(
      first.body.tasks[0].payload.asset_url,
      "https://app.test/assets/artwork",
    );
    const secondInstance = new CloudProducer(
      store,
      files,
      key,
      directory,
      () => now,
    );
    assert.equal(
      (await secondInstance.call("get_status", input, machine))
        .execution_status,
      "accepted",
    );
    now += 301_000;
    assert.equal(
      (await cloud.call("get_status", input, machine)).execution_status,
      "unknown",
    );
    await cloud.call(
      "run_job",
      { ...input, attempt_id: "never-delivered" },
      machine,
    );
    now += 301_000;
    assert.equal(
      (
        await cloud.call(
          "get_status",
          { ...input, attempt_id: "never-delivered" },
          machine,
        )
      ).execution_status,
      "failed",
    );
    await poll({
      events: [{ type: "job.result", data: { job_id: "attempt1", ok: true } }],
    }).expect(200);
    assert.equal(
      (await cloud.call("get_status", input, machine)).execution_status,
      "completed",
    );
    await poll({
      events: [
        {
          type: "job.progress",
          data: { job_id: "attempt1", state: "running" },
        },
      ],
    }).expect(200);
    assert.equal(
      (await cloud.call("get_status", input, machine)).execution_status,
      "completed",
      "late progress cannot undo completion",
    );
    await assert.rejects(
      cloud.call(
        "run_job",
        { ...input, artifact_sha256: "b".repeat(64) },
        machine,
      ),
      /already belongs/,
    );
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "real local producer polls the cloud, prepares an image, and executes a file-only sticker once",
  { timeout: 60_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "fabyn-cloud-e2e-"));
    const store = new SqliteStore(
      join(directory, "state.sqlite"),
      initialState(),
    );
    const objects = new Map<string, Buffer>();
    let origin = "";
    const files: FileStorage = {
      async upload(bytes) {
        const id = digest(bytes);
        objects.set(id, bytes);
        return id;
      },
      async download(id) {
        return objects.get(id)!;
      },
      async url(id) {
        return `${origin}/objects/${id}`;
      },
      async uploadUrl() {
        return `${origin}/objects/upload`;
      },
    };
    const cloud = new CloudProducer(store, files, key, directory);
    const app = express();
    app.post(
      "/objects/upload",
      express.raw({ type: "*/*", limit: "20mb" }),
      (req, res) => {
        const id = digest(req.body);
        objects.set(id, req.body);
        res.json({ storageId: id });
      },
    );
    app.get("/objects/:id", (req, res) => res.send(objects.get(req.params.id)));
    app.use(express.json());
    cloud.register(
      app,
      (id) => `${origin}/objects/${id}`,
      async () => {},
    );
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${(server.address() as any).port}`;
    let logs = "";
    const worker = spawn(
      resolve("producer-side/.venv/bin/python"),
      [
        "-m",
        "hub.cloud",
        "--origin",
        origin,
        "--dry-run",
        "--work-dir",
        join(directory, "local"),
      ],
      {
        cwd: resolve("producer-side"),
        env: { ...process.env, FABYN_PRODUCER_KEY: key },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    worker.stdout.on("data", (chunk) => {
      logs += chunk;
    });
    worker.stderr.on("data", (chunk) => {
      logs += chunk;
    });
    const waitFor = async (predicate: () => Promise<boolean>) => {
      const end = Date.now() + 35_000;
      while (Date.now() < end) {
        if (await predicate()) return;
        if (worker.exitCode !== null) break;
        await pause();
      }
      assert.fail(`local producer did not finish: ${logs}`);
    };
    try {
      await waitFor(async () => (await cloud.machines()).length === 3);
      assert(
        (await cloud.machines()).every((m) => m.simulated),
        "dry runs are labeled simulation",
      );
      const rendered = await cloud.rpc("prepare", {
        operation: "render_design_preview",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" fill="black"/></svg>',
        size_px: 128,
        output_dir: "ignored-cloud-path",
      });
      assert.equal(rendered.status, "ready");
      const inspected = await cloud.rpc("inspect", { path: rendered.path }, [
        rendered.path,
      ]);
      assert.deepEqual(
        [inspected.width, inspected.height, inspected.mime],
        [128, 128, "image/png"],
      );
      const { readFile } = await import("node:fs/promises");
      const bytes = await readFile(rendered.path),
        assetId = await files.upload(bytes);
      const machine = {
        ...initialState().machines.phomemo_01,
        producerHub: { machineId: "m_sticker_01", since: "now" },
      };
      const input = {
        job_id: "test_job",
        attempt_id: "test_attempt",
        artifact_url: `${origin}/assets/${assetId}`,
        artifact_sha256: digest(bytes),
        parameters: {
          outputType: "sticker",
          widthMm: 48,
          heightMm: 30,
          quantity: 1,
        },
      };
      await cloud.call("run_job", input, machine);
      await cloud.call("run_job", input, machine);
      await waitFor(
        async () =>
          (await cloud.call("get_status", input, machine)).execution_status ===
          "completed",
      );
      const { DatabaseSync } = await import("node:sqlite");
      const journal = new DatabaseSync(
        join(directory, "local", "producer.sqlite"),
      );
      assert.equal(
        (
          journal
            .prepare("SELECT count(*) AS n FROM jobs WHERE id='test_attempt'")
            .get() as any
        ).n,
        1,
      );
      journal.close();
    } finally {
      worker.kill("SIGTERM");
      await once(worker, "exit").catch(() => {});
      await new Promise<void>((done) => server.close(() => done()));
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
