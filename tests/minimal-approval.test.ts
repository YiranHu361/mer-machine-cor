import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.ts";
import { initialState, now, type Job } from "../server/model.ts";
import { MockPayment } from "../server/payments.ts";
import { Service } from "../server/service.ts";
import { SqliteStore, mutate } from "../server/store.ts";

async function fixture(extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "fabrary-minimal-approval-"));
  const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  let sideEffects = 0;
  const payment = new MockPayment();
  for (const method of ["collect", "transfer", "reconcile"] as const)
    payment[method] = async () => {
      sideEffects++;
      throw Error("Payment forbidden in approval fixture");
    };
  const service = new Service(
    store,
    {
      token() {
        sideEffects++;
        throw Error("Device authorization forbidden in approval fixture");
      },
      async call() {
        sideEffects++;
        throw Error("Device I/O forbidden in approval fixture");
      },
    },
    payment,
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:4318/assets",
      secret: "isolated-minimal-approval-secret",
      ownerCode: "isolated-minimal-owner",
      nodeUrl: "http://127.0.0.1:1",
      quoteMs: 120000,
      pickupMs: 60000,
      dataDir: dir,
    },
  );
  const app = createApp(service),
    agent = request.agent(app);
  const session = (
    await agent.post("/api/session").send({ role: "requester" }).expect(200)
  ).body;
  const artifact = {
    id: "approval_art",
    url: "/assets/approval_art",
    sha256: "a".repeat(64),
  };
  await mutate(store, (state) => {
    state.assets.approval_art = {
      ...artifact,
      ownerId: session.id,
      path: "unused-no-image-processing",
      mime: "image/png",
      width: 20,
      height: 20,
      createdAt: now(),
    };
    Object.assign(state.machines.phomemo_01, {
      calibrated: true,
      listed: true,
      ready: true,
      paused: false,
      hours: { start: 0, end: 24 },
    });
  });
  const job = await service.create(
    session.id,
    {
      assetIds: [artifact.id],
      intent: "Exact automatically matched artwork",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      crop: "contain",
      permission: "authorized",
      recommendedMachineId: "phomemo_01",
      ...extra,
    },
    artifact,
  );
  return {
    store,
    service,
    app,
    agent,
    job,
    sideEffects: () => sideEffects,
    close() {
      assert.equal(
        sideEffects,
        0,
        "approval must never call payment or devices",
      );
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
function approval(job: Job, autoAccept = false) {
  return {
    specVersion: job.specVersion,
    artifactSha256: job.artifact.sha256,
    recommendedMachineId: job.spec.recommendedMachineId ?? null,
    autoAccept,
  };
}
const endpoint = (job: Job) => `/api/jobs/${job.id}/approve-and-quote`;

test("one approval intent atomically publishes an exact bound quote without payment or dispatch", async () => {
  const f = await fixture();
  try {
    const observed: string[] = [];
    const unsubscribe = f.store.subscribe(() => {
      void f.store
        .read()
        .then(({ data }) => observed.push(data.jobs[f.job.id].productionState));
    });
    const response = await f.agent
      .post(endpoint(f.job))
      .send(approval(f.job))
      .expect(200);
    unsubscribe();
    const quoted = response.body.job as Job;
    assert.equal(quoted.productionState, "quoted");
    assert.equal(quoted.machineId, "phomemo_01");
    assert.equal(quoted.spec.recommendedMachineId, "phomemo_01");
    assert.equal(quoted.quote!.totalCents, 75);
    assert.equal(quoted.quote!.accepted, false);
    assert.equal(quoted.quote!.specHash, quoted.approvedSpecHash);
    assert.equal(quoted.paymentState, "unpaid");
    assert.equal(quoted.attemptId, undefined);
    assert.deepEqual(
      observed,
      ["quoted"],
      "no observer may see an intermediate approved job",
    );
    assert.deepEqual(
      quoted.history.slice(-2).map((item) => item.event),
      ["specification_approved", "quoted"],
    );
    const state = await f.service.read();
    assert.deepEqual(state.machines.phomemo_01.reservation, {
      jobId: f.job.id,
      expiresAt: quoted.quote!.expiresAt,
    });
    assert.equal(state.machines.phomemo_01.activeJobId, null);
    assert.deepEqual(state.operations, {});
  } finally {
    f.close();
  }
});

test("stale two-tab specification, artifact or machine binding cannot approve or quote newer content", async () => {
  const f = await fixture();
  try {
    const revised = await f.service.revise(
      f.job.id,
      { ...f.job.spec, quantity: 2 },
      { ...f.job.artifact, sha256: "b".repeat(64) },
    );
    for (const body of [
      approval(f.job),
      { ...approval(revised), artifactSha256: f.job.artifact.sha256 },
      { ...approval(revised), recommendedMachineId: "another_machine" },
    ]) {
      const before = await f.store.read();
      const response = await f.agent
        .post(endpoint(f.job))
        .send(body)
        .expect(409);
      assert.equal(response.body.error.code, "STALE_APPROVAL");
      assert.deepEqual(await f.store.read(), before);
    }
    assert.equal((await f.service.job(f.job.id)).productionState, "specified");
  } finally {
    f.close();
  }
});

test("a CAS retry rechecks the displayed binding after a newer edit wins", async () => {
  const f = await fixture();
  const original = f.store.compareAndSet.bind(f.store);
  try {
    let interpose = true;
    f.store.compareAndSet = async (version, state) => {
      if (interpose) {
        interpose = false;
        await f.service.revise(
          f.job.id,
          { ...f.job.spec, heightMm: 75 },
          { ...f.job.artifact, sha256: "b".repeat(64) },
        );
        return false;
      }
      return original(version, state);
    };
    await assert.rejects(f.service.approveAndQuote(f.job.id, approval(f.job)), {
      code: "STALE_APPROVAL",
    });
    const state = await f.service.read(),
      saved = state.jobs[f.job.id];
    assert.equal(saved.spec.heightMm, 75);
    assert.equal(saved.specVersion, 2);
    assert.equal(saved.productionState, "specified");
    assert.equal(saved.approvedSpecHash, undefined);
    assert.equal(saved.quote, undefined);
    assert.equal(state.machines.phomemo_01.reservation, undefined);
    assert(
      !saved.history.some((item) => item.event === "specification_approved"),
    );
  } finally {
    f.store.compareAndSet = original;
    f.close();
  }
});

test("an unavailable recommended device never substitutes a cheaper compatible device or partially approves", async () => {
  const f = await fixture();
  try {
    await mutate(f.store, (state) => {
      state.machines.cheaper_thermal = {
        ...structuredClone(state.machines.phomemo_01),
        id: "cheaper_thermal",
        priceCard: { consumables: 1, machine: 1, handling: 1, platform: 1 },
      };
      state.machines.phomemo_01.paused = true;
    });
    const before = await f.store.read();
    const response = await f.agent
      .post(endpoint(f.job))
      .send(approval(f.job))
      .expect(409);
    assert.equal(response.body.error.code, "RECOMMENDED_MACHINE_UNAVAILABLE");
    assert.deepEqual(await f.store.read(), before);
    assert.equal((await f.service.job(f.job.id)).productionState, "specified");
  } finally {
    f.close();
  }
});

test("lost committed response replays the same live quote and accepted mandate without history churn", async () => {
  const f = await fixture({ budgetMandate: { enabled: true, capCents: 100 } });
  const original = f.store.compareAndSet.bind(f.store);
  try {
    let lose = true;
    f.store.compareAndSet = async (version, state) => {
      const committed = await original(version, state);
      if (committed && lose) {
        lose = false;
        throw Error("Committed reply lost in fixture");
      }
      return committed;
    };
    await assert.rejects(
      f.service.approveAndQuote(f.job.id, approval(f.job, true)),
      /Committed reply lost/,
    );
    f.store.compareAndSet = original;
    const committed = await f.service.job(f.job.id);
    assert.equal(committed.quote!.accepted, true);
    const replay = await f.agent
      .post(endpoint(f.job))
      .send(approval(f.job, true))
      .expect(200);
    assert.deepEqual(replay.body.job, committed);
    assert.deepEqual((await f.service.read()).machines.phomemo_01.reservation, {
      jobId: f.job.id,
      expiresAt: committed.quote!.expiresAt,
    });
    assert.deepEqual((await f.service.read()).operations, {});
  } finally {
    f.store.compareAndSet = original;
    f.close();
  }
});

test("a live quote replay survives readiness loss while checkout still refuses payment", async () => {
  const f = await fixture();
  try {
    const quoted = await f.service.approveAndQuote(f.job.id, approval(f.job));
    await mutate(f.store, (state) => {
      state.machines.phomemo_01.ready = false;
      state.machines.phomemo_01.paused = true;
    });
    const before = await f.service.read();
    const replay = await f.agent
      .post(endpoint(f.job))
      .send(approval(f.job))
      .expect(200);
    assert.deepEqual(replay.body.job, quoted);
    assert.deepEqual(await f.service.read(), before);
    await assert.rejects(
      f.service.checkout(f.job.id, "no-payment-on-unready-machine"),
      { code: "MACHINE_NOT_READY" },
    );
    assert.deepEqual(await f.service.read(), before);
  } finally {
    f.close();
  }
});

test("an explicit expired-quote retry requotes the same approved machine and current price", async () => {
  const f = await fixture();
  try {
    const first = await f.service.approveAndQuote(f.job.id, approval(f.job));
    await mutate(f.store, (state) => {
      const job = state.jobs[f.job.id];
      job.quote!.expiresAt = new Date(Date.now() - 1000).toISOString();
      state.machines.phomemo_01.reservation!.expiresAt = job.quote!.expiresAt;
      state.machines.phomemo_01.priceCard.handling = 40;
    });
    const retry = await f.service.approveAndQuote(f.job.id, approval(f.job));
    assert.notEqual(retry.quote!.id, first.quote!.id);
    assert.equal(retry.quote!.version, first.quote!.version + 1);
    assert.equal(retry.quote!.totalCents, 85);
    assert.equal(retry.machineId, "phomemo_01");
    assert.equal(retry.approvedSpecHash, first.approvedSpecHash);
    assert.equal(
      retry.history.filter((item) => item.event === "specification_approved")
        .length,
      1,
    );
    assert.equal(retry.paymentState, "unpaid");
    assert.equal(retry.attemptId, undefined);
  } finally {
    f.close();
  }
});

test("automatic quote acceptance requires the approved explicit budget and failures are atomic", async () => {
  const f = await fixture({ budgetMandate: { enabled: true, capCents: 50 } });
  try {
    const before = await f.store.read();
    await assert.rejects(
      f.service.approveAndQuote(f.job.id, approval(f.job, true)),
      { code: "MANDATE_REQUIRED" },
    );
    assert.deepEqual(await f.store.read(), before);
    const quoted = await f.service.approveAndQuote(f.job.id, approval(f.job));
    assert.equal(quoted.quote!.accepted, false);
    assert.equal(quoted.quote!.totalCents, 75);
  } finally {
    f.close();
  }
});

test("cancelled, paid, dispatched and unclear-permission jobs cannot use combined approval", async () => {
  for (const kind of ["cancelled", "paid", "dispatched", "review"] as const) {
    const f = await fixture();
    try {
      await mutate(f.store, (state) => {
        const job = state.jobs[f.job.id];
        if (kind === "cancelled") job.productionState = "cancelled";
        if (kind === "paid") {
          job.productionState = "payment_confirmed";
          job.paymentState = "held";
        }
        if (kind === "dispatched") {
          job.productionState = "dispatched";
          job.attemptId = "immutable_attempt";
        }
        if (kind === "review") {
          job.productionState = "needs_review";
          job.spec.permission = "unclear";
        }
      });
      const before = await f.store.read();
      await f.agent.post(endpoint(f.job)).send(approval(f.job)).expect(409);
      assert.deepEqual(await f.store.read(), before);
    } finally {
      f.close();
    }
  }
});

test("the endpoint requires requester ownership and explicit well-formed machine binding", async () => {
  const f = await fixture();
  try {
    await request(f.app)
      .post(endpoint(f.job))
      .send(approval(f.job))
      .expect(401);
    const stranger = request.agent(f.app),
      owner = request.agent(f.app);
    await stranger.post("/api/session").send({ role: "requester" }).expect(200);
    await stranger.post(endpoint(f.job)).send(approval(f.job)).expect(403);
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "isolated-minimal-owner" })
      .expect(200);
    await owner.post(endpoint(f.job)).send(approval(f.job)).expect(403);
    for (const body of [
      { artifactSha256: f.job.artifact.sha256, specVersion: 1 },
      { ...approval(f.job), recommendedMachineId: null },
      { ...approval(f.job), specVersion: 1.5 },
      { ...approval(f.job), artifactSha256: "not-a-hash" },
      { ...approval(f.job), autoAccept: "yes" },
    ]) {
      const before = await f.store.read();
      await f.agent
        .post(endpoint(f.job))
        .send(body)
        .expect(
          "recommendedMachineId" in body && body.recommendedMachineId === null
            ? 409
            : 422,
        );
      assert.deepEqual(await f.store.read(), before);
    }
  } finally {
    f.close();
  }
});

test("legacy unbound saved jobs require explicit null and retain legacy matching", async () => {
  const f = await fixture({ recommendedMachineId: undefined });
  try {
    const result = await f.agent
      .post(endpoint(f.job))
      .send(approval(f.job))
      .expect(200);
    assert.equal(result.body.job.machineId, "phomemo_01");
    assert.equal(result.body.job.spec.recommendedMachineId, undefined);
    assert.equal(result.body.job.productionState, "quoted");
  } finally {
    f.close();
  }
});
