import { spawn } from "node:child_process";
const checks = [
  ["backend", ["npm", "run", "typecheck"]],
  ["application", ["npm", "test"]],
  [
    "node",
    [
      "uv",
      "run",
      "--project",
      "node",
      "--extra",
      "hardware",
      "pytest",
      "-q",
      "node/tests",
    ],
  ],
  ["integrations", ["npm", "--prefix", "integrations", "run", "typecheck"]],
  ["payments/Claude", ["npm", "--prefix", "integrations", "test"]],
  [
    "Fetch",
    [
      "uv",
      "run",
      "--project",
      "integrations/fetch",
      "pytest",
      "-q",
      "integrations/fetch/test_bridge.py",
    ],
  ],
  ["web", ["npm", "--prefix", "web", "run", "build"]],
  ["wallet", ["npm", "--prefix", "web", "run", "test:unit"]],
];
let failures = 0;
for (const [name, [cmd, ...args]] of checks) {
  console.log(`\nChecking ${name}`);
  const code = await new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("error", () => resolve(1));
    p.on("exit", (code) => resolve(code ?? 1));
  });
  if (code !== 0) {
    failures++;
    console.error(`${name} failed (${code})`);
  }
}
if (failures) process.exitCode = 1;
