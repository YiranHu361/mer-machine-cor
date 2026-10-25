/* The eight steps the consumer walks through, and which one an order is on.

   The step is client state: a new order starts at "understand" and the person
   moves forward by pressing buttons. The saved order only decides what a step
   may show: nothing before checkout once it is confirmed, nothing after
   checkout before it is. */

import type { Phase } from "./phase";

export type Step = "understand" | "map" | "machine" | "preview" | "queue" | "checkout" | "printing" | "handoff";

export const STEPS: { id: Step; label: string }[] = [
  { id: "understand", label: "understand" },
  { id: "map", label: "nearby" },
  { id: "machine", label: "machine" },
  { id: "preview", label: "preview" },
  { id: "queue", label: "queue" },
  { id: "checkout", label: "checkout" },
  { id: "printing", label: "printing" },
  { id: "handoff", label: "get it" },
];

export const stepIndex = (s: Step) => STEPS.findIndex((x) => x.id === s);

const BEFORE_CHECKOUT: Step[] = ["understand", "map", "machine", "preview"];

/** Where an order opened from "my orders" picks up. */
export function stepForPhase(phase: Phase): Step {
  if (phase === "making" || phase === "partial" || phase === "needs_review") return "printing";
  if (phase === "ready") return "handoff";
  if (phase === "payment") return "checkout";
  return "preview";
}

/** The step to draw: the chosen one, unless the saved order has moved past it or not reached it. */
export function effectiveStep(step: Step, phase: Phase): Step {
  const confirmed = ["payment", "making", "ready", "partial", "needs_review"].includes(phase);
  if (confirmed && (BEFORE_CHECKOUT.includes(step) || step === "queue")) return phase === "payment" ? "checkout" : stepForPhase(phase);
  if (confirmed && step === "checkout" && phase !== "payment") return stepForPhase(phase);
  // the queue and checkout need a confirmed-able proposal; a changed request goes back to the preview
  if (!confirmed && (step === "queue" || step === "checkout") && phase !== "proposal") return "preview";
  if (!confirmed && (step === "printing" || step === "handoff")) return "preview";
  return step;
}

/** Phases that replace whatever step is open with a notice. */
export const NOTICE_PHASES: Phase[] = ["payment_failed", "cancelled", "superseded", "unavailable", "failed", "question"];
