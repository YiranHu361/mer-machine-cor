import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStore } from "../server/store.ts";
import { initialState } from "../server/model.ts";
import { Service, type Config } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { createApp } from "../server/app.ts";
import { HttpNode } from "../server/node-client.ts";
import { isLocalRequest, redact, type MvpDeps } from "../server/mvp-setup.ts";
import { hubArgs, nodeArgs } from "../server/mvp-plan.ts";

// Every probe and program is a stand-in: nothing here reaches a printer, the
// network or Bluetooth.
const CODE_IN_ROOT_ENV = "Zq7Hx2Lm";
const PUBLISH_SECRET = "publish-secret-not-real-123";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabyn-mvp-"));
  const root = join(dir, "repo");
  const machines = join(root, "producer-side/node/machines");
  mkdirSync(machines, { recursive: true });
  mkdirSync(join(root, "producer-side/.venv/bin"), { recursive: true });
  writeFileSync(join(root, "producer-side/.venv/bin/python"), "");
  writeFileSync(
    join(machines, "m_fdm_01.json"),
    JSON.stringify({ adapter: { host: "172.20.10.8", access_code_env: "BAMBU_ACCESS_CODE" } }),
  );
  writeFileSync(join(machines, "m_sticker_01.json"), JSON.stringify({ adapter: { ble_name: "M02", ble_address: "E070-AAAA" } }));
  writeFileSync(join(machines, "m_photo_01.json"), JSON.stringify({ adapter: { ble_name: "INSTAX-7165", ble_address: "14D0-BBBB" } }));
  writeFileSync(join(root, ".env"), `FABRARY_BAMBU_ACCESS_CODE=${CODE_IN_ROOT_ENV}\nFABYN_PUBLISH_SECRET=${PUBLISH_SECRET}\n`);
  const data = join(dir, "data");
  mkdirSync(data);

  const calls = { start: [] as { command: string; args: string[]; cwd: string }[], run: [] as { command: string; args: string[] }[], stopped: [] as number[] };
  const alive = new Set<number>();
  let hub: { machine_id: string; status: string }[] | null = null;
  let nextPid = 4000;
  const runOutput: Record<string, { code: number; output: string }> = {};
  const deps: MvpDeps = {
    root,
    dataDir: data,
    env: { PATH: "/nowhere", HOME: dir },
    start(command, args, { cwd }) {
      calls.start.push({ command, args, cwd });
      const pid = nextPid++;
      alive.add(pid);
      // the hub answers as soon as it is started
      if (args.includes("hub.dev_server")) hub = [];
      return { pid, once: () => undefined };
    },
    async run(command, args, { log }) {
      calls.run.push({ command, args });
      const key = Object.keys(runOutput).find((k) => args.join(" ").includes(k));
      const r = key ? runOutput[key] : { code: 0, output: "" };
      appendFileSync(log, r.output + "\n");
      return r;
    },
    fetch: (async (url: string) => {
      if (String(url).endsWith("/machines") && hub) return new Response(JSON.stringify(hub), { status: 200 });
      throw new Error("connection refused");
    }) as typeof fetch,
    reachable: async () => false,
    alive: (pid) => alive.has(pid),
    stop(pid) {
      calls.stopped.push(pid);
      alive.delete(pid);
    },
    addresses: () => ["10.10.77.205"],
    now: () => Date.now(),
  };
  const store = new SqliteStore(join(data, "app.sqlite"), initialState());
  const cfg: Config = {
    mode: "simulation",
    paymentMode: "mock",
    storeMode: "sqlite-development",
    assetOrigin: "http://127.0.0.1:4318/assets",
    secret: "test-secret",
    quoteMs: 120000,
    pickupMs: 10000,
    ownerCode: "test-owner-code",
    dataDir: data,
    nodeUrl: "http://127.0.0.1:1",
  };
  const service = new Service(store, new HttpNode("http://127.0.0.1:1", "test-key-not-real", "test-secret"), new MockPayment(), cfg);
  const app = createApp(service, undefined, { mvpSetup: deps });
  return {
    app,
    root,
    calls,
    runOutput,
    setHub: (list: typeof hub) => (hub = list),
    async owner() {
      const a = request.agent(app);
      await a.post("/api/session").send({ role: "owner", accessCode: "test-owner-code" }).expect(200);
      return a;
    },
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function settle(a: ReturnType<typeof request.agent>, key: string) {
  for (let i = 0; i < 40; i++) {
    const s = await a.get("/api/owner/mvp/status").expect(200);
    if (s.body.actions[key] && !s.body.actions[key].running) return s.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${key} did not finish`);
}

test("the connections status is owner-only and reads real probes, never secret values", async () => {
  const f = fixture();
  try {
    await request(f.app).get("/api/owner/mvp/status").expect(401);
    const requester = request.agent(f.app);
    await requester.post("/api/session").send({ role: "requester" }).expect(200);
    await requester.get("/api/owner/mvp/status").expect(403);
    const a = await f.owner();
    const s = await a.get("/api/owner/mvp/status").expect(200);
    assert.equal(s.body.local, true);
    assert.equal(s.body.app.realMachines, false);
    assert.equal(s.body.python.ready, true);
    assert.equal(s.body.hub.running, false);
    const a1 = s.body.machines.find((m: any) => m.theirs === "m_fdm_01");
    assert.equal(a1.ours, "bambu_01");
    assert.equal(a1.device.light, "bad");
    assert.match(a1.device.detail, /no 172\.20\.10\.x address/);
    assert.deepEqual(a1.accessCode, { present: false, fromEnvName: "FABRARY_BAMBU_ACCESS_CODE" });
    assert.equal(a1.program.light, "bad");
    const sticker = s.body.machines.find((m: any) => m.theirs === "m_sticker_01");
    assert.equal(sticker.device.light, "unknown");
    const text = JSON.stringify(s.body);
    assert.ok(!text.includes(CODE_IN_ROOT_ENV) && !text.includes(PUBLISH_SECRET));
  } finally {
    f.close();
  }
});

test("setup steps run only for a page opened on this Mac", async () => {
  const f = fixture();
  try {
    const a = await f.owner();
    const remote = await a.get("/api/owner/mvp/status").set("Host", "10.10.77.205:4317").expect(200);
    assert.equal(remote.body.local, false);
    const refused = await a.post("/api/owner/mvp/steps/start-hub").set("Host", "10.10.77.205:4317").send({}).expect(403);
    assert.equal(refused.body.error.code, "OPEN_ON_THIS_MAC");
    await a.post("/api/owner/mvp/steps/set-access-code").set("Host", "fabyn.example").send({ machine: "m_fdm_01", code: "abcd1234" }).expect(403);
    // the public site comes in through a tunnel on this Mac: loopback socket,
    // the tunnel's Host, and forwarding headers even if the Host is rewritten
    const tunnel = await a.get("/api/owner/mvp/status").set("Host", "quiet-river-1234.trycloudflare.com").set("X-Forwarded-For", "203.0.113.9").expect(200);
    assert.equal(tunnel.body.local, false);
    await a.post("/api/owner/mvp/steps/start-hub").set("Host", "quiet-river-1234.trycloudflare.com").send({}).expect(403);
    await a.post("/api/owner/mvp/steps/start-hub").set("Host", "127.0.0.1:4318").set("CF-Connecting-IP", "203.0.113.9").send({}).expect(403);
    await a.post("/api/owner/mvp/steps/copy-access-code").set("Host", "localhost:4318").set("X-Forwarded-For", "203.0.113.9").send({ machine: "m_fdm_01" }).expect(403);
    await a.post("/api/owner/mvp/steps/start-hub").set("Host", "localhost:4318").set("X-Vercel-Id", "sfo1::abc").send({}).expect(403);
    assert.equal(f.calls.start.length, 0);
    assert.equal(f.calls.run.filter((c) => !c.args.includes("-c")).length, 0);
    const req = (host: string, address: string) => ({ headers: { host }, socket: { remoteAddress: address } }) as any;
    assert.equal(isLocalRequest(req("127.0.0.1:4317", "127.0.0.1")), true);
    assert.equal(isLocalRequest(req("localhost:4318", "::ffff:127.0.0.1")), true);
    assert.equal(isLocalRequest(req("[::1]:4318", "::1")), true);
    assert.equal(isLocalRequest(req("127.0.0.1:4318", "10.10.77.9")), false);
    assert.equal(isLocalRequest(req("10.10.77.205:4317", "127.0.0.1")), false);
    assert.equal(isLocalRequest({ headers: { host: "127.0.0.1:4318", forwarded: "for=203.0.113.9" }, socket: { remoteAddress: "127.0.0.1" } } as any), false);
  } finally {
    f.close();
  }
});

test("steps are a fixed list with fixed arguments", async () => {
  const f = fixture();
  try {
    const a = await f.owner();
    await a.get("/api/owner/mvp/status").expect(200);
    await a.post("/api/owner/mvp/steps/rm-rf").send({}).expect(404);
    await a.post("/api/owner/mvp/steps/start-node").send({ machine: "../../etc/passwd" }).expect(422);
    // a printer program needs the hub first
    const noHub = await a.post("/api/owner/mvp/steps/start-node").send({ machine: "m_sticker_01" }).expect(409);
    assert.equal(noHub.body.error.code, "HUB_NOT_RUNNING");
    await a.post("/api/owner/mvp/steps/start-hub").send({}).expect(202);
    const afterHub = await settle(a, "start-hub");
    assert.equal(afterHub.actions["start-hub"].ok, true);
    assert.equal(afterHub.hub.running, true);
    assert.equal(afterHub.hub.startedHere, true);
    assert.deepEqual(f.calls.start[0].args, hubArgs("http://127.0.0.1:8000"));
    assert.equal(f.calls.start[0].cwd, join(f.root, "producer-side"));
    const again = await a.post("/api/owner/mvp/steps/start-hub").send({}).expect(409);
    assert.equal(again.body.error.code, "HUB_RUNNING");
    // the A1 mini needs its access code before its program starts
    const noCode = await a.post("/api/owner/mvp/steps/start-node").send({ machine: "m_fdm_01", plateCleared: true }).expect(409);
    assert.equal(noCode.body.error.code, "ACCESS_CODE_MISSING");
    await a.post("/api/owner/mvp/steps/start-node").send({ machine: "m_sticker_01", plateCleared: true, extra: "; rm -rf /" }).expect(202);
    assert.deepEqual(f.calls.start[1].args, nodeArgs("m_sticker_01", "http://127.0.0.1:8000"));
    await a.post("/api/owner/mvp/steps/stop-node").send({ machine: "m_sticker_01" }).expect(202);
    assert.equal(f.calls.stopped.length, 1);
    // a program this page did not start is left alone
    const notMine = await a.post("/api/owner/mvp/steps/stop-node").send({ machine: "m_photo_01" }).expect(409);
    assert.equal(notMine.body.error.code, "NOT_STARTED_HERE");
  } finally {
    f.close();
  }
});

test("the access code is written server-side and never sent back", async () => {
  const f = fixture();
  try {
    const a = await f.owner();
    await a.get("/api/owner/mvp/status").expect(200);
    await a.post("/api/owner/mvp/steps/copy-access-code").send({ machine: "m_sticker_01" }).expect(422);
    const copied = await a.post("/api/owner/mvp/steps/copy-access-code").send({ machine: "m_fdm_01" }).expect(200);
    assert.ok(!JSON.stringify(copied.body).includes(CODE_IN_ROOT_ENV));
    const producerEnv = join(f.root, "producer-side/.env");
    assert.match(readFileSync(producerEnv, "utf8"), new RegExp(`^BAMBU_ACCESS_CODE=${CODE_IN_ROOT_ENV}$`, "m"));
    await a.post("/api/owner/mvp/steps/set-access-code").send({ machine: "m_fdm_01", code: "abc 123; echo" }).expect(422);
    const set = await a.post("/api/owner/mvp/steps/set-access-code").send({ machine: "m_fdm_01", code: "NewCode42" }).expect(200);
    assert.ok(!JSON.stringify(set.body).includes("NewCode42"));
    const env = readFileSync(producerEnv, "utf8");
    assert.equal(env.match(/BAMBU_ACCESS_CODE=/g)?.length, 1);
    assert.match(env, /^BAMBU_ACCESS_CODE=NewCode42$/m);
    const s = await a.get("/api/owner/mvp/status").expect(200);
    const a1 = s.body.machines.find((m: any) => m.theirs === "m_fdm_01");
    assert.equal(a1.accessCode.present, true);
    assert.ok(!JSON.stringify(s.body).includes("NewCode42"));
    // a failed step shows its log with every secret removed
    f.runOutput["bambu status"] = { code: 2, output: `connecting with bblp:NewCode42\nerror: cannot reach printer, access_code=NewCode42 secret ${PUBLISH_SECRET}` };
    await a.post("/api/owner/mvp/steps/test-device").send({ machine: "m_fdm_01" }).expect(202);
    const failed = await settle(a, "test-device:m_fdm_01");
    const step = failed.actions["test-device:m_fdm_01"];
    assert.equal(step.ok, false);
    assert.ok(step.log.length > 0);
    const shown = JSON.stringify(failed);
    assert.ok(!shown.includes("NewCode42") && !shown.includes(PUBLISH_SECRET), shown);
  } finally {
    f.close();
  }
});

test("a Bluetooth scan marks which printers are nearby", async () => {
  const f = fixture();
  try {
    const a = await f.owner();
    await a.get("/api/owner/mvp/status").expect(200);
    f.runOutput["scan_ble"] = { code: 0, output: " -58 dBm  E070-AAAA  M02 Pro\n -80 dBm  1234-CCCC  Someone's headphones" };
    await a.post("/api/owner/mvp/steps/find-device").send({ machine: "m_sticker_01" }).expect(202);
    const s = await settle(a, "find-device:ble");
    const byId = (id: string) => s.machines.find((m: any) => m.theirs === id);
    assert.equal(byId("m_sticker_01").device.light, "ok");
    assert.match(byId("m_sticker_01").device.detail, /-58 dBm/);
    assert.equal(byId("m_photo_01").device.light, "bad");
    // with its program online, the hub's check (which prints nothing) is the test
    f.setHub([{ machine_id: "m_sticker_01", status: "idle" }]);
    const online = await a.get("/api/owner/mvp/status").expect(200);
    assert.equal(online.body.machines.find((m: any) => m.theirs === "m_sticker_01").program.light, "ok");
    const notStarted = await a.post("/api/owner/mvp/steps/test-device").send({ machine: "m_photo_01" }).expect(409);
    assert.equal(notStarted.body.error.code, "START_PROGRAM_FIRST");
  } finally {
    f.close();
  }
});

test("log lines lose colour codes and secret values", () => {
  assert.deepEqual(redact(["\x1b[31mtoken=abc123def\x1b[0m uses hunter22-secret"], ["hunter22-secret"]), ["token=••• uses •••"]);
});
