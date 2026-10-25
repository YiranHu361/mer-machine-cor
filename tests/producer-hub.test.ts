import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState } from "../server/model.ts";
import { Service, type Config } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { HttpNode } from "../server/node-client.ts";
import { ConnectorRelay, RoutingNode } from "../server/connectors.ts";
import { ProducerHubNode, hubStatus } from "../server/producer-hub.ts";
import { createApp } from "../server/app.ts";
import { Orchestrator } from "../server/orchestration/orchestrator.ts";
import { cliRunner } from "../server/orchestration/producer.ts";

/** A stand-in for producer-side/hub/dev_server.py with the same endpoints. */
function fakeHub() {
  const offers: any[] = [];
  const approvals: any[] = [];
  const plateCleared: string[] = [];
  const events: { type: string; data: any }[] = [];
  const machines = [
    {
      machine_id: "m_sticker_live",
      process: "sticker_print",
      status: "idle",
      simulated: false,
    },
    {
      machine_id: "m_photo_sim",
      process: "photo_print",
      status: "idle",
      simulated: true,
    },
    {
      machine_id: "m_fdm_live",
      process: "fdm_print",
      status: "idle",
      simulated: false,
    } as { [key: string]: unknown },
  ];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const reply = (status: number, value: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (req.url === "/machines") return reply(200, machines);
      if (req.url?.startsWith("/dev/events")) return reply(200, events);
      if (req.url === "/dev/offer") {
        const offer = JSON.parse(body);
        const job = {
          ...offer,
          job_id: `job_dev_${offers.length + 1}`,
          state: "offered",
          progress: 0,
        };
        offers.push(job);
        events.push({ type: "job.updated", data: job });
        return reply(200, job);
      }
      if (req.url === "/dev/cancel") return reply(200, { ok: "sent" });
      if (req.url === "/dev/plate-cleared") {
        plateCleared.push(JSON.parse(body).machine_id);
        return reply(200, { ok: "sent" });
      }
      if (req.url === "/dev/approve") {
        const ref = JSON.parse(body);
        approvals.push(ref);
        const job = offers.find((o) => o.job_id === ref.job_id);
        events.push({ type: "job.done", data: { ...job, state: "done" } });
        return reply(200, { ...job, state: "done" });
      }
      reply(404, { detail: "not found" });
    });
  });
  const report = (job: any, change: Record<string, unknown>) =>
    events.push({ type: "job.updated", data: { ...job, ...change } });
  return { server, offers, approvals, plateCleared, events, machines, report };
}

const ready = existsSync(
  join(process.cwd(), "node", ".venv", "bin", "fabrary-producer"),
)
  ? false
  : "the node project environment is not installed";
const openscad =
  ready ||
  (spawnSync("openscad", ["--version"]).status === 0 ||
  existsSync("/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD")
    ? false
    : "OpenSCAD is not installed");

test("hub states map to our node vocabulary", () => {
  assert.deepEqual(
    hubStatus({ job_id: "j", machine_id: "m", state: "running" })
      .execution_status,
    "running",
  );
  const printed = hubStatus({
    job_id: "j",
    machine_id: "m",
    state: "done",
  });
  assert.equal(printed.execution_status, "completed");
  assert.equal(
    hubStatus({
      job_id: "j",
      machine_id: "m",
      state: "rejected",
      reason: "too_large",
    }).execution_status,
    "failed",
  );
  assert.equal(
    hubStatus({ job_id: "j", machine_id: "m", state: "lost" }).execution_status,
    "unknown",
  );
});

test(
  "a sticker order prints through the producer side's hub; the owner's check, or accepting unchecked prints, frees the printer",
  { skip: ready, timeout: 120_000 },
  async () => {
    const hub = fakeHub();
    await new Promise<void>((done) => hub.server.listen(0, "127.0.0.1", done));
    const address = hub.server.address() as { port: number };
    const dir = mkdtempSync(join(tmpdir(), "fabrary-hub-"));
    const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
    const config: Config = {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:4318/assets",
      secret: "test-secret",
      quoteMs: 120_000,
      pickupMs: 86_400_000,
      ownerCode: "test-owner-code",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:9",
      allowedModes: ["simulation"],
    };
    const node = new RoutingNode(
      new HttpNode(config.nodeUrl, "key", config.secret),
      new ConnectorRelay(),
      config.secret,
      new ProducerHubNode(`http://127.0.0.1:${address.port}`),
    );
    const service = new Service(store, node, new MockPayment(), config);
    const orchestrator = new Orchestrator(service, {
      producer: cliRunner(join(process.cwd(), "node")),
      designProvider: "fixture",
    });
    const app = createApp(service, undefined, { orchestrator });
    try {
      const owner = request.agent(app);
      await owner
        .post("/api/session")
        .send({ role: "owner", accessCode: "test-owner-code" })
        .expect(200);
      const switchTo = (body: object) =>
        owner.post("/api/owner/machines/phomemo_01/producer-hub").send(body);
      await switchTo({ producerMachineId: "m_sticker_live" }).expect(422);
      await switchTo({
        producerMachineId: "m_sticker_live",
        confirmTestPrint: true,
      }).expect(409); // hardware not allowed
      config.allowedModes = ["hardware", "simulation"];
      await switchTo({
        producerMachineId: "m_photo_sim",
        confirmTestPrint: true,
      }).expect(409); // wrong process, simulated
      hub.machines[0].status = "offline";
      await switchTo({
        producerMachineId: "m_sticker_live",
        confirmTestPrint: true,
      }).expect(409);
      hub.machines[0].status = "idle";
      const switched = await switchTo({
        producerMachineId: "m_sticker_live",
        confirmTestPrint: true,
      }).expect(200);
      assert.equal(switched.body.machine.mode, "hardware");
      assert.equal(
        switched.body.machine.producerHub.machineId,
        "m_sticker_live",
      );
      await mutate(store, (s) => {
        for (const id of ["instax_01", "bambu_01"])
          Object.assign(s.machines[id], { ready: false, paused: true });
      });
      // The availability probe keeps a hub machine ready while the hub lists it.
      await service.probeAvailability();
      assert.equal((await service.read()).machines.phomemo_01.ready, true);

      const requester = { id: "requester_hub", role: "requester" };
      const order = async (key: string) => {
        const { order } = await orchestrator.createOrder(
          requester,
          { requestText: "I want a cat sticker" },
          key,
        );
        await orchestrator.settle(order.id);
        let o = await orchestrator.view(requester, order.id);
        await orchestrator.chooseDesign(requester, order.id, {
          expectedRevision: o.draft.revision,
          candidateSetId: o.candidates!.id,
          candidateId: o.candidates!.candidates[0].id,
        });
        await orchestrator.settle(order.id);
        o = await orchestrator.view(requester, order.id);
        assert.equal(o.draft.stage, "proposed", o.draft.reason ?? "");
        return orchestrator.confirm(requester, order.id, {
          offerId: o.offer!.id,
          planVersion: o.plan!.version,
          planDigest: o.plan!.digest,
          permission: true,
          consent: { payment: true, production: true },
          idempotencyKey: `${key}-confirm`,
        });
      };
      const first = await order("hub-order-1");
      const [a] = first.plan!.assignments;
      assert.equal(a.executionMode, "hardware");
      assert.equal(
        first.makeIntent!.payment.status,
        "confirmed",
        "mock payment for real work",
      );
      const offer = hub.offers[0];
      assert.equal(offer.machine_id, "m_sticker_live");
      assert.equal(offer.process, "sticker_print");
      assert.deepEqual(
        [
          offer.params.width_mm,
          offer.params.sha256,
          offer.params.fabrary_job_id,
        ],
        [48, a.artifactSha256, a.child!.id],
      );
      // The signed link downloads exactly the approved file.
      const link = new URL(offer.asset_url);
      const download = await request(app)
        .get(link.pathname + link.search)
        .buffer(true)
        .expect(200);
      assert.equal(
        createHash("sha256").update(download.body).digest("hex"),
        a.artifactSha256,
      );

      // The machine report completes the job; handling stays separate.
      hub.report(offer, { state: "running", progress: 0.5 });
      await service.reconcile(a.child!.id);
      assert.equal(
        (await service.read()).jobs[a.child!.id].productionState,
        "running",
      );
      hub.report(offer, {
        state: "done",
        progress: 1,
      });
      await service.reconcile(a.child!.id);
      const printed = (await service.read()).jobs[a.child!.id];
      assert.equal(printed.productionState, "produced");
      assert.equal(
        printed.paymentState,
        "released",
        "machine completion releases the payment",
      );

      // Until handling clears it, a new order hears the printer is busy.
      const waiting = await orchestrator.createOrder(
        requester,
        { requestText: "I want a cat sticker" },
        "hub-order-waiting",
      );
      await orchestrator.settle(waiting.order.id);
      let w = await orchestrator.view(requester, waiting.order.id);
      await orchestrator.chooseDesign(requester, w.id, {
        expectedRevision: w.draft.revision,
        candidateSetId: w.candidates!.id,
        candidateId: w.candidates!.candidates[0].id,
      });
      await orchestrator.settle(w.id);
      w = await orchestrator.view(requester, w.id);
      assert.equal(w.draft.stage, "unavailable");
      assert.match(w.draft.reason!, /finishing another order/);

      // Handling frees the printer independently of completion.
      const approve = (body: object) =>
        owner.post(`/api/owner/jobs/${a.child!.id}/clear-print`).send(body);
      await approve({}).expect(422);
      await approve({ cleared: true }).expect(200);
      const approved = (await service.read()).jobs[a.child!.id];
      assert.equal(approved.productionState, "produced");
      assert.equal(approved.fulfillmentState, "ready_for_pickup");
      assert.ok(
        ["release_pending", "released"].includes(approved.paymentState),
      );
      const freed = (await service.read()).machines.phomemo_01;
      assert.deepEqual(
        [freed.ready, freed.paused, freed.activeJobId],
        [true, false, null],
      );

      // Self-ejecting sticker output can be handled automatically.
      config.autoPrepareHubPrints = true;
      const auto = await order("hub-order-auto");
      const autoJob = auto.plan!.assignments[0].child!.id;
      hub.report(hub.offers.at(-1), {
        state: "done",
        progress: 1,
      });
      await service.reconcile(autoJob);
      const accepted = (await service.read()).jobs[autoJob];
      assert.equal(accepted.productionState, "produced");
      assert.equal(accepted.fulfillmentState, "ready_for_pickup");
      const free = (await service.read()).machines.phomemo_01;
      assert.deepEqual(
        [free.ready, free.paused, free.activeJobId],
        [true, false, null],
      );

      // A declined job is refunded and never retried by itself; failures
      // still wait for recovery.
      const second = await order("hub-order-2");
      const declined = hub.offers.at(-1);
      hub.report(declined, {
        state: "rejected",
        reason: "out_of_media: 0 left, 1 needed",
      });
      await service.reconcile(second.plan!.assignments[0].child!.id);
      const refused = (await service.read()).jobs[
        second.plan!.assignments[0].child!.id
      ];
      assert.equal(refused.productionState, "failed");
      assert.match(
        refused.history.map((h) => h.reason).join(" "),
        /declined the job: out_of_media/,
      );
      assert.ok(["refund_pending", "refunded"].includes(refused.paymentState));
      assert.equal(
        hub.offers.length,
        3,
        "a refused job is never offered again by itself",
      );
      assert.equal((await service.read()).machines.phomemo_01.paused, true);

      // Switching back needs an idle machine and leaves it unlisted.
      await mutate(store, (s) => {
        s.machines.phomemo_01.activeJobId = null;
        delete s.machines.phomemo_01.reservation;
      });
      const back = await owner
        .delete("/api/owner/machines/phomemo_01/producer-hub")
        .expect(200);
      assert.equal(back.body.machine.producerHub, undefined);
      assert.equal(back.body.machine.listed, false);
    } finally {
      hub.server.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "a name tag goes to the A1 mini as a model to slice and waits for the owner to clear the plate",
  { skip: openscad, timeout: 120_000 },
  async () => {
    const hub = fakeHub();
    await new Promise<void>((done) => hub.server.listen(0, "127.0.0.1", done));
    const address = hub.server.address() as { port: number };
    const dir = mkdtempSync(join(tmpdir(), "fabrary-nametag-"));
    const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
    const config: Config = {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:4318/assets",
      secret: "test-secret",
      quoteMs: 120_000,
      pickupMs: 86_400_000,
      ownerCode: "test-owner-code",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:9",
      allowedModes: ["hardware"],
      autoPrepareHubPrints: true,
    };
    const service = new Service(
      store,
      new RoutingNode(
        new HttpNode(config.nodeUrl, "key", config.secret),
        new ConnectorRelay(),
        config.secret,
        new ProducerHubNode(`http://127.0.0.1:${address.port}`),
      ),
      new MockPayment(),
      config,
    );
    const orchestrator = new Orchestrator(service, {
      producer: cliRunner(join(process.cwd(), "node")),
      designProvider: "fixture",
      understand: async () => {
        throw new Error("a stated name needs no reading");
      },
    });
    const app = createApp(service, undefined, { orchestrator });
    try {
      const owner = request.agent(app);
      await owner
        .post("/api/session")
        .send({ role: "owner", accessCode: "test-owner-code" })
        .expect(200);
      await owner
        .post("/api/owner/machines/bambu_01/producer-hub")
        .send({ producerMachineId: "m_fdm_live", confirmTestPrint: true })
        .expect(200);

      const requester = { id: "requester_tag", role: "requester" };
      const { order } = await orchestrator.createOrder(
        requester,
        { requestText: 'A name tag that says "Zoë Li"' },
        "nametag-order-1",
      );
      await orchestrator.settle(order.id);
      const o = await orchestrator.view(requester, order.id);
      assert.equal(o.draft.stage, "proposed", o.draft.reason ?? "");
      assert.equal(o.intent!.provider, "local");
      const [item] = o.plan!.items;
      assert.deepEqual(
        [item.name, item.design.kind, item.design.text],
        ["A name tag", "text_tag", "Zoë Li"],
      );
      const confirmed = await orchestrator.confirm(requester, order.id, {
        offerId: o.offer!.id,
        planVersion: o.plan!.version,
        planDigest: o.plan!.digest,
        permission: true,
        consent: { payment: true, production: true },
        idempotencyKey: "nametag-order-1-confirm",
      });
      const [a] = confirmed.plan!.assignments;
      assert.equal(a.executionMode, "hardware");
      const offer = hub.offers[0];
      assert.equal(offer.machine_id, "m_fdm_live");
      assert.equal(offer.process, "fdm_print");
      assert.ok(offer.params.width_mm > 40 && offer.params.height_mm === 20);
      // The A1 mini's node receives the unsliced model (a 3MF zip) and slices it.
      const link = new URL(offer.asset_url);
      const model = await request(app)
        .get(link.pathname + link.search)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      assert.equal(model.body.subarray(0, 4).toString("latin1"), "PK\x03\x04");

      // A 3D job completes from the machine report, then waits for plate clearance.
      hub.report(offer, { state: "done", progress: 1 });
      await service.reconcile(a.child!.id);
      assert.equal(
        (await service.read()).jobs[a.child!.id].productionState,
        "produced",
      );
      assert.deepEqual(hub.plateCleared, []);
      await owner
        .post(`/api/owner/jobs/${a.child!.id}/clear-print`)
        .send({ cleared: true })
        .expect(200);
      assert.equal(
        (await service.read()).jobs[a.child!.id].fulfillmentState,
        "ready_for_pickup",
      );
      assert.deepEqual(hub.plateCleared, ["m_fdm_live"]);

      // A part left on the plate pauses the machine with the node's reason;
      // resuming after inspecting and clearing it clears the plate too.
      Object.assign(hub.machines[2], {
        status: "error",
        detail: "plate_not_cleared: the printer's last print ended FINISH",
      });
      await service.probeAvailability();
      const paused = (await service.read()).machines.bambu_01;
      assert.equal(paused.paused, true);
      assert.match(paused.reason!, /plate_not_cleared/);
      Object.assign(hub.machines[2], { status: "idle", detail: null });
      await owner
        .patch("/api/owner/machines/bambu_01")
        .send({ paused: false, inspected: true, cleared: true })
        .expect(200);
      assert.deepEqual(hub.plateCleared, ["m_fdm_live", "m_fdm_live"]);
      assert.equal((await service.read()).machines.bambu_01.ready, true);
    } finally {
      hub.server.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("a printer check asks the hub to connect once and reads its answer", async () => {
  const calls: { url: string; body: any }[] = [];
  const hub = new ProducerHubNode("http://hub.test", {
    fetch: (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      if (body.machine_id === "m_gone")
        return new Response("machine m_gone is offline", { status: 409 });
      if (body.machine_id === "m_old_hub")
        return new Response('{"detail":"Not Found"}', { status: 404 });
      if (body.machine_id === "m_never")
        return new Response('{"detail":"m_never never connected"}', {
          status: 404,
        });
      return new Response(
        JSON.stringify({
          machine_id: body.machine_id,
          ok: body.machine_id === "m_photo_01",
          detail: body.machine_id === "m_photo_01" ? "answered" : "not found",
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  });
  assert.deepEqual(await hub.check("m_photo_01"), {
    ok: true,
    detail: "answered",
  });
  assert.deepEqual(await hub.check("m_sticker_01"), {
    ok: false,
    detail: "not found",
  });
  assert.equal(calls[0].url, "http://hub.test/dev/check");
  assert.deepEqual(calls[0].body, { machine_id: "m_photo_01" });
  // The printer's program is offline or never connected: not answering.
  assert.deepEqual(await hub.check("m_gone"), {
    ok: false,
    detail: "Its printer program is not running.",
  });
  assert.equal((await hub.check("m_never")).ok, false);
  // A hub from before checks existed cannot tell, so it never blocks an order.
  assert.equal((await hub.check("m_old_hub")).ok, true);
});
