// Plain-language state for machines and jobs, derived from the real owner API fields.
import type { Connector, OwnerJob, OwnerMachine } from "./data";

export type MachineKey = "available" | "printing" | "paused" | "attention" | "offline" | "unlisted";

export const MACHINE_LABEL: Record<MachineKey, string> = {
  available: "Available",
  printing: "Printing",
  paused: "Paused",
  attention: "Needs attention",
  offline: "Offline",
  unlisted: "Not listed",
};

/** A failed run the maker already cleared. */
export function recovered(job: OwnerJob): boolean {
  return job.productionState === "failed" && (job.history ?? []).some((e) => e.event === "owner_recovery");
}

/** Jobs whose machine is waiting on the maker (review, handling or a failed run not cleared yet). */
export function needsMaker(job: OwnerJob): boolean {
  return needsHandling(job) || job.productionState === "needs_review" || (job.productionState === "failed" && !recovered(job));
}

const DONE_FULFILLMENT = ["ready_for_pickup", "collected", "simulation_complete"];

export function needsHandling(job: OwnerJob): boolean {
  return job.productionState === "produced" && !DONE_FULFILLMENT.includes(job.fulfillmentState);
}
export function waitingPickup(job: OwnerJob): boolean {
  return job.fulfillmentState === "ready_for_pickup";
}
export function finished(job: OwnerJob): boolean {
  return job.productionState === "cancelled" || recovered(job) || job.fulfillmentState === "collected" || job.fulfillmentState === "simulation_complete";
}

/** Server wording is for operators; machines that run on the local node are just "local" on screen. */
export function plain(text: string): string {
  return text
    .replace(/\bSimulated\b/g, "Local")
    .replace(/\bsimulated\b/gi, "local")
    .replace(/\bsimulation\b/gi, "local run")
    .replace(/\bdemo\b/gi, "local");
}

/** Why a job stopped, in the maker's words, from the job's own history. */
export function stopReason(job: OwnerJob): string | null {
  if (!["failed", "needs_review"].includes(job.productionState)) return null;
  const last = [...(job.history ?? [])].reverse().find((e) => e.reason && !["owner_recovery", "operator_override"].includes(e.event));
  if (!last) return null;
  if (/time limit/i.test(last.reason)) return "The print is longer than this machine’s time limit, so it never started. Nothing was printed.";
  if (/uncertain/i.test(last.reason)) return "The machine did not confirm the start. Check it before deciding.";
  if (/ambiguous|unclear/i.test(last.reason)) return "The check photo was unclear, so the print waits for your eyes. Look at it, then decide.";
  const text = plain(last.reason).slice(0, 220);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
/** On the machine's line: not finished and not just waiting for pickup. */
export function onLine(job: OwnerJob): boolean {
  return !finished(job) && !waitingPickup(job);
}

export function machineStatus(m: OwnerMachine, connector: Connector | undefined, jobs: OwnerJob[]): { key: MachineKey; note: string } {
  if (connector && !connector.online) return { key: "offline", note: `The machine computer ${connector.hostLabel} is not connected.` };
  const mine = jobs.filter((j) => j.machineId === m.id);
  if (m.policyReconciliationRequired) return { key: "attention", note: "Save the current settings, then check the machine before resuming." };
  if (mine.some(needsMaker)) return { key: "attention", note: "A job on this machine is waiting for you." };
  if (!m.calibrated) return { key: "attention", note: "Calibration is needed before orders can run." };
  if (m.activeJobId) return { key: "printing", note: "Working on the order below." };
  if (m.paused && /plate_not_cleared|build plate/i.test(m.reason))
    return { key: "paused", note: "Paused with the last print on the build plate. Take it off, then resume to clear the plate and take the next order." };
  if (m.paused) return { key: "paused", note: /resume/i.test(m.reason) ? "Done with the last job. Resume it to take the next order." : plain(m.reason) };
  if (!m.listed) return { key: "unlisted", note: "Hidden from new orders until you list it." };
  return { key: "available", note: "Ready for the next order." };
}

/** Placed through the Fabyn agent in an ASI:One chat rather than on the fabyn site. */
export function viaAgent(job: OwnerJob): boolean {
  return job.source === "asi1";
}

export function intakeOf(job: OwnerJob): { label: string; detail: string } {
  const intent = job.spec.intent ?? "";
  if (job.spec.outputType === "3d" || /keychain/i.test(intent))
    return { label: "name keychain", detail: "Started from a name typed by the customer." };
  if (/your photo|your picture|shared memory/i.test(intent))
    return { label: "their own photo", detail: "Started from a photo the customer uploaded." };
  if (/drawn from the request/i.test(intent))
    return { label: "design picked", detail: "The customer chose this design from previews." };
  return { label: "custom order", detail: viaAgent(job) ? "Placed in a chat with the Fabyn agent on ASI:One." : "Placed by a customer on fabyn." };
}

export function jobTitle(job: OwnerJob): string {
  return (job.spec.intent ?? "").split(".")[0] || "Order";
}

export function jobStateLabel(job: OwnerJob): { text: string; tone: "amber" | "green" | "blue" | "neutral" | "red" } {
  if (job.productionState === "needs_review") return { text: "Needs your review", tone: "amber" };
  if (recovered(job)) return { text: "Stopped · machine cleared", tone: "neutral" };
  if (job.productionState === "failed") return { text: "Didn’t pass · clear the machine", tone: "red" };
  if (needsHandling(job)) return { text: "Made · take it off and hand over", tone: "amber" };
  if (waitingPickup(job)) return { text: "Ready for pickup", tone: "blue" };
  if (job.fulfillmentState === "collected") return { text: "Collected", tone: "green" };
  if (job.fulfillmentState === "simulation_complete") return { text: "Made · off the machine", tone: "green" };
  if (job.productionState === "produced" && job.fulfillmentState === "awaiting_owner") return { text: "Made · take it off and hand over", tone: "amber" };
  if (job.productionState === "produced") return { text: "Made", tone: "green" };
  if (job.productionState === "cancelled") return { text: "Cancelled", tone: "neutral" };
  if (job.productionState === "verifying") return { text: "Checking the result", tone: "blue" };
  if (["dispatched", "running"].includes(job.productionState)) return { text: "Printing", tone: "blue" };
  if (job.paymentState === "unpaid" && job.chargeable !== false) return { text: "Waiting for payment", tone: "neutral" };
  return { text: "Queued for this machine", tone: "neutral" };
}

/** What a machine uses up, so supplies read in the machine's own units. */
export function supplyOf(m: Pick<OwnerMachine, "model" | "outputType" | "material">): { noun: string; unit: string; refill: string; capacity: number } {
  if (m.outputType === "3d" || /a1|bambu/i.test(m.model)) return { noun: "PLA filament", unit: "prints left on the spool", refill: "Load a new spool", capacity: 100 };
  if (m.outputType === "instax" || /instax/i.test(m.model)) return { noun: "instax mini film", unit: "shots left", refill: "Load new film packs", capacity: 100 };
  return { noun: "label paper", unit: "labels left on the roll", refill: "Load a new roll", capacity: 100 };
}
