import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { Express, Request, Response } from "express";
import { mutate } from "./store.ts";
import { HttpNode, signNodeToken, type NodeBoundary } from "./node-client.ts";
import {
  Problem,
  requireThat,
  id,
  now,
  ownValue,
  type Connector,
  type ConnectorCheck,
  type Job,
  type Machine,
  type SetupCode,
  type State,
} from "./model.ts";
import type { Service } from "./service.ts";

/** Frame links from connector nodes use this origin; bytes travel over the relay. */
export const CONNECTOR_NODE_ORIGIN = "http://connector.invalid";
const SETUP_CODE_MS = 15 * 60 * 1000;
const POLL_WAIT_MS = 20_000;
const ONLINE_WINDOW_MS = 45_000;
const CALL_TIMEOUT_MS = 12_000;
const FRAME_LIMIT = 8 * 1024 * 1024;
export const supportedModels: Record<string, string> = {
  "phomemo-m02pro": "phomemo_01",
  "instax-mini-link-3": "instax_01",
  "bambu-a1-mini": "bambu_01",
  "Phomemo M02Pro": "phomemo_01",
  "Instax Mini Link 3": "instax_01",
  "Bambu Lab A1 mini": "bambu_01",
};

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
/** A connector signs nothing itself; it verifies tokens with this derived secret. */
export const connectorTokenSecret = (
  platformSecret: string,
  connectorId: string,
) =>
  createHmac("sha256", platformSecret)
    .update(`connector-token:${connectorId}`)
    .digest("hex");
// Crockford base32 without I, L, O and U: easy to read aloud and type.
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function newSetupCode() {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => alphabet[b % 32]).join("");
  return `FAB-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}
export const normalizeSetupCode = (code: string) =>
  code.toUpperCase().replace(/[^0-9A-Z]/g, "");

type RelayRequest = {
  id: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
};
export type RelayReply = {
  id: string;
  status: number;
  contentType?: string;
  json?: unknown;
  base64?: string;
};

/**
 * In-memory hub between the backend and connectors that dial out to it.
 * Each request is delivered to a connector at most once and is never
 * re-sent: a delivered request without a reply surfaces as an error, which
 * the service records as an uncertain outcome for the owner to reconcile.
 */
export class ConnectorRelay {
  private queues = new Map<string, RelayRequest[]>();
  private waiters = new Map<string, Set<() => void>>();
  private pending = new Map<
    string,
    {
      connectorId: string;
      resolve: (reply: RelayReply) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private lastSeen = new Map<string, number>();
  private polling = new Map<string, number>();
  constructor(
    public pollWaitMs = POLL_WAIT_MS,
    public onlineWindowMs = ONLINE_WINDOW_MS,
  ) {}
  isOnline(connectorId: string) {
    return (
      (this.polling.get(connectorId) ?? 0) > 0 ||
      Date.now() - (this.lastSeen.get(connectorId) ?? 0) < this.onlineWindowMs
    );
  }
  lastSeenAt(connectorId: string) {
    const seen = this.lastSeen.get(connectorId);
    return seen ? new Date(seen).toISOString() : undefined;
  }
  wake(connectorId: string) {
    for (const wake of this.waiters.get(connectorId) ?? []) wake();
  }
  request(
    connectorId: string,
    request: Omit<RelayRequest, "id">,
    timeoutMs = CALL_TIMEOUT_MS,
  ) {
    if (!this.isOnline(connectorId))
      return Promise.reject(
        new Error(
          "The machine connector is offline. Start it on the machine computer, then try again",
        ),
      );
    const relayed = { ...request, id: randomUUID() };
    const queue = this.queues.get(connectorId) ?? [];
    queue.push(relayed);
    this.queues.set(connectorId, queue);
    return new Promise<RelayReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(relayed.id);
        const waiting = this.queues.get(connectorId);
        const undelivered = waiting?.indexOf(relayed) ?? -1;
        if (undelivered >= 0) waiting!.splice(undelivered, 1);
        reject(
          new Error(
            undelivered >= 0
              ? "The machine connector did not collect this request in time"
              : "The machine connector did not answer in time",
          ),
        );
      }, timeoutMs);
      this.pending.set(relayed.id, { connectorId, resolve, reject, timer });
      this.wake(connectorId);
    });
  }
  /** Long-poll for work. Requests are removed from the queue when returned. */
  async poll(connectorId: string, closed: () => boolean) {
    this.lastSeen.set(connectorId, Date.now());
    this.polling.set(connectorId, (this.polling.get(connectorId) ?? 0) + 1);
    try {
      if (!this.queues.get(connectorId)?.length) {
        await new Promise<void>((done) => {
          const set = this.waiters.get(connectorId) ?? new Set();
          const finish = () => {
            clearTimeout(timer);
            set.delete(finish);
            done();
          };
          const timer = setTimeout(finish, this.pollWaitMs);
          set.add(finish);
          this.waiters.set(connectorId, set);
        });
      }
      if (closed()) return [];
      const queue = this.queues.get(connectorId) ?? [];
      this.queues.set(connectorId, []);
      return queue;
    } finally {
      this.polling.set(connectorId, (this.polling.get(connectorId) ?? 1) - 1);
      this.lastSeen.set(connectorId, Date.now());
    }
  }
  reply(connectorId: string, reply: RelayReply) {
    const waiting = this.pending.get(reply.id);
    if (!waiting || waiting.connectorId !== connectorId) return false;
    clearTimeout(waiting.timer);
    this.pending.delete(reply.id);
    waiting.resolve(reply);
    return true;
  }
  disconnect(connectorId: string) {
    this.queues.delete(connectorId);
    this.lastSeen.delete(connectorId);
    for (const [requestId, waiting] of this.pending)
      if (waiting.connectorId === connectorId) {
        clearTimeout(waiting.timer);
        this.pending.delete(requestId);
        waiting.reject(new Error("The machine connector was removed"));
      }
    this.wake(connectorId);
  }
}

/** Machines bound to a connector use the relay; all others keep direct HTTP. */
export class RoutingNode implements NodeBoundary {
  constructor(
    public direct: HttpNode,
    public relay: ConnectorRelay,
    private platformSecret: string,
  ) {}
  token(
    job: Job,
    machine: Machine,
    scope: string,
    extra?: { targetScope: "dispatch" | "calibration" },
  ) {
    return signNodeToken(
      machine.connectorId
        ? connectorTokenSecret(this.platformSecret, machine.connectorId)
        : this.platformSecret,
      job,
      machine,
      scope,
      extra,
    );
  }
  async call(tool: string, input: any, machine?: Machine) {
    if (!machine?.connectorId) return this.direct.call(tool, input, machine);
    const path = tool.startsWith("/") ? tool : `/tools/${tool}`;
    const reply = await this.relay.request(machine.connectorId, {
      method: path.startsWith("/machines/") ? "PATCH" : "POST",
      path,
      body: input,
    });
    if (reply.status < 200 || reply.status >= 300) {
      const error = reply.json as any;
      throw new Problem(
        error?.error?.code ?? "NODE_REJECTED",
        error?.error?.message ??
          "The configured machine node rejected this action.",
        reply.status >= 500 ? 502 : reply.status,
      );
    }
    return reply.json;
  }
  async fetchFrame(url: string, machine: Machine) {
    if (!machine.connectorId) return this.direct.fetchFrame(url, machine);
    const frame = new URL(url, CONNECTOR_NODE_ORIGIN);
    if (
      frame.origin !== CONNECTOR_NODE_ORIGIN ||
      !/^\/frames\/[0-9a-f]{32}\.png$/.test(frame.pathname)
    )
      throw new Error("Frame outside configured camera node");
    const reply = await this.relay.request(machine.connectorId, {
      method: "GET",
      path: frame.pathname,
    });
    if (reply.status !== 200 || typeof reply.base64 !== "string")
      throw new Error("Camera frame unavailable");
    const bytes = Buffer.from(reply.base64, "base64");
    if (bytes.length > FRAME_LIMIT) throw new Error("Camera frame too large");
    return bytes;
  }
}

const checkIds = /^[a-z][a-z0-9_-]{0,31}$/;
const statuses = new Set(["pending", "running", "waiting", "done", "failed"]);
const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : undefined;
function sanitizeChecks(value: unknown): ConnectorCheck[] {
  requireThat(
    Array.isArray(value) && value.length <= 12,
    "INVALID_CHECKS",
    "Setup checks must be a short list.",
    422,
  );
  return value.map((raw: any) => {
    const check: ConnectorCheck = {
      id: String(raw?.id ?? ""),
      label: text(raw?.label, 80) ?? "",
      status: raw?.status,
      detail: text(raw?.detail, 300) || undefined,
      consent: text(raw?.consent, 60) || undefined,
    };
    requireThat(
      checkIds.test(check.id) &&
        check.id !== "register" &&
        check.label &&
        statuses.has(check.status),
      "INVALID_CHECKS",
      "A setup check could not be read.",
      422,
    );
    return check;
  });
}
/** The owner-facing checklist: connector steps plus the backend's registration. */
export function connectorView(connector: Connector, relay: ConnectorRelay) {
  const registered = Boolean(connector.registeredAt);
  const registerCheck: ConnectorCheck = {
    id: "register",
    label: "Add it to your workshop",
    status: registered
      ? "done"
      : connector.registrationError
        ? "failed"
        : connector.ready
          ? "running"
          : "pending",
    detail: registered
      ? "Registered. Calibrate it next in Machine checks."
      : connector.registrationError,
  };
  return {
    id: connector.id,
    machineId: connector.machineId,
    mode: connector.mode,
    hostLabel: connector.hostLabel,
    createdAt: connector.createdAt,
    updatedAt: connector.updatedAt,
    online: relay.isOnline(connector.id),
    lastSeenAt: relay.lastSeenAt(connector.id),
    ready: Boolean(connector.ready),
    registeredAt: connector.registeredAt,
    consents: connector.consents,
    checks: [
      {
        id: "connector",
        label: "Connector online",
        status: "done",
        detail: `Enrolled from ${connector.hostLabel}`,
      },
      ...connector.checks,
      registerCheck,
    ],
  };
}
export const setupCodeView = (code: SetupCode) => ({
  id: code.id,
  machineId: code.machineId,
  mode: code.mode,
  createdAt: code.createdAt,
  expiresAt: code.expiresAt,
  usedAt: code.usedAt,
  connectorId: code.connectorId,
});

type Target = { nodeUrl: string } | { connectorId: string };
export function registerConnectorRoutes(
  app: Express,
  deps: {
    service: Service;
    relay: ConnectorRelay;
    owner: (req: Request) => Promise<unknown>;
    registerMachine: (
      machineId: string,
      mode: "simulation" | "hardware",
      target: Target,
    ) => Promise<Machine>;
  },
) {
  const { service, relay, owner, registerMachine } = deps;
  const failures = new Map<string, number[]>();
  const limited = (key: string) => {
    const recent = (failures.get(key) ?? []).filter(
      (at) => Date.now() - at < 10 * 60 * 1000,
    );
    failures.set(key, recent);
    return recent.length >= 10;
  };
  const platformUrl = () =>
    process.env.FABRARY_PUBLIC_ORIGIN?.replace(/\/$/, "") ??
    new URL(service.config.assetOrigin).origin;
  const connectorFor = async (req: Request) => {
    const header = String(req.headers.authorization ?? "");
    const match = /^Bearer (connector_[0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(
      header,
    );
    requireThat(
      match,
      "CONNECTOR_AUTH",
      "Connector credentials required.",
      401,
    );
    const s = await service.read();
    const connector = ownValue(s.connectors ?? {}, match[1]);
    const supplied = Buffer.from(sha256(match[2]));
    requireThat(
      connector &&
        timingSafeEqual(supplied, Buffer.from(connector.keyHash)) &&
        !connector.revokedAt,
      "CONNECTOR_AUTH",
      "This connector is not enrolled or was removed. Get a new setup code.",
      401,
    );
    return connector;
  };
  const tryRegistration = (connectorId: string) =>
    void (async () => {
      const s = await service.read();
      const connector = ownValue(s.connectors ?? {}, connectorId);
      if (!connector?.ready || connector.registeredAt || connector.revokedAt)
        return;
      try {
        const machine = s.machines[connector.machineId];
        // Say why first; there is no need to reach the connector for a busy machine.
        requireThat(
          !machine.activeJobId && !machine.reservation,
          "MACHINE_BUSY",
          "Finish existing orders before registering a different adapter.",
        );
        await registerMachine(connector.machineId, connector.mode, {
          connectorId,
        });
        await mutate(service.store, (state) => {
          const c = ownValue(state.connectors ?? {}, connectorId);
          if (!c) return;
          c.registeredAt = now();
          c.registrationError = undefined;
          c.updatedAt = now();
        });
      } catch (error) {
        await mutate(service.store, (state) => {
          const c = ownValue(state.connectors ?? {}, connectorId);
          if (!c) return;
          c.registrationError =
            error instanceof Problem && error.code === "MACHINE_BUSY"
              ? "Finish the open order on this machine, then try again."
              : `Registration failed: ${(error as Error).message}`;
          c.updatedAt = now();
        });
      }
    })();

  app.post("/api/owner/setup-codes", async (req, res) => {
    await owner(req);
    const machineId = ownValue(supportedModels, String(req.body.model));
    requireThat(
      machineId,
      "UNSUPPORTED_DEVICE",
      "Supported machines are Phomemo M02Pro, Instax Mini Link 3 and Bambu Lab A1 mini.",
      422,
    );
    const mode = req.body.mode;
    requireThat(
      mode === "simulation" || mode === "hardware",
      "INVALID_MODE",
      "Choose simulation or hardware.",
      422,
    );
    const code = newSetupCode();
    const setup: SetupCode = {
      id: id("setup"),
      codeHash: sha256(normalizeSetupCode(code)),
      machineId,
      mode,
      createdAt: now(),
      expiresAt: new Date(Date.now() + SETUP_CODE_MS).toISOString(),
    };
    await mutate(service.store, (s) => {
      s.setupCodes ??= {};
      // One live code per machine: an older unused code stops working.
      for (const previous of Object.values(s.setupCodes))
        if (previous.machineId === machineId && !previous.usedAt)
          previous.expiresAt = setup.createdAt;
      for (const [key, old] of Object.entries(s.setupCodes))
        if (Date.parse(old.expiresAt) < Date.now() - 24 * 3600 * 1000)
          delete s.setupCodes[key];
      s.setupCodes[setup.id] = setup;
    });
    const platform = platformUrl();
    res.status(201).json({
      setupCode: { ...setupCodeView(setup), code },
      platformUrl: platform,
      command: `curl -fsSL ${platform}/connect.sh | sh -s -- ${code}`,
    });
  });
  app.post("/api/owner/connectors/:id/consent", async (req, res) => {
    await owner(req);
    const check = String(req.body.check ?? "");
    const connector = await mutate(service.store, (s) => {
      const c = ownValue(s.connectors ?? {}, String(req.params.id));
      requireThat(c && !c.revokedAt, "NOT_FOUND", "Connector not found.", 404);
      const step = c.checks.find((item) => item.id === check);
      requireThat(
        step?.consent && step.status === "waiting",
        "CONSENT_NOT_NEEDED",
        "This step is not waiting for your permission.",
        409,
      );
      c.consents[check] = now();
      c.updatedAt = now();
      return c;
    });
    relay.wake(connector.id);
    res.json({ connector: connectorView(connector, relay) });
  });
  app.post("/api/owner/connectors/:id/register", async (req, res) => {
    await owner(req);
    const connector = await mutate(service.store, (s) => {
      const c = ownValue(s.connectors ?? {}, String(req.params.id));
      requireThat(c && !c.revokedAt, "NOT_FOUND", "Connector not found.", 404);
      requireThat(
        c.ready && !c.registeredAt,
        "REGISTRATION_NOT_READY",
        "The connector has not finished its checks yet.",
      );
      c.registrationError = undefined;
      c.updatedAt = now();
      return c;
    });
    tryRegistration(connector.id);
    res.status(202).json({ connector: connectorView(connector, relay) });
  });
  app.post("/api/owner/connectors/:id/revoke", async (req, res) => {
    await owner(req);
    const connectorId = String(req.params.id);
    await mutate(service.store, (s) => {
      const c = ownValue(s.connectors ?? {}, connectorId);
      requireThat(c && !c.revokedAt, "NOT_FOUND", "Connector not found.", 404);
      const m = s.machines[c.machineId];
      if (m?.connectorId === connectorId) {
        requireThat(
          !m.activeJobId && !m.reservation,
          "MACHINE_BUSY",
          "Finish the open order on this machine before removing its connector.",
        );
        delete m.connectorId;
        m.paused = true;
        m.ready = false;
        m.listed = false;
        m.calibrated = false;
        m.configured = false;
        m.reason = "Connector removed. Add the machine again to reconnect it.";
      }
      c.revokedAt = now();
      c.updatedAt = now();
    });
    relay.disconnect(connectorId);
    res.json({ ok: true });
  });

  app.post("/api/connectors/enroll", async (req, res) => {
    const remote = req.socket.remoteAddress ?? "unknown";
    requireThat(
      !limited(remote),
      "TOO_MANY_ATTEMPTS",
      "Too many setup attempts. Wait ten minutes, then get a new code.",
      429,
    );
    const codeHash = sha256(normalizeSetupCode(String(req.body.code ?? "")));
    const hostLabel =
      text(req.body.hostLabel, 60)?.replace(/[^\w .-]/g, "") ||
      "machine computer";
    const key = randomBytes(32).toString("hex");
    const connectorId = `connector_${randomUUID()}`;
    let enrolled: { setup: SetupCode; machine: Machine } | undefined;
    try {
      enrolled = await mutate(service.store, (s) => {
        const setup = Object.values(s.setupCodes ?? {}).find(
          (candidate) => candidate.codeHash === codeHash,
        );
        requireThat(
          setup && !setup.usedAt && Date.parse(setup.expiresAt) > Date.now(),
          "SETUP_CODE_INVALID",
          "This setup code is not valid. Codes work once and expire after 15 minutes; get a new one in Add a machine.",
          403,
        );
        setup.usedAt = now();
        setup.connectorId = connectorId;
        s.connectors ??= {};
        s.connectors[connectorId] = {
          id: connectorId,
          machineId: setup.machineId,
          mode: setup.mode,
          keyHash: sha256(key),
          hostLabel,
          createdAt: now(),
          updatedAt: now(),
          checks: [],
          consents: {},
        };
        return { setup, machine: s.machines[setup.machineId] };
      });
    } catch (error) {
      if (error instanceof Problem && error.code === "SETUP_CODE_INVALID")
        failures.set(remote, [...(failures.get(remote) ?? []), Date.now()]);
      throw error;
    }
    res.status(201).json({
      connectorId,
      connectorKey: key,
      tokenSecret: connectorTokenSecret(service.config.secret, connectorId),
      assetOrigin: service.config.assetOrigin,
      nodeOrigin: CONNECTOR_NODE_ORIGIN,
      machine: {
        id: enrolled.machine.id,
        model: enrolled.machine.model,
        outputType: enrolled.machine.outputType,
        material: enrolled.machine.material,
        mode: enrolled.setup.mode,
      },
    });
  });
  app.post("/api/connectors/poll", async (req, res) => {
    const connector = await connectorFor(req);
    let closed = false;
    res.on("close", () => {
      closed = true;
    });
    const requests = await relay.poll(connector.id, () => closed);
    const fresh = ownValue(
      (await service.read()).connectors ?? {},
      connector.id,
    );
    if (closed) return;
    res.json({
      requests,
      consents: fresh?.consents ?? {},
      registered: Boolean(fresh?.registeredAt),
      revoked: Boolean(fresh?.revokedAt),
    });
  });
  app.post("/api/connectors/reply", async (req, res) => {
    const connector = await connectorFor(req);
    const reply = req.body as RelayReply;
    requireThat(
      typeof reply?.id === "string" &&
        Number.isInteger(reply.status) &&
        (reply.base64 === undefined || typeof reply.base64 === "string"),
      "INVALID_REPLY",
      "Relay reply could not be read.",
      422,
    );
    res.json({ accepted: relay.reply(connector.id, reply) });
  });
  app.post("/api/connectors/report", async (req, res) => {
    const connector = await connectorFor(req);
    const checks = sanitizeChecks(req.body.checks);
    const ready = req.body.ready === true;
    const updated = await mutate(service.store, (s) => {
      const c = s.connectors![connector.id];
      c.checks = checks;
      c.ready = ready;
      c.updatedAt = now();
      return c;
    });
    if (ready && !updated.registeredAt && !updated.registrationError)
      tryRegistration(updated.id);
    res.json({
      consents: updated.consents,
      registered: Boolean(updated.registeredAt),
    });
  });

  // One-command setup: a script and the node package, both safe to publish.
  const hostPattern =
    /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:]+\](:\d{1,5})?$/;
  app.get("/connect.sh", async (req, res) => {
    const host = String(req.headers.host ?? "");
    requireThat(
      hostPattern.test(host),
      "INVALID_HOST",
      "Open the setup command from the address shown in your workshop.",
      400,
    );
    const platform =
      process.env.FABRARY_PUBLIC_ORIGIN?.replace(/\/$/, "") ?? `http://${host}`;
    res.type("text/x-shellscript").send(connectScript(platform));
  });
  app.get("/connect/package.tar.gz", async (_req, res) => {
    const source = resolve(process.env.FABRARY_NODE_SOURCE ?? "node");
    const tar = spawn(
      "tar",
      [
        "-czf",
        "-",
        "--exclude",
        ".venv",
        "--exclude",
        "__pycache__",
        "--exclude",
        ".pytest_cache",
        "--exclude",
        ".env",
        "-C",
        source,
        ".",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    res.type("application/gzip");
    tar.stdout.pipe(res);
    tar.on("error", () => res.destroy());
  });
}

export function connectScript(platform: string) {
  return `#!/bin/sh
# Fabrary machine connector setup. It installs the connector in
# ~/.fabrary-connector and starts it; nothing else on this computer changes.
set -eu
PLATFORM='${platform.replace(/'/g, "")}'
CODE="\${1:-}"
DIR="\${FABRARY_CONNECTOR_DIR:-$HOME/.fabrary-connector}"
if ! command -v uv >/dev/null 2>&1; then
  echo "Fabrary needs uv to run the connector. Install it with:"
  echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
  echo "then open a new terminal and run this setup command again."
  exit 1
fi
mkdir -p "$DIR/node"
chmod 700 "$DIR"
echo "Downloading the Fabrary connector from $PLATFORM ..."
curl -fsSL "$PLATFORM/connect/package.tar.gz" | tar -xzf - -C "$DIR/node"
# Bluetooth printers need the system Python on Linux; uv's own builds may lack it.
if [ "$(uname -s)" = "Linux" ] && [ -x /usr/bin/python3 ]; then
  export UV_PYTHON=/usr/bin/python3
fi
uv sync --project "$DIR/node" --locked --quiet
if [ -n "$CODE" ]; then
  exec uv run --project "$DIR/node" fabrary-connect --platform "$PLATFORM" --data-dir "$DIR" --code "$CODE"
fi
exec uv run --project "$DIR/node" fabrary-connect --platform "$PLATFORM" --data-dir "$DIR"
`;
}
