import type { Express, Request } from "express";
import {
  Problem,
  id,
  now,
  ownValue,
  requireThat,
  type Machine,
} from "./model.ts";
import { mutate } from "./store.ts";
import type { Service } from "./service.ts";

/**
 * Our node boundary for machines that print through the producer side's hub
 * (producer-side/hub). The hub's nodes download the approved file from our
 * signed asset URL and report jobs as offered → accepted → running →
 * done, or rejected/failed. Each offer carries our job and attempt
 * ids and the file hash, so a job is found again after either side restarts.
 * Today this speaks to the hub's development endpoints (/machines, /dev/offer,
 * /dev/events, /dev/cancel); the production interface is still to be agreed.
 */
export interface HubMachine {
  machine_id: string;
  process: string;
  status: string;
  simulated?: boolean;
  limits?: { max_size_mm?: number[]; max_job_minutes?: number };
  media_loaded?: { remaining_est?: number };
  /** The node's own words for its state, e.g. "plate_not_cleared: …". */
  detail?: string | null;
}
interface HubJob {
  job_id: string;
  machine_id: string;
  state: string;
  progress?: number;
  reason?: string | null;
  error?: string | null;
  params?: Record<string, unknown>;
}
const PROCESS: Record<string, string> = {
  sticker: "sticker_print",
  instax: "photo_print",
  "3d": "fdm_print",
};
export class ProducerHubNode {
  private readonly request: typeof fetch;
  private readonly timeoutMs: number;
  constructor(
    readonly url: string,
    options: { fetch?: typeof fetch; timeoutMs?: number } = {},
  ) {
    this.request = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }
  private async hub(path: string, body?: unknown, timeoutMs = this.timeoutMs) {
    const response = await this.request(
      `${this.url.replace(/\/$/, "")}${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    const text = await response.text();
    if (!response.ok)
      throw new Problem(
        "PRODUCER_HUB_REJECTED",
        `The producer side's hub answered ${response.status}: ${text.slice(0, 200)}`,
        502,
      );
    return JSON.parse(text);
  }
  /**
   * The node connects to its printer once, printing nothing. A node online is
   * not proof its printer is awake; Bluetooth printers sleep when idle.
   */
  async check(theirs: string): Promise<{ ok: boolean; detail: string }> {
    try {
      // A Bluetooth check can take three tries; the hub itself waits up to 90 s.
      const r = await this.hub("/dev/check", { machine_id: theirs }, 100_000);
      return { ok: r.ok === true, detail: String(r.detail ?? "") };
    } catch (e) {
      if (!(e instanceof Problem)) throw e;
      // A hub without checks cannot tell; it never blocks an order.
      if (/ answered 404: \{"detail":"not found"\}/i.test(e.message))
        return { ok: true, detail: "This hub cannot check printers." };
      // The printer's program never connected, or has stopped.
      if (/ answered (404|409):/.test(e.message))
        return { ok: false, detail: "Its printer program is not running." };
      throw e;
    }
  }
  async machines(): Promise<HubMachine[]> {
    return this.hub("/machines");
  }
  /** Someone took the last print off the machine (a 3D print stays on the plate until then). */
  private async plateCleared(theirs: string) {
    try {
      await this.hub("/dev/plate-cleared", { machine_id: theirs });
    } catch {
      // Best effort: an offline node starts fresh, and the owner can resume again.
    }
  }
  /** The newest state the hub reported for one of our attempts, if any. */
  private async find(attemptId: string): Promise<HubJob | undefined> {
    const events = (await this.hub("/dev/events?limit=500")) as {
      type: string;
      data: HubJob;
    }[];
    return events
      .map((e) => e.data)
      .filter((d) => d?.params?.fabyn_attempt_id === attemptId)
      .at(-1);
  }
  async call(tool: string, input: any, machine: Machine): Promise<any> {
    const theirs = machine.producerHub!.machineId;
    if (
      tool === "get_capabilities" ||
      (tool === "get_status" && !input.job_id)
    ) {
      const found = (await this.machines()).find(
        (m) => m.machine_id === theirs,
      );
      const online = !!found && found.status !== "offline";
      return {
        machine_id: machine.id,
        mode: found?.simulated ? "simulation" : "hardware",
        ready: online && found!.status !== "error",
        // The producer side checks its own printer; our record of the owner's
        // bring-up print stands until the owner changes it.
        calibrated: machine.calibrated,
        paired: online,
        configured: online,
        adapter_version: `producer-hub:${theirs}`,
        ...(typeof found?.media_loaded?.remaining_est === "number"
          ? { media_remaining: found.media_loaded.remaining_est }
          : {}),
        reason: !found
          ? `${theirs} is not connected to the producer side's hub.`
          : online
            ? `Producer side: ${found.status}${found.detail ? ` (${found.detail})` : ""}.`
            : `${theirs} is offline at the producer side's hub.`,
      };
    }
    if (tool === "run_job") {
      const p = input.parameters;
      const job = await this.hub("/dev/offer", {
        machine_id: theirs,
        process: PROCESS[p.outputType] ?? p.outputType,
        quantity: p.quantity,
        asset_url: input.artifact_url,
        params: {
          width_mm: p.widthMm,
          height_mm: p.heightMm,
          sha256: input.artifact_sha256,
          fabyn_job_id: input.job_id,
          fabyn_attempt_id: input.attempt_id,
        },
      });
      return {
        status: "accepted",
        execution_status: "accepted",
        reason: `Offered to ${theirs} as ${job.job_id}.`,
      };
    }
    if (tool === "get_status") {
      const job = await this.find(input.attempt_id);
      if (!job)
        return {
          execution_status: "unknown",
          reason: "The producer side's hub has no record of this attempt.",
        };
      return hubStatus(job);
    }
    if (tool === "abort") {
      const job = await this.find(input.attempt_id);
      if (job)
        await this.hub("/dev/cancel", {
          machine_id: theirs,
          job_id: job.job_id,
        });
      return {
        status: "stop_requested",
        reason:
          "Cancel sent to the producer side; the printer stops between chunks and may still print what it already has.",
      };
    }
    if (tool === "/reconcile") {
      // Explicitly resolve an uncertain execution; plate handling is separate.
      return {
        execution_status: input.result === "completed" ? "completed" : "failed",
        reason: `Owner inspection: ${input.reason}`,
      };
    }
    if (tool.startsWith("/machines/") && tool.endsWith("/policy")) {
      // The producer side enforces its own owner rules; ours stay in our registry.
      // Resuming after inspecting and clearing the machine also clears its plate.
      if (input.paused === false && input.cleared === true)
        await this.plateCleared(theirs);
      return { accepted: true, ...input };
    }
    throw new Problem(
      "UNSUPPORTED_ON_PRODUCER_HUB",
      `${tool} is not available for machines on the producer side's hub.`,
      409,
    );
  }
}
/** The hub's job state in our node vocabulary. */
export function hubStatus(job: HubJob): {
  execution_status: string;
  reason?: string;
} {
  const base = { reason: job.reason ?? job.error ?? undefined };
  switch (job.state) {
    case "offered":
    case "accepted":
      return { ...base, execution_status: "accepted" };
    case "running":
      return { ...base, execution_status: "running" };
    // Older hubs used this state after the machine finished.
    case "verifying":
    case "done":
      return {
        ...base,
        execution_status: "completed",
      };
    case "rejected":
      return {
        execution_status: "failed",
        reason: `The producer side declined the job: ${job.reason ?? "no reason given"}.`,
      };
    case "failed":
      return {
        execution_status: "failed",
        reason: `The producer side reported a failure: ${job.error ?? job.reason ?? "no detail"}.`,
      };
    default:
      return { ...base, execution_status: "unknown" };
  }
}

/**
 * The owner deliberately moves one of our machines onto the producer side's
 * hub (and back). Switching to the hub makes it a hardware machine whose
 * printer the producer side runs; the owner attests to a good test print.
 */
export function registerProducerHubRoutes(
  app: Express,
  {
    service,
    hub,
    owner,
  }: {
    service: Service;
    hub: ProducerHubNode | undefined;
    owner: (req: Request) => Promise<unknown>;
  },
) {
  app.post("/api/owner/machines/:id/producer-hub", async (req, res) => {
    await owner(req);
    requireThat(
      hub,
      "PRODUCER_HUB_UNCONFIGURED",
      "Set FABYN_PRODUCER_HUB_URL to the producer side's hub first.",
      409,
    );
    const machineId = String(req.params.id);
    const theirs = req.body?.producerMachineId;
    requireThat(
      typeof theirs === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(theirs),
      "INVALID_PRODUCER_MACHINE",
      "Name the producer side's machine id, e.g. m_sticker_live.",
      422,
    );
    requireThat(
      req.body?.confirmTestPrint === true,
      "TEST_PRINT_REQUIRED",
      "Confirm that a test print from this producer machine came out right.",
      422,
    );
    requireThat(
      service.modeAllowed("hardware"),
      "HARDWARE_NOT_ALLOWED",
      "Allow hardware work first: FABYN_ALLOWED_MODES=hardware,simulation.",
      409,
    );
    const listed = (await hub.machines()).find((m) => m.machine_id === theirs);
    const ours = ownValue((await service.read()).machines, machineId);
    requireThat(ours, "NOT_FOUND", "Machine not found.", 404);
    requireThat(
      listed && listed.status !== "offline",
      "PRODUCER_MACHINE_OFFLINE",
      `${theirs} is not online at the producer side's hub.`,
      409,
    );
    requireThat(
      listed.process === PROCESS[ours.outputType] && !listed.simulated,
      "PRODUCER_MACHINE_MISMATCH",
      `${theirs} does ${listed.process}${listed.simulated ? " (simulated)" : ""}; this machine needs a real ${PROCESS[ours.outputType]} printer.`,
      409,
    );
    const machine = await mutate(service.store, (s) => {
      const m = s.machines[machineId];
      requireThat(
        !m.activeJobId && !m.reservation,
        "MACHINE_BUSY",
        "Finish existing orders on this machine before switching it.",
        409,
      );
      const at = now();
      m.mode = "hardware";
      m.producerHub = { machineId: theirs, since: at };
      m.registrationId = id("registration");
      m.adapterVersion = `producer-hub:${theirs}`;
      delete m.connectorId;
      m.paired = true;
      m.configured = true;
      m.calibrated = true;
      m.calibrationAt = at;
      m.listed = true;
      m.ready = true;
      m.paused = false;
      m.policyReconciliationRequired = false;
      m.reason = `Prints through the producer side's hub as ${theirs}. Completion follows the machine report.`;
      return m;
    });
    res.json({ machine });
  });
  /** Confirm the completed item has been removed and the plate is clear. */
  app.post("/api/owner/jobs/:id/clear-print", async (req, res) => {
    await owner(req);
    requireThat(
      req.body?.cleared === true,
      "INSPECTION_REQUIRED",
      "Confirm that you removed the completed print and cleared the plate.",
      422,
    );
    const jobId = String(req.params.id);
    requireThat(
      ownValue((await service.read()).jobs, jobId),
      "NOT_FOUND",
      "Order not found.",
      404,
    );
    const machine = await service.clearHubPrint(jobId);
    res.json({ machine });
  });
  app.delete("/api/owner/machines/:id/producer-hub", async (req, res) => {
    await owner(req);
    const machine = await mutate(service.store, (s) => {
      const m = ownValue(s.machines, String(req.params.id));
      requireThat(
        m?.producerHub,
        "NOT_ON_HUB",
        "This machine is not on the producer side's hub.",
        409,
      );
      requireThat(
        !m.activeJobId && !m.reservation,
        "MACHINE_BUSY",
        "Finish existing orders on this machine before switching it back.",
        409,
      );
      delete m.producerHub;
      m.mode = service.config.mode;
      m.registrationId = id("registration");
      m.calibrated = false;
      delete m.calibrationAt;
      m.listed = false;
      m.ready = false;
      m.paused = true;
      m.reason =
        "Moved off the producer side's hub. Register it with a local node, calibrate, then list and resume.";
      return m;
    });
    res.json({ machine });
  });
}
