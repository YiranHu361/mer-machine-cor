import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = "http://127.0.0.1:4318";
const health = (await (await fetch(origin + "/api/health")).json()) as any;
assert.equal(health.mode, "simulation");
assert.equal(health.paymentMode, "mock");
assert.equal(health.store, "spacetimedb");
const privateConfig = JSON.parse(
  await readFile(".data/local-credentials.json", "utf8"),
);
const login = await fetch(origin + "/api/session", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    role: "owner",
    accessCode: process.env.FABRARY_OWNER_CODE ?? privateConfig.ownerCode,
  }),
});
assert(login.ok);
const cookie = login.headers.get("set-cookie")!.split(";")[0];
async function api(
  path: string,
  body?: any,
  method = body === undefined ? "GET" : "POST",
) {
  const r = await fetch(origin + "/api" + path, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = (await r.json()) as any;
  assert(r.ok, JSON.stringify(value));
  return value;
}
const form = new FormData();
form.append(
  "images",
  new Blob(
    [
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    ],
    { type: "image/png" },
  ),
  "calibration-software.png",
);
const upload = await fetch(origin + "/api/uploads", {
  method: "POST",
  headers: { Cookie: cookie },
  body: form,
});
assert(upload.ok);
const assetId = ((await upload.json()) as any).assets[0].id;
const spec = {
  assetIds: [assetId],
  intent: "Explicit finite software calibration fixture",
  outputType: "sticker",
  widthMm: 53,
  heightMm: 50,
  quantity: 1,
  material: "thermal-paper",
  permission: "authorized",
  crop: "contain",
};
const body = {
  spec,
  ownerReady: true,
  idempotencyKey: "finite-calibration-" + Date.now(),
};
const path = "/owner/machines/phomemo_01";
const started = (await api(path + "/calibration/start", body)).calibration;
const repeated = (await api(path + "/calibration/start", body)).calibration;
assert.equal(started.attemptId, repeated.attemptId);
let result: any;
for (let i = 0; i < 50; i++) {
  result = await api(path + "/calibration");
  if (result.status.execution_status === "completed") break;
  await new Promise((r) => setTimeout(r, 100));
}
assert.equal(result.status.execution_status, "completed");
assert.equal(result.calibration.evidence.frame, undefined);
const frame = await fetch(origin + result.calibration.evidence.url, {
  headers: { Cookie: cookie },
});
assert(frame.ok);
const confirmed = await api(path + "/calibrate", {
  inspected: true,
  attemptId: started.attemptId,
  reason: "Inspected explicit simulation calibration output",
});
assert.equal(confirmed.machine.calibrated, true);
assert.equal(confirmed.machine.ready, false);
assert.equal(confirmed.machine.paused, true);
await api(path, { paused: false, inspected: true, cleared: true }, "PATCH");
const evidence = {
  at: new Date().toISOString(),
  status: "PASS",
  mode: "simulation",
  store: health.store,
  machineId: "phomemo_01",
  calibrationId: started.id,
  attemptId: started.attemptId,
  scope:
    "Actual owner upload, prepare, signed calibration attempt, durable duplicate, status/evidence, inspection and explicit resume",
  physicalCalibration: "NOT_RUN",
};
await writeFile(
  "docs/evidence/calibration-api.json",
  JSON.stringify(evidence, null, 2),
);
console.log(
  JSON.stringify({
    status: "PASS",
    calibrationId: started.id,
    attemptId: started.attemptId,
    physicalJobs: 0,
  }),
);
