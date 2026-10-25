/* What the consumer screen shows, derived only from the saved order. */

import type { Assignment, OrderItem, OrderView, MachineKind, Process } from "./model";
import { KIND_OF_PROCESS, LABEL_OF_PROCESS, machineLabel } from "./model";

export type Phase =
  | "understand" // tool calls: reading the request, choosing a machine, preparing the file
  | "drafts" // pick one of the design candidates
  | "proposal" // items, machines, price, offer, confirm
  | "payment" // payment still pending on the backend
  | "payment_failed"
  | "making" // jobs on machines
  | "ready" // every job finished
  | "partial"
  | "needs_review"
  | "cancelled"
  | "superseded"
  | "unavailable"
  | "failed"
  | "question";

export function phaseOf(o: OrderView): Phase {
  if (o.status === "cancelled" || o.draft.stage === "superseded") {
    if (o.makeIntent?.payment?.status === "failed") return "payment_failed";
    return o.draft.stage === "superseded" ? "superseded" : "cancelled";
  }
  if (o.makeIntent) {
    const pay = o.makeIntent.payment?.status;
    if (pay === "pending") return "payment";
    if (pay === "failed") return "payment_failed";
    const ps = o.plan?.status;
    if (ps === "done") return "ready";
    if (ps === "partial") return "partial";
    if (ps === "needs_review") return "needs_review";
    if (ps === "cancelled") return "cancelled";
    return "making";
  }
  switch (o.draft.stage) {
    case "awaiting_design_choice":
      return "drafts";
    case "proposed":
      return "proposal";
    case "unavailable":
      return "unavailable";
    case "failed":
      return "failed";
    case "needs_clarification":
      return "question";
    default:
      return "understand";
  }
}

export interface ToolCall {
  /** the orchestration step, written as the tool the agent calls */
  fn: string;
  arg: string;
  /** what came back, from the saved order; empty until the step is done */
  result: string;
  done: boolean;
}

const PLACE_NEAR = "Palace of Fine Arts";
const mm = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function prepared(o: OrderView): string {
  const a = o.plan?.assignments[0];
  const p = a?.parameters;
  if (!p) return "";
  const size = p.model_size_mm?.length
    ? p.model_size_mm.map(mm).join(" × ")
    : p.width_mm && p.height_mm
      ? `${mm(p.width_mm)} × ${mm(p.height_mm)}`
      : "";
  return [size && `${size} mm`, p.material, p.color_mode === "mono" && !p.model_size_mm ? "black and white" : ""]
    .filter(Boolean)
    .join(" · ");
}

/** The real orchestration steps, each filled from the saved order once it is done. */
export function toolCalls(o: OrderView): ToolCall[] {
  const stage = o.draft.stage;
  const plan = o.plan;
  const assigned = (plan?.assignments.length ?? 0) > 0;
  const understood = o.events.find((e) => e.type === "draft.understood");
  const kinds = ((understood?.data?.items as Process[] | undefined) ?? plan?.items.map((i) => i.process) ?? []).map(
    (k) => LABEL_OF_PROCESS[k] ?? k,
  );
  const request = o.draft.requestText || (o.draft.photoAssetIds.length ? `${o.draft.photoAssetIds.length} photo` : "");
  const calls: ToolCall[] = [
    {
      fn: "understand_request",
      arg: `"${request.length > 34 ? request.slice(0, 33) + "…" : request}"`,
      result: kinds.length ? kinds.join(" + ") : o.intent?.outcome ?? "",
      done: !!understood || !!o.intent,
    },
  ];
  const c = o.candidates;
  if (c || stage === "generating_candidates")
    calls.push({
      fn: "draw_design_drafts",
      arg: `"${c?.subject ?? ""}"`,
      result: c ? `${c.candidates.length} drafts${c.selectedId ? " · 1 picked" : ""}` : "",
      done: !!c && c.status === "ready",
    });
  const machines = [...new Set((plan?.assignments ?? []).map((a) => machineLabel(a.machineId, a.machineName)))];
  calls.push({
    fn: "find_nearest_machine",
    arg: [...new Set((plan?.items ?? []).map((i) => i.process))].join(", ") || kinds.join(", "),
    result: machines.length ? `${machines.join(" + ")} · ${PLACE_NEAR}` : "",
    done: assigned,
  });
  const text = plan?.items.find((i) => i.design.text)?.design.text;
  calls.push({
    fn: "prepare_print_file",
    arg: text ? `"${text}"` : plan?.items.map((i) => LABEL_OF_PROCESS[i.process]).join(", ") ?? "",
    result: prepared(o) || (assigned ? "file ready" : ""),
    done: assigned,
  });
  calls.push({
    fn: "preflight_and_quote",
    arg: "",
    result: plan
      ? `ready in about ${Math.max(1, plan.readyEstimateMinutes)} min · $${(plan.payableCents / 100).toFixed(2)} demo payment`
      : "",
    done: stage === "proposed" || !!o.makeIntent,
  });
  return calls;
}

/** Which machine the wait scene should show before a plan exists. */
export function kindForWait(o: OrderView): MachineKind | null {
  const first = o.plan?.items[0];
  if (first) return KIND_OF_PROCESS[first.process];
  const text = o.draft.requestText.toLowerCase();
  if (/\b(keychain|key chain|charm|tag|3d)\b/.test(text)) return "a1mini";
  if (o.draft.photoAssetIds.length || /\b(photo|instax|polaroid)\b/.test(text))
    return "instax";
  return "m02pro";
}

export function assignmentsFor(o: OrderView, itemId: string): Assignment[] {
  return (o.plan?.assignments ?? []).filter((a) => a.itemId === itemId);
}

/** What the person calls the item: a name keychain reads as the name. */
export function itemTitle(item: OrderItem): string {
  const text = item.process === "fdm_print" ? item.design.text : undefined;
  return text ? `${text.charAt(0)}${text.slice(1).toLowerCase()} keychain` : item.name;
}

export function orderTitle(o: OrderView): string {
  const plan = o.plan;
  const only = plan?.items.length === 1 ? plan.items[0] : null;
  if (only) return itemTitle(only);
  if (plan && plan.items.length > 1) return `${plan.items.length} things, made in parallel`;
  return o.intent?.outcome || o.draft.requestText || "Your order";
}
