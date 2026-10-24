import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
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
  return { server, offers, approvals, events, machines, report };
}

const ready = existsSync(
  join(process.cwd(), "node", ".venv", "bin", "fabrary-producer"),
)
  ? false
  : "the node project environment is not installed";

test("hub states map to our node vocabulary", () => {
  assert.deepEqual(
    hubStatus({ job_id: "j", machine_id: "m", state: "running" })
      .execution_status,
    "running",
  );
  const printed = hubStatus({
    job_id: "j",
    machine_id: "m",
    state: "verifying",
    verification: {
      pass: null,
      reason: "no camera frame; needs manual approval",
    },
  });
  assert.equal(printed.execution_status, "completed");
  assert.equal(
    printed.completion_credible,
    false,
    "an unchecked print is never credible on its own",
  );
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
  "a sticker order prints through the producer side's hub and waits for the owner's check",
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

      // Printed but unchecked: the owner reviews it here.
      hub.report(offer, { state: "running", progress: 0.5 });
      await service.reconcile(a.child!.id);
      assert.equal(
        (await service.read()).jobs[a.child!.id].productionState,
        "running",
      );
      hub.report(offer, {
        state: "verifying",
        progress: 1,
        verification: {
          pass: null,
          reason: "no camera frame; needs manual approval",
        },
      });
      await service.reconcile(a.child!.id);
      const printed = (await service.read()).jobs[a.child!.id];
      assert.equal(printed.productionState, "needs_review");
      assert.equal(
        printed.paymentState,
        "held",
        "nothing is released before the owner's check",
      );

      // Until the owner checks it, a new order hears the printer is busy.
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

      // No camera on the producer side: the owner's own check approves the
      // print, records handling and frees the printer in one step.
      const approve = (body: object) =>
        owner.post(`/api/owner/jobs/${a.child!.id}/approve-print`).send(body);
      await approve({}).expect(422);
      await approve({ checked: true }).expect(200);
      const approved = (await service.read()).jobs[a.child!.id];
      assert.equal(approved.productionState, "produced");
      assert.equal(approved.fulfillmentState, "ready_for_pickup");
      assert.equal(approved.evidence.source, "owner_inspection");
      assert.equal(approved.evidence.manual, true);
      assert.ok(["release_pending", "released"].includes(approved.paymentState));
      assert.deepEqual(hub.approvals, [
        { machine_id: "m_sticker_live", job_id: offer.job_id },
      ]);
      const freed = (await service.read()).machines.phomemo_01;
      assert.deepEqual(
        [freed.ready, freed.paused, freed.activeJobId],
        [true, false, null],
      );

      // A declined job is refunded and never retried by itself.
      const second = await order("hub-order-2");
      const declined = hub.offers[1];
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
        2,
        "a refused job is never offered again by itself",
      );

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
