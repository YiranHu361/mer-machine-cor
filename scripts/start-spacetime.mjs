import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
const runtime = resolve(".data/spacetime-runtime");
const local = resolve(runtime, "spacetime");
const binary =
  process.env.FABYN_SPACETIME_CLI ??
  (existsSync(local) ? local : "spacetime");
const args = [
  ...(binary === local ? [`--root-dir=${runtime}`] : []),
  "start",
  "--listen-addr",
  "127.0.0.1:3002",
  "--data-dir",
  resolve(runtime, "data"),
  "--non-interactive",
];
const child = spawn(binary, args, { stdio: "inherit" });
child.on("error", () => {
  console.error(
    "SpacetimeDB CLI unavailable. Install pinned 2.13.0 using the official instructions in docs/demo-runbook.md.",
  );
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
