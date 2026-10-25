import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { HttpNode } from "../server/node-client.ts";
import {
  initialState,
  parameters,
  type Job,
  type Machine,
} from "../server/model.ts";
const secret = "isolated-mode-signing-fixture-not-a-real-key";
const job: Job = {
  id: "job_mode_fixture",
  requesterId: "requester_fixture",
  machineId: "phomemo_01",
  attemptId: "attempt_mode_fixture",
  specVersion: 2,
  spec: {
    assetIds: ["fixture_art"],
    intent: "Authorized mode binding fixture",
    outputType: "sticker",
    widthMm: 53,
    heightMm: 50,
    quantity: 1,
    material: "thermal-paper",
    permission: "authorized",
    crop: "contain",
  },
  artifact: {
    id: "fixture_art",
    url: "/assets/fixture_art",
    sha256: "a".repeat(64),
  },
  productionState: "dispatched",
  paymentState: "held",
  fulfillmentState: "unprepared",
  history: [],
  createdAt: "2026-10-23T12:00:00.000Z",
  updatedAt: "2026-10-23T12:00:00.000Z",
  version: 1,
};
const node = new HttpNode("http://127.0.0.1:1", "isolated-api-key", secret);
function machine(mode: "simulation" | "hardware") {
  return { ...initialState().machines.phomemo_01, mode };
}
function decode(token: string) {
  const [encoded, signature] = token.split(".");
  return {
    encoded,
    signature,
    payload: JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
  };
}
function pythonVerify(
  token: string,
  scope: string,
  expected: unknown,
  configuredMode = "simulation",
) {
  const source = `import json,sys\nfrom fabyn_node.security import verify_token,require_expected_mode,NodeError\nv=json.load(sys.stdin)\ntry:\n p=verify_token(v['token'],v['secret'],scope=v['scope'],expected=v['expected'])\n require_expected_mode(p,v['configured_mode'])\n print(json.dumps({'accepted':True,'expected_mode':p.get('expected_mode')}))\nexcept NodeError as e:\n print(json.dumps({'accepted':False,'code':e.code,'status':e.status}))\n`;
  return JSON.parse(
    execFileSync(
      "uv",
      ["run", "--project", resolve("node"), "python", "-c", source],
      {
        input: JSON.stringify({
          token,
          secret,
          scope,
          expected,
          configured_mode: configuredMode,
        }),
        encoding: "utf8",
        timeout: 30000,
      },
    ),
  );
}

for (const mode of ["simulation", "hardware"] as const)
  for (const scope of ["dispatch", "calibration", "abort"])
    test(`signed ${scope} authorization binds explicit ${mode} mode and every approved field`, () => {
      const before = Math.floor(Date.now() / 1000),
        signed = node.token(job, machine(mode), scope),
        after = Math.floor(Date.now() / 1000),
        { encoded, signature, payload } = decode(signed.token);
      assert.equal(
        signature,
        createHmac("sha256", secret).update(encoded).digest("hex"),
      );
      assert.equal(payload.expected_mode, mode);
      assert.equal(payload.scope, scope);
      assert.equal(payload.machine_id, "phomemo_01");
      assert.equal(payload.job_id, job.id);
      assert.equal(payload.attempt_id, job.attemptId);
      assert.equal(payload.artifact_sha256, job.artifact.sha256);
      assert.deepEqual(payload.parameters, parameters(job));
      assert.equal(payload.expires_at, signed.expires_at);
      assert(
        signed.expires_at >= before + 300 && signed.expires_at <= after + 300,
      );
      assert.deepEqual(
        Object.keys(signed).sort(),
        ["expires_at", "token"],
        "Mode is signed inside the token, not added as an unsigned tool argument",
      );
    });

test("actual Python HMAC verification accepts the signed mode and rejects tampering or a different expected mode", () => {
  const signed = node.token(job, machine("simulation"), "dispatch"),
    { encoded, signature, payload } = decode(signed.token);
  const expected = {
    machine_id: "phomemo_01",
    job_id: job.id,
    attempt_id: job.attemptId,
    artifact_sha256: job.artifact.sha256,
    parameters: parameters(job),
    expires_at: signed.expires_at,
    expected_mode: "simulation",
  };
  assert.deepEqual(pythonVerify(signed.token, "dispatch", expected), {
    accepted: true,
    expected_mode: "simulation",
  });
  const changed = Buffer.from(
    JSON.stringify({ ...payload, expected_mode: "hardware" }),
  ).toString("base64url");
  assert.notEqual(changed, encoded);
  assert.deepEqual(
    pythonVerify(`${changed}.${signature}`, "dispatch", expected),
    { accepted: false, code: "invalid_token", status: 403 },
  );
  assert.deepEqual(
    pythonVerify(signed.token, "dispatch", {
      ...expected,
      expected_mode: "hardware",
    }),
    { accepted: false, code: "token_binding", status: 403 },
  );
  assert.deepEqual(
    pythonVerify(signed.token, "dispatch", expected, "hardware"),
    { accepted: false, code: "mode_binding", status: 403 },
  );
});

test("mode binding changes only authorization context and retains exact durable attempt/content fields", () => {
  const sim = decode(
      node.token(job, machine("simulation"), "dispatch").token,
    ).payload,
    hardware = decode(
      node.token(job, machine("hardware"), "dispatch").token,
    ).payload;
  for (const field of [
    "machine_id",
    "job_id",
    "attempt_id",
    "artifact_sha256",
    "parameters",
    "scope",
  ])
    assert.deepEqual(sim[field], hardware[field]);
  assert.equal(sim.expected_mode, "simulation");
  assert.equal(hardware.expected_mode, "hardware");
});

test("the node tool transport carries the mode-bound token without changing signed request fields", async () => {
  const seen: { path?: string; method?: string; auth?: string; body?: any } =
    {};
  const server = createServer(async (req, res) => {
    seen.path = req.url;
    seen.method = req.method;
    seen.auth = req.headers.authorization;
    let raw = "";
    for await (const chunk of req) raw += chunk;
    seen.body = JSON.parse(raw);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "accepted" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const transport = new HttpNode(
        `http://127.0.0.1:${address.port}`,
        "isolated-api-key",
        secret,
      ),
      m = machine("hardware"),
      signed = transport.token(job, m, "dispatch");
    const body = {
      machine_id: m.id,
      job_id: job.id,
      attempt_id: job.attemptId,
      artifact_sha256: job.artifact.sha256,
      parameters: parameters(job),
      artifact_url:
        "http://127.0.0.1:1/assets/fixture?expires=4102444800&sig=fixture",
      ...signed,
    };
    assert.deepEqual(await transport.call("run_job", body, m), {
      status: "accepted",
    });
    assert.equal(seen.path, "/tools/run_job");
    assert.equal(seen.method, "POST");
    assert.equal(seen.auth, "Bearer isolated-api-key");
    assert.deepEqual(seen.body, body);
    assert.equal(Object.hasOwn(seen.body, "expected_mode"), false);
    assert.equal(decode(seen.body.token).payload.expected_mode, "hardware");
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

test("malformed saved machine mode cannot mint a fresh signed authorization", () => {
  for (const mode of [undefined, null, "Hardware", {}, 1])
    assert.throws(
      () =>
        node.token(
          job,
          { ...machine("simulation"), mode } as unknown as Machine,
          "dispatch",
        ),
      { code: "INVALID_MACHINE_MODE" },
    );
});

test("before-acceptance cancellation binds its original target scope inside the signed token", () => {
  for (const mode of ["simulation", "hardware"] as const)
    for (const targetScope of ["dispatch", "calibration"] as const) {
      const signed = node.token(
        job,
        machine(mode),
        "cancel_before_acceptance",
        { targetScope },
      );
      const { encoded, signature, payload } = decode(signed.token);
      assert.equal(
        signature,
        createHmac("sha256", secret).update(encoded).digest("hex"),
      );
      assert.equal(payload.scope, "cancel_before_acceptance");
      assert.equal(payload.target_scope, targetScope);
      assert.equal(payload.expected_mode, mode);
      assert.deepEqual(payload.parameters, parameters(job));
      assert.equal(payload.artifact_sha256, job.artifact.sha256);
      assert.deepEqual(Object.keys(signed).sort(), ["expires_at", "token"]);
    }
  for (const extra of [
    undefined,
    {},
    { targetScope: "camera" },
    { targetScope: null },
  ])
    assert.throws(
      () =>
        node.token(
          job,
          machine("simulation"),
          "cancel_before_acceptance",
          extra as any,
        ),
      { code: "INVALID_CANCELLATION_SCOPE" },
    );
});
