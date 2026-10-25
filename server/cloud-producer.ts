import type { Express, Request } from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ProducerHubNode, hubStatus, type HubMachine } from "./producer-hub.ts";
import { Problem, requireThat, type Machine } from "./model.ts";
import { mutate, type Store } from "./store.ts";
import { digest, type FileStorage } from "./cloud-files.ts";

export interface TransferFile {
  path: string;
  storageId: string;
  sha256: string;
}
export interface ProducerTask {
  id: string;
  kind: string;
  payload: any;
  files: TransferFile[];
  state: "queued" | "delivered" | "finished";
  createdAt: number;
  expiresAt: number;
  result?: any;
  error?: string;
  job?: any;
}
export interface ProducerState {
  machines: Record<string, HubMachine & { lastSeen: number }>;
  tasks: Record<string, ProducerTask>;
}
const state = (s: import("./model.ts").State) =>
  (s.producer ??= { machines: {}, tasks: {} });
const machineIds = new Set(["m_sticker_01", "m_photo_01", "m_fdm_01"]);
const taskResult = z.object({
  id: z.string(),
  result: z.any().optional(),
  error: z.string().max(1000).optional(),
  files: z
    .array(
      z.object({
        path: z.string(),
        storageId: z.string(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(8)
    .default([]),
});

/** Durable outbound-only boundary. No cloud request ever connects to the Mac. */
export class CloudProducer extends ProducerHubNode {
  constructor(
    readonly store: Store,
    readonly files: FileStorage,
    private key: string,
    private dataDir: string,
    private now = Date.now,
  ) {
    super("cloud-queue");
  }
  private async enqueue(
    id: string,
    kind: string,
    payload: any,
    files: TransferFile[] = [],
  ) {
    return mutate(this.store, (s) => {
      const p = state(s);
      const existing = p.tasks[id];
      if (existing) return existing;
      const at = this.now();
      return (p.tasks[id] = {
        id,
        kind,
        payload,
        files,
        state: "queued",
        createdAt: at,
        expiresAt: at + (kind === "run_job" ? 300_000 : 180_000),
      });
    });
  }
  override async machines(): Promise<HubMachine[]> {
    return Object.values(state((await this.store.read()).data).machines).map(
      (m) => ({
        ...m,
        status: this.now() - m.lastSeen > 20_000 ? "offline" : m.status,
      }),
    );
  }
  override async check(machineId: string) {
    const result = await this.rpc("check", { machine_id: machineId });
    return { ok: result.ok === true, detail: String(result.detail ?? "") };
  }
  override async call(
    tool: string,
    input: any,
    machine: Machine,
  ): Promise<any> {
    const theirs = machine.producerHub!.machineId;
    if (
      tool === "get_capabilities" ||
      (tool === "get_status" && !input.job_id)
    ) {
      const m = (await this.machines()).find((m) => m.machine_id === theirs);
      const online = !!m && m.status !== "offline";
      return {
        machine_id: machine.id,
        mode: m?.simulated ? "simulation" : "hardware",
        ready: online && m!.status !== "error",
        paired: online,
        configured: online,
        calibrated: machine.calibrated,
        adapter_version: `cloud-producer:${theirs}`,
        reason: online
          ? `Local producer: ${m!.status}${m!.detail ? ` (${m!.detail})` : ""}.`
          : "Local producer is offline.",
      };
    }
    if (tool === "run_job") {
      const p = input.parameters;
      const task = await this.enqueue(input.attempt_id, "run_job", {
        job_id: input.attempt_id,
        order_id: input.job_id,
        item_id: input.job_id,
        machine_id: theirs,
        process: {
          sticker: "sticker_print",
          instax: "photo_print",
          "3d": "fdm_print",
        }[p.outputType as string],
        quantity: p.quantity,
        asset_id: input.artifact_url.split("/assets/")[1]?.split("?")[0],
        params: {
          width_mm: p.widthMm,
          height_mm: p.heightMm,
          sha256: input.artifact_sha256,
          fabyn_job_id: input.job_id,
          fabyn_attempt_id: input.attempt_id,
        },
        escrow: "held",
      });
      requireThat(
        task.kind === "run_job" &&
          task.payload.params.sha256 === input.artifact_sha256 &&
          task.payload.machine_id === theirs,
        "ATTEMPT_CONFLICT",
        "This attempt already belongs to another dispatch.",
        409,
      );
      return {
        status: "accepted",
        execution_status: "accepted",
        reason: "Queued for the local producer.",
      };
    }
    if (tool === "get_status") {
      const producer = state((await this.store.read()).data);
      const task = producer.tasks[input.attempt_id];
      if (!task)
        return {
          execution_status: "unknown",
          reason: "No recorded producer attempt.",
        };
      if (task.job) {
        const report = hubStatus(task.job);
        const seen = producer.machines[theirs]?.lastSeen ?? 0;
        if (
          ["accepted", "running"].includes(report.execution_status) &&
          this.now() - seen > 20_000
        )
          return {
            execution_status: "unknown",
            reason:
              "Producer disconnected during this attempt. Inspect the machine before retrying.",
          };
        return report;
      }
      if (task.error) return { execution_status: "failed", reason: task.error };
      if (task.state === "queued" && task.expiresAt < this.now())
        return {
          execution_status: "failed",
          reason: "Producer did not receive the job before it expired.",
        };
      if (task.expiresAt < this.now() && !task.job)
        return {
          execution_status: "unknown",
          reason:
            "Delivery was recorded but the producer has not reported its outcome. Inspect the machine before retrying.",
        };
      return {
        execution_status: "accepted",
        reason: "Waiting for the local producer's report.",
      };
    }
    if (tool === "abort") {
      await mutate(this.store, (s) => {
        const task = state(s).tasks[input.attempt_id];
        if (task?.state === "queued") {
          task.state = "finished";
          task.error = "Cancelled before delivery";
        }
      });
      await this.enqueue(`cancel:${input.attempt_id}`, "cancel", {
        machine_id: theirs,
        job_id: input.attempt_id,
      });
      return {
        status: "stop_requested",
        reason: "Cancellation queued for the local producer.",
      };
    }
    if (tool === "/reconcile")
      return {
        execution_status: input.result === "completed" ? "completed" : "failed",
        reason: input.reason,
      };
    if (tool.startsWith("/machines/") && tool.endsWith("/policy")) {
      if (input.paused === false && input.cleared === true)
        await this.enqueue(`clear:${randomUUID()}`, "plate_cleared", {
          machine_id: theirs,
        });
      return { accepted: true, ...input };
    }
    throw new Problem(
      "UNSUPPORTED_ON_CLOUD_PRODUCER",
      `${tool} is unavailable for this producer.`,
      409,
    );
  }
  /** Move declared files through object storage; remote paths are never opened on this host. */
  async rpc(kind: string, request: any, paths: string[] = []) {
    requireThat(
      (await this.machines()).some((m) => m.status !== "offline"),
      "PRODUCER_OFFLINE",
      "The local producer is offline. Start npm run producer on the machine computer.",
      503,
    );
    const found = new Set(paths);
    const scan = (v: any) => {
      if (!v || typeof v !== "object") return;
      for (const [k, x] of Object.entries(v)) {
        if (k === "path" && typeof x === "string") found.add(x);
        else scan(x);
      }
    };
    scan(request);
    const files: TransferFile[] = [];
    for (const path of found) {
      const bytes = await readFile(path);
      files.push({
        path,
        storageId: await this.files.upload(bytes),
        sha256: digest(bytes),
      });
    }
    const task = await this.enqueue(
      `rpc_${randomUUID()}`,
      kind,
      request,
      files,
    );
    while (this.now() < task.expiresAt) {
      const current = state((await this.store.read()).data).tasks[task.id];
      if (current.state === "finished") {
        if (current.error) throw new Error(`PRODUCER_FAILED: ${current.error}`);
        const result = structuredClone(current.result);
        const replacements = new Map<string, string>();
        await mkdir(join(this.dataDir, "results", task.id), {
          recursive: true,
        });
        for (const [index, file] of current.files.entries()) {
          const bytes = await this.files.download(file.storageId);
          if (digest(bytes) !== file.sha256)
            throw new Error("Producer output checksum mismatch");
          const path = join(this.dataDir, "results", task.id, String(index));
          await writeFile(path, bytes);
          replacements.set(file.path, path);
        }
        return replacePaths(result, replacements);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      "PRODUCER_TIMEOUT: local producer did not finish preparation in three minutes",
    );
  }
  register(
    app: Express,
    assetUrl: (id: string) => string,
    reconcile: () => Promise<void>,
  ) {
    const auth = (req: Request) => {
      const supplied = Buffer.from(String(req.headers.authorization ?? ""));
      const expected = Buffer.from(`Bearer ${this.key}`);
      requireThat(
        supplied.length === expected.length &&
          timingSafeEqual(supplied, expected),
        "PRODUCER_AUTH_REQUIRED",
        "A producer credential is required.",
        401,
      );
    };
    app.post("/api/producer/storage", async (req, res) => {
      auth(req);
      res.json({ url: await this.files.uploadUrl() });
    });
    app.post("/api/producer/poll", async (req, res) => {
      auth(req);
      const body = z
        .object({
          machines: z
            .array(
              z
                .object({
                  machine_id: z.string(),
                  process: z.string(),
                  status: z.string(),
                  simulated: z.boolean().optional(),
                  detail: z.string().nullable().optional(),
                })
                .passthrough(),
            )
            .max(3),
          results: z.array(taskResult).max(32).default([]),
          events: z
            .array(
              z.object({
                type: z.string(),
                data: z.record(z.string(), z.any()),
              }),
            )
            .max(100)
            .default([]),
        })
        .parse(req.body);
      const tasks = await mutate(this.store, (s) => {
        const p = state(s),
          at = this.now();
        for (const m of body.machines) {
          requireThat(
            machineIds.has(m.machine_id),
            "UNKNOWN_MACHINE",
            "Producer machine is not configured.",
            422,
          );
          p.machines[m.machine_id] = { ...m, lastSeen: at };
        }
        for (const r of body.results) {
          const t = p.tasks[r.id];
          if (t && t.state === "delivered") {
            t.state = "finished";
            t.result = r.result;
            t.error = r.error;
            t.files = r.files;
          }
        }
        for (const e of body.events) {
          const t = p.tasks[e.data.job_id];
          if (
            !t ||
            t.kind !== "run_job" ||
            (t.job && ["done", "failed", "rejected"].includes(t.job.state))
          )
            continue;
          const next =
            e.type === "job.result"
              ? e.data.ok
                ? "done"
                : "failed"
              : e.type === "job.accept"
                ? "accepted"
                : e.type === "job.reject"
                  ? "rejected"
                  : e.data.state;
          const rank: Record<string, number> = {
            accepted: 0,
            running: 1,
            needs_review: 2,
            done: 3,
            failed: 3,
            rejected: 3,
          };
          if (next && (rank[next] ?? -1) >= (rank[t.job?.state] ?? -1))
            t.job = {
              ...t.payload,
              ...t.job,
              ...e.data,
              state: next,
              progress: Math.max(t.job?.progress ?? 0, e.data.progress ?? 0),
            };
        }
        return Object.values(p.tasks)
          .filter((t) => t.state !== "finished" && t.expiresAt >= at)
          .slice(0, 16)
          .map((t) => {
            t.state = "delivered";
            return structuredClone(t);
          });
      });
      const outgoing = await Promise.all(
        tasks.map(async (t) => ({
          ...t,
          payload:
            t.kind === "run_job"
              ? { ...t.payload, asset_url: assetUrl(t.payload.asset_id) }
              : t.payload,
          files: await Promise.all(
            t.files.map(async (f) => ({
              ...f,
              url: await this.files.url(f.storageId),
            })),
          ),
        })),
      );
      res.json({ tasks: outgoing });
      // The runtime registers this work with waitUntil; never rely on an idle timer.
      await reconcile();
    });
  }
}
function replacePaths(value: any, paths: Map<string, string>): any {
  if (typeof value === "string") return paths.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => replacePaths(v, paths));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, replacePaths(v, paths)]),
    );
  return value;
}
