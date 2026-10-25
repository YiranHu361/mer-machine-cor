import type { Express, Request } from "express";
import {
  spawn as spawnChild,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { access, appendFile, chmod, readFile, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { Problem, requireThat } from "./model.ts";
import type { Service } from "./service.ts";
import {
  PRODUCER_DIR,
  PRODUCER_PYTHON,
  hubArgs,
  nodeArgs,
  printerPairs,
  producerHubUrl,
  type PrinterPair,
} from "./mvp-plan.ts";

/*
 * The seller page's Connections panel: the real state of everything a
 * real-machine run needs (the producer side's Python, its hub, one program per
 * printer, each printer's link, and our machine counters on the hub), read from
 * live probes, plus one fixed step to fix each missing piece. Steps that start
 * programs or write secrets only run for a page opened on this Mac: the owner
 * sign-in can be open, and a phone on the network reaches the API through Vite.
 * No step prints or moves anything; the probes only read.
 */

export type Light = "ok" | "warn" | "bad" | "unknown";
export interface Row {
  light: Light;
  detail: string;
  checkedAt: string | null;
}
export interface ActionState {
  key: string;
  running: boolean;
  startedAt: string;
  finishedAt?: string;
  ok?: boolean;
  detail: string;
  /** The last lines of the step's log, secrets removed; only when it failed. */
  log: string[];
}
interface Started {
  pid: number;
  startedAt: string;
  marker: string;
}
interface Exited {
  code: number | null;
  at: string;
  log: string[];
  /** Stopped with this page's Stop button. */
  onPurpose: boolean;
}
export interface Proc {
  pid?: number;
  once(event: "exit", listener: (code: number | null) => void): unknown;
}
export interface MvpDeps {
  root: string;
  dataDir: string;
  env: NodeJS.ProcessEnv;
  /** Starts a long-running program; its output goes to the log file. */
  start(command: string, args: string[], options: { cwd: string; log: string }): Proc;
  /** Runs a short program to the end, output captured and appended to the log. */
  run(
    command: string,
    args: string[],
    options: { cwd: string; log: string; timeoutMs: number },
  ): Promise<{ code: number | null; output: string }>;
  fetch: typeof fetch;
  reachable(host: string, port: number, timeoutMs: number): Promise<boolean>;
  /** True while the pid runs a command line containing the marker. */
  alive(pid: number, marker: string): boolean;
  stop(pid: number): void;
  /** This Mac's IPv4 addresses. */
  addresses(): string[];
  now(): number;
}

const LOOPBACK_SOCKETS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
// Headers a proxy or tunnel adds (Vercel, cloudflared). The public site reaches
// this app through a tunnel on this Mac, so its socket is loopback too; Vite's
// local proxy adds none of these.
const FORWARDED_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-real-ip",
  "cf-connecting-ip",
  "cf-ray",
  "true-client-ip",
  "x-vercel-id",
  "x-vercel-forwarded-for",
];
/** The request was made by a browser on this Mac: loopback socket and Host, and no proxy or tunnel in between. */
export function isLocalRequest(req: Pick<Request, "headers" | "socket">) {
  const host = String(req.headers.host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[([^\]]+)\](?::\d+)?$/, "$1")
    .replace(/^([^:]+):\d+$/, "$1");
  return (
    LOOPBACK_SOCKETS.has(req.socket?.remoteAddress ?? "") &&
    LOOPBACK_HOSTS.has(host) &&
    !FORWARDED_HEADERS.some((h) => req.headers[h] !== undefined)
  );
}

const SECRET_NAME = /KEY|SECRET|CODE|TOKEN|PASSWORD|SEED|PRIVATE/i;
/** Root .env names that may hold the A1 mini's LAN access code, newest first. */
const ACCESS_CODE_NAMES = [
  "BAMBU_ACCESS_CODE",
  "FABYN_BAMBU_ACCESS_CODE",
  "FABRARY_BAMBU_ACCESS_CODE",
];
const ACCESS_CODE = /^[A-Za-z0-9]{6,32}$/;
const PYTHON_IMPORTS =
  "import bleak, paho.mqtt.client, websockets, httpx, PIL, pydantic, simplepyble, fastapi, uvicorn";
const A1_PORTS = [990, 8883];

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const at = line.indexOf("=");
    const key = line.slice(0, at).replace(/^export\s+/, "").trim();
    out[key] = line
      .slice(at + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** Strips colour codes and every known secret value from log lines. */
export function redact(lines: string[], secrets: string[]) {
  const values = [...new Set(secrets.filter((s) => s.length >= 6))].sort(
    (a, b) => b.length - a.length,
  );
  return lines.map((line) => {
    let out = line.replace(/\x1b\[[0-9;]*m/g, "");
    for (const v of values) out = out.split(v).join("•••");
    return out
      .replace(
        /\b(access[_ ]?code|password|secret|token|api[_ ]?key)(["'\s:=]+)[^\s"',}]+/gi,
        "$1$2•••",
      )
      .slice(0, 300);
  });
}

export function defaultMvpDeps(dataDir: string): MvpDeps {
  return {
    root: resolve("."),
    dataDir,
    env: process.env,
    start(command, args, { cwd, log }) {
      const fd = openSync(log, "a");
      try {
        // Its own process group, so it keeps running across an app restart
        // and stops as one with its children.
        const child: ChildProcess = spawnChild(command, args, {
          cwd,
          env: process.env,
          stdio: ["ignore", fd, fd],
          detached: true,
        });
        child.unref();
        return child;
      } finally {
        closeSync(fd);
      }
    },
    run(command, args, { cwd, log, timeoutMs }) {
      return new Promise((done) => {
        let output = "";
        let child: ChildProcess;
        try {
          child = spawnChild(command, args, { cwd, env: process.env });
        } catch (e) {
          return done({ code: null, output: String((e as Error).message) });
        }
        const take = (chunk: Buffer) => {
          if (output.length < 200_000) output += chunk.toString("utf8");
        };
        child.stdout?.on("data", take);
        child.stderr?.on("data", take);
        const timer = setTimeout(() => {
          output += `\n(stopped after ${Math.round(timeoutMs / 1000)} s)`;
          child.kill("SIGTERM");
        }, timeoutMs);
        const finish = (code: number | null) => {
          clearTimeout(timer);
          appendFile(log, `$ ${[command, ...args].join(" ")}\n${output}\n`).catch(
            () => {},
          );
          done({ code, output });
        };
        child.once("error", (e) => {
          output += String(e.message);
          finish(null);
        });
        child.once("close", (code) => finish(code));
      });
    },
    fetch: globalThis.fetch,
    reachable(host, port, timeoutMs) {
      return new Promise((done) => {
        const socket = connect({ host, port });
        const end = (ok: boolean) => {
          socket.destroy();
          done(ok);
        };
        socket.setTimeout(timeoutMs, () => end(false));
        socket.once("connect", () => end(true));
        socket.once("error", () => end(false));
      });
    },
    alive(pid, marker) {
      try {
        process.kill(pid, 0);
      } catch {
        return false;
      }
      const ps = spawnSync("ps", ["-o", "command=", "-p", String(pid)], {
        encoding: "utf8",
      });
      return ps.status === 0 && ps.stdout.includes(marker);
    },
    stop(pid) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        process.kill(pid, "SIGTERM");
      }
    },
    addresses() {
      return Object.values(networkInterfaces())
        .flat()
        .filter((a) => a && a.family === "IPv4" && !a.internal)
        .map((a) => a!.address);
    },
    now: () => Date.now(),
  };
}

export function registerMvpSetupRoutes(
  app: Express,
  {
    service,
    owner,
    hubUrl,
    deps = defaultMvpDeps(service.config.dataDir),
  }: {
    service: Service;
    owner: (req: Request) => Promise<unknown>;
    /** The hub this app sends orders through, when it was started with one. */
    hubUrl: string | undefined;
    deps?: MvpDeps;
  },
) {
  const producerDir = join(deps.root, PRODUCER_DIR);
  const python = join(deps.root, PRODUCER_PYTHON);
  const hub = (hubUrl ?? producerHubUrl(deps.env)).replace(/\/$/, "");
  const pairs = printerPairs(deps.env);
  const logs = join(deps.dataDir, "logs");
  mkdirSync(logs, { recursive: true });
  const logPath = (name: string) => join(logs, `mvp-${name}.log`);
  const iso = (ms = deps.now()) => new Date(ms).toISOString();

  // Programs started here, kept on disk so an app restart still knows them.
  const startedFile = join(deps.dataDir, "mvp-processes.json");
  let started: Record<string, Started> = {};
  try {
    started = JSON.parse(readFileSync(startedFile, "utf8"));
  } catch {
    started = {};
  }
  const saveStarted = () =>
    writeFileSync(startedFile, JSON.stringify(started), { mode: 0o600 });
  const exited: Record<string, Exited> = {};
  const stopping = new Set<string>();
  const actions: Record<string, ActionState> = {};
  let pythonCheck: (Row & { ready: boolean }) | null = null;
  let pythonChecking: Promise<void> | null = null;
  let scan: { at: string; ok: boolean; detail: string; seen: { name: string; address: string; rssi: number }[] } | null = null;
  let discovered: { at: string; ok: boolean; found: { ip: string; serial: string }[] } | null = null;
  const deviceChecks: Record<string, { ok: boolean; detail: string; at: string }> = {};
  const lanCache: Record<string, { at: number; open: boolean[] }> = {};

  const readText = async (path: string) => {
    try {
      return await readFile(path, "utf8");
    } catch {
      return "";
    }
  };
  const exists = async (path: string) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  };
  const secrets = async () => {
    const files = [
      parseEnv(await readText(join(deps.root, ".env"))),
      parseEnv(await readText(join(producerDir, ".env"))),
      deps.env as Record<string, string | undefined>,
    ];
    return files.flatMap((vars) =>
      Object.entries(vars)
        .filter(([k, v]) => SECRET_NAME.test(k) && typeof v === "string")
        .map(([, v]) => v as string),
    );
  };
  const tail = async (path: string, lines = 8) =>
    redact(
      (await readText(path))
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .slice(-lines),
      await secrets(),
    );
  const machineConfig = async (theirs: string): Promise<any> => {
    try {
      return JSON.parse(
        await readFile(join(producerDir, "node/machines", `${theirs}.json`), "utf8"),
      );
    } catch {
      return null;
    }
  };
  const isRunning = (name: string) => {
    const s = started[name];
    if (!s) return false;
    if (deps.alive(s.pid, s.marker)) return true;
    delete started[name];
    saveStarted();
    return false;
  };
  const hubMachines = async (): Promise<any[] | null> => {
    try {
      const r = await deps.fetch(`${hub}/machines`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!r.ok) return null;
      const list = await r.json();
      return Array.isArray(list) ? list : null;
    } catch {
      return null;
    }
  };
  const accessCode = async (pair: PrinterPair) => {
    const cfg = await machineConfig(pair.theirs);
    const name = String(cfg?.adapter?.access_code_env ?? "BAMBU_ACCESS_CODE");
    const local = parseEnv(await readText(join(producerDir, ".env")));
    const present = Boolean(local[name] || deps.env[name]);
    const root = parseEnv(await readText(join(deps.root, ".env")));
    return {
      name,
      present,
      fromEnvName: ACCESS_CODE_NAMES.find((n) => root[n]) ?? null,
    };
  };

  const checkPython = () => {
    pythonChecking ??= (async () => {
      const at = iso();
      if (!(await exists(python))) {
        pythonCheck = {
          ready: false,
          light: "bad",
          detail: "Not installed yet: producer-side/.venv is missing.",
          checkedAt: at,
        };
        return;
      }
      const r = await deps.run(python, ["-c", PYTHON_IMPORTS], {
        cwd: producerDir,
        log: logPath("python-check"),
        timeoutMs: 60_000,
      });
      const missing = /No module named '([^']+)'/.exec(r.output)?.[1];
      pythonCheck =
        r.code === 0
          ? { ready: true, light: "ok", detail: "Installed, and every printer library loads.", checkedAt: at }
          : {
              ready: false,
              light: "bad",
              detail: missing
                ? `A library is missing: ${missing}. Install again.`
                : "Installed, but its libraries do not load. Install again.",
              checkedAt: at,
            };
    })().finally(() => {
      pythonChecking = null;
    });
    return pythonChecking;
  };

  const idle = (key: string) =>
    requireThat(
      !actions[key]?.running,
      "STEP_RUNNING",
      "That step is already running.",
      409,
    );
  /** Runs a step in the background; the panel follows it through the status. */
  const background = (
    key: string,
    detail: string,
    work: () => Promise<{ ok: boolean; detail: string; log?: string }>,
  ) => {
    idle(key);
    const state: ActionState = {
      key,
      running: true,
      startedAt: iso(),
      detail,
      log: [],
    };
    actions[key] = state;
    const finish = async (ok: boolean, text: string, log?: string) => {
      // The log first: a step is shown as finished only with its lines.
      const lines = ok || !log ? [] : await tail(log);
      Object.assign(state, { running: false, ok, detail: text, finishedAt: iso(), log: lines });
    };
    void work().then(
      (r) => finish(r.ok, r.detail, r.log),
      (e) =>
        finish(
          false,
          e instanceof Problem ? e.message : "The step stopped unexpectedly.",
        ),
    );
    return state;
  };
  const waitFor = async (check: () => Promise<boolean>, seconds: number, stopped?: () => boolean) => {
    for (let i = 0; i < seconds * 2; i++) {
      if (await check()) return true;
      if (stopped?.()) return false;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  };
  const track = (name: string, marker: string, proc: Proc, log: string) => {
    requireThat(proc.pid, "START_FAILED", "The program did not start.", 500);
    started[name] = { pid: proc.pid, startedAt: iso(), marker };
    delete exited[name];
    saveStarted();
    proc.once("exit", (code) => {
      if (started[name]?.pid === proc.pid) {
        delete started[name];
        saveStarted();
      }
      const onPurpose = stopping.delete(name);
      void tail(log).then((lines) => {
        exited[name] = { code, at: iso(), log: lines, onPurpose };
      });
    });
  };
  const findUv = async () => {
    const dirs = [
      ...(deps.env.PATH ?? "").split(delimiter),
      join(deps.env.HOME ?? "", ".local/bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ].filter(Boolean);
    for (const dir of dirs) if (await exists(join(dir, "uv"))) return join(dir, "uv");
    return null;
  };
  const pairOf = (theirs: unknown) => {
    const pair = pairs.find((p) => p.theirs === theirs);
    requireThat(
      pair,
      "UNKNOWN_MACHINE",
      `Choose one of ${pairs.map((p) => p.theirs).join(", ")}.`,
      422,
    );
    return pair;
  };
  const writeProducerEnv = async (name: string, value: string) => {
    const path = join(producerDir, ".env");
    const kept = (await readText(path))
      .split(/\r?\n/)
      .filter((l) => l.trim() && !new RegExp(`^\\s*(export\\s+)?${name}\\s*=`).test(l));
    kept.push(`${name}=${value}`);
    await writeFile(path, kept.join("\n") + "\n", { mode: 0o600 });
    await chmod(path, 0o600);
  };
  const lanOpen = async (theirs: string, host: string) => {
    const cached = lanCache[theirs];
    if (cached && deps.now() - cached.at < 8000) return cached;
    const open = await Promise.all(A1_PORTS.map((p) => deps.reachable(host, p, 1200)));
    return (lanCache[theirs] = { at: deps.now(), open });
  };

  const hubAddress = new URL(hub);
  const hubPort = Number(hubAddress.port || 8000);
  /** Something listens where the hub should be, but does not answer as the hub. */
  const hubPortTaken = () => deps.reachable(hubAddress.hostname, hubPort, 800);
  const onlineCount = (list: any[]) => list.filter((m) => m.status !== "offline").length;
  async function status(req: Request) {
    const local = isLocalRequest(req);
    const at = iso();
    if (!pythonCheck) await checkPython();
    const [listed, state] = await Promise.all([hubMachines(), service.read()]);
    const hubRunning = listed !== null;
    const hubStartedHere = isRunning("hub");
    const portTaken = !hubRunning && (await hubPortTaken());
    const realMachines = service.modeAllowed("hardware") && Boolean(hubUrl);
    const machines = await Promise.all(
      pairs.map(async (pair) => {
        const cfg = await machineConfig(pair.theirs);
        const onHub = listed?.find((m) => m.machine_id === pair.theirs);
        const online = Boolean(onHub && onHub.status !== "offline");
        const running = isRunning(pair.theirs);
        const gone = exited[pair.theirs];
        const program: Row & { running: boolean; online: boolean; startedHere: boolean } = online
          ? {
              light: "ok",
              detail: `Connected to the hub · ${onHub.status}${onHub.detail ? ` · ${onHub.detail}` : ""}.`,
              checkedAt: at,
              running,
              online,
              startedHere: running,
            }
          : running
            ? {
                light: "warn",
                detail: hubRunning
                  ? "Started. Waiting for it to reach the printer and the hub…"
                  : "Running, but the hub does not answer.",
                checkedAt: at,
                running,
                online,
                startedHere: true,
              }
            : {
                light: "bad",
                detail: gone?.onPurpose
                  ? "Stopped from this page."
                  : gone
                  ? `It stopped${gone.code === null ? "" : ` (exit ${gone.code})`}: ${gone.log.at(-1) ?? "no output"}`
                  : "Not running.",
                checkedAt: at,
                running,
                online,
                startedHere: false,
              };
        const check = deviceChecks[pair.theirs];
        let device: Row;
        let host: string | undefined;
        if (pair.link === "lan") {
          host = String(cfg?.adapter?.host ?? "");
          if (!host) device = { light: "unknown", detail: `No printer address in node/machines/${pair.theirs}.json.`, checkedAt: null };
          else {
            const lan = await lanOpen(pair.theirs, host);
            const sameHotspot = !host.startsWith("172.20.10.") || deps.addresses().some((a) => a.startsWith("172.20.10."));
            device = lan.open.every(Boolean)
              ? { light: "ok", detail: `Reachable at ${host} (ports 990 and 8883).`, checkedAt: iso(lan.at) }
              : {
                  light: "bad",
                  detail: sameHotspot
                    ? `Not reachable at ${host} from this Mac (port${lan.open.some(Boolean) ? ` ${A1_PORTS.filter((_, i) => !lan.open[i]).join(", ")}` : "s 990 and 8883"} closed). Is it on and on this network?`
                    : `Not reachable at ${host}: this Mac has no 172.20.10.x address. Join the printer's iPhone hotspot and switch to the PrinterHotspot network Location (producer-side/MAC_NETWORK_SETUP.md).`,
                  checkedAt: iso(lan.at),
                };
          }
          if (discovered) {
            const found = discovered.found[0];
            if (found && host && found.ip !== host)
              device = { light: "warn", detail: `It announced itself at ${found.ip}, but node/machines/${pair.theirs}.json says ${host}. Update the host there.`, checkedAt: discovered.at };
          }
        } else {
          const name = String(cfg?.adapter?.ble_name ?? "");
          const address = String(cfg?.adapter?.ble_address ?? "");
          const seen = scan?.seen.find((d) => (address && d.address === address) || (name && d.name.startsWith(name)));
          device = online
            ? { light: "ok", detail: "Its program reached it over Bluetooth when it started.", checkedAt: at }
            : !scan
              ? { light: "unknown", detail: "Not looked for yet. Find it over Bluetooth.", checkedAt: null }
              : !scan.ok
                ? { light: "unknown", detail: scan.detail, checkedAt: scan.at }
                : seen
                  ? { light: "ok", detail: `Seen nearby over Bluetooth as ${seen.name} (${seen.rssi} dBm).`, checkedAt: scan.at }
                  : { light: "bad", detail: `Not seen nearby${name ? ` (looked for ${name})` : ""}. Switch it on and close its phone app.`, checkedAt: scan.at };
        }
        if (check && (!device.checkedAt || check.at >= device.checkedAt))
          device = { light: check.ok ? "ok" : "bad", detail: check.detail, checkedAt: check.at };
        const ours = state.machines[pair.ours];
        const onOurHub = ours?.producerHub?.machineId === pair.theirs;
        const orders: Row & { onHub: boolean; known: boolean } = !ours
          ? { light: "unknown", detail: `This app has no machine called ${pair.ours}.`, checkedAt: at, onHub: false, known: false }
          : onOurHub
            ? { light: "ok", detail: `Orders for ${ours.name} go to this printer through the hub.`, checkedAt: at, onHub: true, known: true }
            : {
                light: "bad",
                detail: realMachines
                  ? `Orders for ${ours.name} go to the workshop node, not to this printer.`
                  : "The app was started without the hub. Restart it with npm run mvp to send orders here.",
                checkedAt: at,
                onHub: false,
                known: true,
              };
        return {
          ours: pair.ours,
          theirs: pair.theirs,
          name: pair.name,
          link: pair.link,
          threeD: pair.threeD,
          ...(host ? { host } : {}),
          program,
          device,
          ...(pair.link === "lan" ? { accessCode: await accessCode(pair).then(({ present, fromEnvName }) => ({ present, fromEnvName })) } : {}),
          orders,
        };
      }),
    );
    return {
      local,
      app: {
        realMachines,
        light: (realMachines ? "ok" : "warn") as Light,
        detail: realMachines
          ? `Real printers are on. Orders can go through the hub at ${hub}.`
          : "The app is running its workshop node only. Restart it with npm run mvp to send orders to the real printers.",
        checkedAt: at,
      },
      python: pythonCheck ?? { ready: false, light: "unknown" as Light, detail: "Checking…", checkedAt: null },
      hub: {
        url: hub,
        running: hubRunning,
        startedHere: hubStartedHere,
        light: (hubRunning ? "ok" : "bad") as Light,
        detail: hubRunning
          ? `Answers at ${hub} · ${onlineCount(listed!)} printer program${onlineCount(listed!) === 1 ? "" : "s"} connected.`
          : exited.hub?.onPurpose
            ? "Stopped from this page."
            : exited.hub
            ? `It stopped${exited.hub.code === null ? "" : ` (exit ${exited.hub.code})`}: ${exited.hub.log.at(-1) ?? "no output"}`
            : portTaken
              ? `Another program, not the hub, uses port ${hubPort}. Stop it, or set FABYN_PRODUCER_HUB_URL to a free port and restart the app.`
              : `Nothing answers at ${hub}.`,
        checkedAt: at,
      },
      machines,
      scan: scan && { at: scan.at, ok: scan.ok, detail: scan.detail, seen: scan.seen.length },
      actions,
    };
  }

  app.get("/api/owner/mvp/status", async (req, res) => {
    await owner(req);
    res.json(await status(req));
  });

  app.post("/api/owner/mvp/steps/:step", async (req, res) => {
    await owner(req);
    requireThat(
      isLocalRequest(req),
      "OPEN_ON_THIS_MAC",
      "Open the seller page on the Mac that runs fabyn to start programs or set codes.",
      403,
    );
    const step = String(req.params.step);
    const body = req.body ?? {};
    const reply = (state: ActionState) => res.status(202).json({ step: state });
    switch (step) {
      case "install-python":
        return reply(
          background("install-python", "Installing the printer programs' Python…", async () => {
            const log = logPath("python-install");
            const uv = await findUv();
            const steps: [string, string[]][] = uv
              ? [
                  ...((await exists(python)) ? [] : [[uv, ["venv", "--python", "3.12", ".venv"]] as [string, string[]]]),
                  [uv, ["pip", "install", "--python", ".venv/bin/python", "-r", "requirements.txt"]],
                ]
              : [
                  ...((await exists(python)) ? [] : [["python3", ["-m", "venv", ".venv"]] as [string, string[]]]),
                  [python, ["-m", "pip", "install", "-r", "requirements.txt"]],
                ];
            for (const [command, args] of steps) {
              const r = await deps.run(command, args, { cwd: producerDir, log, timeoutMs: 600_000 });
              if (r.code !== 0) return { ok: false, detail: "The install did not finish.", log };
            }
            pythonCheck = null;
            await checkPython();
            return pythonCheck!.ready
              ? { ok: true, detail: "Installed. Every printer library loads." }
              : { ok: false, detail: pythonCheck!.detail, log: logPath("python-check") };
          }),
        );
      case "check-python":
        return reply(
          background("check-python", "Checking the printer libraries…", async () => {
            pythonCheck = null;
            await checkPython();
            return { ok: pythonCheck!.ready, detail: pythonCheck!.detail, log: logPath("python-check") };
          }),
        );
      case "start-hub": {
        idle("start-hub");
        requireThat(pythonCheck?.ready, "PYTHON_NOT_READY", "Install the printer programs' Python first.", 409);
        requireThat(!(await hubMachines()), "HUB_RUNNING", "The hub is already running.", 409);
        requireThat(
          !(await hubPortTaken()),
          "HUB_PORT_TAKEN",
          `Another program uses port ${hubPort}. Stop it, or set FABYN_PRODUCER_HUB_URL to a free port and restart the app.`,
          409,
        );
        requireThat(!isRunning("hub"), "HUB_STARTING", "The hub is already starting.", 409);
        const log = logPath("hub");
        track("hub", "hub.dev_server", deps.start(python, hubArgs(hub), { cwd: producerDir, log }), log);
        return reply(
          background("start-hub", "Starting the hub…", async () =>
            (await waitFor(async () => (await hubMachines()) !== null, 20, () => !isRunning("hub")))
              ? { ok: true, detail: `The hub answers at ${hub}.` }
              : { ok: false, detail: "The hub did not answer.", log },
          ),
        );
      }
      case "stop-hub": {
        requireThat(isRunning("hub"), "NOT_STARTED_HERE", "This hub was not started from this page. Stop it where it was started.", 409);
        stopping.add("hub");
        deps.stop(started.hub.pid);
        return reply(
          background("stop-hub", "Stopping the hub…", async () =>
            (await waitFor(async () => !isRunning("hub"), 10))
              ? { ok: true, detail: "The hub stopped." }
              : { ok: false, detail: "The hub is still running." },
          ),
        );
      }
      case "start-node": {
        const pair = pairOf(body.machine);
        idle(`start-node:${pair.theirs}`);
        requireThat(pythonCheck?.ready, "PYTHON_NOT_READY", "Install the printer programs' Python first.", 409);
        const listed = await hubMachines();
        requireThat(listed, "HUB_NOT_RUNNING", "Start the hub first.", 409);
        requireThat(
          !listed.some((m) => m.machine_id === pair.theirs && m.status !== "offline"),
          "NODE_ONLINE",
          "Its program is already connected to the hub.",
          409,
        );
        requireThat(!isRunning(pair.theirs), "NODE_STARTING", "Its program is already starting.", 409);
        if (pair.link === "lan")
          requireThat((await accessCode(pair)).present, "ACCESS_CODE_MISSING", "Set the printer's LAN access code first.", 409);
        const log = logPath(pair.theirs);
        const args = nodeArgs(pair.theirs, hub, { plateCleared: pair.threeD && body.plateCleared === true });
        track(pair.theirs, "node.client", deps.start(python, args, { cwd: producerDir, log }), log);
        return reply(
          background(`start-node:${pair.theirs}`, "Starting its program and reaching the printer…", async () => {
            // A Bluetooth probe can take three tries.
            const ok = await waitFor(
              async () => Boolean((await hubMachines())?.some((m) => m.machine_id === pair.theirs && m.status !== "offline")),
              150,
              () => !isRunning(pair.theirs),
            );
            return ok
              ? { ok: true, detail: "Its program reached the printer and joined the hub." }
              : {
                  ok: false,
                  detail: "Its program stopped before joining the hub. Is the printer on, and not connected to a phone?",
                  log,
                };
          }),
        );
      }
      case "stop-node": {
        const pair = pairOf(body.machine);
        requireThat(isRunning(pair.theirs), "NOT_STARTED_HERE", "This program was not started from this page. Stop it where it was started.", 409);
        stopping.add(pair.theirs);
        deps.stop(started[pair.theirs].pid);
        return reply(
          background(`stop-node:${pair.theirs}`, "Stopping its program…", async () =>
            (await waitFor(async () => !isRunning(pair.theirs), 10))
              ? { ok: true, detail: "Its program stopped." }
              : { ok: false, detail: "Its program is still running." },
          ),
        );
      }
      case "find-device": {
        const pair = pairOf(body.machine);
        requireThat(pythonCheck?.ready, "PYTHON_NOT_READY", "Install the printer programs' Python first.", 409);
        if (pair.link === "lan")
          return reply(
            background(`find-device:${pair.theirs}`, "Listening for the printer on this network…", async () => {
              const log = logPath("discover");
              const r = await deps.run(python, ["-m", "node.tools.bambu", "discover", "--timeout", "8"], { cwd: producerDir, log, timeoutMs: 30_000 });
              const found = [...r.output.matchAll(/^(\d+\.\d+\.\d+\.\d+)\s+(\S+)\s+model/gm)].map((m) => ({ ip: m[1], serial: m[2] }));
              discovered = { at: iso(), ok: r.code === 0, found };
              return found.length
                ? { ok: true, detail: `It announced itself at ${found.map((f) => f.ip).join(", ")}.` }
                : { ok: false, detail: "No Bambu printer announced itself in 8 s. Is this Mac on the printer's network?", log };
            }),
          );
        return reply(
          background("find-device:ble", "Looking for printers over Bluetooth…", async () => {
            const log = logPath("ble-scan");
            const r = await deps.run(python, ["-m", "node.tools.scan_ble", "--timeout", "8"], { cwd: producerDir, log, timeoutMs: 40_000 });
            const seen = [...r.output.matchAll(/^\s*(-?\d+) dBm\s+(\S+)\s+(.+?)\s*$/gm)].map((m) => ({ rssi: Number(m[1]), address: m[2], name: m[3] }));
            scan =
              r.code === 0
                ? { at: iso(), ok: true, detail: `${seen.length} named device${seen.length === 1 ? "" : "s"} nearby.`, seen }
                : { at: iso(), ok: false, detail: "The Bluetooth scan did not run. Is Bluetooth on, and may this app use it?", seen: [] };
            return scan.ok ? { ok: true, detail: scan.detail } : { ok: false, detail: scan.detail, log };
          }),
        );
      }
      case "test-device": {
        const pair = pairOf(body.machine);
        const listed = await hubMachines();
        const online = Boolean(listed?.some((m) => m.machine_id === pair.theirs && m.status !== "offline"));
        if (!online && pair.link === "ble")
          throw new Problem("START_PROGRAM_FIRST", "Start its program first; the program checks the printer.", 409);
        if (!online) {
          requireThat(pythonCheck?.ready, "PYTHON_NOT_READY", "Install the printer programs' Python first.", 409);
          requireThat((await accessCode(pair)).present, "ACCESS_CODE_MISSING", "Set the printer's LAN access code first.", 409);
        }
        return reply(
          background(`test-device:${pair.theirs}`, "Asking the printer to answer (it prints nothing)…", async () => {
            let result: { ok: boolean; detail: string; log?: string };
            if (online) {
              try {
                const r = await deps.fetch(`${hub}/dev/check`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ machine_id: pair.theirs }),
                  signal: AbortSignal.timeout(100_000),
                });
                const answer = (await r.json()) as { ok?: boolean; detail?: string };
                // The node's own words, unless they only repeat the verdict.
                const said = answer.detail && !/^(answered|ok|no answer)\.?$/i.test(answer.detail.trim()) ? `: ${answer.detail}` : ".";
                result = { ok: answer.ok === true, detail: `${answer.ok === true ? "It answered" : "No answer"}${said}` };
              } catch {
                result = { ok: false, detail: "The hub did not pass the check on." };
              }
            } else {
              // MQTT status read only: state, filament, temperatures.
              const log = logPath("a1-status");
              const r = await deps.run(python, ["-m", "node.tools.bambu", "status"], { cwd: producerDir, log, timeoutMs: 45_000 });
              const first = redact(r.output.split(/\r?\n/).filter((l) => l.trim()), await secrets())[0] ?? "";
              result = r.code === 0 ? { ok: true, detail: `It answered: ${first}` } : { ok: false, detail: "It did not answer its status request.", log };
            }
            deviceChecks[pair.theirs] = { ok: result.ok, detail: result.detail, at: iso() };
            return result;
          }),
        );
      }
      case "copy-access-code": {
        const pair = pairOf(body.machine);
        requireThat(pair.link === "lan", "NO_ACCESS_CODE", "Only the A1 mini uses an access code.", 422);
        const { name } = await accessCode(pair);
        const root = parseEnv(await readText(join(deps.root, ".env")));
        const from = ACCESS_CODE_NAMES.find((n) => root[n]);
        requireThat(
          from && ACCESS_CODE.test(root[from]),
          "NO_CODE_IN_ENV",
          "No usable access code in .env. Type the one on the printer screen (Settings › WLAN).",
          409,
        );
        await writeProducerEnv(name, root[from]);
        return res.json({ ok: true, detail: `Copied ${from} from .env to producer-side/.env as ${name}. Restart its program to use it.` });
      }
      case "set-access-code": {
        const pair = pairOf(body.machine);
        requireThat(pair.link === "lan", "NO_ACCESS_CODE", "Only the A1 mini uses an access code.", 422);
        const code = body.code;
        requireThat(
          typeof code === "string" && ACCESS_CODE.test(code),
          "INVALID_ACCESS_CODE",
          "Type the access code from the printer screen: letters and digits only.",
          422,
        );
        const { name } = await accessCode(pair);
        await writeProducerEnv(name, code);
        return res.json({ ok: true, detail: `Saved to producer-side/.env as ${name}. Restart its program to use it.` });
      }
      default:
        throw new Problem("UNKNOWN_STEP", "That setup step does not exist.", 404);
    }
  });
}
