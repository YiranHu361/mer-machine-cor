import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, type Job } from "../server/model.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { HttpNode } from "../server/node-client.ts";
import { createApp } from "../server/app.ts";
import {
  ConnectorRelay,
  RoutingNode,
  connectScript,
  connectorTokenSecret,
} from "../server/connectors.ts";

const secret = "isolated-connector-platform-secret";
async function fixture(relay = new ConnectorRelay(200, 2000)) {
  const dir = mkdtempSync(join(tmpdir(), "fabyn-connectors-"));
  const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  const service = new Service(
    store,
    new RoutingNode(
      new HttpNode("http://127.0.0.1:9", "unused-direct-key", secret),
      relay,
      secret,
    ),
    new MockPayment(),
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:4318/assets",
      secret,
      quoteMs: 120000,
      pickupMs: 10000,
      ownerCode: "isolated-connector-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:9",
    },
  );
  const app = createApp(service);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const owner = request.agent(app);
  await owner
    .post("/api/session")
    .send({ role: "owner", accessCode: "isolated-connector-owner" })
    .expect(200);
  return {
    service,
    store,
    relay,
    app,
    owner,
    base,
    close: () => server.close(),
  };
}
const post = (base: string, path: string, body: unknown, auth?: string) =>
  fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  });
async function enroll(
  f: Awaited<ReturnType<typeof fixture>>,
  mode = "simulation",
) {
  const created = await f.owner
    .post("/api/owner/setup-codes")
    .send({ model: "phomemo-m02pro", mode })
    .expect(201);
  const response = await post(f.base, "/api/connectors/enroll", {
    code: created.body.setupCode.code,
    hostLabel: "workbench-pi",
  });
  assert.equal(response.status, 201);
  const credentials = await response.json();
  return {
    created: created.body,
    credentials,
    auth: `Bearer ${credentials.connectorId}.${credentials.connectorKey}`,
  };
}
const capabilities = (mode = "simulation") => ({
  mode,
  paired: true,
  configured: true,
  adapter_version: "connector-fixture",
  media_remaining: 77,
  max_job_seconds: 100,
  blockers: [],
});

test("a setup code is shown once, works once, expires older codes and never appears in the dashboard", async () => {
  const f = await fixture();
  try {
    const first = await f.owner
      .post("/api/owner/setup-codes")
      .send({ model: "phomemo-m02pro", mode: "simulation" })
      .expect(201);
    assert.match(first.body.setupCode.code, /^FAB-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    assert.equal(
      first.body.command,
      `curl -fsSL http://127.0.0.1:4318/connect.sh | sh -s -- ${first.body.setupCode.code}`,
    );
    const second = await f.owner
      .post("/api/owner/setup-codes")
      .send({ model: "phomemo-m02pro", mode: "simulation" })
      .expect(201);
    const dashboard = await f.owner.get("/api/owner/dashboard").expect(200);
    assert.deepEqual(
      dashboard.body.setupCodes.map((code: any) => code.id),
      [second.body.setupCode.id],
    );
    assert.doesNotMatch(
      JSON.stringify(dashboard.body),
      /codeHash|keyHash|FAB-/,
    );
    const stale = await post(f.base, "/api/connectors/enroll", {
      code: first.body.setupCode.code,
    });
    assert.equal(stale.status, 403);
    const used = await post(f.base, "/api/connectors/enroll", {
      code: second.body.setupCode.code.toLowerCase().replaceAll("-", " "),
    });
    assert.equal(used.status, 201);
    const again = await post(f.base, "/api/connectors/enroll", {
      code: second.body.setupCode.code,
    });
    assert.equal(again.status, 403);
  } finally {
    f.close();
  }
});

test("setup codes resist guessing and only owners can create them", async () => {
  const f = await fixture();
  try {
    await request(f.app)
      .post("/api/owner/setup-codes")
      .send({ model: "phomemo-m02pro", mode: "simulation" })
      .expect(401);
    for (let attempt = 0; attempt < 10; attempt++)
      assert.equal(
        (
          await post(f.base, "/api/connectors/enroll", {
            code: "FAB-0000-0000",
          })
        ).status,
        403,
      );
    const created = await f.owner
      .post("/api/owner/setup-codes")
      .send({ model: "phomemo-m02pro", mode: "simulation" })
      .expect(201);
    const blocked = await post(f.base, "/api/connectors/enroll", {
      code: created.body.setupCode.code,
    });
    assert.equal(blocked.status, 429);
  } finally {
    f.close();
  }
});

test("the relay carries a node call to a dialing-out connector and back", async () => {
  const f = await fixture();
  try {
    const { credentials, auth } = await enroll(f);
    assert.equal(
      credentials.tokenSecret,
      connectorTokenSecret(secret, credentials.connectorId),
    );
    assert.notEqual(credentials.tokenSecret, secret);
    const machine = {
      ...(await f.service.read()).machines.phomemo_01,
      connectorId: credentials.connectorId,
    };
    const poll = post(f.base, "/api/connectors/poll", {}, auth);
    await new Promise((done) => setTimeout(done, 20));
    const call = f.service.node.call(
      "get_capabilities",
      { machine_id: "phomemo_01" },
      machine,
    );
    const polled = await (await poll).json();
    assert.equal(polled.requests.length, 1);
    assert.deepEqual(
      { ...polled.requests[0], id: undefined },
      {
        id: undefined,
        method: "POST",
        path: "/tools/get_capabilities",
        body: { machine_id: "phomemo_01" },
      },
    );
    const reply = await post(
      f.base,
      "/api/connectors/reply",
      { id: polled.requests[0].id, status: 200, json: capabilities() },
      auth,
    );
    assert.deepEqual(await reply.json(), { accepted: true });
    assert.deepEqual(await call, capabilities());
    // A reply cannot be replayed or sent by another connector.
    const replay = await post(
      f.base,
      "/api/connectors/reply",
      { id: polled.requests[0].id, status: 200, json: {} },
      auth,
    );
    assert.deepEqual(await replay.json(), { accepted: false });
  } finally {
    f.close();
  }
});

test("relay failures surface as errors and are never delivered twice", async () => {
  const relay = new ConnectorRelay(100, 300);
  await assert.rejects(
    relay.request("connector_offline", { method: "POST", path: "/tools/x" }),
    /offline/,
  );
  // Seen but never collected: the request is withdrawn, not left for later.
  await relay.poll("connector_quiet", () => false);
  await assert.rejects(
    relay.request("connector_quiet", { method: "POST", path: "/tools/x" }, 50),
    /did not collect/,
  );
  assert.deepEqual(await relay.poll("connector_quiet", () => false), []);
  // Collected but unanswered: an uncertain outcome for the owner to reconcile.
  const pending = relay.request(
    "connector_quiet",
    { method: "POST", path: "/tools/run_job" },
    80,
  );
  assert.equal((await relay.poll("connector_quiet", () => false)).length, 1);
  await assert.rejects(pending, /did not answer/);
  assert.deepEqual(await relay.poll("connector_quiet", () => false), []);
});

test("connector machines get tokens signed with their own secret", async () => {
  const f = await fixture();
  try {
    const machine = {
      ...(await f.service.read()).machines.phomemo_01,
      connectorId: "connector_00000000-0000-4000-8000-000000000000",
    };
    const job = {
      id: "job_1",
      attemptId: "attempt_1",
      artifact: { sha256: "a".repeat(64) },
      spec: {
        outputType: "sticker",
        widthMm: 53,
        heightMm: 50,
        quantity: 1,
        material: "thermal-paper",
        crop: "contain",
      },
      specVersion: 1,
    } as unknown as Job;
    const { token } = f.service.node.token(job, machine, "dispatch");
    const [raw, signature] = token.split(".");
    const connectorSecret = connectorTokenSecret(secret, machine.connectorId);
    assert.equal(
      signature,
      createHmac("sha256", connectorSecret).update(raw).digest("hex"),
    );
    assert.notEqual(
      signature,
      createHmac("sha256", secret).update(raw).digest("hex"),
    );
  } finally {
    f.close();
  }
});

test("allowances, readiness and registration flow through the checklist", async () => {
  const f = await fixture();
  try {
    const { credentials, auth } = await enroll(f);
    const checks = [
      { id: "system", label: "Check this computer", status: "done" },
      {
        id: "search",
        label: "Find your M02 Pro",
        status: "waiting",
        consent: "Allow a search (simulated)",
      },
    ];
    await post(
      f.base,
      "/api/connectors/report",
      { checks, ready: false },
      auth,
    );
    await f.owner
      .post(`/api/owner/connectors/${credentials.connectorId}/consent`)
      .send({ check: "system" })
      .expect(409);
    const poll = post(f.base, "/api/connectors/poll", {}, auth);
    await new Promise((done) => setTimeout(done, 20));
    await f.owner
      .post(`/api/owner/connectors/${credentials.connectorId}/consent`)
      .send({ check: "search" })
      .expect(200);
    const woke = await (await poll).json();
    assert.ok(woke.consents.search);
    // Ready triggers registration over the relay, answered by this "connector".
    const answer = (async () => {
      const polled = await (
        await post(f.base, "/api/connectors/poll", {}, auth)
      ).json();
      for (const relayed of polled.requests)
        await post(
          f.base,
          "/api/connectors/reply",
          { id: relayed.id, status: 200, json: capabilities() },
          auth,
        );
    })();
    await post(
      f.base,
      "/api/connectors/report",
      {
        checks: checks.map((c) => ({
          ...c,
          status: "done",
          consent: undefined,
        })),
        ready: true,
      },
      auth,
    );
    await answer;
    let view: any;
    for (let i = 0; i < 50; i++) {
      view = (await f.owner.get("/api/owner/dashboard").expect(200)).body
        .connectors[0];
      if (view.registeredAt) break;
      await new Promise((done) => setTimeout(done, 20));
    }
    assert.equal(view.online, true);
    assert.deepEqual(
      view.checks.map((c: any) => [c.id, c.status]),
      [
        ["connector", "done"],
        ["system", "done"],
        ["search", "done"],
        ["register", "done"],
      ],
    );
    const machine = (await f.service.read()).machines.phomemo_01;
    assert.equal(machine.connectorId, credentials.connectorId);
    assert.equal(machine.nodeUrl, undefined);
    assert.equal(machine.mediaRemaining, 77);
    assert.deepEqual(
      [machine.calibrated, machine.listed, machine.paused, machine.ready],
      [false, false, true, false],
    );
    const publicView = await request(f.app).get("/api/machines");
    assert.doesNotMatch(JSON.stringify(publicView.body), /connector_/);
  } finally {
    f.close();
  }
});

test("registration waits for an idle machine and removal unbinds it", async () => {
  const f = await fixture();
  try {
    const { credentials, auth } = await enroll(f);
    await mutate(f.store, (s) => {
      s.machines.phomemo_01.activeJobId = "job_busy";
    });
    await post(
      f.base,
      "/api/connectors/report",
      {
        checks: [{ id: "config", label: "Save", status: "done" }],
        ready: true,
      },
      auth,
    );
    let view: any;
    for (let i = 0; i < 50; i++) {
      view = (await f.owner.get("/api/owner/dashboard")).body.connectors[0];
      if (view.checks.at(-1).status === "failed") break;
      await new Promise((done) => setTimeout(done, 20));
    }
    assert.match(view.checks.at(-1).detail, /Finish the open order/);
    await mutate(f.store, (s) => {
      s.machines.phomemo_01.activeJobId = null;
      s.machines.phomemo_01.connectorId = credentials.connectorId;
    });
    await f.owner
      .post(`/api/owner/connectors/${credentials.connectorId}/revoke`)
      .expect(200);
    const machine = (await f.service.read()).machines.phomemo_01;
    assert.equal(machine.connectorId, undefined);
    assert.equal(machine.paused, true);
    assert.equal(
      (await post(f.base, "/api/connectors/poll", {}, auth)).status,
      401,
    );
    assert.deepEqual(
      (await f.owner.get("/api/owner/dashboard")).body.connectors,
      [],
    );
  } finally {
    f.close();
  }
});

test("the setup script embeds only a validated workshop address", async () => {
  const f = await fixture();
  try {
    const ok = await request(f.app)
      .get("/connect.sh")
      .set("Host", "192.168.1.20:4318")
      .expect(200);
    assert.match(ok.text, /PLATFORM='http:\/\/192\.168\.1\.20:4318'/);
    await request(f.app)
      .get("/connect.sh")
      .set("Host", "evil.example;rm -rf ~")
      .expect(400);
    assert.doesNotMatch(connectScript("http://a'b"), /a'b/);
  } finally {
    f.close();
  }
});
