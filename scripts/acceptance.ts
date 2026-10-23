import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.env.FABRARY_ACCEPTANCE_ORIGIN ?? "http://127.0.0.1:4318";
const health = (await (await fetch(origin + "/api/health")).json()) as any;
assert.equal(
  health.mode,
  "simulation",
  "This finite software acceptance must never start real hardware",
);
assert.equal(
  health.paymentMode,
  "mock",
  "Use mock money for software acceptance",
);
assert.equal(
  health.store,
  "spacetimedb",
  "Required application persistence acceptance uses actual SpacetimeDB",
);
const config = JSON.parse(
  await readFile(".data/local-credentials.json", "utf8"),
);
async function session(role: string) {
  const r = await fetch(origin + "/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role,
      ...(role === "owner"
        ? { accessCode: process.env.FABRARY_OWNER_CODE ?? config.ownerCode }
        : {}),
    }),
  });
  assert(r.ok);
  return r.headers.get("set-cookie")!.split(";")[0];
}
const owner = await session("owner"),
  requester = await session("requester");
async function api(
  cookie: string,
  path: string,
  body?: any,
  method = body === undefined ? "GET" : "POST",
) {
  const r = await fetch(origin + "/api" + path, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await r.json()) as any;
  assert(r.ok, `${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}
async function ready(machineId: string) {
  await api(owner, `/owner/machines/${machineId}/calibrate`, {
    inspected: true,
  });
  await api(
    owner,
    `/owner/machines/${machineId}`,
    {
      listed: true,
      paused: false,
      inspected: true,
      cleared: true,
      hours: { start: 0, end: 24 },
      mediaRemaining: 100,
    },
    "PATCH",
  );
}
async function resume(machineId: string) {
  await api(
    owner,
    `/owner/machines/${machineId}`,
    { paused: false, inspected: true, cleared: true },
    "PATCH",
  );
}
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const form = new FormData();
form.append(
  "images",
  new Blob([image], { type: "image/png" }),
  "software-acceptance.png",
);
const up = await fetch(origin + "/api/uploads", {
  method: "POST",
  headers: { Cookie: requester },
  body: form,
});
assert(up.ok);
const assetId = ((await up.json()) as any).assets[0].id;
const evidence: any = {
  at: new Date().toISOString(),
  mode: "simulation",
  paymentMode: "mock",
  store: health.store,
  runs: [],
  failureCases: [],
  timingScope:
    "After shared artwork upload: POST /jobs through scripted owner preparation and resume; not upload-to-ready or physical timing.",
  ownerActionsScope:
    "Two scripted software handling calls per job, not measured owner labor.",
  physicalAcceptance:
    "BLOCKED: no devices, cameras or owner readiness configured",
};
async function order(outputType = "sticker") {
  const start = performance.now();
  const j = (
    await api(requester, "/jobs", {
      assetIds: [assetId],
      intent: "Finite software acceptance " + Date.now(),
      outputType,
      widthMm: outputType === "sticker" ? 53 : 54,
      heightMm: outputType === "sticker" ? 50 : 86,
      quantity: 1,
      material: outputType === "sticker" ? "thermal-paper" : "photo-film",
      permission: "authorized",
      crop: "contain",
    })
  ).job;
  await api(requester, `/jobs/${j.id}/approve`, {
    specVersion: j.specVersion,
    artifactSha256: j.artifact.sha256,
  });
  await api(requester, `/jobs/${j.id}/quote`, {});
  const key = "acceptance-" + j.id;
  await api(requester, `/jobs/${j.id}/checkout`, { idempotencyKey: key });
  await api(requester, `/jobs/${j.id}/checkout`, { idempotencyKey: key });
  const dispatched = (await api(requester, `/jobs/${j.id}/dispatch`, {})).job;
  assert.equal(
    (await api(requester, `/jobs/${j.id}/dispatch`, {})).job.attemptId,
    dispatched.attemptId,
  );
  // Reconcile a lost acknowledgment with the existing journal before inspection;
  // an acknowledgment loss does not mean an active worker has stopped.
  await api(owner, `/owner/jobs/${j.id}/reconcile`, {});
  return { j, start, attemptId: dispatched.attemptId };
}
async function terminal(jobId: string) {
  for (let i = 0; i < 100; i++) {
    const j = (await api(requester, `/jobs/${jobId}`)).job;
    if (
      j.productionState === "needs_review" ||
      (j.productionState === "produced" && j.paymentState === "released") ||
      (j.productionState === "failed" && j.paymentState === "refunded")
    )
      return j;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Software acceptance timed out");
}
async function handle(j: any) {
  const prepared = (
    await api(owner, `/owner/jobs/${j.id}/prepare`, {
      removed: true,
      labeled: true,
      stored: true,
      cleared: true,
    })
  ).job;
  await resume(j.machineId);
  return prepared;
}
// Preserve unrelated orders. Recover only prior runs of this exact simulation fixture.
for (const machine of (await api(owner, "/owner/dashboard")).machines) {
  if (!machine.activeJobId) continue;
  let previous = (await api(owner, "/owner/dashboard")).jobs.find(
    (j: any) => j.id === machine.activeJobId,
  );
  assert(
    previous?.spec.intent.startsWith("Finite software acceptance "),
    "An unrelated active order needs its owner; acceptance will not clear it",
  );
  previous = (await api(owner, `/owner/jobs/${previous.id}/reconcile`, {})).job;
  if (previous.productionState === "needs_review")
    previous = (
      await api(owner, `/owner/jobs/${previous.id}/review`, {
        result: "pass",
        reason:
          "Inspected terminal simulated fixture during acceptance harness recovery",
      })
    ).job;
  if (previous.productionState === "produced") {
    for (let i = 0; i < 30 && previous.paymentState !== "released"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      previous = (await api(owner, `/jobs/${previous.id}`)).job;
    }
    assert.equal(previous.paymentState, "released");
    const prepared = await handle(previous);
    await api(owner, `/owner/jobs/${prepared.id}/redeem`, {
      code: prepared.pickup.code,
    });
  } else
    throw new Error(
      "Previous fixture requires explicit operator resolution before rerun",
    );
}
for (const [outputType, machineId, count] of [
  ["sticker", "phomemo_01", 10],
  ["instax", "instax_01", 3],
] as const) {
  await ready(machineId);
  await api(owner, `/owner/simulation/${machineId}`, { outcome: "pass" });
  const pickup: any[] = [];
  for (let i = 0; i < count; i++) {
    const { j, start, attemptId } = await order(outputType);
    const done = await terminal(j.id);
    assert.equal(done.productionState, "produced");
    assert.equal(done.paymentState, "released");
    assert.equal(done.evidence.source, "simulation");
    assert.equal(done.fulfillmentState, "awaiting_owner");
    const photo = await fetch(origin + done.evidence.url, {
      headers: { Cookie: requester },
    });
    assert(photo.ok);
    const prepared = await handle(done);
    pickup.push(prepared);
    evidence.runs.push({
      outputType,
      jobId: j.id,
      attemptId,
      readyMilliseconds: Math.round(performance.now() - start),
      ownerActions: 2,
      source: "simulation",
      paymentState: prepared.paymentState,
    });
  }
  // All items remain uncollected while the machine accepts subsequent jobs.
  for (const j of pickup) {
    await api(owner, `/owner/jobs/${j.id}/redeem`, { code: j.pickup.code });
    const again = await fetch(origin + `/api/owner/jobs/${j.id}/redeem`, {
      method: "POST",
      headers: { Cookie: owner, "Content-Type": "application/json" },
      body: JSON.stringify({ code: j.pickup.code }),
    });
    assert.equal(again.status, 409);
  }
}
for (const outcome of ["fail", "review", "lost_ack"]) {
  await api(owner, "/owner/simulation/phomemo_01", { outcome });
  const { j } = await order();
  let done = await terminal(j.id);
  if (outcome === "fail") {
    assert.equal(done.productionState, "failed");
    assert.equal(done.paymentState, "refunded");
    await api(owner, `/owner/jobs/${j.id}/clear`, {
      inspected: true,
      cleared: true,
      reason: "Software fixture missing output inspected and path cleared",
    });
    await resume("phomemo_01");
  } else {
    assert.equal(done.productionState, "needs_review");
    assert.equal(done.paymentState, "held");
    const before = done.attemptId;
    await api(requester, `/jobs/${j.id}/dispatch`, {});
    assert.equal((await api(requester, `/jobs/${j.id}`)).job.attemptId, before);
    done = (
      await api(owner, `/owner/jobs/${j.id}/review`, {
        result: "pass",
        reason:
          "Explicit software operator fixture inspected the simulated result",
      })
    ).job;
    assert.equal(done.paymentState, "released");
    const prepared = await handle(done);
    await api(owner, `/owner/jobs/${j.id}/redeem`, {
      code: prepared.pickup.code,
    });
  }
  evidence.failureCases.push({
    outcome,
    jobId: j.id,
    finalProductionState: done.productionState,
    finalPaymentState: done.paymentState,
  });
}
await api(owner, "/owner/simulation/phomemo_01", { outcome: "pass" });
const sticker = evidence.runs
  .filter((r: any) => r.outputType === "sticker")
  .map((r: any) => r.readyMilliseconds)
  .sort((a: number, b: number) => a - b);
evidence.simulatedStickerMedianMilliseconds = (sticker[4] + sticker[5]) / 2;
evidence.physicalPerformanceTargets =
  "UNMEASURED; simulation timing is not a physical acceptance result";
await mkdir("docs/evidence", { recursive: true });
await writeFile(
  "docs/evidence/software-acceptance.json",
  JSON.stringify(evidence, null, 2),
);
console.log(
  JSON.stringify({
    status: "PASS",
    stickerSimulationJobs: 10,
    instaxSimulationJobs: 3,
    failureCases: 3,
    simulatedStickerMedianMilliseconds:
      evidence.simulatedStickerMedianMilliseconds,
    evidence: "docs/evidence/software-acceptance.json",
  }),
);
