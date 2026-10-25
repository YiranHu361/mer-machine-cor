import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useOrder } from "./useOrder";
import { STATUS_TEXT, useMachines } from "./machines";
import { addSuggestion, changeRequest, chooseDelivery, describeError, plainReason, uploadPhotos, assetUrl } from "./orders";
import { clockTime } from "./estimate";
import { orderTitle, phaseOf, processesOf, realMachinesFor, itemTitle } from "./phase";
import { KIND_OF_PROCESS, LABEL_OF_PROCESS, MACHINE_NAME, MATCH_OF_PROCESS, PLACE_SHORT, machineLabel, type OrderView } from "./model";
import type { Profile } from "./profile";
import { Actions, ErrorLine, NoticeScreen, PriceBlock, TitleBlock, assignmentItem, usd, type ScreenProps } from "./Screens";
import { MachineStep, MapStep, UnderstandStep } from "./Find";
import { CheckoutStep, PreviewStep, QueueStep } from "./Order";
import { HandoffStep, PrintingStep } from "./After";
import { NOTICE_PHASES, STEPS, effectiveStep, stepForPhase, stepIndex, type Step } from "./steps";
import { Stage3D } from "./Stage3D";
import { cardKey, fabynEntry, readThread, saveThread, summaryOf, agentLine, youEntry, type Card, type ChatEntry, type LineContext } from "./thread";
import { deliveryChoice, deliveryFor, spotOf, useStreetRoute, useWhere } from "./location";
import { PALACE, distanceKm, formatKm } from "../shared/map";

/* The consumer's order as one chat thread. The first message creates the
   order; every later message before checkout is a new version of the request
   (the whole conversation, newest line last), which the server understands
   again. Each step of the order is a card in the thread, drawn by the same
   step components as before: the newest card is live, older ones fold to the
   line they left behind. Nothing here changes how an order is made, priced,
   paid, printed or handed over. */

export function Mark({ className = "cs-mark" }: { className?: string }) {
  const clip = useId();
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <defs>
        <clipPath id={clip}>
          <circle cx="12" cy="12" r="11" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`} style={{ fill: "var(--acc)" }}>
        <rect x="0" y="8.4" width="24" height="2.1" rx="1" />
        <rect x="0" y="11.5" width="24" height="2.1" rx="1" />
        <rect x="0" y="14.6" width="24" height="2.1" rx="1" />
        <rect x="0" y="17.7" width="24" height="2.1" rx="1" />
        <rect x="0" y="20.8" width="24" height="2.1" rx="1" />
      </g>
      <circle cx="12" cy="12" r="11" style={{ fill: "none", stroke: "var(--acc)", strokeOpacity: 0.5, strokeWidth: 0.8 }} />
    </svg>
  );
}

/* ---------- the chat box ---------- */

const MAX_PHOTOS = 4;
const MAX_BYTES = 12 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Checks picked photos: the type, the size and how many. Returns the files to keep and any problem. */
export function checkPhotos(picked: File[], already: number): { files: File[]; error: string } {
  const room = Math.max(0, MAX_PHOTOS - already);
  const bad = picked.find((f) => !TYPES.includes(f.type) || f.size > MAX_BYTES);
  if (bad) return { files: [], error: `${bad.name}: use a PNG, JPEG or WebP under 12 MB.` };
  if (picked.length > room) return { files: picked.slice(0, room), error: `Add up to ${MAX_PHOTOS} photos.` };
  return { files: picked, error: "" };
}

export function Composer({
  value,
  onChange,
  files,
  onFiles,
  onSend,
  placeholder,
  label,
  canSend,
  disabled,
  busy,
  chips,
  error,
  sendLabel = "send",
  fileInputId,
  big,
}: {
  value: string;
  onChange: (v: string) => void;
  files: File[];
  onFiles: (files: File[]) => void;
  onSend: () => void;
  placeholder: string;
  label: string;
  canSend: boolean;
  disabled?: boolean;
  busy?: boolean;
  chips?: ReactNode;
  error?: string;
  sendLabel?: string;
  /** lets a chip outside the box open the same photo picker */
  fileInputId?: string;
  big?: boolean;
}) {
  const ownId = useId();
  const inputId = `${ownId}-text`;
  const pickId = fileInputId ?? `${ownId}-photos`;
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  return (
    <form
      className={`cs-composer ${big ? "is-big" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend && !disabled && !busy) onSend();
      }}
    >
      {chips && (
        <div className="cs-chips" role="group" aria-label="Suggestions">
          {chips}
        </div>
      )}
      {previews.length > 0 && (
        <ul className="cs-thumbs cs-composer-thumbs" aria-label="Photos to send">
          {previews.map((src, i) => (
            <li key={src}>
              <img src={src} alt={`photo ${i + 1}: ${files[i]?.name ?? ""}`} />
              <button type="button" className="cs-link" disabled={busy} onClick={() => onFiles(files.filter((_, j) => j !== i))}>
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="cs-composer-row">
        <label className={`cs-attach ${disabled ? "is-off" : ""}`} title="add photos">
          <input
            id={pickId}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            disabled={disabled || busy}
            onChange={(e) => {
              onFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M16.5 6.5 8.4 14.6a2.1 2.1 0 0 0 3 3l8.3-8.3a4.2 4.2 0 0 0-6-6L5.4 11.6a6.3 6.3 0 0 0 8.9 8.9l6.2-6.2" />
          </svg>
          <span className="cs-visually-hidden">add photos</span>
        </label>
        <label htmlFor={inputId} className="cs-visually-hidden">
          {label}
        </label>
        <input
          id={inputId}
          className="cs-composer-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={500}
          autoComplete="off"
          disabled={disabled}
        />
        <button className="cs-btn cs-btn-main cs-send" type="submit" disabled={!canSend || disabled || busy} aria-busy={busy || undefined}>
          {busy ? "…" : sendLabel}
        </button>
      </div>
      {error && (
        <p role="alert" className="cs-error cs-composer-error">
          {error}
        </p>
      )}
    </form>
  );
}

/* ---------- messages ---------- */

function YouMessage({ e }: { e: Extract<ChatEntry, { who: "you" }> }) {
  return (
    <div className="cs-bubble">
        {e.photos && e.photos.length > 0 && (
          <ul className="cs-bubble-photos" aria-label="Photos you sent">
            {e.photos.map((id) => (
              <li key={id}>
                <img src={assetUrl(id)} alt="a photo you sent" />
              </li>
            ))}
          </ul>
        )}
      {e.text && <p>{e.text}</p>}
    </div>
  );
}

function Say({ children }: { children: ReactNode }) {
  return (
    <p className="cs-say">
      <Mark className="cs-say-mark" />
      <span>{children}</span>
    </p>
  );
}

/** A card the next one replaced: its line, one summary row and, if the step can be opened again, a link. */
function FoldedCard({ e, onOpen }: { e: Extract<ChatEntry, { who: "fabyn" }>; onOpen?: () => void }) {
  return (
    <>
      {e.line && <Say>{e.line}</Say>}
      <div className="cs-fold">
        <span className="cs-fold-text">{e.summary}</span>
        {e.thumbs.length > 0 && (
          <span className="cs-fold-thumbs" aria-hidden="true">
            {e.thumbs.map((src) => (
              <img key={src} src={src} alt="" />
            ))}
          </span>
        )}
        {onOpen && (
          <button className="cs-link" onClick={onOpen}>
            open again
          </button>
        )}
      </div>
    </>
  );
}

/* ---------- the pairing card: several things, several machines, one order ---------- */

export function PairingCard({ order, machines, go, name }: ScreenProps & { name: string }) {
  const processes = processesOf(order);
  const plan = order.plan;
  const spot = spotOf(useWhere());
  const rows = processes.map((p) => {
    const item = plan?.items.find((i) => i.process === p);
    const a = item ? plan?.assignments.find((x) => x.itemId === item.id) : undefined;
    const live = machines?.find((m) => m.id === a?.machineId) ?? realMachinesFor(machines, p)[0] ?? null;
    const minutes = a?.schedule ? Math.max(1, Math.ceil(a.schedule.finishSeconds / 60)) : null;
    return { p, item, a, live, minutes };
  });
  const free = rows.filter((r) => r.live?.status === "available").length;
  return (
    <section className="cs-pairing" aria-labelledby="cs-pairing-title">
      <TitleBlock
        id="cs-pairing-title"
        kicker={`pairing · ${rows.length} things · ${new Set(rows.map((r) => r.live?.id ?? r.p)).size} machines`}
        title="Each thing on its own machine"
        sub={`One order for ${name}, made side by side at the ${PLACE_SHORT}. ${free === rows.length ? "Every machine is free now." : `${free} of ${rows.length} machines are free now; the rest join their queue.`}`}
      />
      <ul className="cs-pairs" aria-label="What each machine makes">
        {rows.map(({ p, item, a, live, minutes }) => (
          <li key={p} className={`cs-pair ${live?.status === "available" ? "is-free" : ""}`}>
            <div className="cs-pair-stage">
              <Stage3D
                machine={KIND_OF_PROCESS[p]}
                item={a ? assignmentItem(order, a) : null}
                progress={null}
                focus={!!a}
                parked
                label={`${item ? itemTitle(item, order) : LABEL_OF_PROCESS[p]} on the ${live ? MACHINE_NAME[live.id] ?? live.model : MATCH_OF_PROCESS[p]}`}
              />
            </div>
            <div className="cs-pair-body">
              <p className="cs-pair-what">{item ? itemTitle(item, order) : `a ${LABEL_OF_PROCESS[p]}`}</p>
              <p className="cs-pair-arrow" aria-hidden="true">
                ↓
              </p>
              <p className="cs-pair-type">{MATCH_OF_PROCESS[p]}</p>
              <p className="cs-pair-machine">
                {live ? (a ? machineLabel(a.machineId, a.machineName) : MACHINE_NAME[live.id] ?? live.model) : "looking for a machine…"}
              </p>
              {live && (
                <p className="cs-pair-sub">
                  {live.owner} · {PLACE_SHORT} · {STATUS_TEXT[live.status]}
                  {spot ? ` · ${formatKm(distanceKm(spot, live.at))} from you` : ""}
                </p>
              )}
              <p className="cs-pair-eta">
                {minutes ? `ready in about ${minutes} min` : live?.current ? `after ${live.current.title}` : "time once the file is ready"}
                {a?.price ? ` · ${usd(a.price.totalCents)}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {plan ? <PriceBlock order={order} /> : <p className="cs-fine">The price and time show once each file is ready.</p>}
      <Actions>
        <button className="cs-btn cs-btn-main" onClick={() => go("preview")}>
          see your preview
        </button>
        <button className="cs-btn cs-btn-quiet" onClick={() => go("map")}>
          back to the map
        </button>
      </Actions>
    </section>
  );
}

/* ---------- a busy machine: wait for it, or take the other printer ---------- */

/** The machine the person asked for is busy. The server says when it should be
   free and may offer the other printer as a replace suggestion; nothing
   changes until the person presses one. */
export function BusyCard({ order, run, busy, error, onNew, now, go }: ScreenProps) {
  const freeAt = order.draft.freeAt ? Date.parse(order.draft.freeAt) : NaN;
  const minutes = Number.isFinite(freeAt) ? Math.max(0, Math.ceil((freeAt - now) / 60000)) : null;
  const freeNow = minutes === 0;
  const alternatives = order.suggestions.filter((s) => s.operation === "replace");
  const reason = plainReason(order.draft.reason, "The machines nearby are busy or not ready.");
  const retry = () => void run("retry", () => changeRequest(order, order.draft.requestText));
  return (
    <section className="cs-notice cs-busy" aria-labelledby="cs-busy-title">
      <TitleBlock
        id="cs-busy-title"
        kicker={minutes === null ? "busy right now" : freeNow ? "should be free now" : `busy · free about ${clockTime(order.draft.freeAt!)}`}
        title={freeNow ? "The machine should be free now" : minutes !== null ? `Free in about ${minutes} min` : "No machine can take this now"}
        sub={reason}
      />
      <div className="cs-busy-choices">
        <div className="cs-busy-choice">
          <p className="cs-kicker">wait for it</p>
          <button className={`cs-btn ${freeNow || !alternatives.length ? "cs-btn-main" : ""}`} disabled={!!busy} aria-busy={busy === "retry" || undefined} onClick={retry}>
            {freeNow ? "check again now" : "check again"}
          </button>
          <p className="cs-fine">{minutes !== null && !freeNow ? `Nothing changes; check again after about ${clockTime(order.draft.freeAt!)}.` : "Asks the machines again. Nothing is charged."}</p>
        </div>
        {alternatives.map((s) => (
          <div key={s.id} className="cs-busy-choice">
            <p className="cs-kicker">or take the other printer</p>
            <button
              className={`cs-btn ${freeNow ? "" : "cs-btn-main"}`}
              disabled={!!busy}
              aria-busy={busy === "alt" || undefined}
              onClick={async () => {
                // the other printer is the person's choice: straight on to its preview
                await run("alt", () => addSuggestion(order, s.id, "replace"));
                go("preview");
              }}
            >
              {s.label} · about {usd(s.estimateCents)}
            </button>
            {s.note && <p className="cs-fine">{s.note}</p>}
          </div>
        ))}
      </div>
      <ErrorLine text={error} />
      <Actions>
        <button className="cs-btn cs-btn-quiet" onClick={onNew}>
          start over
        </button>
      </Actions>
    </section>
  );
}

/* ---------- the progress strip ---------- */

/** The eight steps, with the open one marked. Steps already passed can be opened again. */
function StepRail({ current, reached, confirmed, onPick }: { current: Step; reached: number; confirmed: boolean; onPick: (s: Step) => void }) {
  const at = stepIndex(current);
  return (
    <nav className="cs-rail cs-chat-rail" aria-label="Order steps">
      <ol>
        {STEPS.map((s, i) => {
          const state = i === at ? "now" : i < at ? "done" : "todo";
          return (
            <li key={s.id} className={`is-${state}`}>
              {canReopen(s.id, i, at, reached, confirmed) ? (
                <button className="cs-rail-step" onClick={() => onPick(s.id)}>
                  <span>{i + 1}</span>
                  {s.label}
                </button>
              ) : (
                <span className="cs-rail-step" aria-current={state === "now" ? "step" : undefined}>
                  <span>{i + 1}</span>
                  {s.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function canReopen(s: Step, i: number, at: number, reached: number, confirmed: boolean) {
  const before = i < stepIndex("checkout");
  return i !== at && i <= reached && s !== "understand" && (confirmed ? !before && s !== "checkout" : before || s === "queue");
}

/* ---------- the thread ---------- */

const REVISABLE = (phase: string) => !["understand", "payment", "making", "ready", "partial", "needs_review", "cancelled", "superseded", "payment_failed"].includes(phase);

export function OrderThread({
  id,
  fresh,
  initial,
  profile,
  onNew,
  onOrders,
}: {
  id: string;
  fresh: boolean;
  initial: OrderView | null;
  profile: Profile;
  onNew: () => void;
  onOrders: () => void;
}) {
  const { order, setOrder, error, reload } = useOrder(id, { initial });
  const { machines } = useMachines(4000);
  const where = useWhere();
  const spot = spotOf(where);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [step, setStep] = useState<Step | null>(fresh ? "understand" : null);
  const [reached, setReached] = useState(0);
  const [entries, setEntries] = useState<ChatEntry[]>(() => readThread(id));
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  // after a change in the chat the map is not shown again: understanding goes on to the pairing or the preview
  const afterUnderstand = useRef<{ processes: number } | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const phase = order ? phaseOf(order) : null;
  useEffect(() => {
    if (step === null && phase) setStep(stepForPhase(phase));
  }, [step, phase]);
  const shown = step && phase ? effectiveStep(step, phase) : null;
  useEffect(() => {
    if (shown) setReached((r) => Math.max(r, stepIndex(shown)));
    if (shown && step && shown !== step) setStep(shown);
  }, [shown, step]);
  // once Lucas hands it over, printing moves on to the delivery or pickup
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (prevPhase.current !== "ready" && phase === "ready" && step === "printing") setStep("handoff");
    prevPhase.current = phase;
  }, [phase, step]);
  const goStep = useCallback((s: Step) => {
    setActionError("");
    setStep(s);
  }, []);
  // the understanding card moves on by itself; after a chat change it skips the map
  const goFromUnderstand = useCallback(
    (s: Step) => {
      const after = afterUnderstand.current;
      if (s === "map" && after) {
        afterUnderstand.current = null;
        const o = orderRef.current;
        const n = o ? processesOf(o).length : 0;
        goStep(n > 1 && n !== after.processes ? "machine" : "preview");
        return;
      }
      goStep(s);
    },
    [goStep],
  );
  const run = useCallback(
    async (name: string, fn: () => Promise<OrderView>) => {
      setBusy(name);
      setActionError("");
      try {
        setOrder(await fn());
      } catch (e) {
        const d = describeError(e);
        if (d.unknown) {
          setActionError("The result is unknown; the order may still have changed. We refreshed it. Nothing was made twice.");
          await reload();
        } else if (["STALE_DRAFT", "STALE_CHOICE", "STALE_SUGGESTION", "STALE_OFFER", "OFFER_EXPIRED", "PLAN_CHANGED"].includes(d.code)) {
          setActionError("This changed while you were looking. Here is the latest.");
          await reload();
        } else if (d.code === "ROUNDS_EXHAUSTED") {
          setActionError("That was the last round of drafts. Pick one, or change the request.");
          await reload();
        } else {
          setActionError(d.message);
        }
      } finally {
        setBusy("");
      }
    },
    [reload, setOrder],
  );

  const notice = !!phase && (NOTICE_PHASES.includes(phase) || phase === "partial" || phase === "needs_review" || phase === "payment");
  const card: Card | null = !shown || !phase ? null : notice ? "notice" : shown;
  const revised = entries.filter((e) => e.who === "you").length > 1;
  const ctx: LineContext = useMemo(() => ({ machines, spot, name: profile.name, now, revised }), [machines, spot, profile.name, now, revised]);

  // the thread: the first message, then a card per step and revision; the live card's line keeps up with the order
  useEffect(() => {
    if (!order || !card || !phase) return;
    setEntries((prev) => {
      let list = prev;
      if (!list.some((e) => e.who === "you")) list = [youEntry(order.draft.requestText, order.draft.photoAssetIds), ...list];
      const i = list.map((e) => e.who).lastIndexOf("fabyn");
      const live = i >= 0 ? (list[i] as Extract<ChatEntry, { who: "fabyn" }>) : null;
      if (live && cardKey(live.card, live.phase) === cardKey(card, phase) && live.rev === order.draft.revision) {
        const line = agentLine(card, order, ctx, phase);
        const snap = summaryOf(card, order, ctx, phase);
        if (line === live.line && snap.summary === live.summary && snap.thumbs.join() === live.thumbs.join()) return list;
        const next = [...list];
        next[i] = { ...live, line, ...snap };
        return next;
      }
      return [...list, fabynEntry(card, order, ctx, phase)];
    });
  }, [order, card, phase, ctx]);
  useEffect(() => {
    if (entries.length) saveThread(id, entries);
  }, [id, entries]);

  // a new message or card scrolls into view
  const lastRef = useRef<HTMLLIElement | null>(null);
  const count = entries.length;
  const seen = useRef(count);
  useEffect(() => {
    if (count > seen.current) lastRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    seen.current = count;
  }, [count]);

  // pickup or delivery from the chat box once it's paid
  const reach = deliveryFor(spot);
  const pickRoute = useStreetRoute(PALACE, order?.makeIntent && !order.delivery && reach.ok ? spot : null);

  if (!order || !shown || !phase || !card)
    return (
      <section className="cs-loading" aria-live="polite">
        <Stage3D machine={null} item={null} progress={null} loop label="getting your order" className="cs-notice-stage" />
        <p className="cs-note">{error ? `Could not load the order: ${error}` : "Getting your order…"}</p>
        {error && (
          <button className="cs-btn" onClick={() => void reload()}>
            try again
          </button>
        )}
      </section>
    );

  const confirmed = !!order.makeIntent;
  const props: ScreenProps = {
    order,
    setOrder,
    reload,
    busy,
    run,
    error: actionError || error,
    now,
    onNew,
    onOrders,
    go: goStep,
    machines,
    fresh,
  };
  const liveIndex = entries.map((e) => e.who).lastIndexOf("fabyn");
  const multi = processesOf(order).length > 1;

  const liveCard = (() => {
    if (card === "notice") {
      if (phase === "question")
        return (
          <section className="cs-notice cs-question" aria-labelledby="cs-question-title">
            <TitleBlock id="cs-question-title" kicker="one question first" title={order.intent?.question || "Add a little detail to the request."} sub="Answer in the box below." />
            <ErrorLine text={actionError || error} />
            <Actions>
              <button className="cs-btn cs-btn-quiet" onClick={onNew}>
                start over
              </button>
            </Actions>
          </section>
        );
      if (phase === "unavailable") return <BusyCard {...props} />;
      return <NoticeScreen {...props} phase={phase} />;
    }
    switch (shown) {
      case "understand":
        return <UnderstandStep {...props} fresh={fresh || revised} go={goFromUnderstand} />;
      case "map":
        return <MapStep {...props} />;
      case "machine":
        return multi ? <PairingCard {...props} name={profile.name} /> : <MachineStep {...props} />;
      case "preview":
        return <PreviewStep key={`${order.draft.revision}`} {...props} />;
      case "queue":
        return <QueueStep {...props} />;
      case "checkout":
        return <CheckoutStep key={order.offer?.id} {...props} />;
      case "printing":
        return <PrintingStep {...props} />;
      case "handoff":
        return <HandoffStep {...props} />;
    }
  })();

  /* ---------- sending ---------- */
  const working = phase === "understand" || !!busy;
  const closed = ["cancelled", "superseded", "payment_failed"].includes(phase);
  const canChange = !confirmed && !closed && REVISABLE(phase);
  const send = async () => {
    const message = text.trim();
    if ((!message && !files.length) || !canChange) return;
    setSendError("");
    setSending(true);
    try {
      const photos = files.length ? await uploadPhotos(files) : [];
      const requestText = [order.draft.requestText, message].filter(Boolean).join("\n").slice(-2000);
      const next = await changeRequest(order, requestText, photos.length ? [...order.draft.photoAssetIds, ...photos].slice(-4) : undefined);
      setEntries((prev) => [...prev, youEntry(message, photos)]);
      setText("");
      setFiles([]);
      afterUnderstand.current = stepIndex("map") <= reached ? { processes: processesOf(order).length } : null;
      setOrder(next);
      goStep("understand");
    } catch (e) {
      const d = describeError(e);
      if (["STALE_DRAFT", "STALE_CHOICE", "PLAN_CHANGED"].includes(d.code)) {
        setSendError("The order changed while you were typing. Here is the latest; send it again.");
        await reload();
      } else setSendError(d.unknown ? "We could not tell whether that went through. We refreshed the order; send it again if nothing changed." : d.message);
    } finally {
      setSending(false);
    }
  };
  const placeholder = confirmed
    ? "This order is paid. Start a new one to change it."
    : closed
      ? "This order is closed. Start a new one."
      : working
        ? "fabyn is working on it…"
        : phase === "question"
          ? "Answer fabyn…"
          : phase === "drafts"
            ? "Tell fabyn what to change, e.g. make it wear a hat"
            : "Tell fabyn what to change, or add another thing";
  const chooseFromChat = (mode: "delivery" | "pickup") => {
    const choice = deliveryChoice(mode, where, mode === "delivery" ? pickRoute : null);
    if (choice) void run("delivery", () => chooseDelivery(order, choice));
  };
  // once it's paid, the box keeps only the pickup-or-delivery choice, until it's made
  const chips =
    confirmed && !order.delivery ? (
      <>
        <button type="button" className="cs-chip" disabled={!reach.ok || !!busy} title={reach.ok ? undefined : reach.why} onClick={() => chooseFromChat("delivery")}>
          deliver to me
        </button>
        <button type="button" className="cs-chip" disabled={!!busy} onClick={() => chooseFromChat("pickup")}>
          I&apos;ll pick it up
        </button>
      </>
    ) : undefined;

  return (
    <section className="cs-chat" aria-labelledby="cs-chat-title">
      <header className="cs-chat-head">
        <p className="cs-kicker">
          {order.requesterName || profile.name}&apos;s order{order.source === "asi1" ? " · via ASI:One" : ""}
        </p>
        <h2 id="cs-chat-title" className="cs-chat-title">
          {orderTitle(order)}
        </h2>
        <StepRail current={shown} reached={reached} confirmed={confirmed} onPick={goStep} />
      </header>
      <ol className="cs-thread" aria-label="Your conversation with fabyn">
        {entries.map((e, i) => {
          const ref = i === entries.length - 1 ? lastRef : undefined;
          if (e.who === "you")
            return (
              <li key={e.id} ref={ref} className="cs-msg is-you">
                <YouMessage e={e} />
              </li>
            );
          if (i === liveIndex)
            return (
              <li key={e.id} ref={ref} className="cs-msg is-fabyn is-live">
                <Say>{agentLine(card, order, ctx, phase)}</Say>
                <div className="cs-live">{liveCard}</div>
              </li>
            );
          const s = e.card !== "notice" ? e.card : null;
          const open = s && canReopen(s, stepIndex(s), stepIndex(shown), reached, confirmed) && s !== shown ? () => goStep(s) : undefined;
          return (
            <li key={e.id} ref={ref} className="cs-msg is-fabyn is-folded">
              <FoldedCard e={e} onOpen={open} />
            </li>
          );
        })}
      </ol>
      <Composer
        value={text}
        onChange={setText}
        files={files}
        onFiles={(picked) => {
          const c = checkPhotos(picked, files.length);
          setSendError(c.error);
          setFiles([...files, ...c.files]);
        }}
        onSend={() => void send()}
        placeholder={placeholder}
        label="Message fabyn"
        canSend={canChange && !working && (!!text.trim() || files.length > 0)}
        disabled={!canChange}
        busy={sending}
        chips={chips}
        error={sendError}
      />
    </section>
  );
}

