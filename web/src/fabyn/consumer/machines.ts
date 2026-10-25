/* The real machines, for the map and the machine detail.

   GET /api/machines/live gives where each machine is, who runs it, what it is
   making and what waits (titles only). Older backends only have
   /api/machines/capabilities; then the place and owner fall back to the
   Palace of Fine Arts and Lucas, and the queue is unknown. */

import { useEffect, useState } from "react";
import { api } from "../../api";
import { PALACE, type LatLng } from "../shared/map";
import type { Process } from "./model";

export type MachineStatus = "available" | "printing" | "paused" | "needs_attention" | "offline";

export interface LiveJob {
  title: string;
  process: Process | null;
  source?: string;
  startedAt?: string;
}

export interface LiveMachine {
  id: string;
  name: string;
  model: string;
  process: Process | null;
  mode: "simulation" | "hardware";
  at: LatLng;
  place: string;
  owner: string;
  status: MachineStatus;
  current: LiveJob | null;
  /** null when the backend cannot say */
  queue: LiveJob[] | null;
}

const PROCESSES: Process[] = ["fdm_print", "sticker_print", "photo_print"];
const asProcess = (p: unknown): Process | null => (PROCESSES.includes(p as Process) ? (p as Process) : null);

async function fromLive(): Promise<LiveMachine[]> {
  const { machines } = await api<{ machines: any[] }>("/machines/live");
  return machines.map((m) => ({
    id: String(m.id),
    name: String(m.displayName ?? m.name ?? m.id),
    model: String(m.model ?? ""),
    process: asProcess(m.process),
    mode: m.mode === "hardware" ? "hardware" : "simulation",
    at:
      m.location && Number.isFinite(m.location.lat) && Number.isFinite(m.location.lng)
        ? { lat: m.location.lat, lng: m.location.lng }
        : { lat: PALACE.lat, lng: PALACE.lng },
    place: String(m.location?.label ?? PALACE.label),
    owner: String(m.ownerName ?? "Lucas"),
    status: (["available", "printing", "paused", "needs_attention", "offline"].includes(m.status) ? m.status : "offline") as MachineStatus,
    current: m.current
      ? { title: String(m.current.title ?? "A print"), process: asProcess(m.current.process), startedAt: m.current.startedAt }
      : null,
    queue: Array.isArray(m.queue)
      ? m.queue.map((q: any) => ({ title: String(q.title ?? "A print"), process: asProcess(q.process), source: q.source }))
      : [],
  }));
}

async function fromCapabilities(): Promise<LiveMachine[]> {
  const { machines } = await api<{ machines: any[] }>("/machines/capabilities");
  return machines.map((m) => ({
    id: String(m.id),
    name: String(m.name ?? m.id),
    model: String(m.model ?? ""),
    process: asProcess(m.process),
    mode: m.mode === "hardware" ? "hardware" : "simulation",
    at: { lat: PALACE.lat, lng: PALACE.lng },
    place: PALACE.label,
    owner: "Lucas",
    status: m.available ? "available" : "printing",
    current: null,
    queue: null,
  }));
}

// an older backend has no /machines/live: ask again only once a minute
let liveMissingUntil = 0;

export async function loadMachines(): Promise<LiveMachine[]> {
  if (Date.now() >= liveMissingUntil)
    try {
      return await fromLive();
    } catch {
      liveMissingUntil = Date.now() + 60_000;
    }
  return await fromCapabilities();
}

/** Polls the machines every few seconds while a screen that shows them is open. */
export function useMachines(every = 4000) {
  const [machines, setMachines] = useState<LiveMachine[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const list = await loadMachines();
        if (alive) {
          setMachines(list);
          setError("");
        }
      } catch {
        if (alive) setError("Could not reach the machines just now.");
      }
    };
    void pull();
    const t = setInterval(() => void pull(), every);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [every]);
  return { machines, error };
}

export const STATUS_TEXT: Record<MachineStatus, string> = {
  available: "free now",
  printing: "printing",
  paused: "paused by the owner",
  needs_attention: "finishing a print",
  offline: "offline",
};
