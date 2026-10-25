// GET /api/machines/live: the public view of every machine (where it is, who
// runs it, what it is making, what is queued). Polled; an older server without
// the route just leaves the list empty and the map falls back to the Palace.
import { useEffect, useState } from "react";
import { api } from "../../api";

export interface LiveMachine {
  id: string;
  displayName: string;
  model: string;
  process: "sticker_print" | "photo_print" | "fdm_print" | null;
  mode: string;
  location?: { lat: number; lng: number; label: string };
  ownerName?: string;
  status: "available" | "printing" | "needs_attention" | "paused" | "offline";
  current: { title: string; process: string | null; progress: number | null; startedAt: string | null } | null;
  queue: { title: string; process: string | null; source?: "web" | "asi1" }[];
}

export interface PaymentConfig {
  mode: "mock" | "testnet" | string;
  network?: string;
}

/** GET /api/payments/config: whether checkout runs on x402 testnet or the no-charge test checkout. */
export function usePaymentConfig(): PaymentConfig | null {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  useEffect(() => {
    let alive = true;
    api<PaymentConfig>("/payments/config", undefined, "GET")
      .then((c) => {
        if (alive && c?.mode) setConfig(c);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return config;
}

export function useLiveMachines(enabled: boolean, revision: number): LiveMachine[] {
  const [machines, setMachines] = useState<LiveMachine[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      api<{ machines: LiveMachine[] }>("/machines/live")
        .then((r) => {
          if (alive && Array.isArray(r?.machines)) setMachines(r.machines);
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled, revision]);
  return machines;
}
