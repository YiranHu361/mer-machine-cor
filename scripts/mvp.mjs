// The MVP in one command: someone types "i want a sticker" and adds a picture,
// and the Phomemo M02 Pro prints it; or someone types a name, and the Bambu
// Lab A1 mini prints a name tag (OpenSCAD makes the model, the A1 mini's node
// slices it with Bambu Studio). Starts the producer side's hub and both nodes,
// builds and starts this app, then moves the Sticker and Model counters onto
// the hub. Every screen's live view comes from Convex when the .env names a
// deployment (see npm run convex:push).
//
// Usage: npm run mvp [-- --dry-run] [-- --no-build] [-- --plate-cleared] [-- --no-3d]
//   --dry-run        the nodes write the printer files under producer-side/.work/
//                    instead of printing
//   --no-build       reuse the existing web build
//   --plate-cleared  the A1 mini's build plate is empty, even if the printer
//                    still shows its last print as finished
//   --no-3d          leave the A1 mini out (stickers only)
//
// Moving a machine onto the hub records the owner's confirmation of a good
// test print (node.tools.run_job / node.tools.bambu, see producer-side/README.md).
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const with3d = !args.includes("--no-3d");
const port = Number(process.env.PORT ?? 4318);
const app = `http://127.0.0.1:${port}`;
const hub = (
  process.env.FABRARY_PRODUCER_HUB_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");
// [our machine id, the producer side's machine id, what it makes]
const counters = [
  [
    process.env.FABRARY_MVP_MACHINE ?? "phomemo_01",
    process.env.FABRARY_MVP_PRODUCER_MACHINE ?? "m_sticker_01",
    "stickers",
  ],
  ...(with3d
    ? [
        [
          process.env.FABRARY_MVP_3D_MACHINE ?? "bambu_01",
          process.env.FABRARY_MVP_3D_PRODUCER_MACHINE ?? "m_fdm_01",
          "name tags",
        ],
      ]
    : []),
];
const deployment = /^(?:dev|prod):([a-z0-9-]+)\|/.exec(
  process.env.CONVEX_DEPLOY_KEY ?? "",
)?.[1];
const convexUrl =
  process.env.CONVEX_URL ||
  (deployment ? `https://${deployment}.convex.cloud` : "");
const env = {
  ...process.env,
  // Real machines only: an order never lands on a simulated machine.
  FABRARY_ALLOWED_MODES: process.env.FABRARY_ALLOWED_MODES ?? "hardware",
  FABRARY_PRODUCER_HUB_URL: hub,
  // No camera check yet: a finished sticker completes the order and frees the
  // printer. A 3D print always waits for the owner to take it off the plate.
  FABRARY_AUTO_ACCEPT_PRINTS: process.env.FABRARY_AUTO_ACCEPT_PRINTS ?? "1",
  ...(convexUrl ? { CONVEX_URL: convexUrl } : {}),
};
const python = "producer-side/.venv/bin/python";

if (!args.includes("--no-build")) {
  console.log("• Building the web app");
  const build = spawnSync("npm", ["run", "build"], { stdio: "inherit", env });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const children = [];
const start = (name, command, argv, options = {}, hint = "") => {
  const child = spawn(command, argv, { stdio: "inherit", env, ...options });
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`${name} exited (${code}). Stopping the others.${hint}`);
      stop(1);
    }
  });
  children.push(child);
};
const hubPort = new URL(hub).port || "8000";
start("The producer side's hub", "../" + python, ["-m", "hub.dev_server", "--host", "127.0.0.1", "--port", hubPort], { cwd: "producer-side" });
for (const [, producerMachine, makes] of counters) {
  const printer = makes === "name tags";
  start(
    `The ${makes} node`,
    "../" + python,
    [
      "-m",
      "node.client",
      "--machine",
      `node/machines/${producerMachine}.json`,
      "--hub",
      hub,
      ...(dryRun ? ["--transport", "file"] : []),
      // The A1 mini is checked once at start: reachable, and its plate empty.
      ...(printer ? ["--probe"] : []),
      ...(printer && args.includes("--plate-cleared") ? ["--plate-cleared"] : []),
    ],
    { cwd: "producer-side" },
    printer
      ? "\n  Could not reach the A1 mini. Is it on, in LAN mode, and is this Mac on its network" +
          " (producer-side/MAC_NETWORK_SETUP.md)?\n  Check with: cd producer-side && .venv/bin/python -m node.tools.bambu status" +
          "\n  Or start without it: npm run mvp -- --no-3d"
      : "",
  );
}
start("The app", process.execPath, ["--import", "tsx", "server/main.ts"]);

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 2500).unref();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());

const wait = async (what, check, seconds = 60) => {
  for (let i = 0; i < seconds * 2; i++) {
    if (stopping) throw new Error(what);
    try {
      if (await check()) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`Gave up waiting for ${what}.`);
  stop(1);
  throw new Error(what);
};
await wait("the app", async () => (await fetch(`${app}/api/health`)).ok);
const hubMachines = async () => (await fetch(`${hub}/machines`)).json();
for (const [, producerMachine] of counters)
  await wait(`${producerMachine} to connect to the hub`, async () =>
    (await hubMachines()).some(
      (m) => m.machine_id === producerMachine && m.status !== "offline",
    ),
  );
const { ownerCode } = JSON.parse(
  await readFile(
    `${process.env.FABRARY_DATA_DIR ?? ".data"}/local-credentials.json`,
    "utf8",
  ),
);
const login = await fetch(`${app}/api/session`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    role: "owner",
    accessCode: process.env.FABRARY_OWNER_CODE ?? ownerCode,
  }),
});
const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
const dashboard = await (
  await fetch(`${app}/api/owner/dashboard`, { headers: { cookie } })
).json();
for (const [ourMachine, producerMachine, makes] of counters) {
  const ours = dashboard.machines?.find((m) => m.id === ourMachine);
  if (ours?.producerHub?.machineId === producerMachine)
    console.log(
      `• ${ourMachine} already prints ${makes} through the producer side's hub as ${producerMachine}.`,
    );
  else {
    const switched = await fetch(
      `${app}/api/owner/machines/${ourMachine}/producer-hub`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          producerMachineId: producerMachine,
          confirmTestPrint: true,
        }),
      },
    );
    console.log(
      switched.ok
        ? `• ${ourMachine} now prints ${makes} through the producer side's hub as ${producerMachine}${dryRun ? " (dry run: nothing is printed)" : ""}.`
        : `• ${ourMachine} was not moved onto the hub: ${(await switched.text()).slice(0, 200)}`,
    );
  }
  const waiting = (dashboard.jobs ?? []).filter(
    (j) => j.machineId === ourMachine && j.productionState === "needs_review",
  );
  if (waiting.length)
    console.log(
      `• ${waiting.length} ${makes} print${waiting.length > 1 ? "s are" : " is"} waiting for your check, so ${ourMachine} takes no new order yet.\n` +
        `  Open ${app}/owner (owner code: ownerCode in ${process.env.FABRARY_DATA_DIR ?? ".data"}/local-credentials.json), find the order\n` +
        `  and press "Printed fine · approve and free the printer".`,
    );
}
const plate = with3d
  ? (await hubMachines()).find((m) => m.machine_id === counters[1][1])
  : undefined;
if (plate?.detail?.startsWith("plate_not_cleared"))
  console.log(
    `• The A1 mini says its last print is still on the plate. Take it off, then restart with\n` +
      `  npm run mvp -- --plate-cleared  (or resume ${counters[1][0]} in ${app}/owner after inspecting it).`,
  );
console.log(
  `\nReady. Open ${app}/make.\n` +
    `  Sticker: type "i want a sticker", add a picture and press Start.\n` +
    (with3d
      ? `  Name tag: type a name under "Or make a name tag" and press "Make a name tag".\n`
      : "") +
    `Tick the permission box, then "Pay & make" (mock payment).\n` +
    (env.FABRARY_AUTO_ACCEPT_PRINTS === "1"
      ? `Camera check is off: a finished sticker completes the order and frees the printer.`
      : `After each print, approve it in ${app}/owner so the printer takes the next order.`) +
    (with3d
      ? `\nA name tag waits on the plate: take it off, then press "Printed fine · approve and free the printer"\n` +
        `in ${app}/owner. That completes the order and tells the A1 mini its plate is clear.`
      : "") +
    (convexUrl
      ? `\nLive view from Convex: ${app}/live`
      : `\nLive view is off: set CONVEX_URL or the full CONVEX_DEPLOY_KEY in .env, then npm run convex:push.`),
);
