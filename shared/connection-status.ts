export const PRODUCER_STALE_MS = 20_000;

export interface PrinterConnection {
  id: string;
  name: string;
  model: string;
  makes: string;
  status:
    | "connected"
    | "checking"
    | "not_answering"
    | "busy"
    | "paused"
    | "offline"
    | "attention";
  detail: string;
  checkedAt: string | null;
  lastSeen?: string | null;
  linked?: boolean;
}

export interface ProducerConnection {
  lastSeen: string | null;
  printers: PrinterConnection[];
}

export function producerOnline(
  lastSeen: string | null | undefined,
  now = Date.now(),
) {
  const seen = lastSeen ? Date.parse(lastSeen) : NaN;
  return Number.isFinite(seen) && now - seen <= PRODUCER_STALE_MS;
}

export function currentPrinterConnection(
  printer: PrinterConnection,
  now = Date.now(),
): PrinterConnection {
  return printer.lastSeen !== undefined &&
    !producerOnline(printer.lastSeen, now)
    ? {
        ...printer,
        status: "offline",
        detail:
          "No producer heartbeat in the last 20 seconds. Start npm run producer on the machine computer.",
      }
    : printer;
}
