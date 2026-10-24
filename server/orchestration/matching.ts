import type { Machine, State } from "../model.ts";
import { profileFor, type MachineKnowledgeProfile } from "./knowledge.ts";
import { priceAssignment, registryPriceCard } from "./pricing.ts";
import type { ExecutionMode, IntentItem, Process } from "./types.ts";

export const PROCESS_OUTPUT: Partial<Record<Process, Machine["outputType"]>> = {
  sticker_print: "sticker",
  photo_print: "instax",
  fdm_print: "3d",
};
export const OUTPUT_MATERIAL: Record<Machine["outputType"], string> = {
  sticker: "thermal-paper",
  instax: "photo-film",
  "3d": "pla",
};
export interface Candidate {
  machine: Machine;
  mode: ExecutionMode;
  profile: MachineKnowledgeProfile;
  checks: {
    color_preserved: boolean;
    text_readable: boolean;
    subject_fits: boolean;
  };
  finishSeconds: number;
  estimateCents: number;
}
export interface Rejection {
  machineId: string;
  reason: string;
}
/**
 * Every registry machine that can make the intended result now. Unknown or
 * assumed critical facts exclude hardware rather than becoming guesses.
 */
/** A machine that is set up but still finishing (or holding) another order. */
export const BUSY_REASON = "Busy with another order.";
export function eligibleRegistryMachines(
  state: State,
  item: Pick<IntentItem, "process" | "quantity" | "colorImportant">,
  allowed: (mode: ExecutionMode) => boolean,
  at = Date.now(),
  reservedFor?: string,
): { candidates: Candidate[]; rejected: Rejection[] } {
  const output = PROCESS_OUTPUT[item.process];
  const candidates: Candidate[] = [];
  const rejected: Rejection[] = [];
  const hour = new Date(at).getUTCHours();
  for (const m of Object.values(state.machines).sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    if (!output || m.outputType !== output) continue;
    const reject = (reason: string) =>
      rejected.push({ machineId: m.id, reason });
    if (!allowed(m.mode)) {
      reject(`${m.mode} work is not allowed in this deployment.`);
      continue;
    }
    const liveReservation =
      m.reservation &&
      m.reservation.jobId !== reservedFor &&
      Date.parse(m.reservation.expiresAt) > at;
    if (
      !m.paired ||
      !m.configured ||
      !m.calibrated ||
      !m.listed ||
      !m.ready ||
      m.paused ||
      m.activeJobId ||
      m.policyReconciliationRequired ||
      liveReservation
    ) {
      reject(
        m.activeJobId || liveReservation
          ? BUSY_REASON
          : "Not ready, listed and idle.",
      );
      continue;
    }
    if (
      m.material !== OUTPUT_MATERIAL[m.outputType] ||
      m.mediaRemaining < item.quantity ||
      m.policy.maxQuantity < item.quantity ||
      !m.policy.authorizedArtwork ||
      !(m.hours.start <= hour && hour < m.hours.end)
    ) {
      reject("Media, owner policy or hours do not fit.");
      continue;
    }
    const profile = profileFor(m, m.mode);
    if (!profile.usable) {
      reject(profile.reason);
      continue;
    }
    const color = profile.profile.fields.colorMode.value;
    const checks = {
      color_preserved: !item.colorImportant || color === "color",
      text_readable: true,
      subject_fits: true,
    };
    if (!checks.color_preserved) {
      reject("Cannot keep the colours this item needs.");
      continue;
    }
    const f = profile.profile.fields;
    const perUnit = f.secondsPerUnit.value ?? 60;
    const finishSeconds = (f.setupSeconds.value ?? 0) + perUnit * item.quantity;
    candidates.push({
      machine: m,
      mode: m.mode,
      profile: profile.profile,
      checks,
      finishSeconds,
      estimateCents: priceAssignment(
        registryPriceCard(m),
        item.quantity,
        1,
        perUnit / 60,
      ).totalCents,
    });
  }
  // Intended result first (all checks pass), then earliest finish, price, id.
  candidates.sort(
    (a, b) =>
      a.finishSeconds - b.finishSeconds ||
      a.estimateCents - b.estimateCents ||
      a.machine.id.localeCompare(b.machine.id),
  );
  return { candidates, rejected };
}
