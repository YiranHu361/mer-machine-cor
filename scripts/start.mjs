import "dotenv/config";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
const credentials = JSON.parse(
  await readFile(".data/local-credentials.json", "utf8"),
);
const env = {
  ...process.env,
  FABRARY_NODE_KEY: process.env.FABRARY_NODE_KEY ?? credentials.nodeKey,
  FABRARY_TOKEN_SECRET: process.env.FABRARY_TOKEN_SECRET ?? credentials.secret,
  FABRARY_ASSET_ORIGIN:
    process.env.FABRARY_ASSET_ORIGIN ?? "http://127.0.0.1:4318/assets",
};
const children = [
  spawn("uv", ["run", "--project", "node", "fabrary-node"], {
    stdio: "inherit",
    env,
  }),
  spawn(process.execPath, ["--import", "tsx", "server/main.ts"], {
    stdio: "inherit",
    env,
  }),
];
for (const child of children)
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(
        `A required local service exited (${code}). Stopping the other service.`,
      );
      stop();
    }
  });
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(), 2500).unref();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
