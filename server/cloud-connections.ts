import type { Express, Request } from "express";
import { requireThat } from "./model.ts";
import type { Service } from "./service.ts";
import type { CloudProducer } from "./cloud-producer.ts";
import { printerPairs } from "./mvp-plan.ts";

/** Keep main's Connections panel, with observations from the Mac rather than Vercel's filesystem. */
export function registerCloudConnections(
  app: Express,
  service: Service,
  producer: CloudProducer,
  owner: (req: Request) => Promise<unknown>,
) {
  app.get("/api/owner/mvp/status", async (req, res) => {
    await owner(req);
    const state = await service.read(),
      machines = await producer.machines();
    const at = new Date().toISOString();
    const row = (ok: boolean, detail: string) => ({
      light: ok ? "ok" : "bad",
      detail,
      checkedAt: at,
    });
    const online = machines.some((m) => m.status !== "offline");
    res.json({
      cloud: true,
      local: false,
      actions: {},
      scan: null,
      app: {
        ...row(true, "Ordering and AI orchestration run on Vercel."),
        realMachines: true,
      },
      python: {
        ...row(
          online,
          online
            ? "The local producer is connected."
            : "Run npm run producer on the machine computer.",
        ),
        ready: online,
      },
      hub: {
        ...row(
          online,
          online
            ? "The local producer receives work through its outbound cloud connection."
            : "Waiting for the local producer to connect.",
        ),
        running: online,
        startedHere: false,
        url: "outbound HTTPS",
      },
      machines: printerPairs().map((pair) => {
        const m = machines.find((m) => m.machine_id === pair.theirs),
          connected = !!m && m.status !== "offline";
        const linked =
          state.machines[pair.ours]?.producerHub?.machineId === pair.theirs;
        return {
          ...pair,
          program: {
            ...row(
              connected,
              connected
                ? "Connected from the machine computer."
                : "No recent heartbeat from this printer's program.",
            ),
            running: connected,
            online: connected,
            startedHere: false,
          },
          device: row(
            connected && m!.status !== "error",
            m?.detail ||
              (connected
                ? `Producer reports ${m!.status}.`
                : "Check the printer and producer on the machine computer."),
          ),
          orders: {
            ...row(
              linked,
              linked
                ? "Orders are queued for this local printer."
                : "Confirm a successful test print to use this printer for orders.",
            ),
            onHub: linked,
            known: !!state.machines[pair.ours],
          },
        };
      }),
    });
  });
  app.post("/api/owner/mvp/steps/:step", async (req, res) => {
    await owner(req);
    requireThat(
      req.params.step === "test-device",
      "LOCAL_PRODUCER_REQUIRED",
      "Run setup and device configuration on the machine computer, then start npm run producer.",
      409,
    );
    const machine = String(req.body?.machine ?? "");
    requireThat(
      printerPairs().some((p) => p.theirs === machine),
      "UNKNOWN_MACHINE",
      "Choose a configured printer.",
      422,
    );
    const result = await producer.check(machine);
    res.json({ detail: result.detail, ok: result.ok });
  });
}
