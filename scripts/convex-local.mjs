// Convex on this computer, no account (npm run convex:local). Data stays in the
// ignored .convex/ folder.
//
// In anonymous mode the Convex CLI asks version.convex.dev for the latest
// backend on every start and stops with "Failed to fetch latest backend
// version" when that request fails, even with a backend already downloaded.
// Once a local deployment exists, start the backend version it was made with
// instead, so a flaky network never stops it.
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

let version;
try {
  version = JSON.parse(
    readFileSync(".convex/local/default/config.json", "utf8"),
  ).backendVersion;
} catch {}

const child = spawn(
  "node_modules/.bin/convex",
  [
    "dev",
    ...(version ? ["--local-backend-version", version] : []),
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    // The deploy key in .env is for the cloud deployment (npm run convex:push);
    // the CLI refuses to run locally while it is set.
    env: { ...process.env, CONVEX_DEPLOY_KEY: "", CONVEX_AGENT_MODE: "anonymous" },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
