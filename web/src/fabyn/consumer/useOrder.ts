import { useCallback, useEffect, useState } from "react";
import { describeError, getOrder } from "./orders";
import type { OrderView } from "./model";

/** Follows one order: the SSE refresh ping plus a 2 s poll. Keeps the last good view on errors. */
export function useOrder(id: string | null, options: { live?: boolean; initial?: OrderView | null } = {}) {
  const live = options.live ?? true;
  const [order, setOrder] = useState<OrderView | null>(options.initial ?? null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!id) return null;
    try {
      const next = await getOrder(id);
      setOrder(next);
      setError("");
      return next;
    } catch (e) {
      setError(describeError(e).message);
      return null;
    }
  }, [id]);
  useEffect(() => {
    if (!id) return;
    void load();
    const source = live && typeof EventSource !== "undefined" ? new EventSource("/api/events") : null;
    source?.addEventListener("refresh", () => void load());
    const timer = setInterval(() => void load(), 2000);
    return () => {
      source?.close();
      clearInterval(timer);
    };
  }, [id, live, load]);
  return { order, setOrder, error, reload: load };
}
