import "dotenv/config";
import { integrationDiagnostics } from "../integrations/src/diagnostics.ts";
import { readFile } from "node:fs/promises";
const diagnostics = integrationDiagnostics();
let application: any;
try {
  application = await (
    await fetch("http://127.0.0.1:4318/api/health", {
      signal: AbortSignal.timeout(1500),
    })
  ).json();
} catch {
  application = { status: "NOT_RUNNING" };
}
let configuredDevices = 0;
try {
  const parsed = JSON.parse(
    await readFile(process.env.FABYN_MACHINES_FILE ?? "", "utf8"),
  );
  configuredDevices = (Array.isArray(parsed) ? parsed : parsed.machines).length;
} catch {}
console.log(
  JSON.stringify(
    {
      at: new Date().toISOString(),
      application,
      integrations: diagnostics,
      hardware: {
        configuredDevices,
        status: configuredDevices
          ? "CONFIGURATION_PRESENT_NOT_ACCEPTED"
          : "BLOCKED",
        missing: configuredDevices
          ? []
          : [
              "Private team-device config, paired links, media and explicit owner readiness",
            ],
      },
      notes:
        "Configuration is not live acceptance. See docs/test-report.md for tests actually executed.",
    },
    null,
    2,
  ),
);
