import { useEffect, useMemo, useState } from "react";
import { Stage3D } from "./Stage3D";
import {
  Actions,
  ChangeForm,
  DraftsPanel,
  ErrorLine,
  TitleBlock,
  ToolList,
  assignmentItem,
  usd,
  usePaced,
  waitItem,
  type ScreenProps,
} from "./Screens";
import { itemTitle, kindForWait, matchedMachine, orderTitle, phaseOf, prepareCalls, preparedSize } from "./phase";
import { addSuggestion, changeRequest, describeError, REFRESH_CODES } from "./orders";
import { KIND_OF_PROCESS, MACHINE_NAME, PLACE, PLACE_SHORT, machineLabel, type OrderView } from "./model";
import { COURIER, RIDE_SECONDS, mmss } from "./estimate";
import { hasBrowserWallet, isTestnet, payOrder, paymentConfig, walletMessage, type PayMethod, type PaymentConfig } from "./checkout";
import { readHandoff, saveHandoff, type Handoff } from "./profile";
import { HOME } from "../shared/map";

/* Steps 4–6: the preview (drafts, or the real prepared file), the machine's
   queue with this order joining it, and checkout. Nothing is ordered until
   checkout confirms. */

function useOfferClock(order: OrderView) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const expiresAt = order.offer ? Date.parse(order.offer.expiresAt) : 0;
  const left = Math.max(0, Math.round((expiresAt - clock) / 1000));
  return { left, expired: !!order.offer && left === 0 };
}

function Expired({ order, run, busy }: Pick<ScreenProps, "order" | "run" | "busy">) {
  return (
    <div className="cs-confirm">
      <p className="cs-note">The hold on this machine ran out. Prepare it again; nothing was charged.</p>
      <button className="cs-btn cs-btn-main" disabled={!!busy} onClick={() => void run("refresh", () => changeRequest(order, order.draft.requestText))}>
        prepare it again
      </button>
    </div>
  );
}

/* ---------- 4: preview ---------- */

export function PreviewStep(props: ScreenProps) {
  const { order, fresh, go, busy, run, error, onNew } = props;
  const phase = phaseOf(order);
  const calls = prepareCalls(order);
  const { shown, settled } = usePaced(calls, !fresh);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(order.draft.requestText);
  const { expired } = useOfferClock(order);
  if (phase === "drafts") return <DraftsPanel {...props} />;
  const plan = order.plan;
  if (phase !== "proposal" || !plan || !settled) {
    const kind = kindForWait(order);
    const item = waitItem(order);
    return (
      <section className="cs-stage-screen" aria-labelledby="cs-prepare">
        <div className="cs-stage-grid">
          <ToolList calls={calls} shown={shown} />
          <div className="cs-stage-box">
            <Stage3D machine={kind} item={item} progress={null} loop toolpath parked focus label="your print file being prepared" />
          </div>
        </div>
        <TitleBlock
          id="cs-prepare"
          kicker="preview"
          title={order.candidates?.selectedId ? "Preparing the design you picked" : "Preparing your print file"}
          sub={`${calls[shown]?.fn.replace(/_/g, " ") ?? "rendering the preview"} · nothing is ordered until you confirm`}
        />
        <ErrorLine text={error} />
        <Actions>
          <button className="cs-btn cs-btn-quiet" onClick={onNew}>
            start over
          </button>
        </Actions>
      </section>
    );
  }
  const single = plan.assignments.length === 1;
  return (
    <section className="cs-preview" aria-labelledby="cs-preview-title">
      <TitleBlock
        id="cs-preview-title"
        kicker="preview · nothing ordered yet"
        title={orderTitle(order)}
        sub="This is the file the machine will print. Nothing is ordered until you confirm at checkout."
      />
      <ul className={`cs-previews ${single ? "is-single" : ""}`} aria-label="What will be made">
        {plan.assignments.map((a) => {
          const item = plan.items.find((i) => i.id === a.itemId);
          const kind = item ? KIND_OF_PROCESS[item.process] : "m02pro";
          const size = preparedSize(a);
          return (
            <li key={a.id} className="cs-prev">
              <figure className="cs-prev-file">
                {a.previewUrl ? (
                  <img src={a.previewUrl} alt={`Rendered print file for ${item ? itemTitle(item) : "your item"}`} />
                ) : (
                  <p className="cs-note">No rendered preview for this one.</p>
                )}
                <figcaption>the print file{size ? ` · ${size}` : ""}</figcaption>
              </figure>
              <div className="cs-prev-stage">
                <Stage3D machine={kind} item={assignmentItem(order, a)} progress={null} focus label={`${item ? itemTitle(item) : "your item"} on the ${machineLabel(a.machineId, a.machineName)}`} />
              </div>
              <div className="cs-prev-body">
                {!single && item && <p className="cs-item-name">{itemTitle(item)}</p>}
                {item?.why && <p className="cs-item-why">{item.why}</p>}
                <p className="cs-item-machine">
                  <span>{machineLabel(a.machineId, a.machineName)}</span>
                  <span>Lucas · {PLACE_SHORT}</span>
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {order.suggestions.length > 0 && (
        <div className="cs-suggest" aria-label="Also make">
          <p className="cs-kicker">also make</p>
          <ul>
            {order.suggestions.map((s) => (
              <li key={s.id}>
                <button className="cs-btn" disabled={!!busy || expired} onClick={() => void run("extra", () => addSuggestion(order, s.id, s.operation))}>
                  {s.label} · about {usd(s.estimateCents)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ErrorLine text={error} />
      {expired ? (
        <Expired order={order} run={run} busy={busy} />
      ) : (
        <Actions>
          <button className="cs-btn cs-btn-main" disabled={!!busy} onClick={() => go("queue")}>
            looks good · add to the queue
          </button>
          <button className="cs-btn cs-btn-quiet" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            change the request
          </button>
          <button className="cs-btn cs-btn-quiet" onClick={onNew}>
            start over
          </button>
        </Actions>
      )}
      {editing && (
        <ChangeForm
          order={order}
          busy={busy}
          run={run}
          value={draft}
          onChange={setDraft}
          onDone={() => setEditing(false)}
          button="prepare it again"
          note="The file is prepared again from the new request. Nothing is charged."
        />
      )}
    </section>
  );
}

/* ---------- 5: the machine's queue ---------- */

export function QueueStep({ order, machines, go, run, busy, error }: ScreenProps) {
  const plan = order.plan!;
  const { left, expired } = useOfferClock(order);
  const m = matchedMachine(order, machines);
  const mine = plan.items.length === 1 ? itemTitle(plan.items[0]) : `${plan.items.length} items`;
  const ahead = m?.queue?.length ?? 0;
  const position = ahead + 1;
  const startMin = Math.round((plan.assignments[0]?.schedule?.startSeconds ?? 0) / 60);
  const others = [...new Set(plan.assignments.map((a) => a.machineId))].filter((id) => id !== m?.id);
  return (
    <section className="cs-queue-screen" aria-labelledby="cs-queue-title">
      <TitleBlock
        id="cs-queue-title"
        kicker={`queue · ${m ? MACHINE_NAME[m.id] ?? m.model : "the machine"}`}
        title={`Your ${mine} joins at #${position}`}
        sub={
          m?.current
            ? `${m.owner}'s machine is printing ${m.current.title} now. Your spot is held while you check out.`
            : `${m?.owner ?? "Lucas"}'s machine is free. Your spot is held while you check out.`
        }
      />
      <ol className="cs-queue cs-queue-big" aria-label="The machine's queue">
        {m?.current && (
          <li className="is-now">
            <span className="cs-queue-n">now</span>
            <span>{m.current.title}</span>
            <small>printing</small>
          </li>
        )}
        {(m?.queue ?? []).map((q, i) => (
          <li key={i}>
            <span className="cs-queue-n">{i + 1}</span>
            <span>{q.title}</span>
            <small>{q.source === "asi1" ? "via ASI:One" : "waiting"}</small>
          </li>
        ))}
        <li className="is-you" aria-current="true">
          <span className="cs-queue-n">{position}</span>
          <span>
            your {mine}
            {m?.queue === null && <small> · {m.owner} has not shared the rest of the queue</small>}
          </span>
          <small>{expired ? "hold ran out" : `held ${mmss(left)}`}</small>
        </li>
      </ol>
      {others.length > 0 && (
        <p className="cs-note">
          Also on {others.map((id) => MACHINE_NAME[id] ?? id).join(" and ")} at the same time.
        </p>
      )}
      <dl className="cs-facts">
        <div>
          <dt>starts</dt>
          <dd>{position === 1 && !m?.current ? "right after checkout" : `in about ${Math.max(1, startMin)} min`}</dd>
        </div>
        <div>
          <dt>ready in about</dt>
          <dd>{Math.max(1, plan.readyEstimateMinutes)} min</dd>
        </div>
        <div>
          <dt>spot held for</dt>
          <dd className={expired ? "is-err" : undefined}>{expired ? "ran out" : mmss(left)}</dd>
        </div>
      </dl>
      <ErrorLine text={error} />
      {expired ? (
        <Expired order={order} run={run} busy={busy} />
      ) : (
        <Actions>
          <button className="cs-btn cs-btn-main" onClick={() => go("checkout")}>
            check out
          </button>
          <button className="cs-btn cs-btn-quiet" onClick={() => go("preview")}>
            back to the preview
          </button>
        </Actions>
      )}
    </section>
  );
}

/* ---------- 6: checkout ---------- */

export function CheckoutStep({ order, setOrder, reload, run, busy, error, go }: ScreenProps) {
  const plan = order.plan!;
  const { left, expired } = useOfferClock(order);
  const [permission, setPermission] = useState(false);
  const [handoff, setHandoff] = useState<Handoff["mode"] | null>(() => readHandoff(order.id)?.mode ?? null);
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState("");
  const [unknown, setUnknown] = useState(false);
  const browserWallet = useMemo(hasBrowserWallet, []);
  useEffect(() => {
    void paymentConfig().then(setConfig);
  }, []);
  const testnet = isTestnet(order);
  // testnet mode, but nothing on this plan is chargeable: a plain confirm, no "demo" wording
  const free = !testnet && plan.paymentMode === "testnet";
  const fabynWallet = testnet && !!config?.builtInWallet.available;
  const [method, setMethod] = useState<PayMethod | null>(null);
  const chosen: PayMethod = !testnet ? "demo" : method ?? (fabynWallet ? "fabyn_wallet" : browserWallet ? "own_wallet" : "fabyn_wallet");
  const price = plan.assignments.reduce((s, a) => s + (a.price?.totalCents ?? 0), 0);
  const charged = plan.payableCents;
  const cannotPay = testnet && config !== null && !fabynWallet && !browserWallet;

  const pay = async () => {
    if (!handoff) return;
    setNote("");
    setUnknown(false);
    setWorking(true);
    saveHandoff(order.id, { mode: handoff });
    try {
      setOrder(await payOrder(order, chosen));
      go("printing");
    } catch (e) {
      const d = describeError(e);
      if (d.unknown) {
        setUnknown(true);
        await reload();
      } else if (REFRESH_CODES.has(d.code)) {
        setNote("The offer changed or ran out. Here is the latest; check it and confirm again.");
        await reload();
      } else {
        setNote(walletMessage(e) ?? d.message);
      }
    } finally {
      setWorking(false);
    }
  };

  const payLabel = free
    ? "confirm and print"
    : !testnet
    ? charged > 0
      ? `pay ${usd(charged)} · demo payment`
      : "confirm and print · demo payment"
    : chosen === "fabyn_wallet"
      ? `pay ${usd(charged)} with Fabyn wallet`
      : `pay ${usd(charged)} with my wallet`;

  return (
    <section className="cs-checkout" aria-labelledby="cs-checkout-title">
      <TitleBlock id="cs-checkout-title" kicker="checkout · before printing" title={orderTitle(order)} sub={`On ${MACHINE_NAME[plan.assignments[0]?.machineId] ?? "the machine"} at the ${PLACE_SHORT}, held for ${expired ? "no more time" : mmss(left)}.`} />
      <div className="cs-checkout-grid">
        <div>
          <p className="cs-kicker">price</p>
          <ul className="cs-terms" aria-label="Price">
            {plan.assignments.map((a) =>
              (a.price?.terms ?? []).map((t, i) => (
                <li key={`${a.id}-${i}`}>
                  <span>
                    {plan.assignments.length > 1 && i === 0 ? `${itemTitle(plan.items.find((x) => x.id === a.itemId)!)} · ` : ""}
                    {t.label}
                  </span>
                  <span>{usd(t.cents)}</span>
                </li>
              )),
            )}
            <li className="is-total">
              <span>total</span>
              <span>{usd(price || charged)}</span>
            </li>
            <li className="is-charged">
              <span>{testnet ? "you pay now · Base Sepolia test USDC" : free ? "charged now · no charge for this print" : "charged now · demo payment"}</span>
              <span>{usd(charged)}</span>
            </li>
          </ul>
        </div>
        <div>
          <fieldset className="cs-choice">
            <legend>How do you get it?</legend>
            <div className="cs-choice-row">
              <button type="button" className={`cs-btn ${handoff === "delivery" ? "is-on" : ""}`} aria-pressed={handoff === "delivery"} onClick={() => setHandoff("delivery")}>
                deliver to me
              </button>
              <button type="button" className={`cs-btn ${handoff === "pickup" ? "is-on" : ""}`} aria-pressed={handoff === "pickup"} onClick={() => setHandoff("pickup")}>
                I&apos;ll pick it up
              </button>
            </div>
            {handoff === "delivery" && (
              <p className="cs-note">
                {COURIER.name} on an {COURIER.vehicle} brings it to {HOME.label}, about {Math.round(RIDE_SECONDS / 60)} min after Lucas hands it over.
              </p>
            )}
            {handoff === "pickup" && <p className="cs-note">Collect it from Lucas at the {PLACE}.</p>}
            {!handoff && <p className="cs-fine">Choose one to continue.</p>}
          </fieldset>
          {testnet && (fabynWallet || browserWallet) && (
            <fieldset className="cs-choice">
              <legend>Pay with</legend>
              <div className="cs-choice-row">
                {fabynWallet && (
                  <button type="button" className={`cs-btn ${chosen === "fabyn_wallet" ? "is-on" : ""}`} aria-pressed={chosen === "fabyn_wallet"} onClick={() => setMethod("fabyn_wallet")}>
                    Fabyn wallet
                  </button>
                )}
                {browserWallet && (
                  <button type="button" className={`cs-btn ${chosen === "own_wallet" ? "is-on" : ""}`} aria-pressed={chosen === "own_wallet"} onClick={() => setMethod("own_wallet")}>
                    use my own wallet
                  </button>
                )}
              </div>
              <p className="cs-fine">
                {chosen === "fabyn_wallet"
                  ? "One click: Fabyn's Base Sepolia test wallet pays in test USDC and you get the BaseScan receipt."
                  : "Your browser wallet signs the payment on Base Sepolia."}
              </p>
            </fieldset>
          )}
        </div>
      </div>
      {expired ? (
        <Expired order={order} run={run} busy={busy} />
      ) : (
        <form
          className="cs-confirm"
          onSubmit={(e) => {
            e.preventDefault();
            if (permission && handoff && !working && !cannotPay) void pay();
          }}
        >
          <label className="cs-check">
            <input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} disabled={working} />
            I own this design or have permission to make it
          </label>
          <button className="cs-btn cs-btn-main" disabled={!permission || !handoff || working || cannotPay || !!busy} aria-busy={working || undefined}>
            {working ? (testnet ? "paying…" : "confirming…") : payLabel}
          </button>
          <p className="cs-fine">
            {cannotPay
              ? "Checkout needs the Fabyn wallet or a browser wallet with Base Sepolia test USDC. Nothing was charged."
              : testnet
                ? "Base Sepolia test USDC, not real money. Printing starts once the payment settles."
                : free
                  ? "No charge for this print. Printing starts when you confirm."
                  : "Demo payment: no funds move. Printing starts when you confirm."}
          </p>
        </form>
      )}
      {unknown && (
        <p role="alert" className="cs-error">
          We could not tell whether this went through, so we checked your order. If it still shows checkout, press the button again: it will not charge or print twice.
        </p>
      )}
      <ErrorLine text={note || error} />
      <Actions>
        <button className="cs-btn cs-btn-quiet" disabled={working} onClick={() => go("queue")}>
          back to the queue
        </button>
      </Actions>
    </section>
  );
}
