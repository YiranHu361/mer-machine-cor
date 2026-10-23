import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState } from "../server/model.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { createApp } from "../server/app.ts";
import { calibrationDeviceContext } from "../server/calibration-context.ts";

async function fixture(held = false) {
  const dir = mkdtempSync(join(tmpdir(), "fabrary-calibration-preparation-")),
    previousPath = process.env.PATH,
    store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "assets"));
  const entered = join(dir, "entered"),
    release = join(dir, "release"),
    hold = join(dir, "hold");
  if (held) writeFileSync(hold, "hold");
  writeFileSync(
    join(dir, "bin", "uv"),
    `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);if(a[3]!=='fabrary-prepare')process.exit(90);async function main(){if(fs.existsSync(${JSON.stringify(hold)})){fs.writeFileSync(${JSON.stringify(entered)},'entered');while(!fs.existsSync(${JSON.stringify(release)}))await new Promise(r=>setTimeout(r,5));}fs.copyFileSync(a[4],a[5]);}main().catch(()=>process.exit(91));\n`,
    { mode: 0o755 },
  );
  process.env.PATH = `${join(dir, "bin")}:${previousPath ?? ""}`;
  const calls: { tool: string; jobId?: string }[] = [];
  const service = new Service(
    store,
    {
      token() {
        return {
          token: "isolated-preparation",
          expires_at: Math.floor(Date.now() / 1000) + 60,
        };
      },
      async call(tool, input) {
        calls.push({ tool, jobId: input.job?.job_id });
        if (tool === "/calibrate")
          return { execution_status: "running", mode: "simulation" };
        if (tool === "/reconcile") return {};
        if (tool === "get_status")
          return {
            machine_id: "phomemo_01",
            mode: "simulation",
            ready: false,
            calibrated: false,
            execution_status: "failed",
          };
        if (tool === "camera_snapshot")
          throw Error("No camera in isolated preparation fixture");
        throw Error("Unconfigured fake node method");
      },
    },
    new MockPayment(),
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:1/assets",
      secret: "isolated-preparation",
      quoteMs: 120000,
      pickupMs: 10000,
      ownerCode: "isolated-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
    },
  );
  const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
    path = join(dir, "assets", "art");
  writeFileSync(path, image);
  const artifact = {
      id: "art",
      url: "/assets/art",
      sha256: createHash("sha256").update(image).digest("hex"),
    },
    spec = {
      assetIds: ["art"],
      intent: "Explicit supervised calibration preparation fixture",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    };
  const owner = request.agent(createApp(service));
  await owner
    .post("/api/session")
    .send({ role: "owner", accessCode: "isolated-owner" })
    .expect(200);
  await mutate(store, (s) => {
    s.assets.art = {
      ...artifact,
      path,
      ownerId: "team_owner",
      mime: "image/png",
      width: 1,
      height: 1,
      createdAt: new Date().toISOString(),
    };
  });
  const expectedContext = calibrationDeviceContext(
    (await service.read()).machines.phomemo_01,
  );
  const start = (key: string) =>
    owner
      .post("/api/owner/machines/phomemo_01/calibration/start")
      .send({ spec, ownerReady: true, idempotencyKey: key, expectedContext });
  const newerCycle = async (key: string) => {
    const calibration = await service.startCalibration(
      "phomemo_01",
      "team_owner",
      spec,
      artifact,
      key,
      true,
      expectedContext,
    );
    assert.equal(
      (await service.calibrationStatus("phomemo_01")).calibration
        ?.productionState,
      "failed",
    );
    await service.resolveCalibration("phomemo_01", {
      attemptId: calibration.attemptId,
      inspected: true,
      result: "failed",
      reason: "Owner inspected and cleared the failed newer output",
    });
    return calibration;
  };
  return {
    store,
    service,
    calls,
    owner,
    spec,
    artifact,
    expectedContext,
    start,
    newerCycle,
    async waitEntered() {
      const until = Date.now() + 5000;
      while (!existsSync(entered)) {
        assert(Date.now() < until, "Held preparation did not start");
        await new Promise((r) => setTimeout(r, 5));
      }
    },
    release() {
      writeFileSync(release, "release");
    },
    close() {
      writeFileSync(release, "release");
      store.close();
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("an older held preparation cannot authorize another physical attempt after a newer calibration failed and was cleared", async () => {
  const f = await fixture(true);
  let pending: Promise<request.Response> | undefined;
  try {
    pending = f.start("older-prepared-authorization").then((r) => r);
    await f.waitEntered();
    const newer = await f.newerCycle("newer-completed-authorization");
    const before = await f.service.read();
    assert.equal(before.machines.phomemo_01.activeJobId, null);
    assert.equal(
      calibrationDeviceContext(before.machines.phomemo_01),
      f.expectedContext,
    );
    f.release();
    const rejected = await pending;
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.error.code, "CALIBRATION_AUTHORIZATION_CHANGED");
    const after = await f.service.read();
    assert.equal(Object.keys(after.calibrations!).length, 1);
    assert.equal(after.calibrations![newer.id].productionState, "failed");
    assert.equal(after.machines.phomemo_01.activeJobId, null);
    assert.equal(f.calls.filter((c) => c.tool === "/calibrate").length, 1);
    assert.deepEqual(after.operations, {});
  } finally {
    f.release();
    await pending?.catch(() => {});
    f.close();
  }
});

test("known-key replay after a held preparation still returns its exact failed and cleared attempt", async () => {
  const f = await fixture(true);
  let pending: Promise<request.Response> | undefined;
  try {
    const key = "same-exact-calibration-key";
    pending = f.start(key).then((r) => r);
    await f.waitEntered();
    const known = await f.newerCycle(key);
    f.release();
    const replay = await pending;
    assert.equal(replay.status, 200);
    assert.equal(replay.body.calibration.id, known.id);
    assert.equal(replay.body.calibration.productionState, "failed");
    assert.equal(Object.keys((await f.service.read()).calibrations!).length, 1);
    assert.equal(f.calls.filter((c) => c.tool === "/calibrate").length, 1);
  } finally {
    f.release();
    await pending?.catch(() => {});
    f.close();
  }
});

test("unrelated saved work while preparation is held does not reject a current explicit calibration authorization", async () => {
  const f = await fixture(true);
  let pending: Promise<request.Response> | undefined;
  try {
    pending = f.start("current-prepared-authorization").then((r) => r);
    await f.waitEntered();
    await mutate(f.store, (s) => {
      s.machines.instax_01.reason = "Unrelated requester and owner work";
    });
    f.release();
    const accepted = await pending;
    assert.equal(accepted.status, 200);
    assert.equal(
      (await f.service.read()).machines.phomemo_01.activeJobId,
      accepted.body.calibration.id,
    );
    assert.equal(
      (await f.service.read()).machines.instax_01.reason,
      "Unrelated requester and owner work",
    );
    assert.equal(f.calls.filter((c) => c.tool === "/calibrate").length, 1);
  } finally {
    f.release();
    await pending?.catch(() => {});
    f.close();
  }
});

test("a calibration attempt-and-clear cycle winning CAS fences older authorization while an unrelated CAS conflict still retries", async () => {
  for (const change of ["newer-cycle", "unrelated"] as const) {
    const f = await fixture(),
      original = f.store.compareAndSet.bind(f.store);
    try {
      let armed = true,
        newerId: string | undefined;
      f.store.compareAndSet = async (version, next) => {
        if (
          armed &&
          Object.values(next.calibrations ?? {}).some(
            (c) => c.checkoutKey === "older-cas-authorization",
          )
        ) {
          armed = false;
          if (change === "newer-cycle")
            newerId = (await f.newerCycle("newer-cas-authorization")).id;
          else {
            const fresh = await f.store.read();
            fresh.data.machines.instax_01.reason = "Independent CAS record";
            assert.equal(await original(fresh.version, fresh.data), true);
          }
          return false;
        }
        return original(version, next);
      };
      const response = await f.start("older-cas-authorization");
      f.store.compareAndSet = original;
      assert.equal(armed, false);
      const state = await f.service.read();
      assert.equal(Object.keys(state.calibrations!).length, 1);
      assert.equal(f.calls.filter((c) => c.tool === "/calibrate").length, 1);
      if (change === "newer-cycle") {
        assert.equal(response.status, 409);
        assert.equal(
          response.body.error.code,
          "CALIBRATION_AUTHORIZATION_CHANGED",
        );
        assert.equal(state.calibrations![newerId!].productionState, "failed");
        assert.equal(state.machines.phomemo_01.activeJobId, null);
      } else {
        assert.equal(response.status, 200);
        assert.equal(
          state.machines.phomemo_01.activeJobId,
          response.body.calibration.id,
        );
        assert.equal(state.machines.instax_01.reason, "Independent CAS record");
      }
    } finally {
      f.store.compareAndSet = original;
      f.close();
    }
  }
});
