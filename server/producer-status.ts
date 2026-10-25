import type { State } from "./model.ts";
import { printerPairs } from "./mvp-plan.ts";
import {
  PRODUCER_STALE_MS,
  type ProducerConnection,
  type PrinterConnection,
} from "../shared/connection-status.ts";

/** Observations come from the Mac; reading this endpoint never invents a fresh device check. */
export function producerConnection(
  state: State,
  now = Date.now(),
): ProducerConnection {
  const reports = state.producer?.machines ?? {};
  const times = Object.values(reports).map((m) => m.lastSeen);
  return {
    lastSeen: times.length ? new Date(Math.max(...times)).toISOString() : null,
    printers: printerPairs().map((pair): PrinterConnection => {
      const report = reports[pair.theirs];
      const machine = state.machines[pair.ours];
      const online = !!report && now - report.lastSeen <= PRODUCER_STALE_MS;
      const status = !online
        ? "offline"
        : /checking the printer connection/i.test(report.detail ?? "")
          ? "checking"
          : report.status === "error"
            ? "attention"
            : report.status === "busy"
              ? "busy"
              : "connected";
      return {
        id: pair.ours,
        name: machine?.name ?? pair.name,
        model: machine?.model ?? pair.name,
        makes: pair.threeD
          ? "3D prints"
          : pair.theirs === "m_photo_01"
            ? "Photo prints"
            : "Stickers",
        status,
        detail: !online
          ? "No recent producer heartbeat. Start npm run producer on the machine computer."
          : report.detail ||
            (status === "busy"
              ? "Printer is busy."
              : "Printer answered its producer's check."),
        checkedAt:
          typeof report?.checked_at === "string" ? report.checked_at : null,
        lastSeen: report ? new Date(report.lastSeen).toISOString() : null,
        linked: machine?.producerHub?.machineId === pair.theirs,
      };
    }),
  };
}
