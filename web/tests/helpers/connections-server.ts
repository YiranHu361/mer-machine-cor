// Local-only browser fixture. It connects to no real printer, AI provider or cloud store.
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../../../server/app.ts";
import { initialState } from "../../../server/model.ts";
import { SqliteStore, mutate } from "../../../server/store.ts";
import { Service } from "../../../server/service.ts";
import { MockPayment } from "../../../server/payments.ts";
import { CloudProducer } from "../../../server/cloud-producer.ts";
import { printerPairs } from "../../../server/mvp-plan.ts";

const directory = await mkdtemp(join(tmpdir(), "fabyn-browser-connections-"));
const state = initialState();
for (const pair of printerPairs())
  Object.assign(state.machines[pair.ours], {
    mode: "hardware",
    producerHub: { machineId: pair.theirs, since: new Date().toISOString() },
    calibrated: true,
    paired: true,
    configured: true,
    ready: true,
    paused: false,
    listed: true,
    reason: "Printer connected.",
  });
const store = new SqliteStore(join(directory, "fixture.sqlite"), state);
const producer = new CloudProducer(
  store,
  {
    async upload() {
      throw new Error("No uploads in connection fixture");
    },
    async download() {
      throw new Error("No downloads in connection fixture");
    },
    async url() {
      return "http://127.0.0.1:4326/unused";
    },
    async uploadUrl() {
      throw new Error("No uploads in connection fixture");
    },
  },
  "fixture-key-that-is-at-least-32-characters",
  directory,
);
const service = new Service(
  store,
  {
    async call() {
      throw new Error("No hardware in connection fixture");
    },
    token() {
      throw new Error("No dispatch in connection fixture");
    },
  },
  new MockPayment(),
  {
    mode: "hardware",
    paymentMode: "mock",
    storeMode: "test",
    secret: "fixture",
    ownerCode: "",
    dataDir: directory,
    assetOrigin: "http://127.0.0.1:4326/assets",
    publicOrigin: "http://127.0.0.1:4326",
    nodeUrl: "http://127.0.0.1:9",
    quoteMs: 120000,
    pickupMs: 86400000,
  },
);
let online = true;
const heartbeat = () =>
  mutate(store, (s) => {
    s.producer ??= { machines: {}, tasks: {} };
    for (const pair of printerPairs())
      s.producer.machines[pair.theirs] = {
        machine_id: pair.theirs,
        process: pair.threeD
          ? "fdm_print"
          : pair.theirs === "m_photo_01"
            ? "photo_print"
            : "sticker_print",
        status: "idle",
        lastSeen: Date.now(),
        checked_at: new Date().toISOString(),
      };
  });
await heartbeat();
const timer = setInterval(() => {
  if (online) void heartbeat();
}, 3000);
const wrapper = express();
wrapper.post("/__test/producer/:state", async (req, res) => {
  online = req.params.state === "online";
  if (online) await heartbeat();
  res.json({ online });
});
wrapper.use(createApp(service, resolve("web/dist"), { producer }));
const server = wrapper.listen(4326, "127.0.0.1", () =>
  console.log(
    "Connection UI fixture: http://127.0.0.1:4326/fabyn/seller#machines",
  ),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    clearInterval(timer);
    server.closeAllConnections();
    server.close(() => {
      store.close();
      void rm(directory, { recursive: true, force: true }).then(() =>
        process.exit(0),
      );
    });
  });
