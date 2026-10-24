/// <reference types="vite/client" />
import type { ReactNode } from "react";
import { ConvexProvider, ConvexReactClient, useQuery } from "convex/react";
import { anyApi } from "convex/server";

/* Live views read Convex directly (design doc, "Convex live state"): the hubs
   publish every machine, plan, job and event there, and these components
   subscribe. The browser never writes to Convex. Without a deployment URL the
   live parts are simply left out and the pages keep polling the hub. */

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const client = url ? new ConvexReactClient(url) : null;
export const liveEnabled = !!client;

export function LiveProvider({ children }: { children: ReactNode }) {
  return client ? (
    <ConvexProvider client={client}>{children}</ConvexProvider>
  ) : (
    <>{children}</>
  );
}

type LiveJob = {
  jobId: string;
  machineId?: string;
  producerMachineId?: string;
  state?: string;
  hubState?: string;
  progress?: number;
  reason?: string;
};
type LiveEvent = { _id: string; ts: string; summary: string; type: string };
type LiveMachine = {
  _id: string;
  machineId: string;
  source: "consumer" | "producer";
  displayName: string;
  process: string;
  simulated: boolean;
  status: string;
  reason?: string;
  mediaRemaining?: number;
  linkedMachineId?: string;
};

const HUB_LINE: Record<string, string> = {
  offered: "Sent to the printer",
  accepted: "The printer accepted it",
  running: "Printing",
  verifying: "Printed · waiting for a check",
  done: "Printed and checked",
  rejected: "The printer declined it",
  failed: "The printer reported a problem",
};
const time = (ts: string) =>
  new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

/** What the machine is doing for this order right now, live from Convex. */
export function LiveOrder({ orderId }: { orderId: string }) {
  const live = useQuery(anyApi.live.order, { orderId }) as
    | { jobs: LiveJob[]; events: LiveEvent[] }
    | undefined;
  if (!live || (!live.jobs.length && !live.events.length)) return null;
  return (
    <section className="live-order" aria-label="Live from the workshop">
      {live.jobs
        .filter((j) => j.hubState)
        .map((j) => (
          <div key={j.jobId} className="live-job">
            <p>
              <strong>{HUB_LINE[j.hubState!] ?? j.hubState}</strong>
              {j.producerMachineId && (
                <span className="fine-print"> · {j.producerMachineId}</span>
              )}
              {j.hubState === "running" && typeof j.progress === "number" && (
                <span> {Math.round(j.progress * 100)}%</span>
              )}
            </p>
            {j.hubState === "running" && (
              <progress max={1} value={j.progress ?? 0} />
            )}
            {j.reason && <p className="fine-print">{j.reason}</p>}
          </div>
        ))}
      <details>
        <summary>Live activity</summary>
        <ol className="live-feed">
          {live.events.map((e) => (
            <li key={e._id}>
              <time dateTime={e.ts}>{time(e.ts)}</time> {e.summary}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

/** /live: every machine and the network's event feed, for the big screen. */
export function LivePage() {
  const machines = useQuery(anyApi.live.machines, {}) as
    | LiveMachine[]
    | undefined;
  const events = useQuery(anyApi.live.recentEvents, { limit: 40 }) as
    | LiveEvent[]
    | undefined;
  const summary = useQuery(anyApi.live.summary, {}) as
    | Record<string, number>
    | undefined;
  return (
    <section className="make live" aria-labelledby="live-title">
      <h1 id="live-title">Live network</h1>
      {summary && (
        <dl className="make-total live-counters">
          <div>
            <dt>Machines connected</dt>
            <dd>
              {summary.machinesOnline} of {summary.machines}
            </dd>
          </div>
          <div>
            <dt>Jobs printing</dt>
            <dd>{summary.jobsRunning}</dd>
          </div>
          <div>
            <dt>Jobs done</dt>
            <dd>{summary.jobsDone}</dd>
          </div>
        </dl>
      )}
      <h2>Machines</h2>
      <ul className="live-machines">
        {(machines ?? []).map((m) => (
          <li key={m._id} data-status={m.status}>
            <strong>{m.displayName}</strong>{" "}
            <span className="fine-print">
              {m.process.replace("_", " ")} ·{" "}
              {m.simulated ? "simulated" : "real"} ·{" "}
              {m.source === "producer" ? "node" : "registry"}
              {m.linkedMachineId ? ` → ${m.linkedMachineId}` : ""}
            </span>
            <span className="live-status">{m.status.replace("_", " ")}</span>
            {typeof m.mediaRemaining === "number" && (
              <span className="fine-print"> · {m.mediaRemaining} left</span>
            )}
          </li>
        ))}
      </ul>
      <h2>Activity</h2>
      <ol className="live-feed">
        {(events ?? []).map((e) => (
          <li key={e._id}>
            <time dateTime={e.ts}>{time(e.ts)}</time> {e.summary}
          </li>
        ))}
      </ol>
    </section>
  );
}
