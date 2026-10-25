import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, type Machine } from "../server/model.ts";
import { Service, type Config } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import type { NodeBoundary } from "../server/node-client.ts";
import { createApp } from "../server/app.ts";
import { Orchestrator } from "../server/orchestration/orchestrator.ts";

/** A node that answers capability requests, or stays silent for one machine. */
class Node implements NodeBoundary {
  silent = new Set<string>();
  token() {
    return { token: "t", expires_at: Math.floor(Date.now() / 1000) + 60 };
  }
  async call(tool: string, input: any) {
    if (tool === "get_capabilities") {
      if (this.silent.has(input.machine_id))
        throw new Error("The node did not answer.");
      return { machine_id: input.machine_id };
    }
    return { ready: true };
  }
}

function fixture(
  checkPrinter?: (m: Machine) => Promise<{ ok: boolean; detail: string }>,
) {
  const dir = mkdtempSync(join(tmpdir(), "fabyn-live-"));
  const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  const node = new Node();
  const config: Config = {
    mode: "simulation",
    paymentMode: "mock",
    storeMode: "sqlite-development",
    assetOrigin: "http://127.0.0.1:4318/assets",
    secret: "test-secret",
    quoteMs: 120000,
    pickupMs: 86400000,
    ownerCode: "test-owner-code",
    dataDir: dir,
    nodeUrl: "http://127.0.0.1:8788",
    allowedModes: ["simulation"],
  };
  const service = new Service(store, node, new MockPayment(), config);
  const orchestrator = new Orchestrator(service, {
    designProvider: "fixture",
    checkPrinter,
  });
  const app = createApp(service, undefined, { orchestrator });
  return {
    app,
    store,
    node,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const job = (over: Record<string, unknown>) =>
  ({
    requesterId: "requester_secret_id",
    machineId: "bambu_01",
    specVersion: 1,
    spec: { outputType: "3d" },
    artifact: { id: "a", url: "/assets/private-link?sig=abc", sha256: "x" },
    paymentState: "confirmed",
    fulfillmentState: "unprepared",
    history: [{ at: "2026-10-24T20:00:00.000Z", event: "dispatched", reason: "" }],
    createdAt: "2026-10-24T19:59:00.000Z",
    updatedAt: "2026-10-24T20:00:00.000Z",
    version: 1,
    pickup: { code: "abcdef123456", expiresAt: "2026-10-25T20:00:00.000Z" },
    ...over,
  }) as any;

const order = (id: string, source: string | undefined, jobId: string, name: string) =>
  ({
    id,
    requesterId: "requester_secret_id",
    creationKey: `key-${id}`,
    experience: "best_single",
    ...(source ? { source } : {}),
    createdAt: "2026-10-24T19:58:00.000Z",
    updatedAt: "2026-10-24T19:58:00.000Z",
    version: 1,
    draft: { revision: 1, requestText: name, photoAssetIds: [], stage: "proposed" },
    plan: {
      items: [{ id: "it_1", process: "fdm_print", name }],
      assignments: [{ id: "as_1", itemId: "it_1", machineId: "bambu_01", childJobId: jobId }],
    },
    planHistory: [],
    suggestions: [],
    status: "in_progress",
    events: [],
    nextSeq: 1,
  }) as any;

async function seedQueue(store: SqliteStore) {
  await mutate(store, (s) => {
    s.jobs.job_now = job({ id: "job_now", orderId: "ord_a", productionState: "running" });
    s.jobs.job_next = job({
      id: "job_next",
      orderId: "ord_b",
      productionState: "payment_confirmed",
      createdAt: "2026-10-24T20:01:00.000Z",
    });
    s.jobs.job_done = job({ id: "job_done", productionState: "produced" });
    s.orders = {
      ord_a: order("ord_a", "asi1", "job_now", "Henry keychain"),
      ord_b: order("ord_b", undefined, "job_next", "Lucas keychain"),
    };
    Object.assign(s.machines.bambu_01, { activeJobId: "job_now", listed: true, ready: true, paused: false });
  });
}

test("the public machine map shows what each machine makes, its owner and its queue, and nothing private", async () => {
  const f = fixture();
  try {
    await seedQueue(f.store);
    const { body } = await request(f.app).get("/api/machines/live").expect(200);
    const a1 = body.machines.find((m: any) => m.id === "bambu_01");
    assert.equal(a1.model, "Bambu Lab A1 mini");
    assert.equal(a1.process, "fdm_print");
    assert.equal(a1.ownerName, "Lucas");
    assert.equal(a1.status, "printing");
    assert.deepEqual(a1.location, {
      lat: 37.8029,
      lng: -122.4484,
      label: "Palace of Fine Arts, San Francisco",
    });
    assert.deepEqual(a1.current, {
      title: "Henry keychain",
      process: "fdm_print",
      progress: null,
      startedAt: "2026-10-24T20:00:00.000Z",
    });
    assert.deepEqual(a1.queue, [
      { title: "Lucas keychain", process: "fdm_print", source: "web" },
    ]);
    const text = JSON.stringify(body);
    for (const secret of ["requester_secret_id", "abcdef123456", "sig=abc", "ownerId"])
      assert.ok(!text.includes(secret), `leaked ${secret}`);
  } finally {
    f.close();
  }
});

test("orders record where they came in: the web app by default, ASI:One when the agent says so", async () => {
  const f = fixture();
  try {
    const web = request.agent(f.app);
    await web.post("/api/session").send({ role: "requester" }).expect(200);
    const a = await web
      .post("/api/orders")
      .set("Idempotency-Key", "source-web-0001")
      .send({ requestText: "a cat sticker" })
      .expect(202);
    assert.equal(a.body.order.source, "web");
    const b = await web
      .post("/api/orders")
      .set("Idempotency-Key", "source-asi-0001")
      .send({ requestText: "a cat sticker", source: "asi1" })
      .expect(202);
    assert.equal(b.body.order.source, "asi1");
    // Anything else is not a source this app knows: it counts as the web app.
    const c = await web
      .post("/api/orders")
      .set("Idempotency-Key", "source-odd-0001")
      .send({ requestText: "a cat sticker", source: "somewhere" })
      .expect(202);
    assert.equal(c.body.order.source, "web");

    await seedQueue(f.store);
    const owner = request.agent(f.app);
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "test-owner-code" })
      .expect(200);
    const { body } = await owner.get("/api/owner/dashboard").expect(200);
    const source = (id: string) => body.jobs.find((j: any) => j.id === id).source;
    assert.equal(source("job_now"), "asi1");
    assert.equal(source("job_next"), "web", "an order saved before sources existed");
    assert.equal(source("job_done"), "web", "a job with no order");
  } finally {
    f.close();
  }
});

test("the owner's printer check asks the machine now and returns its answer", async () => {
  const f = fixture(async (m) =>
    m.id === "phomemo_01"
      ? { ok: false, detail: "INSTAX-1 not found; is it on?" }
      : { ok: true, detail: "answered" },
  );
  try {
    await mutate(f.store, (s) => {
      s.machines.phomemo_01.producerHub = { machineId: "m_sticker_01", since: "2026-10-24T00:00:00.000Z" };
    });
    const owner = request.agent(f.app);
    await request(f.app).post("/api/owner/machines/bambu_01/check").expect(401);
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "test-owner-code" })
      .expect(200);
    const local = await owner.post("/api/owner/machines/bambu_01/check").expect(200);
    assert.equal(local.body.ok, true);
    assert.ok(Date.parse(local.body.checkedAt));
    f.node.silent.add("instax_01");
    const silent = await owner.post("/api/owner/machines/instax_01/check").expect(200);
    assert.deepEqual([silent.body.ok, silent.body.detail], [false, "The node did not answer."]);
    const hub = await owner.post("/api/owner/machines/phomemo_01/check").expect(200);
    assert.deepEqual([hub.body.ok, hub.body.detail], [false, "INSTAX-1 not found; is it on?"]);
    await owner.post("/api/owner/machines/nope/check").expect(404);
  } finally {
    f.close();
  }
});
