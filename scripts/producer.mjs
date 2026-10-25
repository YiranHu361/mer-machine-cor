import { spawn } from "node:child_process";
const child = spawn(
  ".venv/bin/python",
  ["-m", "hub.cloud", ...process.argv.slice(2)],
  {
    cwd: new URL("../producer-side/", import.meta.url),
    stdio: "inherit",
    env: process.env,
  },
);
child.on("error", () => {
  console.error("Set up producer-side/.venv first; see docs/deployment.md.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
