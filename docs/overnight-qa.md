# Overnight interface and quality review

Requested October 23, 2026, shortly after midnight Pacific. The user selected a **9:00 a.m. Pacific on October 23** morning handoff. This is continued testing and repair of the existing implementation, with emphasis on interface quality.

## Continuation and boundaries

- Heartbeat automation: `overnight-fabrary-quality-checks`, hourly on the hour, ending at `2026-10-23T16:00:00Z` (9:00 a.m. PDT). The final run should disable the heartbeat after producing the morning handoff. Preserve the existing chat.
- A temporary idle-sleep inhibitor (PID 35225) runs only until the same cutoff; no persistent power settings changed. The desktop app must remain running. The inhibitor does not override a deliberate sleep, shutdown or closed laptop lid.
- Work only in this writable `fabrary/` directory. Parent `AGENTS.md` applies; synced reference files and `sources/` remain read-only.
- Preserve ignored `.env`, `.data`, local publishing identity, assets, state and journals. Never print or commit credentials.
- Use simulation and mock payment fixtures. No hardware work, API-credit spending, live payments, external registration, public deployment, account changes or external messages overnight.
- Live hardware, funded wallets, Claude and ASI/Agentverse acceptance remain blocked until supplied configuration and readiness. Preparing `.env` did not configure those services.
- Do not repeat an unchanged suite simply to fill time. Each pass needs a new test boundary, actual change, failure to investigate or unresolved diagnostic question.

## Runtime and baseline

Retained local SpacetimeDB 2.13 runtime restarted using `npm run spacetime`; backend and node restarted using `npm run demo`. Interface: `http://127.0.0.1:4318`. Health reports `simulation / mock / spacetimedb`; no live services were enabled. Start them again if absent, without replacing private data.

Baseline observed this night:

- Backend: 37 passing tests.
- Node: 45 passing tests.
- Payment/Claude fixtures: 19 passing tests plus integration typecheck.
- Fetch bridge fixtures: 5 passing tests.
- Built-application browser workflows: 5 passing tests in 10.1 seconds, including independent fulfillment, paid cancellation, preview invalidation, owner review, offline recovery and SSE with polling disabled.
- Browser baseline report: `web/evidence/overnight-baseline-browser.json`; local command output: `.data/overnight-baseline-browser.log`.

## Verified first checkpoint, 00:40 Pacific

The first pass is complete; the overnight task remains active. Three independent
reviews plus a second review of their fixes produced the changes below. Current
source fingerprint: `85a2ce5f44d36ab43f3daab7ee22914d40fd539fba1d2b4f86d082219f4d0c33`.

- Mobile controls and supporting text are readable; stronger text contrast, 320–1440 px reflow, keyboard tabs/skip navigation, visible error focus/scroll and production-preview retry are verified.
- Owner queue starts with actionable orders, with search, view filters and eight-order pages. Older orders stay reachable. Pending collection/payment receives a useful heading.
- Expired owner/requester sessions discard private state. Deferred old uploads/creates cannot restore another identity's draft or saved selection. A delayed receipt cannot appear on another order.
- Late verification/review errors cannot undo handling or pause new work; final outcome allocation recovers after restart. Approval retry retains a valid quote; cancelled orders stay closed; handling uses explicit confirmations.
- Node rechecks current policy after artwork retrieval; calibration binds device, camera, transport, material and adapter version. Current pairing and explicit calibration revocation stay truthful.
- Stops before worker start cannot later print. Pending old stop transports and active workers fence reconciliation/resume/calibration/new acceptance, including canceled callers and shutdown ownership.
- Camera capture is bounded; failures return actionable errors. Known payment hashes survive failed checkpoints. Cached, contradictory or unavailable model evidence goes to review.

Verification on this checkpoint:

| Check                                          | Result                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Backend/application/process/realtime           | 53 passed                                                                                                                             |
| Python node                                    | 65 passed                                                                                                                             |
| Payment/Claude fixtures                        | 25 passed                                                                                                                             |
| Fetch bridge fixtures                          | 5 passed                                                                                                                              |
| Wallet boundary                                | 8 passed                                                                                                                              |
| Browser scenarios                              | 17 passed in each of Chromium 156, Firefox 157 and WebKit 27.2                                                                        |
| Accessibility                                  | 39 automated A/AA scans, no detected violations; visual and keyboard review also performed                                            |
| Actual local database                          | CAS, subscriptions, anonymous read isolation and unauthorized write rejection passed                                                  |
| Actual app + node + database                   | 10 sticker and 3 Instax simulation jobs, failure/review/lost-ack cases, signed calibration API and complete local FastMCP flow passed |
| Build/typechecks/dependency audits/secret scan | Passed                                                                                                                                |

That is 173 unique software test cases, or 207 executions including all three
browser engines. There were no failed/skipped/flaky final browser cases.
These counts exclude blocked live tests. Simulation sticker median was 1.5195 s
starting **after shared upload**; it is not a physical/upload-to-ready target.
The full software check followed backend/node changes; the final build and all
three browser suites followed the final UI refinement.

Detailed evidence: [test report](test-report.md), [machine-readable checkpoint](evidence/overnight-qa.json),
[requester overview](../web/evidence/overnight-requester-intake-overview.png),
[owner overview](../web/evidence/overnight-owner-orders-handling-overview.png),
[mobile requester](../web/evidence/overnight-requester-intake-390.png).
Early failing diagnostic reports are archived privately under `.data/`; final
per-engine reports are under `web/evidence/overnight-*-browser.json`.

## Next useful audits

1. Inspect touch/mobile WebKit behavior, short landscape viewports, 200% zoom, reduced motion and long text. The completed desktop-engine viewport checks do not prove actual iOS device usability.
2. Exercise unavailable/quota-limited local/session storage, interrupted navigation and restored sessions. Use offline wallet/API fixtures; do not submit testnet transactions or silently open a new requester identity.
3. Test delayed/reordered background refreshes around owner actions and requester job selection. Ensure a late poll cannot permanently replace newer visible state or restore stale controls. Backend idempotency is already covered.
4. Inspect real EventSource reconnection after a bounded backend restart with polling disabled; existing SSE proof covers delivery and subscription cleanup, but not every reconnect timing. Preserve database/node journals and do not clear unrelated orders.
5. Review multi-image upload/replacement, asynchronous suggestion/edit interactions and existing approved-file integrity with isolated fixtures. Avoid creating physical artifacts or redundant simulation loops.
6. Fix only reproduced issues, add meaningful regressions, rerun affected checks and refresh evidence. At the morning cutoff, prepare the final handoff and disable the heartbeat. No optional sponsor add-ons are authorized by this overnight quality pass.

## Morning handoff requirements

Report concrete changes, tests actually run, links to representative screenshots and evidence, current local app URL and remaining external prerequisites. Distinguish fixture, simulation, actual database and live acceptance. Do not describe a scheduled future check as already completed or claim uninterrupted execution while a heartbeat is waiting.
