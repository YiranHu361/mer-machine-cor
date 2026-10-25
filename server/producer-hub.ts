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
 * verifying/done, or rejected/failed. Each offer carries our job and attempt
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
  verification?: { pass: boolean | null; reason?: string } | null;
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
  private async hub(path: string, body?: unknown) {
    const response = await this.request(
      `${this.url.replace(/\/$/, "")}${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
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
      .filter((d) => d?.params?.fabrary_attempt_id === attemptId)
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
          fabrary_job_id: input.job_id,
          fabrary_attempt_id: input.attempt_id,
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
      // The owner inspected the print. A pass is recorded at the producer side
      // as its labeled manual approval, so both sides agree the job is done.
      // Best effort: the owner's inspection stands even when the hub has
      // restarted (and forgotten the job) or is unreachable.
      try {
        const job = await this.find(input.attempt_id);
        if (job && input.result === "completed" && job.state !== "done")
          await this.hub("/dev/approve", {
            machine_id: theirs,
            job_id: job.job_id,
            reason: input.reason,
          });
      } catch {}
      // A passed print is off the printer: 3D prints are only ever passed by
      // the owner, after taking them off the plate. Sticker nodes ignore this.
      if (input.result === "completed") await this.plateCleared(theirs);
      return {
        execution_status: input.result === "completed" ? "completed" : "failed",
        completion_credible: false,
        reason: `Owner inspection: ${input.reason}`,
      };
    }
    if (tool === "camera_snapshot")
      throw new Problem(
        "CAMERA_UNAVAILABLE",
        "The producer side has no camera yet; the owner checks the print.",
        503,
      );
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
  completion_credible?: boolean;
  reason?: string;
} {
  const base = { reason: job.reason ?? job.error ?? undefined };
  switch (job.state) {
    case "offered":
    case "accepted":
      return { ...base, execution_status: "accepted" };
    case "running":
      return { ...base, execution_status: "running" };
    case "verifying":
      // Made, but nobody has looked at it: the owner checks it on our side.
      return {
        ...base,
        execution_status: "completed",
        completion_credible: false,
        reason: job.verification?.reason ?? "Printed; not yet checked.",
      };
    case "done":
      return {
        ...base,
        execution_status: "completed",
        completion_credible: job.verification?.pass === true,
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
      "Set FABRARY_PRODUCER_HUB_URL to the producer side's hub first.",
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
      "Allow hardware work first: FABRARY_ALLOWED_MODES=hardware,simulation.",
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
      m.reason = `Prints through the producer side's hub as ${theirs}. The owner confirmed a test print; the owner checks each print.`;
      return m;
    });
    res.json({ machine });
  });
  /**
   * "Approve manually" for a print from the producer side, which has no
   * camera yet: the owner checked the item and took it off the printer. One
   * step records the passing review, the handling and the resume, so the
   * printer takes the next order. Each step keeps its own checks.
   */
  app.post("/api/owner/jobs/:id/approve-print", async (req, res) => {
    await owner(req);
    requireThat(
      req.body?.checked === true,
      "INSPECTION_REQUIRED",
      "Confirm that you checked the print and took it off the printer.",
      422,
    );
    const jobId = String(req.params.id);
    requireThat(
      ownValue((await service.read()).jobs, jobId),
      "NOT_FOUND",
      "Order not found.",
      404,
    );
    const machine = await service.approveHubPrint(
      jobId,
      typeof req.body.reason === "string" && req.body.reason.trim().length >= 8
        ? req.body.reason.trim()
        : "Checked the print by eye and took it off the printer.",
    );
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
