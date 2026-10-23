# Verification report

Recorded 2026-10-23 02:29 Pacific (America/Los_Angeles). Overnight testing continues until 9:00 a.m. on October 23. Machine-readable timestamps are UTC.

**Partial completion.** The software is runnable and the software checks below pass. Required physical and live integration acceptance is still blocked; the entire PRD is not done. No physical output, onchain transaction, live Claude call, ASI:One discovery, interview, sponsor eligibility or shipping event is claimed.

Working source-state identifier:

`3b8b53e7e46b781a03722fcb644a2be6786bdbeae811e1fab891df2c3d8eceae`

Reproduce with `node scripts/state-id.mjs`. It hashes application, node, integrations, tests, browser configuration, setup scripts and dependency/runtime pins; private data, generated builds and reports are excluded. The full software check followed the backend/node/integration changes; the final build and all three browser suites followed the last UI refinement. [Overnight checkpoint](overnight-qa.md), [current machine-readable summary](evidence/overnight-third-qa.json).

## Checks actually executed

| Suite                                                    | Result                                    | Boundary and evidence                                                                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend typecheck and application/process/realtime tests | **61 passed**, 0 failed/skipped           | Actual HTTP, Pillow, private assets, SQLite CAS, process deaths, concurrency, and 36 live-stream reconnects without leaked subscriptions. `.data/overnight-third-software-final.log`     |
| Python node                                              | **67 passed** in 5.57s                    | Real journal/auth/image processing, isolated device/camera boundaries; configuration-bound calibration, owner-policy races and delayed-stop fencing. [Node details](node-integration.md) |
| Payment/Claude fixtures and typecheck                    | **25 passed** / PASS                      | Official signatures/headers, transfer receipts, durable checkpoint failures and conservative image parsing; no live funds or model calls                                                 |
| Fetch bridge fixtures                                    | **5 passed**                              | Actual in-process MCP/Chat Protocol and requester/sender/mandate guards. One upstream Authlib deprecation warning                                                                        |
| Browser storage/wallet unit tests                        | **20 passed**                             | Denied/quota/silent storage, concurrent/ambiguous wallet retries, storage eviction and offline EIP1193 signatures; no live settlement                                                    |
| Production web build / strict TypeScript                 | PASS                                      | Latest bundle served at loopback port 4318; fonts local and wallet code loaded separately                                                                                                |
| Built app browser suite, Chromium                        | **56 passed**, 0 skipped/flaky/unexpected | [Chromium report](../web/evidence/overnight-third-chromium-browser.json)                                                                                                                 |
| Same suite, Firefox                                      | **56 passed**, 0 skipped/flaky/unexpected | [Firefox report](../web/evidence/overnight-third-firefox-browser.json)                                                                                                                   |
| Same suite, WebKit                                       | **56 passed**, 0 skipped/flaky/unexpected | [WebKit report](../web/evidence/overnight-third-webkit-browser.json)                                                                                                                     |
| Automated accessibility                                  | **39 scans**, 0 detected violations       | 13 states per engine, WCAG A/AA rules; keyboard and screenshots reviewed separately. This is not complete accessibility conformance                                                      |
| Actual local SpacetimeDB SDK/module                      | PASS                                      | CAS, cross-client subscriptions, anonymous read isolation and unauthorized reducer rejection; isolated test database                                                                     |
| Finite actual-app acceptance                             | PASS                                      | 10 sticker + 3 Instax **simulation** jobs, plus missing-output failure/refund, review/override and lost acknowledgment. [Evidence](evidence/software-acceptance.json)                    |
| Signed owner calibration API                             | PASS                                      | Actual upload/prepare/signed attempt/duplicate/status/frame/inspection/resume, all simulation. [Evidence](evidence/calibration-api.json)                                                 |
| Actual local FastMCP application transaction             | PASS                                      | Dedicated requester, approval via HTTP, mandate, MCP quote/checkout/dispatch, mock release and simulated pickup. [Evidence](../integrations/evidence/local-acceptance.json)              |
| Dependency audits and configured-secret scan             | PASS                                      | No moderate-or-higher advisories in root/web/integrations; configured secrets absent from deliverable candidates                                                                         |

**234 unique test cases**; running the 56 browser cases in three engines yields **346 test executions**. Five browser checks use the actual application, 50 intercept application APIs, and one intercepts startup health failure before recovering against the actual application. Earlier real database restart/state-hash and read-only public testnet compatibility evidence is retained; those unchanged boundaries were not rerun simply to increase the count.

`npm run check` runs the deterministic/software suites, typechecks and build. Live suites remain separate and blocked prerequisites are never counted as passed. Browser and finite acceptance reject physical devices and live payment modes.

The shared software check followed the latest backend/node validation and initial UI repairs. The final web build, strict web TypeScript and all three browser suites followed the last focus-contrast and input-preservation repairs. Finite simulation acceptance, actual database CAS/restart and dependency audits were retained from the first checkpoint. After the final web repairs, only web checks were repeated. The configured-secret scan was rerun.

## Functional evidence

The actual browser flow includes supported simulated-device registration, distinct calibration/list/readiness facts, production preview approval, quote, mock hold, authorized dispatch, fresh synthetic evidence, mock release, owner handling, a second job before the first collection, paid cancellation/refund, single-use pickup and receipts. The state workflow covers unsupported dimensions, unclear artwork review, approval invalidation, explicit budget mandate, expired quote display, offline/reconnect,390px/1440px layouts and keyboard focus/skip navigation. No browser page errors were observed.

The live dashboard test disables all polling intervals>=2000ms, independently pauses/resumes a machine and observes the open dashboard update plus named SSE refresh events. It uses actual SpacetimeDB; polling cannot hide a disconnected subscription. Stable screenshots: [desktop requester](../web/evidence/requester-ready-desktop.png), [mobile requester](../web/evidence/requester-mobile.png), [owner](../web/evidence/owner-desktop.png), [SSE](../web/evidence/sse-live-dashboard.png).

50 isolated UI-fixture browser checks cover the pending-payment reference and measured-cost forms, Claude suggestion/manual fallback, artwork editing, reordered responses, session/store failures, real document navigation, focus, live queue behavior and touch layouts. They intercept all API calls and establish **UI behavior only**. Actual payment matching and provider parsing are covered in their separate backend/integration suites; real funded/provider acceptance remains blocked.

[Process-death evidence](evidence/process-recovery.json) records: node crash after a durable possible start→review/held with exactly1 attempt; orchestrator crash while accepted simulated work continues→reconciled completion/release with exactly1 attempt; unavailable node before acceptance→authenticated absence, audited failure/refund,0 node attempts. No new physical request resolves uncertainty. This suite uses explicitly isolated SQLite development persistence; the separate real Spacetime restart and live-update tests establish the required store path.

Prepared3D tests bind file hash, overall dimensions, material, single color and duration to a reviewed catalog and owner limits. The backend catalog test uses an opaque software archive fixture solely for byte-integrity/policy checks. It is **not** a sliced printable model, actual Bambu invocation, completion or physical evidence.

## Measured targets versus functional acceptance

| PRD target                                                                                       | Actual measurement                                                                        | Status                                                  |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 10 consecutive physical stickers; median upload-to-ready<60s                                     | 0 physical jobs.10 consecutive simulated sticker jobs passed; simulation median1.5195s    | Physical acceptance and target **UNMEASURED / BLOCKED** |
| 3 actual Link3 jobs; transfer/ejection/development/verification timing, target<2min if supported | 0 physical jobs.3 simulated Instax jobs passed                                            | **UNMEASURED / BLOCKED**                                |
| 1 full prepared Bambu completion and short live start                                            | 0 actual device jobs; no inspected sliced model supplied                                  | **NOT RUN / BLOCKED**                                   |
| Supported onboarding<5min active setup, calibration separately                                   | Actual app/node **simulation** API/browser onboarding passed; physical setup not observed | **UNMEASURED / BLOCKED**                                |
| Real testnet collection, release and refund                                                      | 0 submitted transactions; standard SDK/receipt fixtures passed                            | **NOT RUN / BLOCKED**                                   |
| ASI:One discovery and authorized remote invocation                                               | Actual local MCP transaction passed; no remote discovery observed                         | **NOT RUN / BLOCKED**                                   |

The1.5195-second simulation measurement starts **after a shared artwork upload**, before `POST /jobs`, and ends after scripted owner preparation/resume. It excludes upload and all physical production/development/handling time, so it cannot establish the60-second target. Two scripted handling calls per job are recorded; they are not a measured person's labor. No physical performance target is claimed met, and no physical timing result exists from which to calculate a measured miss. Required timing acceptance remains unmet until measured.

Consumables, physical machine time, owner labor, failure rate, API cost, willingness to pay and actual owner earnings have not been measured. Price cards are unmeasured development estimates. The measured-trial form records inputs without defaulting blank values to zero, and keeps quoted allocations separate from confirmed income; failed/refunded jobs do not count quoted payout/fees as received.

## Failures found and repaired

October 23 overnight repairs:

- Readable mobile controls and stronger text contrast; 320–1440 px reflow, keyboard tabs, visible error focus/scroll and production preview retry.
- Actionable owner queue, search, filters, finite eight-order pages, and separate pickup/payment follow-up messages.
- Expired requester/owner sessions remove private state. Late uploads/orders cannot restore another requester’s artwork or selection; delayed receipts cannot appear on a different order.
- Atomic verification/review finalization; late responses preserve completed handling and newer machine work. Restart recovery completes a recorded outcome’s pending payout/refund allocation.
- Idempotent approval preserves a valid quote; cancelled orders cannot reopen; handling requires explicit boolean confirmations; failed upload batches are removed atomically and MIME follows decoded content.
- Fresh owner policy is checked after artwork retrieval. Calibration is bound to device/camera/transport/material/adapter provenance and cannot carry from simulation to hardware. Pairing changes and calibration revocations reach the dashboard.
- Pre-start stops cannot later print; old stops, canceled callers and active workers cannot release a machine into a newer attempt before stop transport settles.
- Bounded camera capture, parseable camera errors, known payment hashes preserved after checkpoint failure, and cached/contradictory/unavailable visual evidence routed to review.

Second overnight pass repairs:

- Authoritative snapshot revisions prevent old background responses from undoing owner actions or rolling requester order details backward; late authentication errors cannot end a renewed owner session.
- Session-store outages and malformed successful session responses show retry, preserve the saved requester identity and never silently replace it.
- Browser preference storage failures keep the interface usable. Mock checkout keys remain stable; wallet signing and physical calibration require verified retry checkpoints. Concurrent, ambiguous and in-page storage-evicted wallet attempts cannot sign again.
- Discarded multi-image replacements and model suggestions cannot contaminate another order or a later edit. Intended replacement images survive raster format changes, and a rebuilt file still requires approval.
- Long collection/evidence/machine text wraps; touch controls and 16px input text remain usable in short landscape viewports and 320px equivalent reflow. Reduced motion is checked.
- Actual local backend/node restart restores EventSource delivery to the already-open dashboard with polling disabled. [Reconnect proof](evidence/overnight-sse-reconnect.json).

Third overnight pass repairs:

- Approval waits for the selected order/file preview to load even when its bytes match a previously viewed preview. Reselecting or reopening the current file remains usable.
- Unsaved requester drafts and pending actions can cancel accidental page navigation; saving/canceling/new-order clears the warning. Browser/OS process termination can still lose an unsaved draft. Eleven browser cases prove real document changes for reload/history, preserve a canceled document, and recover committed create/edit/quote responses without resubmission. Document UUIDs avoid browser clock-rounding assumptions.
- A deterministic old-built regression exposed delayed heading focus stealing the textbox focus during entry. Requester and owner pagination focus now preserve a newer user focus choice. Synchronous input-value capture also hardens requester fields, owner handling checkboxes and measured trial fields; visible and submitted values are checked. [Focus/input diagnostics](evidence/overnight-focus-recovery.json).
- Owner queue pagination stays clamped after shrinking work. Incoming jobs preserve the selected pickup form and code within eight visible slots; explicit paging still reaches displaced orders. Completed handoff/payment follow-up returns keyboard focus to queue controls without stealing it from another control.
- Keyboard focus contrast increases from 1.83–2.28:1 to 4.22–5.26:1 on the primary measured light surfaces while keeping the orange accents. [Measured color evidence](evidence/overnight-focus-contrast.json).
- Inherited property names cannot masquerade as orders, artwork, sessions, supported models, machines or payment operations. Invalid reasons/keys, numeric/budget/quantity payloads and blank collection references reject without state mutation. Calibration validates owner intent before creating preview assets.
- Prepared catalog IDs are unique and color metadata round-trips through matching backend/node Unicode normalization and limits. Signed parameters remain exact; file hash/dimensions/material/duration binding is retained. All Bambu checks are offline software checks.
- Latest code was activated by bounded local backend/node restart, preserving state/journals and passing native EventSource reconnect with polling disabled. [Current reconnect proof](evidence/overnight-third-sse-reconnect.json).

Earlier implementation repairs:

- Browser integration exposed conflicting numeric versus string UTC hours. App/node now share integer end-exclusive hours; owner policy, failed calibration and explicit recovery are tested.
- Audits repaired replay of an old failure clearing a newer execution, node selection/fact handling at registration, redirected token-bearing calls, stale/mismatched frame association, operator resolution of authenticated absence, safe pre-submission payment retries and standard x402 header interoperability.
- Payment restart audit found allocation-without-submission could remain pending. Recovery now distinguishes active/queued calls, durable submission checkpoints and definite pre-submission process death. Collection retries get distinct records; an older failed callback cannot reset a newer funded attempt. Tests prove safe same-allocation release recovery and no replacement for submitted unknown transactions.
- Prepared3D approval originally omitted depth/color/duration. Those are now fixed catalog fields, displayed for requester approval and signed/enforced by the node.
- The finite acceptance harness initially assumed production and payment settled simultaneously, then attempted owner resolution before a lost-acknowledgment worker reached a terminal state. It now waits for each independent payment outcome and reconciles the existing journal before inspection. Assertions still require confirmed release/refund; no production outcome was fabricated. The final13-job/3-case run passes.
- The final **built** browser run exposed missing `/owner` deep-link handling and a collision between public bundle assets and private artwork routes; the hidden `.codex` checkout path also required a root-relative index response. These are repaired with HTTP regressions and the passing built-origin5-test suite. Earlier development-preview browser evidence is retained separately.

## Required blocked or unrun work

| Missing prerequisite                              | What to supply and next acceptance                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phomemo team device/path/media/camera/supervision | Configure exact paired RFCOMM address/channel on tested Linux/Pi, fixed baseline/result camera and loaded roll; inspect calibration, then10 finite jobs                                                            |
| Exact Instax Mini Link3 compatibility             | Configure exact paired peripheral/UUIDs, firmware/orientation/film/camera; prove candidate protocol on the unit before setting compatibility flag, then3 developed outputs                                         |
| A1 mini LAN/firmware/prepared file/camera         | Supply exact address/serial/private access code, observed firmware LAN/developer settings, clear supervised bed, single-color PLA3MF+matching preview/hash/catalog; full completion required                       |
| Funded Base Sepolia development accounts          | Put treasury/payer signer/RPC/origin in ignored env, owner address in owner settings; externally fund test USDC/gas. Run collection→held→release and cancellation/failure→confirmed refund, preserving real hashes |
| Agentverse/ASI:One configuration                  | Dedicated requester cookie, persistent agent seed/mailbox, ASI key and allowed signed sender; demonstrate actual discovery and authorized invocation                                                               |
| Claude account and actual result evidence         | Configure key/model privately, provide genuine fresh camera evidence/credible completion and run live intake/vision pass/fail/review                                                                               |
| Rules and customer evidence                       | Supply official rules/source and consenting club/owner interviews. Sponsor opportunities remain opportunities; no eligibility or customer findings inferred                                                        |

The account/device live suites currently report **BLOCKED** (exit2), not success. No device scan of unrelated hardware, physical run, fund purchase, credit/media purchase, public deployment, permission change or external customer/organizer message occurred.

## Environment and versions

Observed host: macOS/Darwin25.6.0 arm64, Node25.8.1/npm11.11.0, Python3.12.11 for both locked Python environments. Root Express5.3.0/Zod4.6.7; SpacetimeDB CLI/module/SDK2.13.0; x402 core/EVM2.28.0 and viem2.57.10; React19.1.1/Vite7.3.7; node FastMCP4.1.3/FastAPI0.161.1/Pillow13.0.0; Fetch FastMCP2.14.5/uAgents0.26.1/adapter0.6.2. Device candidate pins and upstream commit hashes are in node-integration.md. Driver import/API inspection is not compatibility proof. All dependency locks are included.

See [resumption steps](demo-runbook.md), [requirement/sponsor matrix](progress.md) and [the accepted PRD](working-prd.md). Optional photo-to-3D, unfamiliar adapters, mailing and sponsor add-ons remain planned, behind the stability gate.
