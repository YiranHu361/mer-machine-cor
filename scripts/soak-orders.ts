// 100 orders through the real orchestrator and the real fabyn-producer, with
// drawings from scripts/soak/drawings.ts and generated photos instead of Claude.
// Every outside network call is refused, so the run costs nothing. The receiving
// end is a stand-in that records exactly which file it was handed.
//
// Usage: npm run test:soak [-- OUTPUT_DIR]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, type Machine } from "../server/model.ts";
import { Service, type Config } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import type { NodeBoundary } from "../server/node-client.ts";
import { Orchestrator } from "../server/orchestration/orchestrator.ts";
import { cliRunner } from "../server/orchestration/producer.ts";
import { SUBJECTS, libraryDrafts } from "./soak/drawings.ts";

delete process.env.ANTHROPIC_API_KEY; // intent is read locally
globalThis.fetch = (async (url: unknown) => {
  throw new Error(`SOAK_NETWORK_REFUSED: ${String(url)}`);
}) as typeof fetch;

const ORDERS = 100;
const root = resolve(".");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve(process.argv[2] ?? join(".data", "soak", stamp));
const files = join(out, "files");
mkdirSync(files, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "fabyn-soak-"));
const sha = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
const uvPython = (...args: string[]) =>
  execFileSync("uv", ["run", "--project", "node", "python", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

/** The receiving end: accepts a job and records the exact file it was given. */
class ReceivingEnd implements NodeBoundary {
  handed: { machine: string; artifact: string }[] = [];
  token() {
    return {
      token: "soak-boundary",
      expires_at: Math.floor(Date.now() / 1000) + 60,
    };
  }
  async call(tool: string, input: any, machine?: Machine) {
    if (tool === "run_job") {
      this.handed.push({
        machine: input.machine_id,
        artifact: input.artifact_sha256,
      });
      return {
        status: "accepted",
        execution_status: "completed",
        completion_credible: true,
      };
    }
    if (tool === "get_status")
      return {
        machine_id: input.machine_id,
        mode: machine?.mode,
        ready: true,
        calibrated: true,
        execution_status: "completed",
        completion_credible: true,
      };
    return { calibrated: true };
  }
}

const store = new SqliteStore(join(work, "state.sqlite"), initialState());
const receiver = new ReceivingEnd();
const config: Config = {
  mode: "simulation",
  paymentMode: "mock",
  storeMode: "sqlite-development",
  assetOrigin: "http://127.0.0.1:4318/assets",
  secret: "soak-only-secret",
  quoteMs: 120_000,
  pickupMs: 86_400_000,
  ownerCode: "soak-only-owner",
  dataDir: work,
  nodeUrl: "http://127.0.0.1:8788",
  allowedModes: ["hardware"],
};
const service = new Service(store, receiver, new MockPayment(), config);
const prepares: { request: any; result: any }[] = [];
const producer = cliRunner(join(root, "node"));
const orchestrator = new Orchestrator(service, {
  producer: async (request: any) => {
    const result = await producer(request);
    if (request.operation === "prepare") prepares.push({ request, result });
    return result;
  },
  designProvider: "claude",
  draft: libraryDrafts,
});
const MACHINES = ["phomemo_01", "instax_01", "bambu_01"];
/** Ready, idle, real machines. Between orders this stands in for the owner's handling. */
const freeMachines = () =>
  mutate(store, (s) => {
    for (const id of MACHINES) {
      const m = s.machines[id];
      Object.assign(m, {
        mode: "hardware",
        calibrated: true,
        listed: true,
        ready: true,
        paused: false,
        reason: "Ready",
        mediaRemaining: 10_000,
        policyReconciliationRequired: false,
      });
      if (m.outputType === "3d") m.maxJobSeconds = 1800;
      m.activeJobId = null;
      delete m.reservation;
    }
  });

// Inputs made here: 40 generated photos and the 24-subject drawing library.
const photoDir = join(work, "photos");
uvPython("scripts/soak/photos.py", photoDir);
const photos: {
  file: string;
  kind: string;
  width: number;
  height: number;
  mime: string;
}[] = JSON.parse(readFileSync(join(photoDir, "manifest.json"), "utf8"));
const subjects = Object.keys(SUBJECTS);
const NAMES = [
  "MAYA",
  "SAM",
  "LEO 7",
  "TEAM RED",
  "HI MOM",
  "JO+AL",
  "NOVA",
  "YES!",
  "KAI 2026",
  "BEST DAD",
];
const TAGS = [
  "HELLO",
  "CAL HACKS",
  "KEYS",
  "LOVE U",
  "A+",
  "MAKE IT",
  "BIKE 9",
  "HOME",
  "GO TEAM",
  "OK?",
];
const registerPhoto = (owner: string, index: number) =>
  mutate(store, (s) => {
    const p = photos[index % photos.length];
    const path = join(photoDir, p.file);
    const id = `asset_soak_${owner}_${index % photos.length}`;
    s.assets[id] ??= {
      id,
      ownerId: owner,
      path,
      url: `/assets/${id}`,
      sha256: sha(readFileSync(path)),
      mime: p.mime,
      width: p.width,
      height: p.height,
      createdAt: new Date().toISOString(),
    };
    return { id, photo: p };
  });

type Row = {
  order: number;
  scenario: string;
  request: string;
  photo?: string;
  ok: boolean;
  stage?: string;
  reason?: string;
  items?: string[];
  payableCents?: number;
  ms: number;
};
const rows: Row[] = [];
const handed: any[] = [];
const started = Date.now();
for (let i = 0; i < ORDERS; i++) {
  const t0 = Date.now();
  const actor = {
    id: `soak_requester_${Math.floor(i / 10)}`,
    role: "requester",
  };
  const subject = subjects[i % subjects.length];
  let scenario: string;
  let body: any;
  let photo: string | undefined;
  let moreLike = false;
  let extra = false;
  if (i < 35) {
    scenario = "drawn sticker";
    body = { requestText: `I want a ${subject} sticker` };
    moreLike = i % 7 === 3;
  } else if (i < 45) {
    scenario = "drawn photo card";
    body = { requestText: `I want a ${subject} design as a photo card` };
  } else if (i < 70) {
    scenario = "photo only";
    const p = await registerPhoto(actor.id, i - 45);
    photo = p.photo.file;
    body = { requestText: "", photoAssetIds: [p.id] };
  } else if (i < 80) {
    scenario = "photo with an extra";
    const p = await registerPhoto(actor.id, i - 45);
    photo = p.photo.file;
    body = {
      requestText: i % 2 ? "make a sticker of this" : "print this photo",
      photoAssetIds: [p.id],
    };
    extra = true;
  } else if (i < 90) {
    scenario = "gift";
    const p = await registerPhoto(actor.id, i - 45);
    photo = p.photo.file;
    body = {
      experience: "gift",
      requestText: `A gift for "${NAMES[i - 80]}"`,
      photoAssetIds: [p.id],
    };
  } else {
    scenario = "keychain";
    body = { requestText: `a keychain that says "${TAGS[i - 90]}"` };
  }
  const row: Row = {
    order: i,
    scenario,
    request: body.requestText,
    photo,
    ok: false,
    ms: 0,
  };
  try {
    await freeMachines();
    const { order } = await orchestrator.createOrder(
      actor,
      body,
      `soak-create-${i}`,
    );
    await orchestrator.settle(order.id);
    let o = await orchestrator.view(actor, order.id);
    if (o.draft.stage === "awaiting_design_choice") {
      if (moreLike) {
        await orchestrator.moreLikeThis(actor, order.id, {
          expectedRevision: o.draft.revision,
          candidateSetId: o.candidates!.id,
        });
        await orchestrator.settle(order.id);
        o = await orchestrator.view(actor, order.id);
      }
      const options = o.candidates!.candidates;
      await orchestrator.chooseDesign(actor, order.id, {
        expectedRevision: o.draft.revision,
        candidateSetId: o.candidates!.id,
        candidateId: options[(i * 5) % options.length].id,
      });
      await orchestrator.settle(order.id);
      o = await orchestrator.view(actor, order.id);
    }
    if (extra && o.draft.stage === "proposed" && o.suggestions.length) {
      const s = o.suggestions[0];
      await orchestrator.selectAlternative(actor, order.id, s.id, {
        expectedPlanVersion: o.plan!.version,
        operation: s.operation,
      });
      await orchestrator.settle(order.id);
      o = await orchestrator.view(actor, order.id);
      row.scenario += ` (${s.operation}: ${s.process})`;
    }
    row.stage = o.draft.stage;
    if (o.draft.stage !== "proposed")
      throw new Error(o.draft.reason ?? o.draft.stage);
    row.items = o.plan!.items.map((x) => x.process);
    row.payableCents = o.plan!.payableCents;
    o = await orchestrator.confirm(actor, order.id, {
      offerId: o.offer!.id,
      planVersion: o.plan!.version,
      planDigest: o.plan!.digest,
      permission: true,
      consent: { payment: true, production: true },
      idempotencyKey: `soak-confirm-${i}`,
    });
    if (o.makeIntent?.status !== "submitted")
      throw new Error(`make intent ${o.makeIntent?.status}`);
    const state = await service.read();
    for (const a of o.plan!.assignments) {
      const job = state.jobs[a.child!.id];
      const asset = state.assets[job.artifact!.id];
      const bytes = readFileSync(asset.path);
      if (
        sha(bytes) !== a.artifactSha256 ||
        job.artifact!.sha256 !== a.artifactSha256
      )
        throw new Error(
          `${a.id}: the stored file differs from the approved plan`,
        );
      if (
        !receiver.handed.some(
          (h) => h.artifact === a.artifactSha256 && h.machine === a.machineId,
        )
      )
        throw new Error(
          `${a.id}: the receiving end never got the approved file`,
        );
      if (job.paymentState === "unpaid") throw new Error(`${a.id}: not funded`);
      const process = o.plan!.items.find((x) => x.id === a.itemId)!.process;
      const file = `${String(i).padStart(3, "0")}-${process}${extname(asset.path) || (process === "fdm_print" ? ".3mf" : ".png")}`;
      copyFileSync(asset.path, join(files, file));
      handed.push({
        file,
        order: i,
        process,
        machine: a.machineId,
        sha256: a.artifactSha256,
        parameters: a.parameters,
      });
    }
    row.ok = true;
  } catch (error) {
    row.reason = (error as Error).message.slice(0, 300);
  }
  row.ms = Date.now() - t0;
  rows.push(row);
  process.stdout.write(
    `${row.ok ? "." : "F"}${(i + 1) % 50 ? "" : ` ${i + 1}\n`}`,
  );
}
writeFileSync(join(files, "files.json"), JSON.stringify(handed, null, 2));

// The same preparation request must give byte-identical files.
const sample = prepares
  .filter((p) => p.result?.status === "ready" && p.result.artifact)
  .filter((_, k, all) => k % Math.max(1, Math.floor(all.length / 10)) === 0)
  .slice(0, 10);
let identical = 0;
for (const p of sample) {
  const again = await producer({
    ...p.request,
    output_dir: join(work, "again"),
  });
  if (again.artifact?.sha256 === p.result.artifact.sha256) identical++;
}

let checks: any;
try {
  checks = JSON.parse(
    uvPython("scripts/soak/check_files.py", files).trim().split("\n").pop()!,
  );
} catch (error) {
  checks = JSON.parse(readFileSync(join(files, "checks.json"), "utf8")).summary;
}
const failed = rows.filter((r) => !r.ok);
const summary = {
  orders: ORDERS,
  passed: rows.length - failed.length,
  failed: failed.length,
  minutes: Math.round((Date.now() - started) / 600) / 100,
  medianOrderMs: rows.map((r) => r.ms).sort((a, b) => a - b)[
    Math.floor(rows.length / 2)
  ],
  scenarios: Object.fromEntries(
    [...new Set(rows.map((r) => r.scenario.replace(/ \(.*\)$/, "")))].map(
      (s) => [
        s,
        `${rows.filter((r) => r.ok && r.scenario.startsWith(s)).length}/${rows.filter((r) => r.scenario.startsWith(s)).length}`,
      ],
    ),
  ),
  filesHandedOver: handed.length,
  fileChecks: checks,
  deterministic: `${identical}/${sample.length} re-prepared files byte-identical`,
  networkCalls: "refused (no Claude, no context.dev)",
  failures: failed.map(
    ({ order, scenario, request, photo, stage, reason }) => ({
      order,
      scenario,
      request,
      photo,
      stage,
      reason,
    }),
  ),
};
writeFileSync(
  join(out, "summary.json"),
  JSON.stringify({ summary, orders: rows }, null, 2),
);
console.log(`\n${JSON.stringify(summary, null, 2)}\nFiles: ${files}`);
store.close();
rmSync(work, { recursive: true, force: true });
process.exit(failed.length || checks?.failed ? 1 : 0);
