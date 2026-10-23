import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, record } from "../server/model.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { createApp } from "../server/app.ts";

const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const spec = {
  assetIds: ["concurrent_art"],
  intent: "Original inspected sticker",
  outputType: "sticker",
  widthMm: 53,
  heightMm: 50,
  quantity: 1,
  material: "thermal-paper",
  permission: "authorized",
  crop: "contain",
};
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabrary-spec-concurrency-"));
  mkdirSync(join(dir, "assets"));
  mkdirSync(join(dir, "bin"));
  const entered = join(dir, "old-preparation-entered"),
    release = join(dir, "release-old-preparation");
  writeFileSync(
    join(dir, "bin", "uv"),
    `#!${process.execPath}\nconst fs = require('node:fs'); const args = process.argv.slice(2); if (args[3] !== 'fabrary-prepare') process.exit(90); const output = args[5]; const height = args[args.indexOf('--height-mm') + 1]; async function main() { if (height === '51') { fs.writeFileSync(${JSON.stringify(entered)}, 'entered'); while (!fs.existsSync(${JSON.stringify(release)})) await new Promise(resolve => setTimeout(resolve, 5)); } fs.copyFileSync(args[4], output); } main().catch(() => process.exit(91));\n`,
    { mode: 0o755 },
  );
  const store = new SqliteStore(join(dir, "app.sqlite"), initialState());
  const service = new Service(
    store,
    {
      async call() {
        throw new Error("Node calls forbidden in concurrency fixture");
      },
      token() {
        throw new Error("Dispatch forbidden in concurrency fixture");
      },
    },
    new MockPayment(),
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:4318/assets",
      secret: "isolated-spec-test",
      quoteMs: 120000,
      pickupMs: 10000,
      ownerCode: "isolated-spec-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
    },
  );
  const app = createApp(service),
    agent = request.agent(app);
  const session = (
    await agent.post("/api/session").send({ role: "requester" }).expect(200)
  ).body;
  const path = join(dir, "assets", "concurrent_art");
  writeFileSync(path, image);
  const artifact = {
    id: "concurrent_art",
    url: "/assets/concurrent_art",
    sha256: createHash("sha256").update(image).digest("hex"),
  };
  await mutate(store, (state) => {
    state.assets.concurrent_art = {
      ...artifact,
      path,
      mime: "image/png",
      ownerId: session.id,
      width: 1,
      height: 1,
      createdAt: new Date().toISOString(),
    };
    Object.assign(state.machines.phomemo_01, {
      paired: true,
      configured: true,
      calibrated: true,
      listed: true,
      ready: true,
      paused: false,
      mediaRemaining: 100,
      hours: { start: 0, end: 24 },
    });
  });
  const job = await service.create(session.id, spec, artifact);
  return {
    dir,
    store,
    service,
    agent,
    job,
    artifact,
    entered,
    release,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
async function waitForFile(path: string) {
  const end = Date.now() + 3000;
  while (!existsSync(path)) {
    if (Date.now() > end)
      throw new Error("Isolated preparer did not enter its controlled gate");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

for (const newerEdit of [true, false])
  test(`an old held preparation cannot overwrite a newer ${newerEdit ? "edit" : "approval and quote"} or release its reservation`, async () => {
    const f = await fixture(),
      originalPath = process.env.PATH;
    let pending: Promise<request.Response> | undefined;
    try {
      process.env.PATH = `${join(f.dir, "bin")}:${originalPath ?? ""}`;
      pending = f.agent
        .patch(`/api/jobs/${f.job.id}/spec`)
        .send({
          ...spec,
          intent: "Older preparation A must not win",
          heightMm: 51,
        })
        .then((response) => response);
      await waitForFile(f.entered);
      if (newerEdit)
        await f.agent
          .patch(`/api/jobs/${f.job.id}/spec`)
          .send({ ...spec, intent: "Newer saved preparation B", heightMm: 52 })
          .expect(200);
      const current = await f.service.job(f.job.id);
      await f.service.approve(current.id, {
        specVersion: current.specVersion,
        artifactSha256: current.artifact.sha256,
      });
      await f.service.quote(current.id);
      const before = (await f.store.read()).data;
      writeFileSync(f.release, "release");
      const response = await pending;
      assert.equal(response.status, 409);
      assert.equal(response.body.error.code, "STALE_SPECIFICATION");
      const after = (await f.store.read()).data;
      assert.deepEqual(after.jobs[f.job.id], before.jobs[f.job.id]);
      assert.deepEqual(after.machines, before.machines);
      assert.equal(
        Object.keys(after.assets).length,
        Object.keys(before.assets).length + 1,
      );
      for (const asset of Object.values(after.assets)) {
        assert(existsSync(asset.path));
        assert.equal(
          createHash("sha256").update(readFileSync(asset.path)).digest("hex"),
          asset.sha256,
        );
        await f.agent.get(asset.url).expect(200);
      }
    } finally {
      writeFileSync(f.release, "release");
      await pending?.catch(() => {});
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      f.close();
    }
  });

test("a CAS retry checks the original observed job version against the newly committed specification", async () => {
  const f = await fixture();
  try {
    const originalCas = f.store.compareAndSet.bind(f.store);
    const observed = await f.service.job(f.job.id);
    let attemptedWrites = 0;
    let winner: typeof observed | undefined;
    f.store.compareAndSet = async (version, data) => {
      attemptedWrites++;
      const current = await f.store.read();
      const job = current.data.jobs[f.job.id];
      job.spec = {
        ...job.spec,
        intent: "Newer edit committed during CAS",
        heightMm: 52,
      };
      job.specVersion++;
      record(
        job,
        "concurrent_specification",
        "The controlled competing edit committed first",
      );
      winner = structuredClone(job);
      assert.equal(await originalCas(current.version, current.data), true);
      return false;
    };
    await assert.rejects(
      f.service.revise(
        f.job.id,
        { ...spec, intent: "Older CAS proposal", heightMm: 51 },
        f.artifact,
        observed,
      ),
      (error: any) =>
        error.code === "STALE_SPECIFICATION" && error.status === 409,
    );
    assert.equal(attemptedWrites, 1);
    assert.deepEqual(await f.service.job(f.job.id), winner);
  } finally {
    f.close();
  }
});

test("an unrelated state conflict retries without rejecting or losing the current specification update", async () => {
  const f = await fixture();
  try {
    const originalCas = f.store.compareAndSet.bind(f.store);
    let attemptedWrites = 0;
    f.store.compareAndSet = async (version, data) => {
      attemptedWrites++;
      if (attemptedWrites === 1) {
        const current = await f.store.read();
        current.data.machines.phomemo_01.reason =
          "Concurrent owner note remains saved";
        assert.equal(await originalCas(current.version, current.data), true);
        return false;
      }
      return originalCas(version, data);
    };
    const result = await f.service.revise(
      f.job.id,
      {
        ...spec,
        intent: "Current edit survives unrelated conflict",
        heightMm: 75,
      },
      f.artifact,
    );
    assert.equal(attemptedWrites, 2);
    assert.equal(
      result.spec.intent,
      "Current edit survives unrelated conflict",
    );
    assert.equal(result.spec.heightMm, 75);
    assert.equal(result.specVersion, f.job.specVersion + 1);
    assert.equal(
      (await f.store.read()).data.machines.phomemo_01.reason,
      "Concurrent owner note remains saved",
    );
    assert(existsSync((await f.store.read()).data.assets.concurrent_art.path));
  } finally {
    f.close();
  }
});
