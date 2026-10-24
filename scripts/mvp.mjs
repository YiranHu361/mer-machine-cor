// The sticker MVP in one command: someone types "i want a sticker", adds a
// picture, and the Phomemo M02 Pro prints it. Starts the producer side's hub
// and the sticker node, builds and starts this app, then moves the Sticker
// counter onto the hub. Every screen's live view comes from Convex when the
// .env names a deployment (see npm run convex:push).
//
// Usage: npm run mvp [-- --dry-run] [-- --no-build]
//   --dry-run   the node writes the printer bytes and a preview under
//               producer-side/.work/ instead of printing
//   --no-build  reuse the existing web build
//
// Moving the machine onto the hub records the owner's confirmation of a good
// test print (node.tools.run_job, see producer-side/README.md). Run one first.
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const port = Number(process.env.PORT ?? 4318);
const app = `http://127.0.0.1:${port}`;
const hub = (
  process.env.FABRARY_PRODUCER_HUB_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");
const producerMachine = process.env.FABRARY_MVP_PRODUCER_MACHINE ?? "m_sticker_01";
const ourMachine = process.env.FABRARY_MVP_MACHINE ?? "phomemo_01";
const deployment = /^(?:dev|prod):([a-z0-9-]+)\|/.exec(
  process.env.CONVEX_DEPLOY_KEY ?? "",
)?.[1];
const convexUrl =
  process.env.CONVEX_URL ||
  (deployment ? `https://${deployment}.convex.cloud` : "");
const env = {
  ...process.env,
  FABRARY_ALLOWED_MODES:
    process.env.FABRARY_ALLOWED_MODES ?? "hardware,simulation",
  FABRARY_PRODUCER_HUB_URL: hub,
  ...(convexUrl ? { CONVEX_URL: convexUrl } : {}),
};
const python = "producer-side/.venv/bin/python";

if (!args.includes("--no-build")) {
  console.log("• Building the web app");
  const build = spawnSync("npm", ["run", "build"], { stdio: "inherit", env });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const children = [];
const start = (name, command, argv, options = {}) => {
  const child = spawn(command, argv, { stdio: "inherit", env, ...options });
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`${name} exited (${code}). Stopping the others.`);
      stop(1);
    }
  });
  children.push(child);
};
const hubPort = new URL(hub).port || "8000";
start("The producer side's hub", "../" + python, ["-m", "hub.dev_server", "--host", "127.0.0.1", "--port", hubPort], { cwd: "producer-side" });
start(
  "The sticker node",
  "../" + python,
  [
    "-m",
    "node.client",
    "--machine",
    `node/machines/${producerMachine}.json`,
    "--hub",
    hub,
    ...(dryRun ? ["--transport", "file"] : []),
  ],
  { cwd: "producer-side" },
);
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
await wait(
  `${producerMachine} to connect to the hub`,
  async () =>
    (await (await fetch(`${hub}/machines`)).json()).some(
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
const ours = dashboard.machines?.find((m) => m.id === ourMachine);
if (ours?.producerHub?.machineId === producerMachine)
  console.log(
    `• ${ourMachine} already prints through the producer side's hub as ${producerMachine}.`,
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
      ? `• ${ourMachine} now prints through the producer side's hub as ${producerMachine}${dryRun ? " (dry run: no paper)" : ""}.`
      : `• ${ourMachine} was not moved onto the hub: ${(await switched.text()).slice(0, 200)}`,
  );
}
const waiting = (dashboard.jobs ?? []).filter(
  (j) => j.machineId === ourMachine && j.productionState === "needs_review",
);
if (waiting.length)
  console.log(
    `• ${waiting.length} print${waiting.length > 1 ? "s are" : " is"} waiting for your check, so the printer takes no new order yet.\n` +
      `  Open ${app}/owner (owner code: ownerCode in ${process.env.FABRARY_DATA_DIR ?? ".data"}/local-credentials.json), find the order\n` +
      `  and press "Printed fine · approve and free the printer".`,
  );
console.log(
  `\nReady. Open ${app}/make, type "i want a sticker", add a picture and press Start.\n` +
    `Tick the permission box, then "Pay & make" (mock payment).\n` +
    `After each print, approve it in ${app}/owner so the printer takes the next order.` +
    (convexUrl
      ? `\nLive view from Convex: ${app}/live`
      : `\nLive view is off: set CONVEX_URL or the full CONVEX_DEPLOY_KEY in .env, then npm run convex:push.`),
);
