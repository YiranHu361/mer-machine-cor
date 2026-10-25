// Printer checks for the machine cards. The owner check route asks the machine
// to answer once (printing nothing). Until a server has that route, the card
// falls back to the site's printer indicator and the order matcher's view.
import { api, ApiError } from "../../api";
import type { OwnerMachine, PrinterCheck, PrinterStatusRow } from "./data";

const STATUS_TEXT: Record<PrinterStatusRow["status"], string> = {
  connected: "Answered its latest check.",
  checking: "Being checked now.",
  not_answering: "Did not answer. Press its power button and check it is not connected to a phone.",
  busy: "Printing an order.",
  paused: "Paused and waiting for you.",
  offline: "The local producer is offline.",
  attention: "The printer answered but needs attention.",
};

export async function checkPrinter(m: OwnerMachine): Promise<PrinterCheck> {
  try {
    const answer = await api<PrinterCheck>(`/owner/machines/${m.id}/check`, {});
    return { ok: Boolean(answer.ok), detail: answer.detail || (answer.ok ? "It answered." : "It did not answer."), checkedAt: answer.checkedAt ?? new Date().toISOString() };
  } catch (error) {
    // Older servers have no check route: read the latest status instead.
    if (!(error instanceof ApiError) || ![404, 405].includes(error.status)) throw error;
  }
  const [printers, caps] = await Promise.all([
    api<{ printers: PrinterStatusRow[] }>("/printers").catch(() => ({ printers: [] as PrinterStatusRow[] })),
    api<{ machines: { id: string; available: boolean; reason?: string }[] }>("/machines/capabilities").catch(() => ({ machines: [] as { id: string; available: boolean; reason?: string }[] })),
  ]);
  const row = printers.printers.find((p) => p.id === m.id);
  if (row)
    return {
      ok: row.status === "connected" || row.status === "busy",
      detail: row.detail || STATUS_TEXT[row.status],
      checkedAt: row.checkedAt,
    };
  const cap = caps.machines.find((c) => c.id === m.id);
  if (cap)
    return {
      ok: cap.available || Boolean(m.activeJobId),
      detail: cap.available ? "Its node answered and it can take an order now." : m.activeJobId ? "Its node answered; it is busy with an order." : "Its node answered, but it cannot take an order yet. See the note above.",
      checkedAt: new Date().toISOString(),
    };
  return { ok: false, detail: "No answer from this machine’s node.", checkedAt: new Date().toISOString() };
}

export function checkedAgo(iso: string | null, now: number): string {
  if (!iso) return "not checked yet";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `checked ${s} s ago` : `checked ${Math.round(s / 60)} min ago`;
}
