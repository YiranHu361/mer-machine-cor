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

## Verified fifth checkpoint, 03:58 Pacific

Continuation from commit `93387b8` completed HTTP failure boundaries, owner action drafts, request/image deadlines, calibration status ordering, fresh evidence and delayed specification preparation. The overnight task remains active through 9:00 a.m. Pacific. Source fingerprint:

`e0d6515862ff043a1e4b7d80df5dd8638b7401353a802dcd7213c6579164e586`

- Owner preparation checklists, pickup codes, review decisions and failed-output inspections survive queue paging, searches and filters in private session memory. Their scopes bind the saved order, specification, approval, attempt, evidence and collection metadata. New scope, explicit discard, accepted action and session expiry clear the relevant confirmation; unrelated payment refreshes preserve it. Inputs lock while saving, and native leave warnings cover hidden dirty drafts. This memory cannot survive forced browser termination.
- Browser API requests now bound both response headers and JSON bodies: 30 seconds for ordinary reads, 90 for calibration status and 180 for mutations. These are recovery budgets, not completion targets. A timed-out or unreadable write is reported as uncertain; no automatic write retry occurs. An interrupted creation blocks a replacement submission until the saved order is opened or the requester explicitly discards it. Wallet HTTP has bounded recovery while the user's signature prompt has no artificial timeout; durable signature and unknown-submission guards remain intact.
- Result evidence binds each decoded image to the exact saved frame/attempt. A changed frame removes the previous image and requests a fresh same-origin URL; unchanged frames do not reload. Native preview and evidence images that never finish recover after 30 seconds, discard expired callbacks and offer explicit image-only retry. Preview approval still waits for the actual valid replacement image. Focus remains usable during retry.
- Physical-calibration numeric fields retain editable text, unavailable evidence has retry, and inspection/readiness confirmations reset for a different attempt, frame or device configuration. Status reads serialize, stale responses cannot replace newer attempts, and unmounted/device-changed callbacks cannot update the form. Unknown, failed or malformed lookups block starting/confirming until a valid saved record is recovered. Eleven isolated browser cases cover these paths; no physical job was started.
- Eight HTTP boundary regressions cover malformed/oversized JSON and multipart, decompressed limits, unsupported body types, safe unknown-route responses and masking private submitted values/paths. Validation/security headers precede parsing. Generic uncertain failures instruct reconciliation without exposing raw internal errors.
- Four concurrency regressions reproduce and prevent an older preview preparation overwriting a newer edit or approval/quote. The saved order/specification versions captured before preparation are checked inside each atomic update, including retries. A conflict preserves the newer artifact, approval, quote, reservation and registered preview files.
- Actual local backend/node activation retained Spacetime data, assets and attempt journals. The already-open owner view natively disconnected/reconnected and received independent pause/resume mutations with polling disabled. [Current reconnect proof](evidence/overnight-fifth-sse-reconnect.json).

| Check                                | Result                                        |
| ------------------------------------ | --------------------------------------------- |
| Backend/application/process/realtime | 83 passed                                     |
| Python node                          | 67 passed in 5.69s                            |
| Payment/Claude and Fetch fixtures    | 25+5 passed                                   |
| API/storage/wallet unit              | 28 passed (7+6+15)                            |
| Built-application browser scenarios  | 130 passed in each of Chromium/Firefox/WebKit |
| Automated accessibility              | 39 A/AA scans, no detected violations         |
| Build/strict types/secret scan       | Passed                                        |
| Actual local restart/SSE reconnect   | Passed; polling disabled                      |

That is 338 unique software cases or 598 canonical executions including the three browser engines, with no final failed/skipped/flaky cases. Full software checks and build followed frozen application changes; the final browser suites used that built origin. New tests use isolated stores/files and intercepted browser APIs. Actual retained runtime was restarted, not fault-injected. Earlier unchanged finite simulation, database restart/CAS and dependency evidence remains historical. No physical/live acceptance is substituted.

Calibration diagnostics initially assumed enabled upload controls before upload completion and matched an unrelated fixture SSE alert; explicit readiness waits and scoped assertions corrected those tests. A WebKit virtual-time diagnostic now waits until the request actually starts. The pickup baseline initially used a filter still including the order; the corrected excluded-order diagnostic against the previous committed OwnerJob implementation reproduced lost input. These earlier diagnostic/affected-only reports remain private; unique cases are counted once in final reports.

[Current machine-readable checkpoint](evidence/overnight-fifth-qa.json), [full report](test-report.md), [owner action drafts at 320px](../web/evidence/overnight-owner-action-drafts-320.png), [mobile image recovery](../web/evidence/overnight-evidence-recovery-320.png), [reconnected owner view](../web/evidence/overnight-fifth-sse-reconnected.png). Final browser reports are `web/evidence/overnight-fifth-*-browser.json`.

## Verified sixth checkpoint, 04:30 Pacific

Continuation from commit `0551d73` completed stale-form conflicts, clearance context, keyboard recovery and calibration concurrency. The overnight task remains active through 9:00 a.m. Pacific. Source fingerprint:

`3229ea03eaec73a7bbe65c21c9a84c1f6a890e485ead27724f81d644474b5ce0`

- Requester edits retain an immutable version from when editing begins. Conditional saves reject stale forms before preview preparation and recheck after I/O. Conflicts preserve the exact draft and disable repeated stale saves; explicit Use saved specification loads a validated current record for reapplying desired changes. The saved-response check now rejects malformed nested artifacts/history instead of allowing a render crash.
- Owner machine forms retain their base editable-settings fingerprint. A newer saved configuration shows a conflict while preserving the draft; explicit Load newer saved settings adopts it. Readiness/job/ledger-only refreshes do not cause configuration conflicts. Stale saves reject before node policy I/O, and same-machine PATCH requests serialize. A changed configuration or uncertain policy acknowledgement preserves newer values and conservatively pauses availability until a deliberate current-policy synchronization and fresh inspection/resume. No rollback or automatic mutation retry is claimed.
- Machine clearance is a fresh confirmation of device/configuration/execution context. A changed adapter, material, pairing, calibration, attempt/reservation or policy-reconciliation state clears the old checkbox. Accepted pause/resume/calibration also clears it; unrelated refreshes preserve it.
- Explicit Check saved orders recovery focuses and scrolls the recovered order (or empty-list heading) into narrow-screen view while respecting newer user focus/input. Calibration retry restores focus only after the rendered control is enabled; failed retries remain usable. Optional calibration status containers/strings are validated, and malformed responses show recovery text instead of crashing. New cases cover 320px keyboard paths and newer-focus preservation.
- Backend calibration observations save status and matching evidence atomically against the captured attempt, device context, version and evidence on every CAS retry. Older replies/frames/errors cannot replace newer owner decisions, completed observations or attempts. Durable operator resolutions remain authoritative, archived attempts use their saved record, and unknown/non-string node statuses cannot reset known outcomes. Late start acknowledgements and errors have the same fencing. Unchanged polls do not add history or change the calibration version. Twelve new isolated cases cover these boundaries.
- Actual local backend/node activation retained Spacetime data/assets/journals. The already-open owner dashboard natively reconnected with polling disabled. The signed simulation calibration API acceptance was rerun because its implementation changed: upload, preparation, one durable attempt/replay, status/frame, inspection and explicit resume. No physical job, payment or live provider was used. [Reconnect proof](evidence/overnight-sixth-sse-reconnect.json), [simulation calibration proof](evidence/overnight-sixth-calibration-api.json).

| Check                                | Result                                        |
| ------------------------------------ | --------------------------------------------- |
| Backend/application/process/realtime | 106 passed                                    |
| Python node                          | 67 passed in 5.53s                            |
| Payment/Claude and Fetch fixtures    | 25+5 passed                                   |
| API/storage/wallet unit              | 29 passed (8+6+15)                            |
| Built-application browser scenarios  | 146 passed in each of Chromium/Firefox/WebKit |
| Automated accessibility              | 39 A/AA scans, no detected violations         |
| Build/strict types/secret scan       | Passed                                        |
| Actual local restart/SSE reconnect   | Passed; polling disabled                      |

That is 378 unique software cases or 670 canonical executions including the three browser engines, with no final failed/skipped/flaky cases. The full shared check passed before the last server-only identity guard; final backend types/tests followed it. Unchanged node/integration/web/unit checks and the identical bundle were retained, with both raw logs and source fingerprints recorded. Final browser suites used the final backend and built origin. New tests use isolated stores/files and intercepted browser APIs. Actual retained runtime was restarted, not fault-injected. Earlier unchanged finite simulation, database restart/CAS and dependency evidence remains historical. No physical/live acceptance is substituted.

A WebKit affected run initially passed 14/15 because focus restoration could run before busy controls re-enabled. The helper now waits for the rendered completion state; four affected cases passed five diagnostic repetitions and the final three-engine suite below passed once per unique case. A previously reentrant nested-PATCH fake was replaced with controlled overlapping external requests because same-machine serialization intentionally prevents nested policy calls. The first built Chromium run passed 143/146: an old workflow tried to reuse clearance after calibration, leaving the machine paused and cascading into its quote/live-update follow-ups. The workflow now asserts the cleared checkbox and disabled Resume, then explicitly checks again. This final test-only update leaves application/build bytes unchanged; final browser results below use the corrected fixture. Earlier private diagnostics and repeated timing checks do not inflate unique-case counts.

[Current machine-readable checkpoint](evidence/overnight-sixth-qa.json), [full report](test-report.md), [requester conflict at 320px](../web/evidence/overnight-requester-edit-conflict-320.png), [owner settings conflict at 320px](../web/evidence/overnight-machine-settings-conflict-320.png), [mobile image recovery](../web/evidence/overnight-evidence-recovery-320.png), [reconnected owner view](../web/evidence/overnight-sixth-sse-reconnected.png). Final browser reports are `web/evidence/overnight-sixth-*-browser.json`.

## Verified seventh checkpoint, 04:57 Pacific

Continuation from commit `6d0e562` completed requester draft recovery, exact creation correlation, frame binding and fresh checkout prerequisites. Work continues through 9:00 a.m. Pacific. Source fingerprint:

`0ddc4be4e47bb516e7100c77e83f9f5635e69cc7eec7fe5ef2a9337fc3274a4c`

- Requester new/edit drafts survive in-page order selection with exact text, numeric blanks, budget, uploaded artwork and original conditional-save baseline. Named Resume/Discard controls, a narrow-screen shortcut and native leave warnings cover hidden drafts. Drafts remain private session memory and clear on session expiry; forced browser termination can lose them. A delayed startup/read-retry response cannot replace a newly edited form. Recovery controls wait until the interrupted action finishes settling.
- New orders carry an exact scoped request identifier. Replaying the original request returns the current saved order, including after later edits/cancellation, without another HTTP preparation or order. A changed original specification under that key rejects. Pre-prepare lookup, local serialization and atomic CAS checks cover concurrent backends; a losing cross-backend preparation can retain its registered private preview. Interrupted UI recovery matches only that exact identifier; similar orders cannot resolve it. Successful create/edit replies must match their captured request/order before clearing a draft. No automatic mutation retry is added.
- Saved evidence URLs bind the exact frame metadata, order/attempt and explicit calibration identity. A stale binding rejects before frame fetch instead of substituting newer bytes under an old caption. Latest-calibration selection is shared and deterministic for tied timestamps, with active attempts preferred. Legacy no-query reads retain documented latest-attempt behavior. A stale image needs an explicit metadata refresh; image-only retry cannot silently change its binding.
- Fresh checkout rechecks reservation, current device readiness/policy, stock, material, permission, owner limits and mode before a new authorization/collection intent and inside allocation CAS retries. Delayed challenge offers also revalidate the current quote and prerequisites. Existing same-key pending/held reconciliation remains unchanged. Readiness can change after allocation commits; this does not claim atomic payment/device rollback.
- Actual local backend/node activation retained Spacetime data/assets/journals, and native SSE reconnect passed with polling disabled. Signed simulation calibration acceptance was rerun for the changed evidence contract. Actual Spacetime-backed creation/replay/conflict/edit/cancel/list acceptance passed with exactly one correlated order and no payment or dispatch. [Reconnect](evidence/overnight-seventh-sse-reconnect.json), [simulation calibration](evidence/overnight-seventh-calibration-api.json), [creation identity](evidence/overnight-seventh-creation-api.json).

| Check                                | Result                                        |
| ------------------------------------ | --------------------------------------------- |
| Backend/application/process/realtime | 130 passed                                    |
| Python node                          | 67 passed in 5.50s                            |
| Payment/Claude and Fetch fixtures    | 25+5 passed                                   |
| API/storage/wallet unit              | 29 passed (8+6+15)                            |
| Built-application browser scenarios  | 163 passed in each of Chromium/Firefox/WebKit |
| Automated accessibility              | 42 A/AA scans, no detected violations         |
| Build/strict types/secret scan       | Passed                                        |
| Actual local restart/SSE reconnect   | Passed; polling disabled                      |

That is 419 unique software cases or 745 canonical executions, with no final failed/skipped/flaky cases. The complete shared check passed before the final web-only startup-draft/focus recovery fixes. Web types/build and API/storage/wallet units were rerun after those fixes; unchanged backend/node/integration results were retained with raw logs and source fingerprints. Final three-engine browser suites used the resulting built origin. New faults use isolated stores/files or intercepted browser APIs. Actual retained runtime was restarted, not fault-injected. Earlier finite simulation/database/dependency evidence remains historical; no physical/live acceptance is substituted.

Diagnostics initially exposed old navigation assumptions that New order discarded edits, a native Mac keyboard-tab convention, and recovery activation before the interrupted action settled. Tests now explicitly discard cached drafts, use the existing Option+Tab convention in WebKit, and cover the held recovery boundary. A separate late startup response reproduced loss of a newly typed draft; that product fix is covered before final build. Private affected/repeated diagnostics do not inflate unique counts. The creation acceptance log is explicitly labeled a reconstructed recorded-result summary; the JSON records the actual execution.

[Current checkpoint](evidence/overnight-seventh-qa.json), [full report](test-report.md), [requester drafts at 320px](../web/evidence/overnight-requester-drafts-320.png), [requester drafts on desktop](../web/evidence/overnight-requester-drafts-desktop.png), [reconnected owner view](../web/evidence/overnight-seventh-sse-reconnected.png). Final reports are `web/evidence/overnight-seventh-*-browser.json`.

## Verified eighth checkpoint, 05:35 Pacific

Continuation from commit `8fe6a2a` completed supervised calibration retry, exact request recovery, fresh observations and registration/probe ordering. Work continues through 9:00 a.m. Pacific. Source fingerprint:

`b5354691a924db51c84ea3bf896aa316db06c4d0eb950e17c38bf78c8fe79523`

- Physical-calibration history remains visible while a deliberate new preparation uses a fresh key, artwork/model selection and unchecked supervised readiness. Repeated historical reads preserve exact input; new active work, changed device/registration or unknown permissions disable stale preparation. Current store permission is labeled separately from physical/node readiness. Mobile keyboard focus and a 320px screenshot are verified with intercepted device APIs.
- One verified session checkpoint envelope is saved before a physical-start POST. Exact saved request-key lookup can recover an archived attempt beside a different latest record; missing, damaged or mismatched responses never establish absence or rotate an uncertain request. A valid current active attempt can still be explicitly resolved when local checkpoint data is damaged, without clearing the unknown-key guard on fresh starts. No automatic write retry or reprint is added.
- Calibration start checks current device context before preparation and inside CAS. An internal authorization observation also prevents old preparation starting after a newer calibration/clearance cycle; exact known-key replay remains recovery. An accepted new calibration atomically removes only an expired reservation so final inspection can complete. Active/live/invalid reservations remain blocked.
- Confirmation/resolution writes bind the device, exact target version/evidence, execution/availability facts and a persisted confirmation identity. Older success, failure or error callbacks cannot replace newer registration, inspection or resolution, including identical inactive simulation confirmations. Successful node confirmation must explicitly match the saved simulation/hardware mode. Node-private transport/camera configuration binding remains required and is not inferred from backend metadata.
- Registration preserves newer device/settings/inspection observations inside every CAS retry. Accepted registrations and accepted/uncertain policy observations carry separate persisted identities, so identical acknowledgements still supersede an older manifest. Unrelated global state does not block the operation. Fresh registration/confirmation identities clear old owner inspection checkboxes.
- Background availability reads validate node identity, mode and booleans, then fence the captured inspection/policy observation before applying a negative result. Old reads cannot erase a newly calibrated/resumed setup. Malformed/foreign/disconnected status pauses availability without inventing a calibration revocation; a coherent current negative can revoke it. Null status cannot prevent remaining machines/orders from reconciling.
- Actual retained Spacetime/simulation/mock services were activated and the open dashboard natively reconnected with polling disabled. Two explicitly authorized signed simulation calibrations exercised expected context, active/inactive lifecycle, exact frames, archived-key lookup, replay, inspection and explicit resume. The seventh checkpoint's exact cancelled creation was replayed after restart without a new order. [Reconnect](evidence/overnight-eighth-sse-reconnect.json), [simulation calibration](evidence/overnight-eighth-calibration-api.json), [creation restart](evidence/overnight-eighth-creation-restart.json).

| Check                                     | Result                                        |
| ----------------------------------------- | --------------------------------------------- |
| Backend/application/process/realtime      | 168 passed                                    |
| Python node                               | 67 passed in 5.47s                            |
| Payment/Claude and Fetch fixtures         | 25+5 passed                                   |
| API/storage/wallet unit                   | 29 passed                                     |
| Built browser scenarios                   | 182 passed in each of Chromium/Firefox/WebKit |
| Automated accessibility                   | 45 A/AA scans, 0 detected violations          |
| Build/types/secret scan/served-byte match | Passed                                        |
| Actual retained restart/native SSE        | Passed; polling disabled                      |

That is 476 unique software cases or 840 canonical executions, with no final failed/skipped/flaky cases. The complete shared software check, strict types, node/integration fixtures, production build and API/storage/wallet units followed all eighth application changes. One later browser-only fixture correction supplies required lifecycle/machine identity metadata; application and bundle bytes are unchanged. Final three-engine browser suites used the corrected fixture and that built origin. The actual runtime remains simulation/mock/SpacetimeDB. No required physical/live test is relabeled passed.

Private baseline diagnostics reproduced older callbacks, identical acknowledgements and stale preparation. An early late-preparation fake used completed→failed resolution, which the pinned node forbids; the valid regression uses node FAILED→explicit owner FAILED. Only the corrected fixture/control and final reports are counted. A fresh-start response missing/differing mode is rejected; legacy positive HTTP fakes were corrected to include the actual node contract. The first built Chromium run passed 181/182; the remaining old evidence fixture lacked required lifecycle/machine identity fields. Its explicit contract was corrected, affected checks passed, and final suites below use that fixture. Application/build bytes did not change. Repeated affected timing diagnostics and this earlier report are not additional unique cases.

[Current checkpoint](evidence/overnight-eighth-qa.json), [full report](test-report.md), [320px fresh calibration preparation](../web/evidence/overnight-calibration-retry-320.png), [320px requester drafts](../web/evidence/overnight-requester-drafts-320.png), [reconnected actual owner view](../web/evidence/overnight-eighth-sse-reconnected.png). Final browser reports are `web/evidence/overnight-eighth-*-browser.json`.

## Verified ninth checkpoint, 05:39 Pacific

Continuation from `a8d46f3` binds new device authorizations to explicit simulation/hardware mode and private device configuration. Source fingerprint: `a4aa36960485dc5a187c48b1041bc39a52051bd88ca8ffa0ccd62146c76a3c89`.

- The TypeScript signer includes authenticated `expected_mode` for dispatch, calibration, camera and abort; malformed saved mode cannot mint an authorization. Python rejects new missing/malformed/mismatched mode before artifact fetch, capture or stop, rechecks after asynchronous I/O, and fences the queued worker before any adapter call.
- Camera/stop for a journaled attempt also require its saved private device/capture configuration. An old same-mode attempt cannot capture a replacement camera or stop a replacement transport. Changed capture context cannot publish frames under old metadata. Exact authenticated durable legacy acceptance replay remains read-only without a new fetch, worker or output.
- **180 backend cases and 89 Python node cases pass**, including 12 new signing and 22 node regressions. Hardware in these regressions is a fake adapter, with zero physical I/O. Backend strict types pass.
- Actual retained Spacetime/simulation/mock backend and node were restarted together. Native SSE reconnected with polling disabled; one explicit signed simulation calibration, exact replay, bound pixels, inspection and resume passed. Three actual-app workflow cases then passed in each of Chromium, Firefox and WebKit.
- Web source, integrations and bundle are unchanged from checkpoint eight. Its 182 full browser cases per engine, 45 accessibility scans, 29 web units and 25+5 integration fixtures remain retained evidence; they were not rerun for volume. Across current backend/node and unchanged retained suites, **510 unique cases** pass. Nine affected workflow reruns are supplemental, not new cases. Served bundle bytes match; configured-secret scan passes and private configuration remains ignored/0600.

[Checkpoint and provenance](evidence/overnight-ninth-qa.json), [signed simulation calibration](evidence/overnight-ninth-calibration-api.json), [actual reconnect](evidence/overnight-ninth-sse-reconnect.json), [reconnected view](../web/evidence/overnight-ninth-sse-reconnected.png). Current workflow reports are `web/evidence/overnight-ninth-*-workflow.json`; unchanged full UI reports remain checkpoint eight.

This is partial software completion. The isolated customer404/refund race and truthful calibration retirement/error-focus gaps below remain actionable; work continues through 9:00 a.m. Pacific. No physical job, funded transaction or live provider is claimed.

## Verified tenth checkpoint, 06:04 Pacific

Continuation from `bfe0714` repairs cancellation-before-acceptance, customer refund ordering, truthful calibration retirement and owner recovery focus. Source: `98594282729c9c222f7c461c5ac91fdcb7b91be8246965919002096fd9c0192a`.

- Signed cancellation before acceptance atomically stores a durable record for the exact machine/job/attempt/artifact/approved parameters/mode/scope. Node acceptance checks it in the same SQLite transaction, including after a held artifact download. Cancellation refuses every already accepted execution state and never captures, fetches, stops or starts output. Exact proof survives restart and lost acknowledgement; transaction failures do not manufacture proof.
- The backend no longer refunds a customer merely because a current status lookup returns404. It requires the full matching durable cancellation proof, captures the exact machine/job/payment context before I/O, and repeats context checks inside CAS. Malformed/foreign/expired-context replies remain blocked. Two independent actual Python HTTP regressions hold a local artifact response, obtain cancellation for customer/calibration intent, then release the original request: zero execution attempts remain and customer refund follows the barrier.
- Completed but unusable calibration output has a separate rejected inspection. Execution remains completed/produced; rejection confirms the exact settled node attempt, retains its artifact/evidence/history, clears only its matching backend slot and leaves availability paused/unready/uncalibrated. Old rejected/cancelled results cannot later become calibration proof. New work needs deliberate fresh preparation, key and supervised readiness.
- Owner actions distinguish Confirm usable calibration, Reject calibration output, Cancel before device acceptance, and Cancel calibration preparation (an unsent local draft only). Unknown local request keys remain independent. Exact version/context/proof metadata is validated before current saved-state recovery; no unconfirmed reply or different attempt authorizes replacement output.
- Calibration confirmation errors are delegated narrowly into a local recovery region. Error/retry controls remain mounted and usable across repeated failed reads; focus waits for enabled DOM, stays near the form and respects newer input. Successful rejection/cancellation moves keyboard focus to fresh preparation, or retained history when an unrelated pending key blocks preparation. Shared global error behavior is unchanged for other actions.
- Actual retained Spacetime/simulation/mock services were activated. Native SSE reconnected with polling disabled. Two finite signed simulation calibrations exercised separate rejection preserving node completion, old-proof refusal, a fresh attempt, inspection and explicit resume. No physical device, live model, funds or external registration was used.

| Check                                            | Result                                      | Boundary / evidence                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend/application/process/realtime             | **201 passed**, no failed/skipped           | Actual HTTP, temporary SQLite/process recovery, concurrency and two actual Python HTTP cancellation races                                                |
| Python node                                      | **107 passed**                              | Real journal/auth, atomic writer races, storage faults, restart/lost replies and actual in-process MCP; device/camera boundaries isolated                |
| Payment/Claude + Fetch fixtures                  | **25+5 passed**                             | Offline signatures, receipts, provider parser/checkpoints and bridge authorization; no funds/live model                                                  |
| API/storage/wallet units                         | **29 passed**                               | 8 API +6 storage +15 wallet                                                                                                                              |
| Build/strict types                               | PASS                                        | Final application bytes built and served on loopback port 4318                                                                                           |
| Built browser Chromium                           | **198 passed**, no skipped/flaky/unexpected | [Report](../web/evidence/overnight-tenth-chromium-browser.json)                                                                                          |
| Built browser Firefox                            | **198 passed**, no skipped/flaky/unexpected | [Report](../web/evidence/overnight-tenth-firefox-browser.json)                                                                                           |
| Built browser WebKit                             | **198 passed**, no skipped/flaky/unexpected | [Report](../web/evidence/overnight-tenth-webkit-browser.json)                                                                                            |
| Automated accessibility                          | **48 scans**, 0 detected violations         | 13 full-page states and scoped requester drafts/calibration preparation/error recovery per engine; keyboard/visual review separate, not full conformance |
| Actual retained restart/SSE                      | PASS, polling disabled                      | [Evidence](evidence/overnight-tenth-sse-reconnect.json)                                                                                                  |
| Actual simulation calibration rejection/recovery | PASS, 2 finite attempts                     | [Evidence](evidence/overnight-tenth-calibration-api.json)                                                                                                |
| Configured-secret/served-byte check              | PASS                                        | Private configuration remains ignored with 0600 permissions; served HTML/JS/CSS match build                                                              |
| Earlier unchanged acceptance                     | Retained historical evidence                | Spacetime CAS/access/subscriptions, finite 10-sticker/3-Instax simulation loop, creation identity/restart and local FastMCP; not rerun for volume        |

That is 565 unique cases or 961 canonical executions, with no final failed/skipped/flaky tests. The complete shared check followed all tenth application changes. One later browser-only correction explicitly focuses/presses Enter for a keyboard recovery case because native Mac WebKit mouse clicks retained the parent Notice focus. App/styles and production bundle are unchanged; final browser suites use the corrected fixture and that built origin. Earlier affected/diagnostic runs are not additional unique cases. Current runtime remains simulation/mock/SpacetimeDB. Required physical/live acceptance is not relabeled passed.

Diagnostics: the first root cross-language harness completed its child operation but waited again for an already signaled child because exitCode remains null after SIGTERM; cleanup now also checks signalCode. Its final two cases and complete shared suite pass. A private actual-Node proof showed a five-second device clock difference rejected valid cancellation; matching bounded 60-second past/future tolerance and far-out negative controls repaired it. The first affected WebKit run 78/79 retained the parent Notice focus after native Mac mouse clicking. That intended keyboard test now explicitly focuses and presses Enter; application/styles/build bytes stayed unchanged. Affected 79 and final full suites use the corrected case. These diagnostics/repetitions are not extra unique cases.

[Checkpoint](evidence/overnight-tenth-qa.json), [full report](test-report.md), [local recovery at 320px](../web/evidence/overnight-calibration-operator-error-320.png), [fresh preparation at 320px](../web/evidence/overnight-calibration-retry-320.png), [actual reconnect](evidence/overnight-tenth-sse-reconnect.json), [owner view](../web/evidence/overnight-tenth-sse-reconnected.png).

## Verified eleventh checkpoint, 06:29 Pacific

Continuation from `5a35c87` repairs durable estimated-media bookkeeping. Source: `156048174a716046bfc6603a8878c15324e6c8fe6a6568fafc1f19f1839040d4`. This is an estimate based on planned quantity, never a physical media measurement.

- The Node saves actual returned execution and its one-time planned-quantity deduction in the same SQLite transaction. Retried updates cannot double-count; tombstones, preflight rejection, driver exceptions, manual reconciliation and legacy rows do not invent consumption or backfill old counts.
- Exact machine/job/attempt/mode-bound completed or failed estimates update the matching active backend slot once. Calibration and failed output no longer omit consumption; pickup does not deduct it again. A fresh read can repair a skipped old observation, while a newer explicit owner count stays authoritative. Uncertain execution waits for a settled outcome.
- Independent review reproduced a retirement race after a max-quantity-only acknowledgement. Calibration rejection/failure/inspection and customer handling/clearance now keep the exact active assignment until the estimate is refreshed through the existing status or Reconcile saved outcome action, followed by deliberate retry. No inactive reads or background polling were added.
- The full shared check passes **223 backend  /119 Node  /25 payment-Claude  /5 Fetch  /29 browser units**, with types and build passing. Current built-origin affected checks pass **5 cases per engine** in Chromium, Firefox and WebKit: two new stock/draft cases plus three actual workflows. The application UI/styles and production bundle are unchanged from checkpoint ten; its full 198 browser cases per engine and 48 automated accessibility scans remain retained evidence. Composite coverage is **601 unique cases  /1001 canonical executions**, with exact split provenance in the checkpoint; this is not a claim of a new full 200-case browser run.
- Retained simulation/mock/Spacetime services were restarted with journals/assets/state preserved. Native SSE reconnected with polling disabled (2 opens/1 error/4 refreshes). Two signed finite simulation calibrations changed the matching backend/Node estimate from 38 to 37 to 36 through completed-output rejection, fresh preparation, inspection and resume; no duplicate deduction occurred. Actual browser workflows followed activation. No hardware, funds or live model calls were used.

[Current checkpoint](evidence/overnight-eleventh-qa.json), [estimated-media simulation](evidence/overnight-eleventh-calibration-api.json), [actual reconnect](evidence/overnight-eleventh-sse-reconnect.json), [320px settings conflict](../web/evidence/overnight-machine-settings-conflict-320.png).

## Verified twelfth checkpoint, 07:04 Pacific

Continuation from `6cc5952`; source `4d7f272a25f2730c80773aa8d0012628f66409811e12be1331d3732821833ee3`. The application remains local simulation/mock/SpacetimeDB, with required physical/live acceptance blocked.

- Owner-only expired pickup renewal uses one permanent per-job request identity and atomic original version/expiry checks. Exact replay returns current state after newer renewals, collection, lost commit acknowledgement and restart. Competing owners cannot rotate the winner’s valid code. Production, machine/media, payment and unrelated work stay unchanged.
- Requester code presentation uses expiry<=now, hides expired tokens and explains owner renewal. Owner actions preserve the exact uncertain body across filters/pages in private session memory, check current saved state before retry, validate response identity and matching renewal history, and preserve a newer focus choice. Current collected state never reopens. Review found and repaired a late failure leaving an obsolete disabled renewal block; the public regression retains current input, focus, scroll and one local POST.
- Actual hardware adapter tasks and cleanup remain retained through timeout/caller cancellation/canceled close; release/reuse and journal ownership stay fenced while they run. Valid late returns account the estimate once without changing saved uncertainty/timestamps. Ambiguous accounting commits remain blocked until explicit authorized recovery. No actual hardware was used.
- Actual pinned SDK wrappers showed failed FTP upload was followed by a Bambu start command, false stop publication was mislabeled requested and missing Instax Bluetooth could exit Node. Upload now requires a positive FTP completion; start/stop require strict publication confirmation, while only exact RUNNING→FINISH can establish Bambu completion. Missing-Bluetooth SystemExit is translated locally. A fake-BLE actual Node child now survives with uncertain state; no live compatibility is claimed.
- An actual temporary browser flow reproduced native POST403 on custom configured port; server PORT existed while the origin guard hardcoded defaults. The guard now recognizes the configured loopback port and rejects other hosts/ports. Two HTTP regressions include real dynamic listening and exact state preservation for hostile origins.
- Complete shared checks pass **237 backend, 137 node, 25 payment/Claude, 5 Fetch and 29 browser units**. Full built Chromium/Firefox/WebKit suites each pass **214**, with no failed/skipped/flaky tests; **51 accessibility scans** detect 0 violations. Aggregate 647 unique/1075 canonical executions. The complete shared check and production build followed every twelfth application change. Three later browser-only corrections added the actual API’s future pickup expiry/code and collection timestamp to positive fixtures. Assertions, application, backend, node and bundle did not change; the final full browser suites use the corrected fixtures. Earlier diagnostic and affected reruns are not additional unique cases.
- Actual retained backend/node restart/native SSE passes with polling disabled. New pickup renewal/old-code rejection/handoff/exact post-collection replay passes with actual HTTP/built UI/native SSE in all three engines using temporary SQLite and a seeded prepared simulation item; no API interception and zero device/payment calls. Earlier finite actual-database/simulation acceptance is retained honestly.

[Checkpoint](evidence/overnight-twelfth-qa.json), [full report](test-report.md), [SDK evidence](evidence/overnight-twelfth-node-contracts.json), [expired owner 320px](../web/evidence/overnight-pickup-expired-owner-320.png), [expired requester 390px](../web/evidence/overnight-pickup-expired-requester-390.png), [local recovery 320px](../web/evidence/overnight-pickup-renewal-320.png), [actual reconnect](evidence/overnight-twelfth-sse-reconnect.json).

Diagnostics: the initial partial Chromium run correctly blocked a positive live-queue fixture that omitted all pickup metadata. Three positive fixtures now supply actual API metadata; no safeguards or behavior assertions were removed. The initial failed/interrupted report is private and not counted. A separate finite actual lost-ack audit confirmed automatic ticks do not churn or starve review, and explicit owner fail review/refund succeeds with one attempt/artifact fetch. Repeated explicit checks remain audit actions; no production change was warranted.

## Final morning handoff, 09:45 Pacific

The requested cutoff was 09:00. Control resumed at 09:41 after a recorded wall-clock/observation gap; no further application changes were made. The heartbeat is confirmed **PAUSED**. Final source remains `4d7f272a25f2730c80773aa8d0012628f66409811e12be1331d3732821833ee3`, committed as `1b486a7`. This chat, ignored configuration, assets, Node journal and Spacetime data are preserved.

- Canonical software coverage remains **647 unique cases /1075 executions**, including 214 cases in each of Chromium/Firefox/WebKit and 51 automated accessibility scans with 0 violations. Exact fixture/simulation/actual-persistence boundaries remain in [test-report.md](test-report.md); the required physical/live acceptance remains blocked.
- The planned 75-minute passive check is **INCOMPLETE**, not passed. It produced 24 healthy samples from 13:58:40.870Z to 14:21:40.908Z (23m00.038s), then a 139m27.002s observation gap. Both EventSource requests recorded `ERR_NETWORK_IO_SUSPENDED`; two final observations had closed pages and HTTP503. The helper’s completed/planned_end bookkeeping and empty failures array did not establish acceptance. No passive final screenshots were produced. [Measured evidence](evidence/overnight-passive-session-soak.json).
- Current health originally returned `STORE_DISCONNECTED`, a guarded refusal to accept replacement activity. An explicit retained local restart restored HTTP200 simulation/mock/SpacetimeDB; final dashboard has 0 active jobs, all 3 Node modes remain simulation, and HTML/JS/CSS match the build. Fresh actual owner 1440px/requester 390px pages each received native SSE (1 open/1 refresh/0 errors), with 0 page errors and no jobs/payments/machine changes. [Recovery](evidence/overnight-final-recovery.json), [browser](evidence/overnight-final-browser.json), [owner screenshot](../web/evidence/overnight-final-owner-1440.png), [requester screenshot](../web/evidence/overnight-final-requester-390.png). This proves recovery only, not the missing endurance interval.
- Remaining required acceptance needs exact team devices/cameras and supervising owners, funded Base Sepolia setup, Claude and Agentverse configuration, physical timing/cost observations, consenting customer evidence and official rules. No funds, physical jobs, live calls, public publishing or external contact occurred. A future uninterrupted endurance check is also outstanding.
- One small copy issue observed late in the final screenshot remains: the requester availability note uses “1 machines available.” It was not changed after the requested cutoff; no functional failure was reproduced.

Use [the full report](test-report.md) and [progress/prerequisites](progress.md) for resumption. Do not restart the overnight heartbeat or claim the whole PRD complete without new user direction and the required external acceptance.

## Later product follow-up, October 23

After the overnight handoff, the user clarified the requester vision: upload pictures and let the agent choose a suitable machine from the database. That new request is implemented separately from the ended overnight task; the heartbeat remains paused. Source `6b29d6df56b4e921afb5a5da441d11cea0c9d5ba5c627d4fc5f2a5d71403d944`.

- Fresh intake now uploads pictures before any output/settings selection, automatically analyzes them and presents the output, saved machine and explanation. Notes and advanced settings are optional, including blank/short notes on edits.
- Recommendations are read-only and use current saved capability/material/mode/policy/hours/media/readiness/reservation facts. The exact machine is approval-bound and revalidated for quote/checkout. Unknown/malformed replies and held analysis cannot silently lose this binding or overwrite newer input.
- Actual retained simulation/mock/Spacetime flow passed upload→recommendation→explicit rights→production preview→approval→same-machine quote. The unpaid test order was cancelled and reservation release checked. No physical output, payment or live model call occurred.
- Verification: 249 backend, 147 Python node, 31 payment/Claude fixtures, 5 Fetch and 29 web units pass; 237 full browser cases pass in each of Chromium/Firefox/WebKit, with 54 automated accessibility scans and 0 detected violations. That is 698 unique cases/1172 canonical executions. Backend/node/provider checks precede only the documented frontend recovery/optional-note changes; final frontend types/build, units and all full browser suites follow every change. Earlier diagnostics are not additional unique cases.
- Current local analysis is explicitly limited color/tonal statistics. The configured Claude recommendation path is covered with injected HTTP fixtures, not a paid/live call. Required physical/live/customer/rules acceptance and the earlier uninterrupted endurance observation remain incomplete. The old singular-machine copy issue is fixed in this later UI update.

[Current report](test-report.md), [checkpoint](evidence/picture-first-qa.json), [actual native proof](evidence/picture-first-native.json), [320px upload](../web/evidence/picture-first-empty-320.png), [actual mobile recommendation](../web/evidence/picture-first-native-recommended-mobile.png).
