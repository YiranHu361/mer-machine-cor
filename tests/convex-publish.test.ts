import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, type Job } from "../server/model.ts";
import {
  ConvexPublisher,
  convexUrl,
  jobEvent,
  jobState,
  machineEvent,
  mirrorState,
} from "../server/convex-publish.ts";

const job = (over: Partial<Job> = {}): Job =>
  ({
    id: "job_1",
    requesterId: "requester_secret",
    orderId: "ord_1",
    machineId: "phomemo_01",
    specVersion: 1,
    spec: { outputType: "sticker" },
    artifact: { id: "a", url: "/assets/a?token=SIGNED", sha256: "x" },
    productionState: "running",
    paymentState: "held",
    fulfillmentState: "unprepared",
    pickup: { code: "PICKUP-SECRET", expiresAt: "2026-10-25T00:00:00Z" },
    history: [],
    createdAt: "2026-10-24T00:00:00Z",
    updatedAt: "2026-10-24T00:00:00Z",
    version: 1,
    executionMode: "hardware",
    ...over,
  }) as Job;

test("published jobs carry §4 states and never requester ids, pickup codes or signed links", () => {
  const data = jobEvent(job());
  assert.equal(data.state, "running");
  assert.equal(data.process, "sticker_print");
  assert.equal(data.simulated, false);
  const text = JSON.stringify(data);
  for (const secret of ["requester_secret", "PICKUP-SECRET", "SIGNED"])
    assert.ok(!text.includes(secret), secret);
  assert.equal(
    jobState(job({ productionState: "needs_review" })),
    "needs_review",
  );
  assert.equal(jobState(job({ productionState: "dispatched" })), "offered");
  assert.equal(
    jobState(
      job({ productionState: "produced", fulfillmentState: "collected" }),
    ),
    "done",
  );
});

test("a registry machine on the producer hub names the node that prints it", () => {
  const m = initialState().machines.phomemo_01;
  assert.equal(machineEvent(m).status, "paused");
  m.producerHub = { machineId: "m_sticker_01", since: "now" };
  Object.assign(m, { paused: false, ready: true, listed: true });
  assert.equal(machineEvent(m).status, "idle");
  assert.equal(machineEvent(m).linked_machine_id, "m_sticker_01");
});

test("a failed send is kept and retried in order; nothing throws into the app", async () => {
  const sent: string[][] = [];
  let fail = true;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const p = new ConvexPublisher(
      async (events) => {
        if (fail) throw new Error("offline");
        sent.push(events.map((e) => e.type));
      },
      { delayMs: 1 },
    );
    p.publish("machine.updated", { machine_id: "a" });
    p.publish("job.updated", { job_id: "b" });
    await p.flush();
    assert.deepEqual(sent, []);
    fail = false;
    await p.flush();
    assert.deepEqual(sent, [["machine.updated", "job.updated"]]);
    p.close();
  } finally {
    console.warn = warn;
  }
});

test("the mirror publishes only what changed after each committed write", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fabrary-convex-"));
  const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  const published: { type: string; data: any }[] = [];
  let flushed = () => {};
  const stop = mirrorState(
    store,
    {
      publish: (type, data) => {
        published.push({ type, data });
        flushed();
      },
      flush: async () => {},
    },
    { debounceMs: 1 },
  );
  const settled = () =>
    new Promise<void>((resolve) => {
      flushed = () => setTimeout(resolve, 20);
    });
  try {
    await settled();
    assert.deepEqual(published.map((e) => e.data.machine_id).sort(), [
      "bambu_01",
      "instax_01",
      "phomemo_01",
    ]);
    published.length = 0;
    const next = settled();
    await mutate(store, (s) => {
      s.machines.phomemo_01.reason = "Loaded new paper.";
    });
    await next;
    assert.deepEqual(
      published.map((e) => [e.type, e.data.machine_id]),
      [["machine.updated", "phomemo_01"]],
    );
  } finally {
    stop();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the deployment URL comes from CONVEX_URL or the name in the deploy key", () => {
  assert.equal(
    convexUrl({ CONVEX_URL: "http://127.0.0.1:3210" }),
    "http://127.0.0.1:3210",
  );
  assert.equal(
    convexUrl({ CONVEX_DEPLOY_KEY: "dev:happy-animal-123|eyJ2" }),
    "https://happy-animal-123.convex.cloud",
  );
  assert.equal(convexUrl({ CONVEX_DEPLOY_KEY: "eyJ2" }), undefined);
});
