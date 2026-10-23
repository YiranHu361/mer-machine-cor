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
reviews plus a second review of their fixes produced the changes below. Source fingerprint at this
checkpoint: `85a2ce5f44d36ab43f3daab7ee22914d40fd539fba1d2b4f86d082219f4d0c33`.

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

## Verified second checkpoint, 01:21 Pacific

Continuation from commit `8a5b7a5` reproduced and repaired additional browser state
failures. The overnight task remains active through 9:00 a.m. Pacific. Source
fingerprint: `66bc8ea5e7a773ad50eb3160bf32aa2bea56fd2f0e65f14fed32452f41a65a08`.

- Desktop/touch: long collection references, machine reasons and evidence tokens wrap; 44px touch navigation/disclosures and 16px coarse-pointer inputs work in 844 × 320 landscape. Tests include 390px portrait, 320px equivalent 200% reflow, reduced motion and touch radio/tab/disclosure controls. WebKit emulates iPhone 13; native iOS keyboard, pinch, true browser zoom and device performance remain unverified.
- Browser storage: getter exceptions, quota failures and silently dropped writes leave the interface usable with a visible notice. Mock checkout keeps the same key after a lost response/reload. Wallet signatures and physical calibration wait for a verified checkpoint; no signed submission occurs when storage is unavailable. Concurrent/ambiguous wallet attempts and storage clearing in the same open page cannot request another signature. All wallet operations here use offline fixtures; no live wallet or funds.
- Refresh ordering: same-snapshot database revisions on machines/jobs/dashboard let newer authoritative data outrank reply order. An old owner response cannot restore completed preparation, a stale requester list cannot roll approved detail back, and an old 401 cannot log out a renewed owner session. Slower requests still apply when they contain newer data.
- Session recovery: an unavailable authoritative session store now returns a service error instead of anonymous state. The browser requires a valid session lookup before creating a first requester. 503 and malformed 200 responses offer retry, send no replacement-session POST, and recover the same saved orders.
- Artwork isolation: discarded two-image replacements and model suggestions from order A could silently replace order B's sources when changing format. Selection/edit/cancel now reset that draft context, while intended replacement images remain bound to their own draft. Four regressions cover cross-order discard/direct selection, same-order cancel and the intended multi-image/suggestion/permission flow. Rebuilt files still require explicit approval. Busy controls prevent accessible same-session context switches during suggestions; earlier identity/unmount callbacks remain covered.
- Actual local reconnect: a bounded restart of the local backend/node preserved database/assets/journals. The open owner view displayed disconnect, reconnected through native EventSource, then received independent pause/resume mutations with dashboard/health polling disabled. Final proof observed 2 opens, 1 error and 4 refresh events. No job/payment was submitted for this check.

Verification on this checkpoint:

| Check                                            | Result                                          |
| ------------------------------------------------ | ----------------------------------------------- |
| Backend/application/process/realtime             | 55 passed                                       |
| Python node                                      | 65 passed in 5.52s                              |
| Payment/Claude and Fetch fixtures                | 25+5 passed                                     |
| Browser storage/wallet unit                      | 20 passed                                       |
| Built-application browser scenarios              | 37 passed per engine; Chromium, Firefox, WebKit |
| Automated accessibility                          | 39 A/AA scans, no detected violations           |
| Build/strict types/configured-secret scan        | Passed                                          |
| Actual local SSE reconnect after service restart | Passed with polling disabled                    |

That is 207 unique cases or 281 executions counting the three browser
engines, with no final failed/skipped/flaky cases. Full software checks followed
backend/session changes; final web build/unit/browser checks followed the last
artwork repair. After the final web repairs, only affected web checks were repeated. Finite
simulation/database acceptance and dependency audits were retained from the first checkpoint. Live and physical prerequisites remain blocked.

Current [machine-readable checkpoint](evidence/overnight-second-qa.json),
[full test report](test-report.md), [reconnect evidence](evidence/overnight-sse-reconnect.json).
Representative screenshots: [portrait](../web/evidence/overnight-touch-webkit-portrait-390.png),
[short landscape](../web/evidence/overnight-touch-webkit-landscape-844x320.png),
[storage recovery notice](../web/evidence/overnight-touch-webkit-storage-320x664.png),
[reconnected dashboard](../web/evidence/overnight-sse-reconnected.png).
Earlier diagnostic/affected-only reports remain private under `.data/`; final
per-engine reports use `overnight-second-*-browser.json`.

## Verified third checkpoint, 02:29 Pacific

Continuation from commit `77d62f7` completed navigation, adversarial validation,
live owner-queue and preview/cache audits. The overnight task remains active
through 9:00 a.m. Pacific. Source fingerprint:

`3b8b53e7e46b781a03722fcb644a2be6786bdbeae811e1fab891df2c3d8eceae`

- Production previews: viewing another order or rebuilt artifact with identical bytes no longer enables approval while that preview is loading. Readiness binds order, artifact, fingerprint, source and view; reselect/edit/cancel reloads remain usable. Three isolated regressions pass.
- Navigation: unsaved requester edits/uploads and pending actions arm a browser leave-page warning. Dismissing it preserves exact input and document; pristine edits, explicit discard/new-order and successful save disarm it. Eleven isolated browser cases also verify saved selection/owner authentication over history, and lost committed create/edit/quote responses over actual document reloads without replacement identity or duplicate submissions. A WebKit 1 ms timeOrigin-rounding difference exposed an overstrict test assertion; document UUID is now the authoritative document identity. Native unload warnings do not survive forced browser/OS termination.
- Input and focus preservation: stable built Firefox diagnostics reproduced typed intent reverting before submission. A held-frame regression established the cause: a delayed heading-focus callback could steal focus after the user entered a textbox. Requester heading and owner pagination callbacks now respect newer focus; deterministic regressions cover both. Primitive-value capture separately hardens requester, handling-checkbox and measured-cost state updates. A specific repeated edit diagnostic verifies the intermittent boundary without inflating unique-case counts.
- Owner queue: pagination no longer jumps back after live work shrinks/returns. New arrivals retain the focused pickup draft/code in an eight-slot page with a truthful note; displaced orders remain reachable by paging. Settled follow-up/handoff returns keyboard focus safely, and retained input scrolls fully into 320px-wide view. Five cross-engine regressions and representative screenshot are retained.
- Keyboard focus: measured orange focus outlines had only 1.83–2.28:1 contrast on primary light surfaces. A darker shared amber focus token measures 4.22–5.26:1 there; existing accents remain. Relative-luminance evidence records colors/surfaces/formula. This complements automated accessibility scans and is not a full conformance claim.
- Adversarial API validation: own-property dictionary lookups reject constructor/toString/**proto** instead of returning inherited objects or internal errors. Owner review/payment reasons and calibration keys are typed/bounded; Unicode collection references trim correctly, and malformed numeric/budget/quantity values reject before preparation. Invalid calibration intent or unknown machine rejects before creating preview assets, preserving exact store/file state.
- Catalog consistency: duplicate prepared-model IDs, blank/oversized colors and mismatched normalization no longer produce unorderable catalog choices. Backend and Python node use matching Unicode trim/length rules. Signed parameters remain normalized/exact and wrong file/hash/dimensions/color/duration still reject. Six backend and two node regression cases were added; no hardware was called.
- Actual local activation: backend/node restarted with retained Spacetime data, assets and attempt journals. The already-open owner dashboard disconnected, natively reconnected and received new pause/resume mutations with polling disabled; 2 opens, 1 error, 4 refreshes. No production job or payment was submitted for this check.

| Check                                | Result                                       |
| ------------------------------------ | -------------------------------------------- |
| Backend/application/process/realtime | 61 passed                                    |
| Python node                          | 67 passed in 5.57s                           |
| Payment/Claude and Fetch fixtures    | 25+5 passed                                  |
| Storage/wallet unit                  | 20 passed                                    |
| Built-application browser scenarios  | 56 passed in each of Chromium/Firefox/WebKit |
| Automated accessibility              | 39 A/AA scans, no detected violations        |
| Build/strict types/secret scan       | Passed                                       |
| Actual local restart/SSE reconnect   | Passed; polling disabled                     |

That is 234 unique software cases, or 346 executions including
the three browser engines, with no final failed/skipped/flaky cases. The shared
software check followed API/node/behavior repairs; the final production web
build and three-engine browser suite followed the final focus-contrast and input-preservation refinements.
Unchanged finite simulation loops, database restart/CAS and dependency audits
remain historical evidence; they were not rerun for volume.

[Current machine-readable checkpoint](evidence/overnight-third-qa.json),
[full report](test-report.md), [focus/input diagnostics](evidence/overnight-focus-recovery.json), [focus contrast](evidence/overnight-focus-contrast.json),
[latest reconnect](evidence/overnight-third-sse-reconnect.json),
[retained mobile pickup draft](../web/evidence/overnight-owner-queue-live-draft-320.png).
Earlier failing/affected-only diagnostic reports are private under `.data/`;
final reports are `web/evidence/overnight-third-*-browser.json`.

## Verified fourth checkpoint, 03:27 Pacific

Continuation from commit `171fdd2` completed numeric input, owner form and queue-draft recovery, media failures, and definite-versus-uncertain persistence audits. The overnight task remains active through 9:00 a.m. Pacific. Source fingerprint:

`74849a208a4d3708940ed51dab77341f1037d021dc905eb2e4b78ed303e5185b`

- Requester and owner numeric fields keep empty or incomplete native input text while typing. Validated numeric values are submitted only after the form is complete; failed saves retain exact visible values. Format changes and explicit discard restore valid defaults.
- Owner workshop views preserve mounted drafts. Trial measurements and payment references also survive queue paging, search and filters in private, per-order memory. Native leave-page warnings cover dirty drafts even while their order is off screen. Explicit discard, accepted saves, settled/ineligible payment records and owner-session expiry clear the relevant warning. This memory is not durable browser storage; a forced browser/OS termination can still lose an unsaved draft.
- Owner machine, trial and payment inputs lock during a pending submission. A successful write followed by a failed dashboard refresh now says the change was accepted but cannot yet be refreshed; submitted values remain visible. New saved trial measurements cannot silently overwrite local edits. Failed or uncertain payment/trial responses use reconciliation copy rather than claiming the stored state is unchanged.
- Clearing an optional payout address now sends an explicit null that removes the stored property; omission preserves it. Unchanged full settings saves preserve existing quote, approval, history and reservation. Real price changes still invalidate unpaid quotes, using current state inside each atomic update; concurrent fresh-state directions are tested. These are offline fixtures and do not send a payment.
- Result images that are unauthorized, missing or corrupt show readable recovery text, simulation/camera provenance and a retry action while retaining the recorded outcome. Malformed image sources cannot crash the interface on retry. Explicit retries use fresh same-origin URL keys to avoid reusing a failed decode. Production-preview and evidence retry controls preserve keyboard focus during loading, ignore duplicate activation and respect a newer focus choice; approval still waits for the actual preview.
- New asset files are cleaned only after a definitely uncommitted registration failure or partial encoder failure. Any throwing compare-and-set remains uncertain and keeps files, including a delayed commit behind a stale read. Already registered previews remain preserved if a later order mutation fails. SQLite refresh-listener exceptions cannot turn a committed write into a failed response or suppress another subscriber. Eight isolated storage-fault regressions cover these boundaries; retained runtime/data was not fault-injected.
- Latest backend/node code was activated with retained Spacetime data/assets/journals. The already-open built owner view disconnected, natively reconnected and received independent pause/resume mutations with polling disabled: 2 opens, 1 error and 4 refreshes. [Current reconnect proof](evidence/overnight-fourth-sse-reconnect.json).

| Check                                | Result                                       |
| ------------------------------------ | -------------------------------------------- |
| Backend/application/process/realtime | 71 passed                                    |
| Python node                          | 67 passed in 5.52s                           |
| Payment/Claude and Fetch fixtures    | 25+5 passed                                  |
| Storage/wallet unit                  | 20 passed                                    |
| Built-application browser scenarios  | 89 passed in each of Chromium/Firefox/WebKit |
| Automated accessibility              | 39 A/AA scans, no detected violations        |
| Build/strict types/secret scan       | Passed                                       |
| Actual local restart/SSE reconnect   | Passed; polling disabled                     |

That is 277 unique software cases or 455 executions including the three browser engines, with no final failed/skipped/flaky cases. The full software check and build followed all final application changes. New browser recovery cases use isolated API boundaries; new persistence tests use temporary stores/files. Unchanged finite simulation loops, database restart/CAS and dependency audits remain historical evidence. No physical/live acceptance was substituted. The first built Firefox run passed 88/89; its touch test assumed tab switching closed machine settings. The revised test explicitly checks retained disclosure state across views and touch closure afterward. The affected case then passed; final reports below use the corrected test. No application change was needed for that diagnostic.

[Current machine-readable checkpoint](evidence/overnight-fourth-qa.json), [full report](test-report.md), [mobile result-image recovery](../web/evidence/overnight-evidence-recovery-320.png), [current reconnect](evidence/overnight-fourth-sse-reconnect.json), [reconnected owner view](../web/evidence/overnight-fourth-sse-reconnected.png). Earlier failed/affected-only diagnostic reports remain private under `.data/`; final reports are `web/evidence/overnight-fourth-*-browser.json`.

## Next useful audits

Completed: the earlier touch/storage/navigation/refresh/preview/queue work plus requester/owner numeric editing, machine settings, per-order trial/payment draft recovery, asset-registration fault boundaries and media retry. Continue only with a new boundary, reproduced failure or unresolved diagnostic:

1. Owner pickup-code, handling and operator-review forms still use component-local draft state. The new cache intentionally covers trial/payment only. Probe explicit queue paging/filtering/search or live state changes for loss of these other drafts; preserve privacy and explicit operator confirmations. Use isolated API fixtures.
2. Bounded recovery for a request that never finishes (as distinct from an explicit HTTP error): upload/prepare, owner saves and checkout/dispatch. Inspect actual timeout/cancellation behavior and distinguish an uncertain commit from a safe retry. No live wallet, model provider, hardware or retained-store fault injection.
3. Confirm responsive/keyboard clarity for any newly fixed boundary, including pending-save focus and unavailable calibration media where a useful next action may still be missing. Reproduce a specific issue before changing it. Native device/browser acceptance remains blocked.
4. Review new fixes independently, rerun affected checks and update this log. Avoid unchanged suite/finite-job reruns for volume. If useful independent work is exhausted or externally blocked, stay quiet until a meaningful change or the cutoff.
5. At 9:00 a.m. Pacific, perform final relevant health/source/evidence checks, leave the morning handoff and disable the heartbeat. Keep physical/live prerequisites honest and leave this chat unarchived.

## Morning handoff requirements

Report concrete changes, tests actually run, links to representative screenshots and evidence, current local app URL and remaining external prerequisites. Distinguish fixture, simulation, actual database and live acceptance. Do not describe a scheduled future check as already completed or claim uninterrupted execution while a heartbeat is waiting.
