// What the workshop earned, straight from the owner ledger: collections from
// customers, releases to the maker and refunds, with x402 receipts when paid on testnet.
import { useMemo } from "react";
import { BASESCAN_TX, money, type Dashboard, type LedgerEntry } from "./data";
import { jobTitle } from "./status";
import { usePaymentConfig } from "./live";

const KIND: Record<LedgerEntry["kind"], string> = { collection: "Customer paid", release: "Paid out to you", refund: "Refunded" };
const STATUS: Record<LedgerEntry["status"], string> = { submitting: "sending", pending: "pending", confirmed: "confirmed", failed: "failed" };

const startOfDay = (now: number) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function Income({ dash, now }: { dash: Dashboard; now: number }) {
  const { ledger, jobs } = dash;
  const sum = (rows: LedgerEntry[]) => rows.reduce((s, e) => s + e.amountCents, 0);
  const live = (e: LedgerEntry) => e.status !== "failed";
  const collections = ledger.filter((e) => e.kind === "collection" && live(e));
  const releases = ledger.filter((e) => e.kind === "release" && live(e));
  const refunds = ledger.filter((e) => e.kind === "refund" && live(e));
  const pending = ledger.filter((e) => e.status === "pending" || e.status === "submitting");
  const today = startOfDay(now);
  const week = today - 6 * 86400000;
  const inRange = (rows: LedgerEntry[], from: number) => rows.filter((e) => Date.parse(e.createdAt) >= from);
  const share = jobs.filter((j) => j.productionState === "produced").reduce((s, j) => s + (j.economics?.ownerNetCents ?? j.quote?.ownerCents ?? 0), 0);
  const payments = usePaymentConfig();
  const testnet = payments ? payments.mode === "testnet" : ledger.some((e) => e.mode === "testnet");
  const rows = useMemo(() => [...ledger].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60), [ledger]);
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  return (
    <section aria-labelledby="sl-income-title">
      <header className="sl-section-head">
        <p className="sl-kicker">income · {testnet ? "x402 test USDC on Base Sepolia" : "test checkout, nothing charged"}</p>
        <h2 id="sl-income-title" className="sl-h2">
          What your machines earned.
        </h2>
        <p className="sl-lede">Every figure comes from the workshop ledger. A customer’s payment is held until the piece is made, then your share is released to you.</p>
      </header>
      <dl className="sl-stats sl-stats-4">
        <div>
          <dt>today</dt>
          <dd>{money(sum(inRange(collections, today)))}</dd>
        </div>
        <div>
          <dt>last 7 days</dt>
          <dd>{money(sum(inRange(collections, week)))}</dd>
        </div>
        <div>
          <dt>paid out to you</dt>
          <dd>{money(sum(releases))}</dd>
        </div>
        <div className={pending.length ? "warn" : ""}>
          <dt>pending</dt>
          <dd>{money(sum(pending))}</dd>
        </div>
      </dl>
      <div className="sl-two">
        <div className="sl-panel">
          <h3 className="sl-h3">All time</h3>
          <dl className="sl-money">
            <div>
              <dt>Collected from customers</dt>
              <dd>{money(sum(collections))}</dd>
            </div>
            <div>
              <dt>Your share on made pieces</dt>
              <dd>{money(share)}</dd>
            </div>
            <div>
              <dt>Paid out to you</dt>
              <dd>{money(sum(releases))}</dd>
            </div>
            <div>
              <dt>Refunded to customers</dt>
              <dd>{money(sum(refunds))}</dd>
            </div>
          </dl>
        </div>
        <div className="sl-panel">
          <h3 className="sl-h3">How you get paid</h3>
          <p className="sl-fine">
            {testnet
              ? "Customers pay with x402 in test USDC on Base Sepolia. Each payment has a receipt you can open on BaseScan. Test tokens have no real value."
              : "Checkout is in test mode: orders go through the whole flow and the ledger records every step, but nothing is charged."}
          </p>
          <p className="sl-fine">Failed payments are listed below and never counted in the totals.</p>
        </div>
      </div>
      <div className="sl-panel">
        <h3 className="sl-h3">Ledger</h3>
        {rows.length === 0 ? (
          <p className="sl-fine">No payments yet. They appear here as soon as a customer checks out.</p>
        ) : (
          <div className="sl-table-wrap">
            <table className="sl-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Order</th>
                  <th scope="col">What</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const job = jobById.get(e.jobId);
                  const tx = e.transactionHash ?? e.receipt?.transactionHash;
                  return (
                    <tr key={e.id} className={e.status === "failed" ? "failed" : ""}>
                      <td>{new Date(e.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                      <td>{job ? jobTitle(job) : e.jobId.slice(-6)}</td>
                      <td>{KIND[e.kind]}</td>
                      <td className="num">
                        {e.kind === "collection" ? "+" : e.kind === "refund" ? "−" : ""}
                        {money(e.amountCents)}
                      </td>
                      <td>
                        <span className={`sl-pill is-${e.status}`}>{STATUS[e.status]}</span>
                      </td>
                      <td>
                        {tx ? (
                          <a href={BASESCAN_TX(tx)} target="_blank" rel="noreferrer" title={tx}>
                            BaseScan ↗
                          </a>
                        ) : e.mode === "testnet" ? (
                          <span className="sl-fine">waiting for the chain</span>
                        ) : (
                          <span className="sl-fine">test checkout</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
