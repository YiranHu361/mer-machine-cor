/**
 * Time-scaled simulation of simulated network machines only. It never touches a
 * real machine. All time arrives as wall-clock milliseconds from the caller and
 * the whole state is plain JSON.
 *
 * simulated seconds = (nowMs − epochMs) / 1000 × timeScale
 *
 * Each advance replays everything that happened in simulated time since the
 * previous advance, so the outcome does not depend on how often it is called
 * while machine status stays the same. Machine status is only known when
 * observed: a machine seen offline is treated as offline since the previous
 * advance, and a machine seen back online resumes work from the current time.
 */
import { isProcessId, type ProcessId } from "./catalog.ts";
import type { NetworkMachine } from "./network.ts";

export type TimeScale = 1 | 10 | 60;
export const TIME_SCALES: readonly TimeScale[] = Object.freeze([1, 10, 60]);

export interface SimJob {
  id: string;
  orderId: string;
  assignmentId: string;
  machineId: string;
  quantity: number;
  process: ProcessId;
  status: "queued" | "running" | "done" | "paused" | "cancelled";
  plannedStartSeconds: number;
  durationSeconds: number;
  startedAtMs: number | null;
  progress: number;
  doneAtMs: number | null;
  note?: string;
  /** Simulated second at which the job first started. */
  startedAtSimSeconds: number | null;
  /**
   * While running: the simulated second at which the job would have started
   * had it never paused, so progress = (simNow − anchor) / durationSeconds.
   */
  runAnchorSimSeconds: number | null;
  /** Simulated second at which the job finished. */
  doneAtSimSeconds: number | null;
}

export interface EngineState {
  timeScale: TimeScale;
  epochMs: number;
  jobs: Record<string, SimJob>;
  /** Simulated time of the latest advance; simulated time never moves backwards. */
  lastSimSeconds: number;
  /** Machines observed offline (or missing) at the latest advance, sorted. */
  offlineMachineIds: string[];
}

export interface EngineEvent {
  type:
    "sim_job.started" | "sim_job.progress" | "sim_job.done" | "sim_job.paused";
  jobId: string;
  machineId: string;
  atMs: number;
  progress: number;
}

export interface ScheduleItem {
  id: string;
  orderId: string;
  assignmentId: string;
  machineId: string;
  quantity: number;
  process: ProcessId;
  plannedStartSeconds: number;
  durationSeconds: number;
}

export const PAUSED_NOTE =
  "Paused: simulated machine went offline. Started work is never reassigned.";

function requireTimeScale(scale: unknown): asserts scale is TimeScale {
  if (!(TIME_SCALES as readonly unknown[]).includes(scale)) {
    throw new RangeError("timeScale must be 1, 10 or 60.");
  }
}
function requireMs(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number of milliseconds.`);
  }
}

export function createEngine(
  epochMs: number,
  timeScale: TimeScale = 10,
): EngineState {
  requireMs(epochMs, "epochMs");
  requireTimeScale(timeScale);
  return {
    timeScale,
    epochMs,
    jobs: {},
    lastSimSeconds: 0,
    offlineMachineIds: [],
  };
}

/** Simulated seconds elapsed at wall-clock `nowMs` under the current scale. */
export function simulatedSeconds(state: EngineState, nowMs: number): number {
  requireMs(nowMs, "nowMs");
  return ((nowMs - state.epochMs) / 1000) * state.timeScale;
}

/** Wall-clock milliseconds for a simulated second under the current scale. */
export function wallMsAt(state: EngineState, simSeconds: number): number {
  return state.epochMs + (simSeconds * 1000) / state.timeScale;
}

/** Changes speed while keeping simulated elapsed time continuous at `nowMs`. */
export function setTimeScale(
  state: EngineState,
  scale: TimeScale,
  nowMs: number,
): void {
  requireTimeScale(scale);
  const sim = simulatedSeconds(state, nowMs);
  state.epochMs = nowMs - (sim * 1000) / scale;
  state.timeScale = scale;
}

const isText = (value: unknown) =>
  typeof value === "string" && value.length > 0;
const nonNegative = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Adds queued jobs atomically; rejects duplicate ids (in the batch or state). */
export function scheduleJobs(state: EngineState, items: ScheduleItem[]): void {
  if (!Array.isArray(items)) throw new TypeError("items must be an array.");
  const batch = new Set<string>();
  for (const item of items) {
    if (
      !isText(item?.id) ||
      !isText(item.orderId) ||
      !isText(item.assignmentId) ||
      !isText(item.machineId)
    ) {
      throw new TypeError(
        "Each job needs non-empty id, orderId, assignmentId and machineId.",
      );
    }
    if (batch.has(item.id) || Object.hasOwn(state.jobs, item.id)) {
      throw new RangeError(`Duplicate simulated job id: ${item.id}`);
    }
    batch.add(item.id);
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new RangeError(
        `Job ${item.id} quantity must be a positive integer.`,
      );
    }
    if (!isProcessId(item.process)) {
      throw new TypeError(`Job ${item.id} has an unknown process.`);
    }
    if (
      !nonNegative(item.plannedStartSeconds) ||
      !nonNegative(item.durationSeconds)
    ) {
      throw new RangeError(
        `Job ${item.id} needs finite, non-negative plannedStartSeconds and durationSeconds.`,
      );
    }
  }
  for (const item of items) {
    state.jobs[item.id] = {
      id: item.id,
      orderId: item.orderId,
      assignmentId: item.assignmentId,
      machineId: item.machineId,
      quantity: item.quantity,
      process: item.process,
      status: "queued",
      plannedStartSeconds: item.plannedStartSeconds,
      durationSeconds: item.durationSeconds,
      startedAtMs: null,
      progress: 0,
      doneAtMs: null,
      startedAtSimSeconds: null,
      runAnchorSimSeconds: null,
      doneAtSimSeconds: null,
    };
  }
}

const byPlan = (a: SimJob, b: SimJob) =>
  a.plannedStartSeconds - b.plannedStartSeconds ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const step = (progress: number) => Math.floor(progress * 10);

/**
 * Moves simulated time to `nowMs` and returns the changes as events, ordered by
 * time. Jobs on one machine run one at a time in plannedStartSeconds order.
 * Offline machines pause their running job (never reassigned) and block queued
 * jobs; a paused job resumes when its machine is observed online again.
 */
export function advance(
  state: EngineState,
  machines: readonly Pick<NetworkMachine, "id" | "status">[],
  nowMs: number,
): EngineEvent[] {
  const simNow = Math.max(simulatedSeconds(state, nowMs), state.lastSimSeconds);
  const status = new Map<string, NetworkMachine["status"]>();
  for (const machine of machines) status.set(machine.id, machine.status);
  const wasOffline = new Set(state.offlineMachineIds);
  const at = (sim: number) => Math.min(nowMs, Math.round(wallMsAt(state, sim)));

  const byMachine = new Map<string, SimJob[]>();
  for (const job of Object.values(state.jobs)) {
    const list = byMachine.get(job.machineId);
    if (list) list.push(job);
    else byMachine.set(job.machineId, [job]);
  }

  const events: EngineEvent[] = [];
  const emit = (type: EngineEvent["type"], job: SimJob, atMs: number) =>
    events.push({
      type,
      jobId: job.id,
      machineId: job.machineId,
      atMs,
      progress: job.progress,
    });

  const machineIds = [...byMachine.keys()].sort();
  for (const machineId of machineIds) {
    const jobs = byMachine.get(machineId)!.sort(byPlan);
    if (status.get(machineId) !== "online") {
      for (const job of jobs) {
        if (job.status !== "running") continue;
        // Progress already reflects the previous advance; nothing is credited
        // for the unobserved interval in which the machine went offline.
        job.status = "paused";
        job.runAnchorSimSeconds = null;
        job.note = PAUSED_NOTE;
        emit("sim_job.paused", job, nowMs);
      }
      continue;
    }

    let freeAt = -Infinity;
    for (const job of jobs) {
      if (job.status === "done" && job.doneAtSimSeconds !== null) {
        freeAt = Math.max(freeAt, job.doneAtSimSeconds);
      }
    }
    if (wasOffline.has(machineId)) freeAt = Math.max(freeAt, simNow);

    let running = jobs.find((job) => job.status === "running") ?? null;
    if (!running) {
      const paused = jobs.find((job) => job.status === "paused");
      if (paused) {
        paused.status = "running";
        paused.runAnchorSimSeconds =
          simNow - paused.progress * paused.durationSeconds;
        delete paused.note;
        emit("sim_job.started", paused, nowMs);
        running = paused;
      }
    }

    for (;;) {
      if (running) {
        const anchor = running.runAnchorSimSeconds ?? simNow;
        const finish = anchor + running.durationSeconds;
        if (finish <= simNow) {
          running.status = "done";
          running.progress = 1;
          running.runAnchorSimSeconds = null;
          running.doneAtSimSeconds = finish;
          running.doneAtMs = at(finish);
          emit("sim_job.done", running, running.doneAtMs);
          freeAt = Math.max(freeAt, finish);
          running = null;
          continue;
        }
        const measured = Math.min(
          1,
          Math.max(0, (simNow - anchor) / running.durationSeconds),
        );
        const progress = Math.max(running.progress, measured);
        const crossed = step(progress) > step(running.progress);
        running.progress = progress;
        if (crossed) emit("sim_job.progress", running, nowMs);
        break;
      }
      const next = jobs.find((job) => job.status === "queued");
      if (!next) break;
      const start = Math.max(freeAt, next.plannedStartSeconds);
      if (start > simNow) break;
      next.status = "running";
      next.progress = 0;
      next.startedAtSimSeconds = start;
      next.runAnchorSimSeconds = start;
      next.startedAtMs = at(start);
      emit("sim_job.started", next, next.startedAtMs);
      running = next;
    }
  }

  const offline = new Set<string>();
  for (const machine of machines) {
    if (machine.status !== "online") offline.add(machine.id);
  }
  for (const machineId of machineIds) {
    if (!status.has(machineId)) offline.add(machineId);
  }
  state.offlineMachineIds = [...offline].sort();
  state.lastSimSeconds = simNow;
  // Array.prototype.sort is stable: same-time events keep causal order.
  return events.sort((a, b) => a.atMs - b.atMs);
}

/** Queued jobs that have never started on the given machines (copies). */
export function unstartedJobs(
  state: EngineState,
  machineIds: string[],
): SimJob[] {
  const wanted = new Set(machineIds);
  return Object.values(state.jobs)
    .filter(
      (job) =>
        wanted.has(job.machineId) &&
        job.status === "queued" &&
        job.startedAtMs === null,
    )
    .sort(
      (a, b) =>
        (a.machineId < b.machineId ? -1 : a.machineId > b.machineId ? 1 : 0) ||
        byPlan(a, b),
    )
    .map((job) => ({ ...job }));
}

/** Cancels only queued, never-started jobs; returns the ids it cancelled. */
export function cancelJobs(state: EngineState, jobIds: string[]): string[] {
  const cancelled: string[] = [];
  for (const id of new Set(jobIds)) {
    const job = Object.hasOwn(state.jobs, id) ? state.jobs[id] : undefined;
    if (!job || job.status !== "queued" || job.startedAtMs !== null) continue;
    job.status = "cancelled";
    cancelled.push(id);
  }
  return cancelled;
}

/** unitsTotal excludes cancelled jobs (their work is replanned elsewhere). */
export function counters(state: EngineState): {
  queued: number;
  running: number;
  paused: number;
  done: number;
  cancelled: number;
  unitsDone: number;
  unitsTotal: number;
} {
  const result = {
    queued: 0,
    running: 0,
    paused: 0,
    done: 0,
    cancelled: 0,
    unitsDone: 0,
    unitsTotal: 0,
  };
  for (const job of Object.values(state.jobs)) {
    result[job.status] += 1;
    if (job.status === "cancelled") continue;
    result.unitsTotal += job.quantity;
    if (job.status === "done") result.unitsDone += job.quantity;
  }
  return result;
}
