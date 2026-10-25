import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState } from "../server/model.ts";
import { Service, type Config } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import type { NodeBoundary } from "../server/node-client.ts";
import { createApp } from "../server/app.ts";
import { Orchestrator } from "../server/orchestration/orchestrator.ts";

class Node implements NodeBoundary {
  token() {
    return { token: "t", expires_at: Math.floor(Date.now() / 1000) + 60 };
  }
  async call(tool: string, input: any) {
    return tool === "get_capabilities" ? { machine_id: input.machine_id } : { ready: true };
  }
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabyn-sessions-"));
  const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
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
  const service = new Service(store, new Node(), new MockPayment(), config);
  const orchestrator = new Orchestrator(service, { designProvider: "fixture" });
  const app = createApp(service, undefined, { orchestrator });
  return {
    app,
    store,
    orchestrator,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const cookieNames = (res: request.Response) =>
  ([] as string[]).concat(res.headers["set-cookie"] ?? []).map((c) => c.split("=")[0]);

test("the customer and the workshop sign in side by side in one browser", async () => {
  const f = fixture();
  try {
    const browser = request.agent(f.app);
    const asRequester = await browser.post("/api/session").send({ role: "requester" }).expect(200);
    // exactly one cookie, by the name the ASI:One agent forwards
    assert.deepEqual(cookieNames(asRequester), ["fabyn_session"]);
    const { body } = await browser
      .post("/api/orders")
      .set("Idempotency-Key", "sessions-order-1")
      .send({ requestText: "a cat sticker", requesterName: "Henry" })
      .expect(202);
    const id = body.order.id;
    await f.orchestrator.settle(id);

    const asOwner = await browser.post("/api/session").send({ role: "owner", accessCode: "test-owner-code" }).expect(200);
    assert.deepEqual(cookieNames(asOwner), ["fabyn_owner_session"]);
    // the customer's order is still theirs, and the workshop is open too
    await browser.get(`/api/orders/${id}`).expect(200);
    await browser.get("/api/owner/dashboard").expect(200);
    assert.equal((await browser.get("/api/session").expect(200)).body.role, "requester");
    assert.equal((await browser.get("/api/session?role=owner").expect(200)).body.role, "owner");
    // the customer's own draft previews open; so do they for the workshop
    const order = (await browser.get(`/api/orders/${id}`).expect(200)).body.order;
    await browser.get(order.candidates.candidates[0].previewUrl).expect(200);

    // signing the workshop out keeps the customer
    const out = await browser.delete("/api/session?role=owner").expect(200);
    assert.deepEqual(cookieNames(out), ["fabyn_owner_session"]);
    const refused = await browser.get("/api/owner/dashboard").expect(403);
    assert.equal(refused.body.error.code, "OWNER_REQUIRED");
    await browser.get(`/api/orders/${id}`).expect(200);
    assert.deepEqual((await browser.get("/api/session?role=owner").expect(200)).body, { role: null });

    // a plain sign-out ends both
    await browser.post("/api/session").send({ role: "owner", accessCode: "test-owner-code" }).expect(200);
    const all = await browser.delete("/api/session").expect(200);
    assert.deepEqual(cookieNames(all).sort(), ["fabyn_owner_session", "fabyn_session"]);
    assert.deepEqual((await browser.get("/api/session").expect(200)).body, { role: null });
    await browser.get("/api/owner/dashboard").expect(401);
    const s = await f.store.read();
    assert.equal(Object.keys(s.data.sessions).length, 0, "both sessions were removed");
  } finally {
    f.close();
  }
});

test("an owner session kept in the old cookie still opens the workshop, and an owner-only browser reads it as its session", async () => {
  const f = fixture();
  try {
    await mutate(f.store, (s) => {
      s.sessions.legacy_owner_token = {
        id: "team_owner",
        role: "owner",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      } as any;
    });
    const legacy = "fabyn_session=legacy_owner_token";
    await request(f.app).get("/api/owner/dashboard").set("Cookie", legacy).expect(200);
    assert.equal((await request(f.app).get("/api/session").set("Cookie", legacy)).body.role, "owner");
    assert.equal((await request(f.app).get("/api/session?role=owner").set("Cookie", legacy)).body.role, "owner");

    // only the workshop signed in: the older /owner page still sees an owner session
    const workshop = request.agent(f.app);
    await workshop.post("/api/session").send({ role: "owner", accessCode: "test-owner-code" }).expect(200);
    assert.equal((await workshop.get("/api/session").expect(200)).body.role, "owner");
    // a relief plan is the coordinator's even when a requester session sits beside it
    await workshop.post("/api/session").send({ role: "requester" }).expect(200);
    const relief = await workshop
      .post("/api/orders")
      .set("Idempotency-Key", "sessions-relief-1")
      .send({ experience: "relief", requestText: "Shelter for 100 people" })
      .expect(202);
    await f.orchestrator.settle(relief.body.order.id);
    await workshop.get(`/api/orders/${relief.body.order.id}`).expect(200);
    // and a requester alone still cannot open it
    const stranger = request.agent(f.app);
    await stranger.post("/api/session").send({ role: "requester" }).expect(200);
    await stranger.get(`/api/orders/${relief.body.order.id}`).expect(403);
  } finally {
    f.close();
  }
});

test("the requester's name goes on the order: checked, kept plain, shown to them and to the workshop", async () => {
  const f = fixture();
  try {
    const customer = request.agent(f.app);
    await customer.post("/api/session").send({ role: "requester" }).expect(200);
    const create = (key: string, requesterName: unknown) =>
      customer.post("/api/orders").set("Idempotency-Key", key).send({ requestText: "a cat sticker", requesterName });
    for (const bad of [42, { name: "x" }, "x".repeat(41), "<b>Henry</b>"]) {
      const res = await create(`name-bad-${JSON.stringify(bad).length}`, bad).expect(422);
      assert.equal(res.body.error.code, "INVALID_NAME", JSON.stringify(bad));
    }
    const named = await create("name-ok-1", "  Henry \n Chen ").expect(202);
    assert.equal(named.body.order.requesterName, "Henry Chen");
    const blank = await create("name-ok-2", "   ").expect(202);
    assert.equal(blank.body.order.requesterName, undefined);
    const none = await create("name-ok-3", undefined).expect(202);
    assert.equal(none.body.order.requesterName, undefined);
    await f.orchestrator.settle(named.body.order.id);

    // the workshop sees it on the order's items
    await mutate(f.store, (s) => {
      s.jobs.job_named = {
        id: "job_named",
        orderId: named.body.order.id,
        requesterId: s.orders![named.body.order.id].requesterId,
        machineId: "phomemo_01",
        specVersion: 1,
        spec: { outputType: "sticker" },
        artifact: { id: "a", url: "/assets/x", sha256: "x" },
        productionState: "running",
        paymentState: "confirmed",
        fulfillmentState: "unprepared",
        history: [],
        createdAt: "2026-10-25T17:50:00.000Z",
        updatedAt: "2026-10-25T17:59:00.000Z",
        version: 1,
      } as any;
    });
    const owner = request.agent(f.app);
    await owner.post("/api/session").send({ role: "owner", accessCode: "test-owner-code" }).expect(200);
    const dash = await owner.get("/api/owner/dashboard").expect(200);
    assert.equal(dash.body.jobs.find((j: any) => j.id === "job_named").requesterName, "Henry Chen");
  } finally {
    f.close();
  }
});
