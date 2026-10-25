// One order end to end, from a request to the producer side's hub: our real
// orchestrator and producer make the file, one confirmation (mock payment)
// dispatches it, and a bridge offers it to a producer-side node, which may be
// a real printer. Drafts come from scripts/soak/drawings.ts, so no API is called.
//
// Usage: npm run print:one -- [--hub URL] [--machine m_sticker_live] [--pick N] "I want a cat sticker"
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState } from "../server/model.ts";
import { Service, type Config } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import type { NodeBoundary } from "../server/node-client.ts";
import { Orchestrator } from "../server/orchestration/orchestrator.ts";
import { cliRunner } from "../server/orchestration/producer.ts";
import { libraryDrafts } from "./soak/drawings.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    hub: { type: "string", default: "http://127.0.0.1:8000" },
    machine: { type: "string", default: "m_sticker_live" },
    pick: { type: "string", default: "0" },
  },
});
const requestText = positionals.join(" ") || "I want a cat sticker";
const hub = values.hub!.replace(/\/$/, "");
delete process.env.ANTHROPIC_API_KEY; // intent is read locally
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  if (!String(url).startsWith(hub))
    throw new Error(`NETWORK_REFUSED: ${String(url)}`);
  return realFetch(url as string, init);
}) as typeof fetch;
const hubCall = async (path: string, body?: unknown) => {
  const response = await fetch(`${hub}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      `${path}: HTTP ${response.status} ${await response.text()}`,
    );
  return response.json();
};

/** Our node boundary, speaking to the producer side's hub instead of our own node. */
class ProducerHub implements NodeBoundary {
  offered: { ours: string; theirs: string }[] = [];
  constructor(private readonly fileFor: (sha: string) => Promise<string>) {}
  token() {
    return { token: "bridge", expires_at: Math.floor(Date.now() / 1000) + 60 };
  }
  async call(tool: string, input: any) {
    if (tool === "run_job") {
      const p = input.parameters;
      const job = await hubCall("/dev/offer", {
        machine_id: values.machine,
        process: "sticker_print",
        quantity: p.quantity,
        asset_url: pathToFileURL(await this.fileFor(input.artifact_sha256))
          .href,
        params: { width_mm: p.widthMm, height_mm: p.heightMm },
      });
      this.offered.push({ ours: input.job_id, theirs: job.job_id });
      return {
        status: "accepted",
        execution_status: "running",
        completion_credible: false,
      };
    }
    if (tool === "get_status")
      return { execution_status: "running", completion_credible: false };
    return { calibrated: true };
  }
}

const work = mkdtempSync(join(tmpdir(), "fabyn-print-one-"));
const store = new SqliteStore(join(work, "state.sqlite"), initialState());
const bridge = new ProducerHub(async (sha) => {
  const asset = Object.values((await store.read()).data.assets).find(
    (a) => a.sha256 === sha,
  );
  if (!asset) throw new Error("approved file not found");
  return asset.path;
});
const config: Config = {
  mode: "simulation",
  paymentMode: "mock",
  storeMode: "sqlite-development",
  assetOrigin: "http://127.0.0.1:4318/assets",
  secret: "print-one-secret",
  quoteMs: 120_000,
  pickupMs: 86_400_000,
  ownerCode: "print-one-owner",
  dataDir: work,
  nodeUrl: hub,
  allowedModes: ["hardware"],
};
const service = new Service(store, bridge, new MockPayment(), config);
const orchestrator = new Orchestrator(service, {
  producer: cliRunner(resolve("node")),
  designProvider: "claude",
  draft: libraryDrafts,
});
await mutate(store, (s) => {
  Object.assign(s.machines.phomemo_01, {
    mode: "hardware",
    calibrated: true,
    listed: true,
    ready: true,
    paused: false,
    reason: "Ready",
  });
  for (const id of ["instax_01", "bambu_01"])
    Object.assign(s.machines[id], { ready: false, paused: true });
});

const actor = { id: "print_one_requester", role: "requester" };
const step = (text: string) => console.log(`• ${text}`);
const machines = (await hubCall("/machines")) as {
  machine_id: string;
  status: string;
}[];
const target = machines.find((m) => m.machine_id === values.machine);
if (!target) throw new Error(`${values.machine} is not connected to ${hub}`);
step(`Producer side: ${values.machine} is online at ${hub} (${target.status})`);

const { order } = await orchestrator.createOrder(
  actor,
  { requestText },
  `print-one-${Date.now()}`,
);
await orchestrator.settle(order.id);
let o = await orchestrator.view(actor, order.id);
step(
  `Request "${requestText}": ${o.candidates?.candidates.length ?? 0} drafts`,
);
if (o.draft.stage === "awaiting_design_choice") {
  const choice =
    o.candidates!.candidates[
      Number(values.pick) % o.candidates!.candidates.length
    ];
  await orchestrator.chooseDesign(actor, order.id, {
    expectedRevision: o.draft.revision,
    candidateSetId: o.candidates!.id,
    candidateId: choice.id,
  });
  await orchestrator.settle(order.id);
  o = await orchestrator.view(actor, order.id);
  step(`Chose "${choice.title}"`);
}
if (o.draft.stage !== "proposed")
  throw new Error(`Not proposed: ${o.draft.reason ?? o.draft.stage}`);
const a = o.plan!.assignments[0];
const p = a.parameters as any;
step(
  `Prepared: ${p.width_mm} x ${p.height_mm} mm, file ${a.artifactSha256!.slice(0, 12)}, total ${o.plan!.payableCents} cents (mock)`,
);
o = await orchestrator.confirm(actor, order.id, {
  offerId: o.offer!.id,
  planVersion: o.plan!.version,
  planDigest: o.plan!.digest,
  permission: true,
  consent: { payment: true, production: true },
  idempotencyKey: `print-one-confirm-${order.id}`,
});
step(
  `Confirmed: payment ${o.makeIntent!.payment.status}, ${o.makeIntent!.status}`,
);
const handed = bridge.offered.at(-1);
if (!handed) throw new Error("Nothing was handed to the producer side.");
step(`Handed to the producer side as ${handed.theirs}`);

let seen = 0;
const deadline = Date.now() + 120_000;
let final: any = null;
while (Date.now() < deadline && !final) {
  const events = (await hubCall("/dev/events?limit=500")) as {
    type: string;
    data: any;
  }[];
  const mine = events.filter((x) => x.data?.job_id === handed.theirs);
  // The hub returns its whole recent history; report only events not shown yet.
  for (const e of mine.slice(seen)) {
    if (e.data.state)
      console.log(
        `  producer side: ${e.data.state}${e.data.progress != null ? ` ${Math.round(e.data.progress * 100)}%` : ""}${e.data.reason ? ` (${e.data.reason})` : ""}`,
      );
    if (["rejected", "done", "failed"].includes(e.data.state)) final = e.data;
  }
  seen = mine.length;
  if (!final) await new Promise((r) => setTimeout(r, 700));
}
if (!final)
  throw new Error("No outcome from the producer side within 2 minutes.");
step(
  final.state === "done"
    ? "Printed. The machine reported completion."
    : `Not printed: ${final.state} ${final.reason ?? final.error ?? ""}`,
);
store.close();
rmSync(work, { recursive: true, force: true });
