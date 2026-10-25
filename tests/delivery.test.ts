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
import {
  COURIERS,
  courierFor,
  distanceKm,
} from "../server/orchestration/delivery.ts";

class Node implements NodeBoundary {
  token() {
    return { token: "t", expires_at: Math.floor(Date.now() / 1000) + 60 };
  }
  async call(tool: string, input: any) {
    return tool === "get_capabilities" ? { machine_id: input.machine_id } : { ready: true };
  }
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabyn-delivery-"));
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
  const clock = { ms: Date.parse("2026-10-25T18:00:00.000Z") };
  const orchestrator = new Orchestrator(service, {
    designProvider: "fixture",
    clock: () => clock.ms,
  });
  const app = createApp(service, undefined, { orchestrator });
  return {
    app,
    store,
    orchestrator,
    clock,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// The Palace site is 37.8029, -122.4484 (orchestrator SITE).
const COW_HOLLOW = { lat: 37.79851, lng: -122.43604, label: "Cow Hollow", source: "gps" };
const MISSION = { lat: 37.7599, lng: -122.4148, label: "Mission", source: "gps" };
const AT_PALACE = { lat: 37.8028, lng: -122.4483, label: "Marina", source: "map" };

async function orderFor(f: ReturnType<typeof fixture>) {
  const customer = request.agent(f.app);
  await customer.post("/api/session").send({ role: "requester" }).expect(200);
  const { body } = await customer
    .post("/api/orders")
    .set("Idempotency-Key", `delivery-${Math.random()}`)
    .send({ requestText: "a cat sticker" })
    .expect(202);
  await f.orchestrator.settle(body.order.id);
  const owner = request.agent(f.app);
  await owner
    .post("/api/session")
    .send({ role: "owner", accessCode: "test-owner-code" })
    .expect(200);
  return { customer, owner, id: body.order.id as string };
}

/** One item of the order on the sticker printer, in the given state. */
async function seedJob(
  f: ReturnType<typeof fixture>,
  orderId: string,
  over: Record<string, unknown> = {},
) {
  await mutate(f.store, (s) => {
    s.jobs[`job_${orderId}`] = {
      id: `job_${orderId}`,
      orderId,
      requesterId: s.orders![orderId].requesterId,
      machineId: "phomemo_01",
      specVersion: 1,
      spec: { outputType: "sticker" },
      artifact: { id: "a", url: "/assets/x", sha256: "x" },
      productionState: "produced",
      paymentState: "confirmed",
      fulfillmentState: "ready_for_pickup",
      history: [],
      createdAt: "2026-10-25T17:50:00.000Z",
      updatedAt: "2026-10-25T17:59:00.000Z",
      version: 1,
      ...over,
    } as any;
  });
}

const minutes = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60000;

test("the person chooses delivery to their spot; bad input and spots out of reach are refused", async () => {
  const f = fixture();
  try {
    const { customer, id } = await orderFor(f);
    await request(f.app).post(`/api/orders/${id}/delivery`).send({ mode: "pickup" }).expect(401);
    const stranger = request.agent(f.app);
    await stranger.post("/api/session").send({ role: "requester" }).expect(200);
    const other = await stranger.post(`/api/orders/${id}/delivery`).send({ mode: "pickup" }).expect(403);
    assert.equal(other.body.error.code, "FORBIDDEN");

    const refused = async (body: object, code = "INVALID_DELIVERY") => {
      const res = await customer.post(`/api/orders/${id}/delivery`).send(body).expect(422);
      assert.equal(res.body.error.code, code, JSON.stringify(body));
    };
    await refused({ mode: "drone" });
    await refused({ mode: "delivery" });
    await refused({ mode: "delivery", to: { ...COW_HOLLOW, lat: "37.8" } });
    await refused({ mode: "delivery", to: { ...COW_HOLLOW, lat: 91 } });
    await refused({ mode: "delivery", to: { ...COW_HOLLOW, label: "" } });
    await refused({ mode: "delivery", to: { ...COW_HOLLOW, label: "x".repeat(61) } });
    await refused({ mode: "delivery", to: { ...COW_HOLLOW, source: "wifi" } });
    await refused({ mode: "delivery", to: COW_HOLLOW, km: -1 });
    await refused({ mode: "delivery", to: COW_HOLLOW, km: 51 });
    await refused({ mode: "delivery", to: MISSION }, "OUT_OF_REACH");
    await refused({ mode: "delivery", to: AT_PALACE }, "OUT_OF_REACH");

    const { body } = await customer
      .post(`/api/orders/${id}/delivery`)
      .send({ mode: "delivery", to: { ...COW_HOLLOW, label: "  Cow\n Hollow " }, km: 1.634 })
      .expect(200);
    assert.deepEqual(
      { ...body.order.delivery, chosenAt: undefined },
      {
        mode: "delivery",
        to: { lat: 37.7985, lng: -122.436, label: "Cow Hollow", source: "gps" },
        km: 1.63,
        chosenAt: undefined,
      },
    );
    assert.ok(Date.parse(body.order.delivery.chosenAt));
    const events = body.order.events.filter((e: any) => e.type === "delivery.chosen");
    assert.equal(events.length, 1);
    // the same choice again is a replay: no second event
    const again = await customer
      .post(`/api/orders/${id}/delivery`)
      .send({ mode: "delivery", to: COW_HOLLOW, km: 1.634 })
      .expect(200);
    assert.equal(again.body.order.events.filter((e: any) => e.type === "delivery.chosen").length, 1);
    // pickup drops the spot
    const pickup = await customer.post(`/api/orders/${id}/delivery`).send({ mode: "pickup", to: COW_HOLLOW }).expect(200);
    assert.equal(pickup.body.order.delivery.mode, "pickup");
    assert.equal(pickup.body.order.delivery.to, undefined);
    assert.equal(pickup.body.order.delivery.km, null);
  } finally {
    f.close();
  }
});

test("the owner calls one courier for a made delivery order; both sides see the same courier and times", async () => {
  const f = fixture();
  try {
    const { customer, owner, id } = await orderFor(f);
    await request(f.app).post(`/api/owner/orders/${id}/courier`).send({}).expect(401);
    await customer.post(`/api/owner/orders/${id}/courier`).send({}).expect(403);
    const notChosen = await owner.post(`/api/owner/orders/${id}/courier`).send({}).expect(409);
    assert.equal(notChosen.body.error.code, "NOT_DELIVERY");
    await customer.post(`/api/orders/${id}/delivery`).send({ mode: "delivery", to: COW_HOLLOW, km: 1.6 }).expect(200);
    await seedJob(f, id, { productionState: "running", fulfillmentState: "unprepared" });
    const early = await owner.post(`/api/owner/orders/${id}/courier`).send({}).expect(409);
    assert.equal(early.body.error.code, "NOT_MADE");
    await seedJob(f, id);

    const called = await owner.post(`/api/owner/orders/${id}/courier`).send({}).expect(200);
    const courier = called.body.delivery.courier;
    const expected = courierFor(id);
    assert.deepEqual([courier.name, courier.vehicle, courier.phone], [expected.name, expected.vehicle, expected.phone]);
    assert.equal(courier.calledAt, "2026-10-25T18:00:00.000Z");
    assert.equal(minutes(courier.calledAt, courier.pickupAt), 7);
    assert.equal(minutes(courier.pickupAt, courier.arriveAt), 5, "1.6 km is under the 5 minute floor");

    f.clock.ms += 60_000;
    const twice = await owner.post(`/api/owner/orders/${id}/courier`).send({}).expect(200);
    assert.deepEqual(twice.body.delivery.courier, courier, "calling again keeps the same courier and times");

    const mine = await customer.get(`/api/orders/${id}`).expect(200);
    assert.deepEqual(mine.body.order.delivery.courier, courier);
    assert.equal(mine.body.order.events.filter((e: any) => e.type === "courier.called").length, 1);
    const dash = await owner.get("/api/owner/dashboard").expect(200);
    assert.deepEqual(dash.body.deliveries[id].courier, courier);
    assert.deepEqual(dash.body.deliveries[id].to, mine.body.order.delivery.to);

    const locked = await customer.post(`/api/orders/${id}/delivery`).send({ mode: "pickup" }).expect(409);
    assert.equal(locked.body.error.code, "COURIER_CALLED");
    // the same choice is still a harmless replay
    await customer.post(`/api/orders/${id}/delivery`).send({ mode: "delivery", to: COW_HOLLOW, km: 1.6 }).expect(200);

    // cancelled before pickup, the person may choose again
    const cancelled = await owner.post(`/api/owner/orders/${id}/courier`).send({ cancel: true }).expect(200);
    assert.equal(cancelled.body.delivery.courier, undefined);
    await owner.post(`/api/owner/orders/${id}/courier`).send({ cancel: true }).expect(200);
    await owner.post(`/api/owner/orders/${id}/courier`).send({}).expect(200);
    f.clock.ms += 8 * 60_000;
    const late = await owner.post(`/api/owner/orders/${id}/courier`).send({ cancel: true }).expect(409);
    assert.equal(late.body.error.code, "COURIER_PICKED_UP");
  } finally {
    f.close();
  }
});

test("without a route length the courier's trip uses the straight line from the workshop", async () => {
  const f = fixture();
  try {
    const { customer, owner, id } = await orderFor(f);
    const pacific = { lat: 37.7925, lng: -122.4096, label: "Nob Hill", source: "map" };
    await customer.post(`/api/orders/${id}/delivery`).send({ mode: "delivery", to: pacific }).expect(200);
    await seedJob(f, id);
    const { body } = await owner.post(`/api/owner/orders/${id}/courier`).send({}).expect(200);
    const km = distanceKm({ lat: 37.8029, lng: -122.4484 }, { lat: 37.7925, lng: -122.4096 });
    assert.ok(km > 3 && km < 4, String(km));
    assert.equal(body.delivery.km, null);
    assert.ok(Math.abs(minutes(body.delivery.courier.pickupAt, body.delivery.courier.arriveAt) - km * 2.4) < 0.02);
    assert.ok(COURIERS.some((c) => c.name === body.delivery.courier.name));
  } finally {
    f.close();
  }
});

test("pickup orders: a code is redeemed as before, and an order with no code is handed over once", async () => {
  const f = fixture();
  try {
    const { customer, owner, id } = await orderFor(f);
    await seedJob(f, id, { pickup: { code: "abcdef123456", expiresAt: "2026-10-26T18:00:00.000Z" } });
    const withCode = await owner.post(`/api/owner/orders/${id}/handed-over`).send({}).expect(409);
    assert.equal(withCode.body.error.code, "USE_PICKUP_CODE");
    await seedJob(f, id);
    const handed = await owner.post(`/api/owner/orders/${id}/handed-over`).send({}).expect(200);
    assert.equal(handed.body.delivery.mode, "pickup");
    assert.ok(Date.parse(handed.body.delivery.handedOverAt));
    const again = await owner.post(`/api/owner/orders/${id}/handed-over`).send({}).expect(200);
    assert.deepEqual(again.body.delivery, handed.body.delivery);
    const after = await customer.post(`/api/orders/${id}/delivery`).send({ mode: "delivery", to: COW_HOLLOW }).expect(409);
    assert.equal(after.body.error.code, "ALREADY_COLLECTED");

    // a delivery order goes out with a courier, not across the table
    const second = await orderFor(f);
    await second.customer.post(`/api/orders/${second.id}/delivery`).send({ mode: "delivery", to: COW_HOLLOW }).expect(200);
    await seedJob(f, second.id);
    const notPickup = await owner.post(`/api/owner/orders/${second.id}/handed-over`).send({}).expect(409);
    assert.equal(notPickup.body.error.code, "NOT_PICKUP");
    // once an item is collected with its code, the choice is locked and no courier goes out
    await seedJob(f, second.id, { fulfillmentState: "collected" });
    const collected = await second.customer.post(`/api/orders/${second.id}/delivery`).send({ mode: "pickup" }).expect(409);
    assert.equal(collected.body.error.code, "ALREADY_COLLECTED");
    const noCourier = await owner.post(`/api/owner/orders/${second.id}/courier`).send({}).expect(409);
    assert.equal(noCourier.body.error.code, "ALREADY_COLLECTED");

    const dash = await owner.get("/api/owner/dashboard").expect(200);
    assert.equal(dash.body.deliveries[id].to, undefined, "a pickup carries no spot");
    assert.equal(dash.body.deliveries[second.id].to.label, "Cow Hollow");
  } finally {
    f.close();
  }
});

test("a follow-up message can swap the photos; the photo list is checked like a new order's", async () => {
  const f = fixture();
  try {
    const { customer, id } = await orderFor(f);
    const s = await f.store.read();
    const requesterId = s.data.orders![id].requesterId;
    await mutate(f.store, (st) => {
      st.assets.asset_mine = { id: "asset_mine", ownerId: requesterId } as any;
      st.assets.asset_theirs = { id: "asset_theirs", ownerId: "someone_else" } as any;
    });
    const revision = s.data.orders![id].draft.revision;
    const edit = (photoAssetIds: unknown) =>
      customer.patch(`/api/orders/${id}/draft`).send({ expectedRevision: revision, requestText: "a cat sticker\nfrom my photo", photoAssetIds });
    assert.equal((await edit([1]).expect(422)).body.error.code, "INVALID_PHOTOS");
    assert.equal((await edit(["asset_mine", "asset_mine"]).expect(422)).body.error.code, "INVALID_PHOTOS");
    assert.equal((await edit(["asset_theirs"]).expect(403)).body.error.code, "ASSET_ACCESS");
    const ok = await edit(["asset_mine"]).expect(200);
    assert.deepEqual(ok.body.order.draft.photoAssetIds, ["asset_mine"]);
    assert.equal(ok.body.order.draft.requestText, "a cat sticker\nfrom my photo");
    await f.orchestrator.settle(id);
  } finally {
    f.close();
  }
});
