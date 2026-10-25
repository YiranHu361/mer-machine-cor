/* What the consumer screen shows, derived only from the saved order. */

import type { Assignment, OrderItem, OrderView, MachineKind, Process } from "./model";
import { KIND_OF_PROCESS, LABEL_OF_PROCESS, MATCH_OF_PROCESS, machineLabel } from "./model";
import { WORLD_MACHINES, areaLabel, distanceKm, formatKm, PROCESS_LABEL, type LatLng } from "../shared/map";
import type { LiveMachine } from "./machines";

export type Phase =
  | "understand" // the agent reads the request, finds a machine, prepares the file
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
    // every job handed over counts as ready even before the plan rolls up
    const children = o.plan?.assignments.map((a) => a.child).filter(Boolean) ?? [];
    if (children.length && children.every((c) => ["ready_for_pickup", "collected", "simulation_complete"].includes(c!.fulfillmentState)))
      return "ready";
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

/** The order waits for new artwork that could not be drawn: an artwork problem, never a machine one. */
export function designUnavailable(o: OrderView): boolean {
  if (o.draft.stage !== "unavailable") return false;
  if (o.candidates?.status === "failed") return true;
  const last = [...o.events].reverse().find((e) => e.type === "plan.needs_action");
  return last?.data?.reason === "design_unavailable";
}

/** The kinds of thing the agent decided to make, as soon as it knows. */
export function processesOf(o: OrderView): Process[] {
  const fromPlan = o.plan?.items.map((i) => i.process);
  if (fromPlan?.length) return [...new Set(fromPlan)];
  // the newest understanding: a chat change is understood again
  return understoodProcesses(o);
}

/** The first thing being made: it decides the machine type, the map and the preview. */
export function mainProcess(o: OrderView): Process | null {
  return processesOf(o)[0] ?? null;
}

export interface ToolCall {
  /** the orchestration step, written as the tool the agent calls */
  fn: string;
  arg: string;
  /** what came back, from the saved order; empty until the step is done */
  result: string;
  done: boolean;
}

const mm = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function preparedSize(a: Assignment | undefined): string {
  const p = a?.parameters;
  if (!p) return "";
  const size = p.model_size_mm?.length
    ? p.model_size_mm.map(mm).join(" × ")
    : p.width_mm && p.height_mm
      ? `${mm(p.width_mm)} × ${mm(p.height_mm)}`
      : "";
  return [
    size && `${size} mm`,
    p.material && (p.material.length <= 4 ? p.material.toUpperCase() : p.material.replace(/[-_]/g, " ")),
    p.color_mode === "mono" && !p.model_size_mm ? "black and white" : p.model_size_mm ? "one colour" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

const short = (s: string, n = 34) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** What the request was, in a few words: the newest line of a chat conversation. */
export function requestShort(o: OrderView): string {
  const lines = o.draft.requestText.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] || (o.draft.photoAssetIds.length ? `${o.draft.photoAssetIds.length} photo${o.draft.photoAssetIds.length > 1 ? "s" : ""}` : "");
}

/** What the agent understood the request to be, before any planning. */
export function understoodProcesses(o: OrderView): Process[] {
  const understood = [...o.events].reverse().find((e) => e.type === "draft.understood");
  const items = understood?.data?.items as Process[] | undefined;
  return items?.length ? [...new Set(items)] : [];
}

/** When planning made something other than what was understood (a busy machine type), what changed and why. */
export function processChange(o: OrderView): { from: Process; to: Process; why: string } | null {
  const plan = o.plan;
  const asked = understoodProcesses(o);
  if (!plan || !asked.length) return null;
  const planned = [...new Set(plan.items.map((i) => i.process))];
  const from = asked.find((p) => !planned.includes(p));
  const toItem = plan.items.find((i) => !asked.includes(i.process));
  return from && toItem ? { from, to: toItem.process, why: toItem.why } : null;
}

/** The real machines of one process, the free ones first. */
export function realMachinesFor(machines: LiveMachine[] | null, process: Process | null) {
  return (machines ?? [])
    .filter((m) => !process || m.process === process)
    .sort((a, b) => Number(b.status === "available") - Number(a.status === "available"));
}

/** The real machine this order uses: the assigned one once there is a plan, else the best fit by type. */
export function matchedMachine(o: OrderView, machines: LiveMachine[] | null): LiveMachine | null {
  const assigned = o.plan?.assignments[0]?.machineId;
  const found = assigned ? machines?.find((m) => m.id === assigned) : undefined;
  return found ?? realMachinesFor(machines, mainProcess(o))[0] ?? null;
}

/** Steps 1–3: read the request, match the machine type, search the map. Distances are from
   the person's spot, when they have shared or set one. */
export function findCalls(o: OrderView, machines: LiveMachine[] | null, from: LatLng | null): ToolCall[] {
  const understood = o.events.some((e) => e.type === "draft.understood") || !!o.intent || !!o.plan;
  const processes = processesOf(o);
  const what = processes.map((p) => LABEL_OF_PROCESS[p]).join(" + ");
  const text = o.plan?.items.find((i) => i.design.text)?.design.text ?? /"([^"]{1,24})"/.exec(o.draft.requestText)?.[1];
  const process = processes[0] ?? null;
  const real = realMachinesFor(machines, process);
  const free = real.filter((m) => m.status === "available");
  const world = process ? WORLD_MACHINES.filter((m) => m.process === process) : [];
  const nearest = free[0] ?? real[0];
  return [
    {
      fn: "understand_request",
      arg: `"${short(requestShort(o))}"`,
      result: understood ? [what || o.intent?.outcome || "understood", text ? `the name ${text}` : ""].filter(Boolean).join(" · ") : "",
      done: understood,
    },
    {
      fn: "match_machine_type",
      arg: what || "…",
      result: process ? processes.map((p) => MATCH_OF_PROCESS[p]).join(" + ") : "",
      done: understood && !!process,
    },
    {
      fn: "search_nearby_machines",
      arg: process ? `${PROCESS_LABEL[process]}, near ${from ? areaLabel(from) : "San Francisco"}` : "…",
      result:
        process && machines
          ? `${world.length + real.length} in San Francisco · ${free.length ? `${free.length} free now` : "none free now"}${nearest ? ` · ${nearest.place.split(",")[0]}${from ? `, ${formatKm(distanceKm(from, nearest.at))} from you` : ""}` : ""}`
          : "",
      done: !!process && !!machines,
    },
  ];
}

/** Steps after a design is picked: draw, prepare the file, check and quote. */
export function prepareCalls(o: OrderView): ToolCall[] {
  const stage = o.draft.stage;
  const plan = o.plan;
  const assigned = (plan?.assignments.length ?? 0) > 0;
  const calls: ToolCall[] = [];
  const c = o.candidates;
  if (c || stage === "generating_candidates")
    calls.push({
      fn: "draw_design_drafts",
      arg: `"${c?.subject ?? ""}"`,
      result: c ? `${c.candidates.length} drafts${c.selectedId ? " · 1 picked" : ""}` : "",
      done: !!c && c.status === "ready",
    });
  const text = plan?.items.find((i) => i.design.text)?.design.text;
  const fdm = plan?.items.some((i) => i.process === "fdm_print");
  calls.push({
    fn: fdm ? "model_and_slice" : "prepare_print_file",
    arg: text ? `"${text}"` : (plan?.items.map((i) => LABEL_OF_PROCESS[i.process]).join(", ") ?? ""),
    result: preparedSize(plan?.assignments[0]) || (assigned ? "file ready" : ""),
    done: assigned,
  });
  const machines = [...new Set((plan?.assignments ?? []).map((a) => machineLabel(a.machineId, a.machineName)))];
  calls.push({
    fn: "reserve_machine_and_quote",
    arg: machines.join(" + "),
    result: plan ? `ready in about ${Math.max(1, plan.readyEstimateMinutes)} min` : "",
    done: stage === "proposed" || !!o.makeIntent,
  });
  return calls;
}

/** Which machine the wait scene should show before a plan exists. */
export function kindForWait(o: OrderView): MachineKind | null {
  const p = mainProcess(o);
  if (p) return KIND_OF_PROCESS[p];
  const text = o.draft.requestText.toLowerCase();
  if (/\b(keychain|key chain|charm|tag|3d)\b/.test(text)) return "a1mini";
  if (o.draft.photoAssetIds.length || /\b(photo|instax|polaroid)\b/.test(text)) return "instax";
  return "m02pro";
}

export function assignmentsFor(o: OrderView, itemId: string): Assignment[] {
  return (o.plan?.assignments ?? []).filter((a) => a.itemId === itemId);
}

/** What the person calls the item: a name keychain reads as the name, a picked draft by its title. */
export function itemTitle(item: OrderItem, o?: OrderView): string {
  const text = item.process === "fdm_print" ? item.design.text : undefined;
  if (text) return `${text} keychain`;
  const picked = item.design.candidateId && o?.candidates?.candidates.find((c) => c.id === item.design.candidateId);
  if (picked) return `${picked.title.replace(/\s*\(fixture\)\s*$/i, "")} ${LABEL_OF_PROCESS[item.process]}`;
  return item.name;
}

export function orderTitle(o: OrderView): string {
  const plan = o.plan;
  const only = plan?.items.length === 1 ? plan.items[0] : null;
  if (only) return itemTitle(only, o);
  if (plan && plan.items.length > 1) return `${plan.items.length} things, made in parallel`;
  return o.intent?.outcome || o.draft.requestText || "Your order";
}
