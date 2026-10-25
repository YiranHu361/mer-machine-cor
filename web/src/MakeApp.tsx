import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { LiveOrder, liveEnabled } from "./live";
import { getCheckoutKey } from "./storage";

/* The orchestrated request flow: describe or add photos, choose a draft when
   new art is needed, review the exact prepared result, confirm once, collect. */

type Candidate = {
  id: string;
  title: string;
  previewUrl: string;
  round: number;
};
type Assignment = {
  id: string;
  itemId: string;
  machineName: string;
  machineSource: "registry" | "network";
  executionMode: "simulation" | "hardware";
  chargeable: boolean;
  quantity: number;
  previewUrl: string;
  price: { totalCents: number; terms: { label: string; cents: number }[] };
  child?: {
    productionState: string;
    paymentState: string;
    fulfillmentState: string;
    pickupCode?: string;
  };
  sim?: { status: string; progress: number };
};
type Item = {
  id: string;
  name: string;
  why: string;
  quantity: number;
  source: "requested" | "extra";
  design: { kind: string; text?: string };
};
export type OrderView = {
  id: string;
  experience: "best_single" | "gift" | "relief";
  status: string;
  draft: {
    revision: number;
    requestText: string;
    photoAssetIds: string[];
    stage: string;
    reason?: string;
  };
  intent?: { provider: string; outcome: string; question: string | null };
  candidates?: {
    id: string;
    subject: string;
    rounds: number;
    maxRounds: number;
    status: string;
    candidates: Candidate[];
    recommendedId: string | null;
    selectedId: string | null;
    reason?: string;
  };
  plan?: {
    version: number;
    digest: string;
    items: Item[];
    assignments: Assignment[];
    payableCents: number;
    simulatedEstimateCents: number;
    paymentMode: "mock" | "testnet";
    collectionPoint: string;
    readyEstimateMinutes: number;
    status: string;
  };
  suggestions: {
    id: string;
    label: string;
    operation: "add" | "replace";
    estimateCents: number;
    note: string;
  }[];
  offer?: {
    id: string;
    planVersion: number;
    planDigest: string;
    expiresAt: string;
  };
  makeIntent?: {
    status: string;
    payment: { status: string; reason?: string; transactionHash?: string };
  };
  events: { seq: number; type: string; at: string }[];
};
export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const designing = new Set([
  "created",
  "understanding",
  "resolving_profiles",
  "generating_candidates",
  "designing",
  "producer_preparing",
  "preflighting",
]);
export function stageLine(o: OrderView) {
  const subject = o.candidates?.subject;
  if (o.draft.stage === "generating_candidates")
    return `Designing your ${subject ?? "design"}…`;
  if (
    o.draft.stage === "producer_preparing" ||
    o.draft.stage === "preflighting"
  )
    return "Preparing the exact file for the machine…";
  if (o.draft.photoAssetIds.length) return "Preparing your photo…";
  return "Working out what to make…";
}
const childLine = (a: Assignment) => {
  if (a.sim)
    return a.sim.status === "done"
      ? "Simulated · complete"
      : `Simulated · ${a.sim.status}`;
  const c = a.child;
  if (!c)
    return a.executionMode === "simulation" ? "Simulated · waiting" : "Waiting";
  if (c.fulfillmentState === "ready_for_pickup") return "Ready for pickup";
  if (c.fulfillmentState === "collected") return "Collected";
  if (c.fulfillmentState === "simulation_complete")
    return "Simulated · complete, no physical item";
  if (c.fulfillmentState === "awaiting_owner")
    return a.executionMode === "simulation"
      ? "Simulated · made, waiting for the owner to finish up"
      : "Made · the owner is getting it ready for pickup";
  if (c.productionState === "needs_review") return "Checking with the workshop";
  if (["verifying", "produced"].includes(c.productionState)) return "Checking";
  if (["dispatched", "running"].includes(c.productionState)) return "Making";
  if (c.productionState === "failed") return "Not made";
  if (c.productionState === "cancelled") return "Cancelled";
  return "Preparing";
};
const key = () => `${Date.now().toString(36)}-${crypto.randomUUID()}`;
// What the name tag template can engrave (server/orchestration/intent.ts tagText).
const nameTagOk = (name: string) =>
  /^[A-Za-z0-9À-ÖØ-öø-ÿ .,'&!?+-]{1,16}$/.test(name.trim()) &&
  /[A-Za-z0-9À-ÖØ-öø-ÿ]/.test(name);

export function MakeApp() {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [text, setText] = useState("");
  const [tagName, setTagName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [permission, setPermission] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const orderId = order?.id;
  const load = useCallback(async (id: string) => {
    const { order } = await api<{ order: OrderView }>(`/orders/${id}`);
    setOrder(order);
    return order;
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("order");
    if (id) void load(id).catch((e) => setError((e as Error).message));
  }, [load]);
  // Follow saved server state: events only say "something changed".
  useEffect(() => {
    if (!orderId) return;
    const source =
      typeof EventSource === "undefined"
        ? null
        : new EventSource("/api/events");
    source?.addEventListener(
      "refresh",
      () => void load(orderId).catch(() => undefined),
    );
    const timer = setInterval(
      () => void load(orderId).catch(() => undefined),
      2000,
    );
    return () => {
      source?.close();
      clearInterval(timer);
    };
  }, [orderId, load]);
  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const start = (
    experience: "best_single" | "gift",
    requestText = text,
    withPhotos = true,
  ) =>
    run("start", async () => {
      let photoAssetIds: string[] = [];
      if (withPhotos && files.length) {
        const form = new FormData();
        files.forEach((f) => form.append("images", f));
        const { assets } = await api<{ assets: { id: string }[] }>(
          "/uploads",
          form,
        );
        photoAssetIds = assets.map((a) => a.id);
      }
      const { order } = await api<{ order: OrderView }>(
        "/orders",
        { requestText, photoAssetIds, experience },
        "POST",
        { headers: { "Idempotency-Key": key() } },
      );
      history.replaceState(null, "", `/make?order=${order.id}`);
      setOrder(order);
    });
  if (!order)
    return (
      <section className="make" aria-labelledby="make-title">
        <h1 id="make-title">What should we make?</h1>
        <p className="lead">
          Describe it, add photos, or both. We choose the machine and prepare
          the file.
        </p>
        <form
          className="make-request"
          onSubmit={(e) => {
            e.preventDefault();
            void start("best_single");
          }}
        >
          <label htmlFor="make-text">Describe it</label>
          <input
            id="make-text"
            value={text}
            maxLength={2000}
            placeholder="For example, I want a cat sticker"
            onChange={(e) => setText(e.target.value)}
          />
          <label htmlFor="make-photos">Add photos (optional)</label>
          <input
            id="make-photos"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(e) =>
              setFiles(Array.from(e.target.files ?? []).slice(0, 4))
            }
          />
          <div className="make-actions">
            <button
              className="primary"
              type="submit"
              disabled={!!busy || (!text.trim() && !files.length)}
              aria-busy={busy === "start" || undefined}
            >
              Start
            </button>
            <button
              type="button"
              className="text-button"
              disabled={!!busy || (!text.trim() && !files.length)}
              onClick={() => void start("gift")}
            >
              Make a three-piece gift instead
            </button>
          </div>
        </form>
        <form
          className="make-request make-nametag"
          onSubmit={(e) => {
            e.preventDefault();
            void start("best_single", `A name tag that says "${tagName.trim()}"`, false);
          }}
        >
          <label htmlFor="make-name">Or make a name tag</label>
          <input
            id="make-name"
            value={tagName}
            maxLength={16}
            placeholder="Your name"
            autoComplete="off"
            aria-describedby="make-name-help"
            onChange={(e) => setTagName(e.target.value.replace(/\s+/g, " "))}
          />
          <p id="make-name-help" className="fine-print">
            {tagName.trim() && !nameTagOk(tagName)
              ? "Use up to 16 letters, digits, spaces and . , ' & ! ? + -"
              : "Engraved into a 3D-printed tag with a keyring hole, one colour."}
          </p>
          <div className="make-actions">
            <button
              className="secondary"
              type="submit"
              disabled={!!busy || !nameTagOk(tagName)}
            >
              Make a name tag
            </button>
          </div>
        </form>
        {error && (
          <p role="alert" className="make-error">
            {error}
          </p>
        )}
      </section>
    );
  const o = order;
  const stage = o.draft.stage;
  const plan = o.plan;
  const confirmed = !!o.makeIntent;
  const choose = (candidateId: string) =>
    run("choose", async () => {
      setOrder(
        (
          await api<{ order: OrderView }>(`/orders/${o.id}/design-choice`, {
            expectedRevision: o.draft.revision,
            candidateSetId: o.candidates!.id,
            candidateId,
          })
        ).order,
      );
    });
  const more = () =>
    run("more", async () => {
      setOrder(
        (
          await api<{ order: OrderView }>(`/orders/${o.id}/more-like-this`, {
            expectedRevision: o.draft.revision,
            candidateSetId: o.candidates!.id,
          })
        ).order,
      );
    });
  const confirm = () =>
    run("confirm", async () => {
      const idempotencyKey = getCheckoutKey({
        id: o.id,
        quote: { id: o.offer!.id, version: plan!.version },
      });
      if (plan!.paymentMode === "testnet" && plan!.payableCents > 0) {
        const { checkoutWithWallet } = await import("./wallet");
        const result = await checkoutWithWallet<{ order: OrderView }>({
          jobId: o.id,
          quote: {
            id: o.offer!.id,
            totalCents: plan!.payableCents,
            expiresAt: o.offer!.expiresAt,
          },
          order: { planVersion: plan!.version, planDigest: plan!.digest },
          idempotencyKey,
        });
        setOrder(result.order);
        return;
      }
      setOrder(
        (
          await api<{ order: OrderView }>(`/orders/${o.id}/confirm`, {
            offerId: o.offer!.id,
            planVersion: plan!.version,
            planDigest: plan!.digest,
            permission: true,
            consent: { payment: true, production: true },
            idempotencyKey,
          })
        ).order,
      );
    });
  const simulatedOnly = plan && plan.payableCents === 0;
  const limited = ["unavailable", "failed", "needs_clarification"].includes(
    stage,
  );
  const cancellable =
    confirmed && plan && ["approved", "in_progress"].includes(plan.status);
  return (
    <section className="make" aria-labelledby="make-title">
      <h1 id="make-title">
        {/* Once planned, one item is named by what will actually be made. */}
        {plan?.items.length === 1
          ? plan.items[0].name
          : (o.intent?.outcome ?? (o.draft.requestText || "Your order"))}
      </h1>
      {o.draft.requestText && <p className="lead">“{o.draft.requestText}”</p>}
      <p className="make-status" role="status" aria-live="polite">
        {designing.has(stage) && (
          <>
            <span className="spinner" aria-hidden="true" /> {stageLine(o)}
          </>
        )}
        {stage === "awaiting_design_choice" && "Choose a design."}
        {stage === "proposed" && !confirmed && "Check the preview and total."}
        {confirmed &&
          plan &&
          (["pending", "submitting"].includes(o.makeIntent!.payment.status)
            ? "Waiting for test payment confirmation."
            : o.makeIntent!.payment.status === "failed"
              ? "Payment failed; production has not started."
              : plan.status === "needs_review"
                ? "The workshop needs to review this order."
                : plan.status === "done"
                  ? "All done."
                  : "Your order is under way.")}
      </p>
      {limited && (
        <p className="make-limit" role="alert">
          {stage === "needs_clarification"
            ? (o.intent?.question ?? o.draft.reason)
            : o.draft.reason}
        </p>
      )}
      {!confirmed && o.status !== "cancelled" && (
        <details className="make-edit" open={limited || undefined}>
          <summary>Change the request</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run("edit", async () => {
                setOrder(
                  (
                    await api<{ order: OrderView }>(
                      `/orders/${o.id}/draft`,
                      {
                        expectedRevision: o.draft.revision,
                        requestText: edit ?? o.draft.requestText,
                      },
                      "PATCH",
                    )
                  ).order,
                );
                setEdit(null);
                setPermission(false);
              });
            }}
          >
            <label htmlFor="make-edit-text">Request</label>
            <input
              id="make-edit-text"
              value={edit ?? o.draft.requestText}
              maxLength={2000}
              onChange={(e) => setEdit(e.target.value)}
            />
            <button className="secondary" type="submit" disabled={!!busy}>
              {limited ? "Try again" : "Update"}
            </button>
            <p className="fine-print">
              Changing the request replaces the drafts and the proposal; nothing
              is charged.
            </p>
          </form>
        </details>
      )}
      {o.candidates &&
        !confirmed &&
        (stage === "awaiting_design_choice" ||
          stage === "generating_candidates" ||
          !plan) && (
          <div className="make-drafts" aria-label="Design drafts">
            <ul>
              {o.candidates.candidates.map((c) => (
                <li
                  key={c.id}
                  className={
                    c.id === o.candidates!.selectedId
                      ? "is-selected"
                      : undefined
                  }
                >
                  <img
                    src={c.previewUrl}
                    alt={c.title}
                    width={160}
                    height={160}
                  />
                  <span className="make-draft-title">
                    {c.title}
                    {c.id === o.candidates!.recommendedId && (
                      <em> · Recommended</em>
                    )}
                  </span>
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() => void choose(c.id)}
                    aria-label={`Use this design: ${c.title}`}
                  >
                    Use this design
                  </button>
                </li>
              ))}
            </ul>
            {o.candidates.status !== "generating" &&
              o.candidates.rounds < o.candidates.maxRounds && (
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={() => void more()}
                >
                  More like this
                </button>
              )}
            <p className="fine-print">
              Drafts are design concepts. Choosing one never pays or starts a
              machine.
            </p>
          </div>
        )}
      {plan && (
        <div className="make-plan">
          {plan.items.map((item) => {
            const assignments = plan.assignments.filter(
              (a) => a.itemId === item.id,
            );
            const first = assignments[0];
            return (
              <article
                key={item.id}
                className="make-item"
                aria-label={item.name}
              >
                {first && (
                  <img
                    src={first.previewUrl}
                    alt={`Production preview: ${item.name}`}
                    className="make-preview"
                  />
                )}
                <div>
                  <h2>{item.name}</h2>
                  <p className="fine-print">
                    {item.quantity} ·{" "}
                    {first?.executionMode === "simulation"
                      ? "Simulated device"
                      : "Real machine"}
                    {item.design.text ? ` · says “${item.design.text}”` : ""}
                  </p>
                  {confirmed &&
                    assignments.map((a) => (
                      <p key={a.id} className="make-progress">
                        {childLine(a)}
                        {a.child?.pickupCode && (
                          <strong> · Pickup code {a.child.pickupCode}</strong>
                        )}
                      </p>
                    ))}
                  {item.source === "extra" && !confirmed && (
                    <button
                      className="text-button"
                      disabled={!!busy}
                      onClick={() =>
                        void run("remove", async () => {
                          setOrder(
                            (
                              await api<{ order: OrderView }>(
                                `/orders/${o.id}/draft`,
                                {
                                  expectedRevision: o.draft.revision,
                                  removeItemId: item.id,
                                },
                                "PATCH",
                              )
                            ).order,
                          );
                        })
                      }
                    >
                      Remove this extra
                    </button>
                  )}
                  <details>
                    <summary>Details</summary>
                    {assignments.map((a) => (
                      <div key={a.id} className="fine-print">
                        <p>
                          {a.machineName} ·{" "}
                          {a.executionMode === "simulation"
                            ? "simulation"
                            : "hardware"}
                        </p>
                        <ul>
                          {a.price.terms.map((t) => (
                            <li key={t.label}>
                              {t.label}: {usd(t.cents)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    <p className="fine-print">{item.why}</p>
                  </details>
                </div>
              </article>
            );
          })}
          {confirmed && liveEnabled && <LiveOrder orderId={o.id} />}
          {!confirmed && o.suggestions.length > 0 && stage === "proposed" && (
            <div className="make-extras" aria-label="Also make this as">
              {o.suggestions.map((s) => (
                <button
                  key={s.id}
                  className="secondary"
                  disabled={!!busy}
                  onClick={() =>
                    void run("extra", async () => {
                      setOrder(
                        (
                          await api<{ order: OrderView }>(
                            `/orders/${o.id}/alternatives/${s.id}/select`,
                            {
                              expectedPlanVersion: plan.version,
                              operation: s.operation,
                            },
                          )
                        ).order,
                      );
                    })
                  }
                >
                  {s.label} · about {usd(s.estimateCents)}
                </button>
              ))}
            </div>
          )}
          <dl className="make-total">
            <div>
              <dt>Total</dt>
              <dd>
                {simulatedOnly
                  ? "No payment: simulated work"
                  : usd(plan.payableCents)}
              </dd>
            </div>
            {plan.simulatedEstimateCents > 0 && (
              <div>
                <dt>Simulated estimate</dt>
                <dd>{usd(plan.simulatedEstimateCents)} (not charged)</dd>
              </div>
            )}
            <div>
              <dt>Ready in about</dt>
              <dd>{Math.max(1, plan.readyEstimateMinutes)} min</dd>
            </div>
            <div>
              <dt>Pickup</dt>
              <dd>{plan.collectionPoint}</dd>
            </div>
          </dl>
          {!confirmed && stage === "proposed" && o.offer && (
            <div className="make-confirm">
              <label>
                <input
                  type="checkbox"
                  checked={permission}
                  onChange={(e) => setPermission(e.target.checked)}
                />{" "}
                I own these pictures or have permission to make this design
              </label>
              <p className="fine-print">
                {plan.paymentMode === "mock"
                  ? "Mock payment: no funds move."
                  : "Pay with test USDC on Base Sepolia. Your wallet will ask you to approve."}
              </p>
              <button
                className="primary"
                disabled={!permission || !!busy}
                aria-busy={busy === "confirm" || undefined}
                onClick={() => void confirm()}
              >
                {simulatedOnly
                  ? "Make it (simulated)"
                  : `Pay ${usd(plan.payableCents)} & make`}
              </button>
            </div>
          )}
          {cancellable && (
            <button
              className="text-button subdued"
              disabled={!!busy}
              onClick={() =>
                void run("cancel", async () => {
                  setOrder(
                    (
                      await api<{ order: OrderView }>(
                        `/orders/${o.id}/cancel`,
                        {},
                      )
                    ).order,
                  );
                })
              }
            >
              Stop work that has not started
            </button>
          )}
          {o.makeIntent?.payment.status === "pending" && (
            <p role="status">
              Confirming your test payment… Production starts after
              confirmation.
            </p>
          )}
          {plan.paymentMode === "testnet" &&
            o.makeIntent?.payment.transactionHash &&
            /^0x[0-9a-fA-F]{64}$/.test(
              o.makeIntent.payment.transactionHash,
            ) && (
              <p>
                <a
                  href={`https://sepolia.basescan.org/tx/${o.makeIntent.payment.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {o.makeIntent.payment.status === "confirmed"
                    ? "Test payment confirmed · view transaction"
                    : "View pending test payment"}
                </a>
              </p>
            )}
          {o.status === "needs_review" && o.makeIntent?.payment.reason && (
            <p role="status">{o.makeIntent.payment.reason}</p>
          )}
          {o.makeIntent?.payment.status === "failed" && (
            <p role="alert">
              Payment failed; nothing was made. {o.makeIntent.payment.reason}
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="make-error">
          {error}
        </p>
      )}
      <p className="make-again">
        <a href="/make" onClick={() => setOrder(null)}>
          Start another
        </a>
      </p>
    </section>
  );
}
