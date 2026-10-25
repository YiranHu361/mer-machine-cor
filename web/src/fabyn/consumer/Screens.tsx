import { useEffect, useMemo, useState } from "react";
import { Stage3D, type StageItem } from "./Stage3D";
import { estimateJob, makingStartedAt, mmss, type JobProgress } from "./estimate";
import { toolCalls, kindForWait, assignmentsFor, itemTitle, orderTitle, phaseOf, type Phase, type ToolCall } from "./phase";
import {
  addSuggestion,
  assetUrl,
  changeRequest,
  chooseDesign,
  confirmOffer,
  describeError,
  moreLikeThis,
  plainReason,
  PREPARE_FAILED,
  REFRESH_CODES,
  stopWork,
} from "./orders";
import {
  KIND_OF_PROCESS,
  LABEL_OF_PROCESS,
  PLACE,
  PLACE_SHORT,
  machineLabel,
  type Assignment,
  type MachineKind,
  type OrderView,
} from "./model";
import { DeliveryMap } from "./DeliveryMap";

/* Every screen the order passes through. Each one reads the saved order and
   sends real actions; the only fake parts are the timing estimate and the
   delivery view. */

export interface ScreenProps {
  order: OrderView;
  setOrder: (o: OrderView) => void;
  reload: () => Promise<OrderView | null>;
  busy: string;
  run: (name: string, fn: () => Promise<OrderView>) => Promise<void>;
  error: string;
  now: number;
  onNew: () => void;
  photoUrls?: string[];
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function waitItem(o: OrderView): StageItem | null {
  const kind = kindForWait(o);
  const quoted = /"([^"]{1,24})"/.exec(o.draft.requestText)?.[1];
  const keychainText = o.plan?.items.find((i) => i.process === "fdm_print")?.design.text ?? quoted;
  if (kind === "a1mini") return { kind: "keychain", text: (keychainText ?? "KEEP").toUpperCase() };
  if (kind === "instax" && o.draft.photoAssetIds[0])
    return { kind: "photo", imageUrl: assetUrl(o.draft.photoAssetIds[0]) };
  const chosen = o.candidates?.candidates.find((c) => c.id === (o.candidates?.selectedId ?? o.candidates?.recommendedId));
  if (chosen) return { kind: "sticker", imageUrl: chosen.previewUrl };
  if (o.draft.photoAssetIds[0]) return { kind: "sticker", imageUrl: assetUrl(o.draft.photoAssetIds[0]) };
  return { kind: "sticker", text: (o.candidates?.subject ?? o.intent?.outcome ?? "your order").slice(0, 18) };
}

/** The item for one assignment: its own design preview, or the uploaded photo. */
export function assignmentItem(o: OrderView, a: Assignment): StageItem {
  const item = o.plan?.items.find((i) => i.id === a.itemId);
  const process = item?.process ?? "sticker_print";
  if (process === "fdm_print")
    return { kind: "keychain", text: (item?.design.text ?? "KEEP").toUpperCase() };
  const photoId = item?.design.photoAssetIds?.[0] ?? o.draft.photoAssetIds[0];
  if (process === "photo_print")
    return photoId ? { kind: "photo", imageUrl: assetUrl(photoId) } : { kind: "photo", text: item?.name ?? "photo" };
  const candidate = o.candidates?.candidates.find((c) => c.id === item?.design.candidateId);
  const url = a.previewUrl ?? candidate?.previewUrl ?? (photoId ? assetUrl(photoId) : undefined);
  return url ? { kind: "sticker", imageUrl: url } : { kind: "sticker", text: item?.name ?? "sticker" };
}

const KIND_LABEL: Record<MachineKind, string> = { a1mini: "keychain", m02pro: "sticker", instax: "photo" };

export function TitleBlock({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="cs-head">
      <h1 className="cs-title cs-title-sm">{title}</h1>
      {sub && <p className="cs-sub">{sub}</p>}
    </header>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="cs-actions">{children}</div>;
}

export function ErrorLine({ text }: { text: string }) {
  return text ? (
    <p role="alert" className="cs-error">
      {text}
    </p>
  ) : null;
}

/* ---------- 2 + 4: the wait, with the agent's real tool calls ---------- */

/** Tool calls are revealed one by one, so a plan the backend finishes in a
   fraction of a second still reads as the steps it went through. Only steps
   the saved order shows as done are ever marked done. */
const STEP_MS = 950;
const HOLD_MS = 1100;

export interface Pace {
  start: number;
  /** calls already shown as done when this reveal began */
  from: number;
}

const doneCount = (calls: ToolCall[]) => {
  const i = calls.findIndex((c) => !c.done);
  return i === -1 ? calls.length : i;
};

function shownCount(calls: ToolCall[], pace: Pace | undefined, now: number) {
  const done = doneCount(calls);
  if (!pace) return done;
  return Math.min(done, Math.max(pace.from, pace.from + Math.floor((now - pace.start) / STEP_MS)));
}

function paceFinished(calls: ToolCall[], pace: Pace, now: number) {
  const done = doneCount(calls);
  return now - pace.start >= Math.max(0, done - pace.from) * STEP_MS + HOLD_MS;
}

export function UnderstandScreen({
  order,
  onNew,
  pace,
  onPaced,
}: ScreenProps & { pace?: Pace; onPaced?: () => void }) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 120);
    return () => clearInterval(t);
  }, []);
  const calls = toolCalls(order);
  const shown = shownCount(calls, pace, clock);
  const finished = !!pace && phaseOf(order) !== "understand" && paceFinished(calls, pace, clock);
  useEffect(() => {
    if (finished) onPaced?.();
  }, [finished, onPaced]);
  const kind = kindForWait(order);
  const item = waitItem(order);
  const current = calls[shown]?.fn.replace(/_/g, " ") ?? "checking the plan";
  return (
    <section className="cs-stage-screen" aria-labelledby="cs-understand">
      <div className="cs-stage-grid">
        <div className="cs-tools-box">
          <p className="cs-kicker">tool calls · fabyn agent</p>
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
        <div className="cs-stage-box">
          <Stage3D
            machine={kind}
            item={item}
            progress={null}
            loop
            toolpath
            parked
            focus
            label={`${item && "text" in item && item.text ? item.text : "your item"} on the ${kind ?? "printer"}, toolpath being prepared`}
          />
        </div>
      </div>
      <TitleBlock
        title={order.draft.stage === "generating_candidates" ? "Drawing your drafts" : "Planning your order"}
        sub={`${current} · nothing is charged until you confirm`}
      />
      <Actions>
        <button className="cs-btn cs-btn-quiet" onClick={onNew}>
          start over
        </button>
      </Actions>
    </section>
  );
}

/* ---------- 3: pick a design ---------- */

export function DraftsScreen({ order, run, busy, error, onNew }: ScreenProps) {
  const c = order.candidates!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(order.draft.requestText);
  const exhausted = c.rounds >= c.maxRounds;
  return (
    <section className="cs-drafts" aria-labelledby="cs-drafts-title">
      <TitleBlock
        title="Pick a design"
        sub={`Round ${c.rounds} of ${c.maxRounds}. Drafts are design ideas: choosing one never charges or starts a machine.`}
      />
      <ul className="cs-cards" aria-label="Design drafts">
        {c.candidates.map((cand) => (
          <li key={cand.id} className={`cs-card ${cand.id === c.recommendedId ? "is-rec" : ""}`}>
            <img src={cand.previewUrl} alt={cand.title.replace(/\s*\(fixture\)\s*$/i, "")} width={512} height={512} />
            <div className="cs-card-body">
              <p className="cs-card-title">
                {cand.title.replace(/\s*\(fixture\)\s*$/i, "")}
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
        {exhausted && (
          <p className="cs-note">
            That was the last round of drafts. Pick one above, or change the request.
          </p>
        )}
        <button className="cs-btn cs-btn-quiet" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
          change the request
        </button>
        <button className="cs-btn cs-btn-quiet" onClick={onNew}>
          start over
        </button>
      </Actions>
      {editing && (
        <form
          className="cs-inline"
          onSubmit={(e) => {
            e.preventDefault();
            void run("edit", () => changeRequest(order, draft.trim()));
            setEditing(false);
          }}
        >
          <label htmlFor="cs-drafts-edit">Your request</label>
          <input id="cs-drafts-edit" value={draft} maxLength={2000} onChange={(e) => setDraft(e.target.value)} />
          <button className="cs-btn" disabled={!!busy || !draft.trim()}>
            draw again
          </button>
          <p className="cs-fine">Changing the request replaces the drafts. Nothing is charged.</p>
        </form>
      )}
      <ErrorLine text={error} />
    </section>
  );
}

/* ---------- 5 + 6: the proposal and the confirm ---------- */

export function ProposalScreen({ order, setOrder, run, busy, error, reload }: ScreenProps) {
  const plan = order.plan!;
  const [permission, setPermission] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [expiredNote, setExpiredNote] = useState("");
  const [unknown, setUnknown] = useState(false);
  const [localBusy, setBusyLocal] = useState(false);
  // one key per offer: a retry of the same confirmation replays it instead of charging twice
  const keyRef = useMemo(() => `${Date.now().toString(36)}-${crypto.randomUUID()}`, [order.offer?.id]);
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const expiresAt = order.offer ? Date.parse(order.offer.expiresAt) : 0;
  const left = Math.max(0, Math.round((expiresAt - clock) / 1000));
  const expired = !!order.offer && left === 0;
  const first = plan.items[0];
  const firstAssignment = plan.assignments.find((a) => a.itemId === first?.id);
  const kind = first ? KIND_OF_PROCESS[first.process] : "m02pro";
  const total = plan.payableCents;

  const confirm = async () => {
    setExpiredNote("");
    setUnknown(false);
    try {
      setBusyLocal(true);
      const next = await confirmOffer(order, keyRef);
      setOrder(next);
    } catch (e) {
      const d = describeError(e);
      if (d.unknown) {
        setUnknown(true);
        await reload();
      } else if (REFRESH_CODES.has(d.code)) {
        setExpiredNote("The offer changed or ran out. Here is the latest proposal; check it and confirm again.");
        await reload();
      } else {
        setExpiredNote(d.message);
      }
    } finally {
      setBusyLocal(false);
    }
  };
  const working = localBusy || busy === "confirm";

  return (
    <section className="cs-proposal" aria-labelledby="cs-proposal-title">
      <div className="cs-stage-box cs-stage-box-tall">
        <Stage3D
          machine={kind}
          item={firstAssignment ? assignmentItem(order, firstAssignment) : null}
          progress={null}
          focus
          label={`${first ? itemTitle(first) : "your item"} on the ${KIND_LABEL[kind]} machine`}
        />
      </div>
      <div className="cs-proposal-body">
        <header className="cs-head">
          <p className="cs-kicker">your proposal</p>
          <h1 id="cs-proposal-title" className="cs-title cs-title-sm">
            {orderTitle(order)}
          </h1>
        </header>
        <ul className="cs-items" aria-label="What will be made">
          {plan.items.map((item) => {
            const list = assignmentsFor(order, item.id);
            return (
              <li key={item.id} className="cs-item">
                <div>
                  {plan.items.length > 1 && (
                    <p className="cs-item-name">
                      {itemTitle(item)}
                      {item.quantity > 1 ? ` × ${item.quantity}` : ""}
                    </p>
                  )}
                  <p className="cs-item-why">{item.why}</p>
                </div>
                {list.map((a) => (
                  <p key={a.id} className="cs-item-machine">
                    <span>{machineLabel(a.machineId, a.machineName)}</span>
                    <span>{PLACE_SHORT}</span>
                    {a.price && <span>{usd(a.price.totalCents)}</span>}
                  </p>
                ))}
              </li>
            );
          })}
        </ul>
        <dl className="cs-facts">
          <div>
            <dt>total</dt>
            <dd>
              {total === 0 ? "$0.00" : usd(total)} <small>demo payment</small>
            </dd>
          </div>
          <div>
            <dt>ready in about</dt>
            <dd>{Math.max(1, plan.readyEstimateMinutes)} min</dd>
          </div>
          <div>
            <dt>collect at</dt>
            <dd>{PLACE}</dd>
          </div>
          {order.offer && (
            <div>
              <dt>offer holds</dt>
              <dd className={expired ? "is-err" : undefined}>{expired ? "ran out" : mmss(left)}</dd>
            </div>
          )}
        </dl>
        {order.suggestions.length > 0 && (
          <div className="cs-suggest" aria-label="Also make">
            <p className="cs-kicker">also make</p>
            <ul>
              {order.suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    className="cs-btn"
                    disabled={!!busy || working || expired}
                    onClick={() => void run("extra", () => addSuggestion(order, s.id, s.operation))}
                  >
                    {s.label} · about {usd(s.estimateCents)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {expired ? (
          <div className="cs-confirm">
            <p className="cs-note">This offer ran out. Prepare it again; nothing was charged.</p>
            <button
              className="cs-btn cs-btn-main"
              disabled={!!busy}
              onClick={() => void run("refresh", () => changeRequest(order, order.draft.requestText))}
            >
              prepare it again
            </button>
          </div>
        ) : (
          <form
            className="cs-confirm"
            onSubmit={(e) => {
              e.preventDefault();
              if (permission && !working) void confirm();
            }}
          >
            <label className="cs-check">
              <input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} disabled={working} />
              I own this design or have permission to make it
            </label>
            <button className="cs-btn cs-btn-main" disabled={!permission || working} aria-busy={working || undefined}>
              {total === 0
                ? "make it"
                : `pay ${usd(total)} (demo) & make`}
            </button>
            <p className="cs-fine">Demo payment: no funds move. Nothing is made until you confirm.</p>
          </form>
        )}
        {unknown && (
          <p role="alert" className="cs-error">
            We could not confirm whether this went through. We checked your order above. If it still shows a proposal, press the button again: it will not charge or make twice.
          </p>
        )}
        <ErrorLine text={expiredNote || error} />
        <Actions>
          <button className="cs-btn cs-btn-quiet" disabled={!!busy || working} onClick={() => void run("refresh", () => changeRequest(order, order.draft.requestText))}>
            prepare it again
          </button>
        </Actions>
      </div>
    </section>
  );
}

/* ---------- 7: making, one tile per job and machine ---------- */

const STATE_TEXT: Record<JobProgress["state"], string> = {
  queued: "waiting for the machine",
  making: "making",
  checking: "checking with the maker",
  finished: "made",
  failed: "not made",
};

export function JobTiles({ order, now }: { order: OrderView; now: number }) {
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
                label={`${item ? itemTitle(item) : "item"} on ${machine}, ${p.percent} percent`}
              />
            </div>
            <div className="cs-tile-body">
              <p className="cs-tile-name">{item ? itemTitle(item) : LABEL_OF_PROCESS.sticker_print}</p>
              <p className="cs-tile-machine">
                {machine} · {PLACE_SHORT}
              </p>
              <p className="cs-tile-state">
                <span>{STATE_TEXT[p.state]}</span>
                {p.state === "making" && <strong> · {p.percent}%</strong>}
                {eta && <span> · {eta}</span>}
              </p>
              <div
                className="cs-bar"
                role="progressbar"
                aria-label={`${item ? itemTitle(item) : "item"} progress`}
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

export function MakingScreen({ order, run, busy, error, now, onNew }: ScreenProps) {
  const plan = order.plan!;
  const startedAt = makingStartedAt(order.events);
  const waiting = plan.assignments.some(
    (a) => estimateJob(a, { now, startedAt, readyEstimateMinutes: plan.readyEstimateMinutes }).state === "checking",
  );
  const cancellable = ["approved", "in_progress"].includes(plan.status);
  return (
    <section className="cs-making" aria-labelledby="cs-making-title">
      <TitleBlock
        title={orderTitle(order)}
        sub={`Making at ${PLACE_SHORT}. You can leave this page; it keeps going and My orders shows it.`}
      />
      {waiting && (
        <p className="cs-banner" role="status">
          Finished pieces wait for the maker to check them before they are ready to collect.
        </p>
      )}
      <JobTiles order={order} now={now} />
      <ErrorLine text={error} />
      <Actions>
        {cancellable && (
          <button className="cs-btn cs-btn-quiet" disabled={!!busy} onClick={() => void run("cancel", () => stopWork(order))}>
            stop work that has not started
          </button>
        )}
        <button className="cs-btn" onClick={onNew}>
          place another order
        </button>
      </Actions>
    </section>
  );
}

/* ---------- 9: ready, then pick up now or delivery ---------- */

export function ReadyScreen({ order, onNew }: ScreenProps) {
  const plan = order.plan!;
  const [choice, setChoice] = useState<"pickup" | "delivery" | null>(null);
  const codes = plan.assignments.map((a) => a.child?.pickupCode).filter(Boolean) as string[];
  return (
    <section className="cs-ready" aria-labelledby="cs-ready-title">
      <TitleBlock title="Ready" sub={`${plan.items.length === 1 ? itemTitle(plan.items[0]) : `${plan.items.length} items`} · ${PLACE}`} />
      <ul className="cs-tiles" aria-label="Finished items">
        {plan.assignments.map((a) => {
          const item = plan.items.find((i) => i.id === a.itemId);
          const kind = item ? KIND_OF_PROCESS[item.process] : "m02pro";
          return (
            <li key={a.id} className="cs-tile is-finished">
              <div className="cs-tile-stage">
                <Stage3D machine={kind} item={assignmentItem(order, a)} progress={1} focus label={`${item ? itemTitle(item) : "item"}, finished`} />
              </div>
              <div className="cs-tile-body">
                <p className="cs-tile-name">{item ? itemTitle(item) : ""}</p>
                <p className="cs-tile-machine">{machineLabel(a.machineId, a.machineName)}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="cs-code" aria-live="polite">
        {codes.length ? (
          <p>
            pickup code <strong>{codes.join(" · ")}</strong>
          </p>
        ) : (
          <p>No pickup code for this print. Show this screen at the table and the maker hands it over.</p>
        )}
      </div>
      <fieldset className="cs-choice">
        <legend>How do you get it?</legend>
        <div className="cs-choice-row">
          <button className={`cs-btn ${choice === "pickup" ? "is-on" : ""}`} aria-pressed={choice === "pickup"} onClick={() => setChoice("pickup")}>
            pick up now
          </button>
          <button className={`cs-btn ${choice === "delivery" ? "is-on" : ""}`} aria-pressed={choice === "delivery"} onClick={() => setChoice("delivery")}>
            deliver to me
          </button>
        </div>
      </fieldset>
      {choice === "pickup" && (
        <div className="cs-panel">
          <p>It is right here. Go to {PLACE_SHORT}, find the machines and ask for your {codes.length ? "code" : "print"}.</p>
        </div>
      )}
      {choice === "delivery" && <DeliveryMap orderId={order.id} />}
      <Actions>
        <button className="cs-btn" onClick={onNew}>
          place another order
        </button>
      </Actions>
    </section>
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
  };
  const c = copy[phase] ?? { title: "", body: "" };
  return (
    <section className="cs-notice" aria-labelledby="cs-notice-title">
      {phase === "payment" && <Stage3D machine={null} item={null} progress={null} loop label="checking the payment" className="cs-notice-stage" />}
      <TitleBlock title={c.title} sub={c.body} />
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
      {phase === "partial" || phase === "needs_review" ? (
        <>
          <p className="cs-banner" role="status">
            {phase === "partial"
              ? "Some items are finished; the rest need attention. Nothing more is charged."
              : "The maker is checking this order before anything else happens."}
          </p>
          <JobTiles order={order} now={now} />
        </>
      ) : null}
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

