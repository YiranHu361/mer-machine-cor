import { useEffect, useState, type ReactNode } from "react";
import { Stage3D, type StageItem } from "./Stage3D";
import { estimateJob, makingStartedAt, mmss, type JobProgress } from "./estimate";
import { kindForWait, itemTitle, type Phase, type ToolCall } from "./phase";
import { assetUrl, changeRequest, chooseDesign, moreLikeThis, plainReason, PREPARE_FAILED } from "./orders";
import { KIND_OF_PROCESS, LABEL_OF_PROCESS, PLACE_SHORT, machineLabel, type Assignment, type OrderView } from "./model";
import type { LiveMachine } from "./machines";
import type { Step } from "./steps";

/* Pieces every step shares, the design drafts, the job tiles and the notices.
   Each one reads the saved order and sends real actions; the only fake parts
   are the timing estimate and the delivery view (estimate.ts). */

export interface ScreenProps {
  order: OrderView;
  setOrder: (o: OrderView) => void;
  reload: () => Promise<OrderView | null>;
  busy: string;
  run: (name: string, fn: () => Promise<OrderView>) => Promise<void>;
  error: string;
  now: number;
  onNew: () => void;
  onOrders: () => void;
  go: (step: Step) => void;
  machines: LiveMachine[] | null;
  /** a new order: tool calls are revealed one by one */
  fresh: boolean;
}

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const cleanTitle = (t: string) => t.replace(/\s*\(fixture\)\s*$/i, "");

const quotedName = (o: OrderView) => /"([^"]{1,24})"/.exec(o.draft.requestText)?.[1];

export function waitItem(o: OrderView): StageItem | null {
  const kind = kindForWait(o);
  const fdm = o.plan?.items.find((i) => i.process === "fdm_print");
  if (kind === "a1mini") {
    const a = fdm && o.plan?.assignments.find((x) => x.itemId === fdm.id);
    return { kind: "keychain", text: fdm?.design.text ?? quotedName(o) ?? "Keep", sizeMm: a?.parameters?.model_size_mm };
  }
  if (kind === "instax" && o.draft.photoAssetIds[0]) return { kind: "photo", imageUrl: assetUrl(o.draft.photoAssetIds[0]) };
  const chosen = o.candidates?.candidates.find((c) => c.id === (o.candidates?.selectedId ?? o.candidates?.recommendedId));
  if (chosen) return { kind: "sticker", imageUrl: chosen.previewUrl };
  if (o.draft.photoAssetIds[0]) return { kind: "sticker", imageUrl: assetUrl(o.draft.photoAssetIds[0]) };
  return { kind: "sticker", text: (o.candidates?.subject ?? o.intent?.outcome ?? "your order").slice(0, 18) };
}

/** The item for one assignment: its own design preview, or the uploaded photo. */
export function assignmentItem(o: OrderView, a: Assignment): StageItem {
  const item = o.plan?.items.find((i) => i.id === a.itemId);
  const process = item?.process ?? "sticker_print";
  if (process === "fdm_print") return { kind: "keychain", text: item?.design.text ?? "Keep", sizeMm: a.parameters?.model_size_mm };
  const photoId = item?.design.photoAssetIds?.[0] ?? o.draft.photoAssetIds[0];
  if (process === "photo_print")
    return a.previewUrl
      ? { kind: "photo", imageUrl: a.previewUrl }
      : photoId
        ? { kind: "photo", imageUrl: assetUrl(photoId) }
        : { kind: "photo", text: item?.name ?? "photo" };
  const candidate = o.candidates?.candidates.find((c) => c.id === item?.design.candidateId);
  const url = a.previewUrl ?? candidate?.previewUrl ?? (photoId ? assetUrl(photoId) : undefined);
  return url ? { kind: "sticker", imageUrl: url } : { kind: "sticker", text: item?.name ?? "sticker" };
}

export function TitleBlock({ kicker, title, sub, id }: { kicker?: string; title: string; sub?: ReactNode; id?: string }) {
  return (
    <header className="cs-head">
      {kicker && <p className="cs-kicker">{kicker}</p>}
      <h1 id={id} className="cs-title cs-title-sm">
        {title}
      </h1>
      {sub && <p className="cs-sub">{sub}</p>}
    </header>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className="cs-actions">{children}</div>;
}

export function ErrorLine({ text }: { text: string }) {
  return text ? (
    <p role="alert" className="cs-error">
      {text}
    </p>
  ) : null;
}

/* ---------- tool calls, revealed one by one ---------- */

/** A plan the backend finishes in a fraction of a second still reads as the
   steps it went through. Only steps the saved order shows as done are ever
   marked done. */
const STEP_MS = 900;
const HOLD_MS = 1000;

const doneCount = (calls: ToolCall[]) => {
  const i = calls.findIndex((c) => !c.done);
  return i === -1 ? calls.length : i;
};

/** How many calls to show as done, and whether the last one has been on screen long enough. */
export function usePaced(calls: ToolCall[], instant: boolean) {
  const done = doneCount(calls);
  const [shown, setShown] = useState(instant ? done : 0);
  useEffect(() => {
    if (shown >= done) return;
    const t = setTimeout(() => setShown((s) => s + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [shown, done]);
  const visible = Math.min(shown, done);
  const all = calls.length > 0 && visible >= calls.length;
  const [settled, setSettled] = useState(instant && all);
  useEffect(() => {
    if (!all) {
      setSettled(false);
      return;
    }
    const t = setTimeout(() => setSettled(true), instant ? 0 : HOLD_MS);
    return () => clearTimeout(t);
  }, [all, instant]);
  return { shown: visible, settled };
}

export function ToolList({ calls, shown, label = "tool calls · fabyn agent" }: { calls: ToolCall[]; shown: number; label?: string }) {
  return (
    <div className="cs-tools-box">
      <p className="cs-kicker">{label}</p>
      <ol className="cs-tools" aria-label="Tool calls the agent is running" aria-live="polite">
        {calls.map((c, i) => {
          const state = i < shown ? "done" : i === shown ? "run" : "todo";
          return (
            <li key={c.fn} className={`cs-tool is-${state}`} aria-current={state === "run" ? "step" : undefined}>
              <span className="cs-tool-mark" aria-hidden="true">
                {state === "done" ? "✓" : state === "run" ? "▸" : "·"}
              </span>
              <div className="cs-tool-body">
                <code className="cs-tool-fn">
                  {c.fn}
                  <span>({c.arg})</span>
                </code>
                {state === "done" && c.result && <p className="cs-tool-result">→ {c.result}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------- design drafts ---------- */

export function DraftsPanel({ order, run, busy, error, onNew }: ScreenProps) {
  const c = order.candidates!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(order.draft.requestText);
  const exhausted = c.rounds >= c.maxRounds;
  return (
    <section className="cs-drafts" aria-labelledby="cs-drafts-title">
      <TitleBlock
        id="cs-drafts-title"
        kicker={`preview · round ${c.rounds} of ${c.maxRounds}`}
        title="Pick a design"
        sub="These are drafts. Picking one prepares the print file; nothing is ordered until you confirm at checkout."
      />
      <ul className="cs-cards" aria-label="Design drafts">
        {c.candidates.map((cand) => (
          <li key={cand.id} className={`cs-card ${cand.id === c.recommendedId ? "is-rec" : ""}`}>
            <img src={cand.previewUrl} alt={cleanTitle(cand.title)} width={512} height={512} />
            <div className="cs-card-body">
              <p className="cs-card-title">
                {cleanTitle(cand.title)}
                {cand.id === c.recommendedId && <em> · recommended</em>}
              </p>
              <button
                className="cs-btn"
                disabled={!!busy || c.status !== "ready"}
                aria-busy={busy === "choose" || undefined}
                onClick={() => void run("choose", () => chooseDesign(order, cand.id))}
              >
                use this design
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Actions>
        {c.status === "ready" && !exhausted && (
          <button className="cs-btn" disabled={!!busy} onClick={() => void run("more", () => moreLikeThis(order))}>
            more like this
          </button>
        )}
        {exhausted && <p className="cs-note">That was the last round of drafts. Pick one above, or change the request.</p>}
        <button className="cs-btn cs-btn-quiet" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
          change the request
        </button>
        <button className="cs-btn cs-btn-quiet" onClick={onNew}>
          start over
        </button>
      </Actions>
      {editing && (
        <ChangeForm
          order={order}
          busy={busy}
          run={run}
          value={draft}
          onChange={setDraft}
          onDone={() => setEditing(false)}
          button="draw again"
          note="Changing the request replaces the drafts. Nothing is charged."
        />
      )}
      <ErrorLine text={error} />
    </section>
  );
}

export function ChangeForm({
  order,
  busy,
  run,
  value,
  onChange,
  onDone,
  button,
  note,
}: Pick<ScreenProps, "order" | "busy" | "run"> & {
  value: string;
  onChange: (v: string) => void;
  onDone: () => void;
  button: string;
  note: string;
}) {
  return (
    <form
      className="cs-inline"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        void run("edit", () => changeRequest(order, value.trim()));
        onDone();
      }}
    >
      <label htmlFor="cs-change">Your request</label>
      <input id="cs-change" value={value} maxLength={2000} onChange={(e) => onChange(e.target.value)} />
      <button className="cs-btn" disabled={!!busy || !value.trim()}>
        {button}
      </button>
      <p className="cs-fine">{note}</p>
    </form>
  );
}

/* ---------- one tile per job and machine ---------- */

export const STATE_TEXT: Record<JobProgress["state"], string> = {
  queued: "waiting for the machine",
  making: "printing",
  handover: "printed",
  finished: "ready",
  failed: "not made",
};

export function JobTiles({ order, now, owner = "Lucas" }: { order: OrderView; now: number; owner?: string }) {
  const plan = order.plan!;
  const startedAt = makingStartedAt(order.events);
  return (
    <ul className="cs-tiles" aria-label="Jobs on machines">
      {plan.assignments.map((a) => {
        const p = estimateJob(a, { now, startedAt, readyEstimateMinutes: plan.readyEstimateMinutes });
        const item = plan.items.find((i) => i.id === a.itemId);
        const kind = item ? KIND_OF_PROCESS[item.process] : "m02pro";
        const machine = machineLabel(a.machineId, a.machineName);
        const eta = p.etaSeconds !== null && p.state !== "finished" ? `about ${mmss(p.etaSeconds)} left` : "";
        return (
          <li key={a.id} className={`cs-tile is-${p.state}`}>
            <div className="cs-tile-stage">
              <Stage3D
                machine={kind}
                item={assignmentItem(order, a)}
                progress={p.state === "queued" ? 0 : p.percent / 100}
                focus
                label={`${item ? itemTitle(item, order) : "item"} on ${machine}, ${p.percent} percent`}
              />
            </div>
            <div className="cs-tile-body">
              <p className="cs-tile-name">{item ? itemTitle(item, order) : LABEL_OF_PROCESS.sticker_print}</p>
              <p className="cs-tile-machine">
                {machine} · {owner} · {PLACE_SHORT}
              </p>
              <p className="cs-tile-state">
                <span>{STATE_TEXT[p.state]}</span>
                {p.state === "making" && <strong> · {p.percent}%</strong>}
                {eta && <span> · {eta}</span>}
                {p.state === "handover" && <span> · {owner} is taking it off the machine</span>}
                {p.state === "finished" && <span> · {owner} handed it over</span>}
              </p>
              <div
                className="cs-bar"
                role="progressbar"
                aria-label={`${item ? itemTitle(item, order) : "item"} progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={p.percent}
              >
                <i style={{ width: `${p.percent}%` }} />
              </div>
              {a.child?.pickupCode && <p className="cs-tile-code">pickup code {a.child.pickupCode}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- problems and stops ---------- */

export function NoticeScreen({ phase, order, run, busy, error, onNew, now }: ScreenProps & { phase: Phase }) {
  const [answer, setAnswer] = useState("");
  const reason = plainReason(order.draft.reason || order.candidates?.reason, "");
  const copy: Record<string, { title: string; body: string }> = {
    payment: { title: "Checking your payment", body: "Your payment is still being confirmed. Nothing has been made yet." },
    payment_failed: { title: "Payment failed", body: "Payment failed; nothing was made. Start again when you are ready." },
    unavailable: { title: "No machine can take this now", body: reason || "The machines nearby are busy or not ready. Try again in a moment." },
    failed: { title: "Something stopped the plan", body: reason || PREPARE_FAILED },
    cancelled: { title: "This order was stopped", body: "Nothing else will be made for it." },
    superseded: { title: "This request was replaced", body: "A newer version of the request is in progress." },
    question: {
      title: "One question first",
      body: order.intent?.question || "The request is not clear enough. Add a little detail.",
    },
    partial: { title: "Partly finished", body: "Some items are finished; the rest need attention. Nothing more is charged." },
    needs_review: { title: "The maker is looking at this order", body: "Lucas is checking it before anything else happens." },
  };
  const c = copy[phase] ?? { title: "", body: "" };
  return (
    <section className="cs-notice" aria-labelledby="cs-notice-title">
      {phase === "payment" && <Stage3D machine={null} item={null} progress={null} loop label="checking the payment" className="cs-notice-stage" />}
      <TitleBlock id="cs-notice-title" title={c.title} sub={c.body} />
      {phase === "question" && (
        <form
          className="cs-inline"
          onSubmit={(e) => {
            e.preventDefault();
            void run("edit", () => changeRequest(order, `${order.draft.requestText} ${answer}`.trim()));
          }}
        >
          <label htmlFor="cs-answer">Your answer</label>
          <input id="cs-answer" value={answer} maxLength={500} onChange={(e) => setAnswer(e.target.value)} />
          <button className="cs-btn" disabled={!!busy || !answer.trim()}>
            send answer
          </button>
        </form>
      )}
      {(phase === "partial" || phase === "needs_review") && order.plan && <JobTiles order={order} now={now} />}
      <ErrorLine text={error} />
      <Actions>
        {(phase === "unavailable" || phase === "failed") && (
          <button className="cs-btn" disabled={!!busy} onClick={() => void run("retry", () => changeRequest(order, order.draft.requestText))}>
            try again
          </button>
        )}
        <button className={`cs-btn ${phase === "unavailable" || phase === "failed" ? "cs-btn-quiet" : ""}`} onClick={onNew}>
          {phase === "cancelled" || phase === "superseded" || phase === "payment_failed" ? "start a new order" : "start over"}
        </button>
      </Actions>
    </section>
  );
}
