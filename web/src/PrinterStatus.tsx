import { useEffect, useState } from "react";
import { api } from "./api";

type Printer = {
  id: string;
  name: string;
  model: string;
  makes: string;
  status: "connected" | "checking" | "not_answering" | "busy" | "paused";
  detail: string;
  checkedAt: string | null;
};

const LABEL: Record<Printer["status"], string> = {
  connected: "Connected",
  checking: "Checking…",
  not_answering: "Not answering · press its power button",
  busy: "Printing",
  paused: "Paused · see Owner workshop",
};

const ago = (iso: string | null) => {
  if (!iso) return "not checked yet";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60
    ? `checked ${s} s ago`
    : `checked ${Math.round(s / 60)} min ago`;
};

/** Whether each real printer answered its latest check (about once a minute). */
export function PrinterStatus() {
  const [printers, setPrinters] = useState<Printer[]>([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      api<{ printers: Printer[] }>("/printers")
        .then((r) => {
          if (live && Array.isArray(r?.printers)) setPrinters(r.printers);
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 10_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  if (!printers.length) return null;
  return (
    <ul className="printer-status" aria-label="Printers">
      {printers.map((p) => (
        <li
          key={p.id}
          className="printer-pill"
          data-status={p.status}
          title={[p.model, ago(p.checkedAt), p.detail]
            .filter(Boolean)
            .join(" · ")}
        >
          <span className="printer-dot" aria-hidden="true" />
          <span>
            {p.makes} · {LABEL[p.status]}
          </span>
        </li>
      ))}
    </ul>
  );
}
