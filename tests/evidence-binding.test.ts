import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, type Job } from "../server/model.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { createApp } from "../server/app.ts";
import { evidenceFingerprint, evidenceUrl } from "../server/evidence.ts";

const at = "2026-10-23T12:00:00.000Z";
const frameBytes = (letter: string) =>
  Buffer.from(`IDENTIFIABLE_FRAME_${letter}`);
const evidence = (letter = "A") => ({
  url: `http://127.0.0.1:1/frames/${letter}.png`,
  capturedAt: at,
  jobId: "job_evidence_fixture",
  machineId: "phomemo_01",
  source: "simulation",
  result: "review",
  reason: `Inspect saved frame ${letter}`,
});
const job = (id = "job_evidence_fixture"): Job => ({
  id,
  requesterId: "team_owner",
  machineId: "phomemo_01",
  specVersion: 1,
  spec: {
    assetIds: ["fixture_art"],
    intent: "Isolated evidence binding",
    outputType: "sticker",
    widthMm: 53,
    heightMm: 50,
    quantity: 1,
    material: "thermal-paper",
    permission: "authorized",
    crop: "contain",
  },
  artifact: {
    id: "fixture_art",
    url: "/assets/fixture_art",
    sha256: "a".repeat(64),
  },
  productionState: "produced",
  paymentState: "unpaid",
  fulfillmentState: "unprepared",
  history: [],
  createdAt: at,
  updatedAt: at,
  version: 1,
  attemptId: "attempt_A",
  evidence: evidence(),
});

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabrary-evidence-binding-"));
  const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  const calls: string[] = [];
  const controls = { fetch: null as ((url: string) => Promise<Buffer>) | null };
  const service = new Service(
    store,
    {
      token() {
        throw new Error("No execution allowed in evidence fixture");
      },
      async call(tool) {
        if (tool === "get_status") return { execution_status: "running" };
        throw new Error(
          "No hardware or camera calls allowed in evidence fixture",
        );
      },
      async fetchFrame(url) {
        calls.push(url);
        if (controls.fetch) return controls.fetch(url);
        return frameBytes(url.endsWith("/A.png") ? "A" : "B");
      },
    },
    new MockPayment(),
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:1/assets",
      secret: "isolated-evidence-secret",
      quoteMs: 120000,
      pickupMs: 10000,
      ownerCode: "isolated-evidence-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
    },
  );
  const app = createApp(service),
    owner = request.agent(app),
    stranger = request.agent(app);
  await owner
    .post("/api/session")
    .send({ role: "owner", accessCode: "isolated-evidence-owner" })
    .expect(200);
  await stranger.post("/api/session").send({ role: "requester" }).expect(200);
  await mutate(store, (state) => {
    state.jobs.job_evidence_fixture = job();
  });
  return {
    store,
    service,
    app,
    owner,
    stranger,
    calls,
    controls,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("all public job metadata binds evidence and excludes the internal creation-spec hash", async () => {
  const f = await fixture();
  try {
    await mutate(f.store, (s) =>
      Object.assign(s.jobs.job_evidence_fixture, {
        creationRequestId: "public-creation-request",
        creationSpecHash: "internal-original-spec-hash",
      }),
    );
    const detail = await f.owner
      .get("/api/jobs/job_evidence_fixture")
      .expect(200);
    const list = await f.owner.get("/api/jobs").expect(200);
    const dashboard = await f.owner.get("/api/owner/dashboard").expect(200);
    for (const visible of [
      detail.body.job,
      list.body.jobs[0],
      dashboard.body.jobs[0],
    ]) {
      const url = new URL(visible.evidence.url, "http://fixture");
      assert.equal(url.pathname, "/api/jobs/job_evidence_fixture/evidence");
      assert.equal(
        url.searchParams.get("frame"),
        evidenceFingerprint((await f.service.read()).jobs.job_evidence_fixture),
      );
      assert.equal(visible.creationRequestId, "public-creation-request");
      assert.equal(Object.hasOwn(visible, "creationSpecHash"), false);
      assert.equal(
        JSON.stringify(visible).includes("http://127.0.0.1:1/frames/"),
        false,
      );
      const image = await f.owner.get(visible.evidence.url).expect(200);
      assert.deepEqual(image.body, frameBytes("A"));
      assert.equal(image.headers["cache-control"], "no-store");
    }
  } finally {
    f.close();
  }
});

test("stale job frames and changed attempt identity reject before fetching instead of substituting new bytes", async () => {
  const f = await fixture();
  try {
    const first = (
      await f.owner.get("/api/jobs/job_evidence_fixture").expect(200)
    ).body.job;
    await mutate(f.store, (s) => {
      s.jobs[first.id].evidence = evidence("B");
      s.jobs[first.id].attemptId = "attempt_B";
    });
    const stale = await f.owner.get(first.evidence.url).expect(409);
    assert.equal(stale.body.error.code, "EVIDENCE_CHANGED");
    assert.match(stale.body.error.message, /Refresh the saved/);
    assert.deepEqual(f.calls, []);
    const fresh = (await f.owner.get(`/api/jobs/${first.id}`).expect(200)).body
      .job;
    assert.notEqual(fresh.evidence.url, first.evidence.url);
    assert.deepEqual(
      (await f.owner.get(fresh.evidence.url).expect(200)).body,
      frameBytes("B"),
    );
    f.calls.length = 0;
    await mutate(f.store, (s) => {
      s.jobs[first.id].attemptId = "attempt_C";
    });
    await f.owner.get(fresh.evidence.url).expect(409);
    await mutate(f.store, (s) => {
      delete s.jobs[first.id].evidence;
    });
    await f.owner.get(fresh.evidence.url).expect(409);
    assert.deepEqual(f.calls, []);
  } finally {
    f.close();
  }
});

test("an already bound in-flight frame read keeps its exact bytes when newer metadata commits", async () => {
  const f = await fixture();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const original = (
      await f.owner.get("/api/jobs/job_evidence_fixture").expect(200)
    ).body.job;
    f.controls.fetch = async (url) => {
      assert.match(url, /\/A\.png$/);
      entered();
      await held;
      return frameBytes("A");
    };
    const image = f.owner
      .get(original.evidence.url)
      .then((response) => response);
    await started;
    await mutate(f.store, (s) => {
      s.jobs[original.id].evidence = evidence("B");
    });
    release();
    const response = await image;
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, frameBytes("A"));
    await f.owner.get(original.evidence.url).expect(409);
    assert.equal(f.calls.length, 1);
  } finally {
    release();
    f.close();
  }
});

test("calibration metadata and legacy image reads share active-first selection and newest insertion ties", async () => {
  const f = await fixture();
  try {
    await mutate(f.store, (s) => {
      s.calibrations = {
        calibration_A: { ...job("calibration_A"), productionState: "running" },
        calibration_B: {
          ...job("calibration_B"),
          evidence: evidence("B"),
          attemptId: "attempt_B",
        },
      };
      s.machines.phomemo_01.activeJobId = "calibration_A";
    });
    const active = (
      await f.owner
        .get("/api/owner/machines/phomemo_01/calibration")
        .expect(200)
    ).body.calibration;
    assert.equal(active.id, "calibration_A");
    assert.equal(
      new URL(active.evidence.url, "http://fixture").searchParams.get(
        "calibration",
      ),
      active.id,
    );
    assert.deepEqual(
      (await f.owner.get(active.evidence.url).expect(200)).body,
      frameBytes("A"),
    );
    assert.deepEqual(
      (
        await f.owner
          .get("/api/owner/machines/phomemo_01/calibration/evidence")
          .expect(200)
      ).body,
      frameBytes("A"),
    );
    await mutate(f.store, (s) => {
      s.machines.phomemo_01.activeJobId = null;
    });
    const latest = (
      await f.owner
        .get("/api/owner/machines/phomemo_01/calibration")
        .expect(200)
    ).body.calibration;
    assert.equal(latest.id, "calibration_B");
    assert.deepEqual(
      (await f.owner.get(latest.evidence.url).expect(200)).body,
      frameBytes("B"),
    );
    assert.deepEqual(
      (
        await f.owner
          .get("/api/owner/machines/phomemo_01/calibration/evidence")
          .expect(200)
      ).body,
      frameBytes("B"),
    );
    // A retained, explicitly identified old frame is still truthfully A under A's caption.
    assert.deepEqual(
      (await f.owner.get(active.evidence.url).expect(200)).body,
      frameBytes("A"),
    );
  } finally {
    f.close();
  }
});

test("changed or missing explicit calibration frames never fall back to another attempt", async () => {
  const f = await fixture();
  try {
    await mutate(f.store, (s) => {
      s.calibrations = { calibration_A: job("calibration_A") };
    });
    const first = (
      await f.owner
        .get("/api/owner/machines/phomemo_01/calibration")
        .expect(200)
    ).body.calibration;
    await mutate(f.store, (s) => {
      s.calibrations!.calibration_A.evidence = evidence("B");
    });
    await f.owner.get(first.evidence.url).expect(409);
    assert.deepEqual(f.calls, []);
    await mutate(f.store, (s) => {
      delete s.calibrations!.calibration_A;
      s.calibrations!.calibration_B = {
        ...job("calibration_B"),
        evidence: evidence("B"),
      };
    });
    await f.owner.get(first.evidence.url).expect(404);
    assert.deepEqual(f.calls, []);
    await mutate(f.store, (s) => {
      s.calibrations!.calibration_C = {
        ...job("calibration_C"),
        evidence: undefined,
      };
      s.machines.phomemo_01.activeJobId = "calibration_C";
    });
    const latest = (
      await f.owner
        .get("/api/owner/machines/phomemo_01/calibration")
        .expect(200)
    ).body.calibration;
    assert.equal(latest.id, "calibration_C");
    assert.equal(latest.evidence, undefined);
    await f.owner
      .get("/api/owner/machines/phomemo_01/calibration/evidence")
      .expect(404);
    assert.deepEqual(f.calls, []);
  } finally {
    f.close();
  }
});

test("binding inputs are strict, calibration identities stay on their machine and authentication precedes frame access", async () => {
  const f = await fixture();
  try {
    const current = (
      await f.owner.get("/api/jobs/job_evidence_fixture").expect(200)
    ).body.job;
    await request(f.app).get(current.evidence.url).expect(401);
    await f.stranger.get(current.evidence.url).expect(403);
    for (const query of [
      "frame=invalid",
      "frame=",
      `frame=${"a".repeat(64)}&frame=${"b".repeat(64)}`,
      `frame=${"A".repeat(64)}`,
    ])
      await f.owner
        .get(`/api/jobs/${current.id}/evidence?${query}`)
        .expect(400);
    await mutate(f.store, (s) => {
      s.calibrations = {
        foreign: { ...job("foreign"), machineId: "instax_01" },
        calibration_A: job("calibration_A"),
      };
    });
    for (const query of [
      "calibration=calibration_A",
      `frame=${"a".repeat(64)}`,
      `frame=${"a".repeat(64)}&calibration=calibration_A&calibration=other`,
      `frame=${"a".repeat(64)}&calibration=`,
    ])
      await f.owner
        .get(`/api/owner/machines/phomemo_01/calibration/evidence?${query}`)
        .expect(400);
    for (const key of ["foreign", "constructor", "__proto__"])
      await f.owner
        .get(
          `/api/owner/machines/phomemo_01/calibration/evidence?frame=${"a".repeat(64)}&calibration=${key}`,
        )
        .expect(404);
    await f.owner
      .get(
        `/api/owner/machines/phomemo_01/calibration/evidence?frame=${"a".repeat(64)}&calibration=calibration_A`,
      )
      .expect(409);
    assert.deepEqual(f.calls, []);
  } finally {
    f.close();
  }
});

test("legacy job image reads remain available and unavailable bound frames preserve the saved outcome", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(
      (await f.owner.get("/api/jobs/job_evidence_fixture/evidence").expect(200))
        .body,
      frameBytes("A"),
    );
    const saved = await f.store.read();
    const url = evidenceUrl(saved.data.jobs.job_evidence_fixture)!;
    f.controls.fetch = async () => {
      throw new Error("private node transport detail");
    };
    const failure = await f.owner.get(url).expect(502);
    assert.equal(failure.body.error.code, "FRAME_UNAVAILABLE");
    assert.equal(
      JSON.stringify(failure.body).includes("private node transport detail"),
      false,
    );
    assert.deepEqual(await f.store.read(), saved);
  } finally {
    f.close();
  }
});
