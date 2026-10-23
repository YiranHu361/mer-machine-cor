# Fabrary implementation checkpoint

Working directory: `fabrary/` beside read-only project references. Contract is [working-prd.md](working-prd.md). Status vocabulary: implemented/tested in simulation, live verified, partial, blocked, planned. Required physical work remains required even while blocked.

## Decisions

- Local TypeScript/Express application, React/TypeScript requester and owner screens, Python FastMCP/FastAPI node with Pillow and durable SQLite attempt journal. No public deployment.
- SpacetimeDB 2.13 local authoritative state, CAS reducer with owner-only view and subscriptions. SQLite is explicitly isolated development mode, never evidence of Spacetime integration.
- USDC amounts integer cents converted by 10,000 to six-decimal base units. x402 Base Sepolia collection; platform-managed test hold and separate owner transfer/refund. Production payments disabled.
- Three fixed team devices; simulation is a labeled external device boundary. No physical device connection supplied. Unknown models planned.
- One atomic application state update resolves reservation and dispatch/cancel races. Accepted attempt persists before side effects; uncertainty never triggers a silent retry.
- Initial prices are unmeasured development estimates. No economic or physical timing claims yet.

## Requirements matrix

Software verification is against real application code and persistence. Simulated devices, mocked/fixture services, and physical/live results are distinguished below. No P0/P1 hardware or required live integration is relabeled optional.

| ID  | Priority / requirement                                  | Implementation                                            | Verification / status                                                                                                                                                    |
| --- | ------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R01 | P0 intake1–4 images + structured intent                 | server/app.ts/model.ts, node prepare, web                 | PASSED HTTP + browser; deterministic errors bundled. Claude live blocked (R22)                                                                                           |
| R02 | P0 production preview + approval integrity/invalidation | service.ts, Pillow, web                                   | PASSED actual preparation/HTTP/browser, hash and changed-spec/price tests; all images composed                                                                           |
| R03 | P0 reservation, quote, expiry, mandate                  | service.ts, web wallet                                    | PASSED concurrency/amount/expiry/cap tests and browser. Initial price card unmeasured                                                                                    |
| R04 | P0 complete labeled mock transaction                    | backend/web/Python simulator                              | PASSED actual browser +10 consecutive sticker simulation jobs through Spacetime                                                                                          |
| R05 | P0 registry + owner policies/readiness                  | app.ts, node policy, owner UI                             | PASSED supported simulation registration/calibration/list/pause/resume, policy tests; hardware facts unproven                                                            |
| R06 | P0 one reservation/execution slot                       | service/store + Spacetime CAS + node journal              | PASSED two requester race, CAS conflicts, cancellation race and unique active journal tests                                                                              |
| R07 | P0 signed dispatch + scoped assets/camera               | node-client.ts/app.ts/node security                       | PASSED unpaid/wrong-machine/expiry/tamper/hash/policy/auth tests; actual private frame proxy exercised                                                                   |
| R08 | P0 durable idempotency/reconnect/restart                | service.ts, SQLite node journal                           | PASSED actual backend/node process deaths, identical attempt counts, no silent reprint; real physical uncertainty unrun                                                  |
| R09 | P0 cancellation/refund/dispatch race                    | service.ts/payment adapter                                | PASSED software races, pre-submission restart recovery, late collection, repeated checkout/callbacks; browser paid cancellation; actual refund R18 blocked               |
| R10 | P0 fresh evidence pass/fail/review/override             | service.ts, node camera, Claude provider                  | PASSED simulated pass/missing/review/lost-ack, stale/mismatched frames and audited operator intervention; actual camera/Claude blocked                                   |
| R11 | P0 owner preparation, independent availability          | service prepare/clear, owner UI                           | PASSED browser next order before first collection, finite loops, historic failure-recovery replay guard                                                                  |
| R12 | P0 expiring single-use pickup/handoff                   | service redeem, UI                                        | PASSED browser/HTTP/atomic reuse/expiry tests; handoff is explicit                                                                                                       |
| R13 | P0 supported-device onboarding/calibration              | node + owner calibration endpoints/UI                     | PASSED actual signed calibration API with simulator; distinct facts and negative cases. Physical active-setup target BLOCKED                                             |
| R14 | P0 real Phomemo10-job suite                             | guarded Linux/Pi RFCOMM candidate                         | BLOCKED exact paired team device, tested Linux/Pi path, roll, fixed camera, supervision; zero physical jobs                                                              |
| R15 | P1 real Link3 three-job suite                           | pinned InstaxBLE/simplepyble candidate                    | BLOCKED exact BLE/firmware/orientation compatibility, film, camera and owner proof.3 simulation jobs passed; not physical evidence                                       |
| R16 | P1 full prepared Bambu job                              | Bambu candidate, reviewed catalog, full3D signed metadata | Software catalog/hash/depth/color/duration guards passed. BLOCKED LAN/access code/firmware/sliced file/media/camera/supervision; no actual prepared print                |
| R17 | P1 confirmed x402 Base Sepolia collection               | integration adapter, standard v2 headers, browser signer  | Official signer/crypto/header/chain-receipt fixtures passed. Live BLOCKED funded payer/treasury/RPC setup; zero transactions                                             |
| R18 | P1 held balance/release/refund/receipts                 | service/external.ts + payment adapter + owner recovery    | PASSED allocation/retry/restart/replay/exclusivity tests and mock browser receipts; matching-reference recovery tested by fixture. Live BLOCKED same wallets + recipient |
| R19 | P1 Fetch.ai discovery/authorized invocation             | actual FastMCP/uAgents bridge, sender allowlist/mandate   | Actual local MCP→backend→simulator transaction PASSED; ASI:One/Agentverse discovery+remote invocation BLOCKED credentials/sender/account                                 |
| R20 | P1 owner dashboard/media/handling/payouts               | owner UI/backend; manual economics                        | PASSED actual browser dashboard/handling; payment-reference/economics UI separately fixture-tested; actual earnings/costs unmeasured                                     |
| R21 | Core authoritative Spacetime/live updates               | private module, CAS store, SSE                            | PASSED actual2.13 server CAS/access controls/subscriptions; browser updates with polling disabled; real server restart preserves identical state hash                    |
| R22 | Core Claude image intake/verification                   | integrations/claude.ts, backend, requester draft action   | Parser/vision guards tested; live BLOCKED ANTHROPIC_API_KEY and real camera evidence. No live model call made                                                            |
| R23 | Core usable browser/narrow/keyboard/states              | web                                                       | PASSED actual full workflows,390px/1440px, keyboard skip/focus, expiry/offline/reconnect, permission review/approval invalidation; screenshots retained                  |
| R24 | Core physical recovery/unpaid/duplicate/disconnect      | node/service/application suites                           | Software including actual process-death tests PASSED. Physical required cases BLOCKED R14–R16 prerequisites                                                              |
| R25 | Core measured timing/economics/interventions            | trial endpoint + evidence/report                          | Simulation sticker median1.509s recorded separately. Physical60s/2min/5min targets UNMEASURED. Owner financial/customer claims unvalidated                               |
| R26 | Core consenting named community/customer evidence       | no fabricated findings                                    | BLOCKED2–3 club officer and prospective owner interviews/consent; no external contact authorized                                                                         |
| R27 | Core pinned reproducible setup/runbook                  | dependency locks, examples, README/runbook                | PASSED builds/type checks and documented local start; fresh install needs configured local Spacetime publishing identity                                                 |
| R28 | P2 unfamiliar-model onboarding                          | no shipped implementation                                 | PLANNED; no general driver-generation claim                                                                                                                              |
| R29 | P2 photo-to-3D                                          | no shipped implementation                                 | PLANNED; prepared catalog only                                                                                                                                           |

Evidence index: [test-report.md](test-report.md), [software acceptance](evidence/software-acceptance.json), [process recovery](evidence/process-recovery.json), [Spacetime restart](evidence/spacetime-restart.json), [calibration API](evidence/calibration-api.json), [browser evidence](../web/evidence/README.md), [integration evidence](../integrations/evidence/local-acceptance.json).

## Sponsor opportunity matrix (eligibility unverified)

Original prize statements are preserved in working-prd.md as reference claims, not verified current rules.

| Opportunity                                                                      | Required contribution                                          | Status                                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Cal Hacks / Hardware / Creative / Hacker's Choice                                | Three physical outputs, actual runs                            | Core; physical blocked, rules unverified                                   |
| Fetch.ai                                                                         | ASI:One discovery and authorized invocation                    | Required integration blocked                                               |
| Coinbase x402 two tracks                                                         | Confirmed testnet collection + receipts                        | Required integration blocked                                               |
| Visa                                                                             | Preview, explicit mandate, full quote/receipt; API rules check | UX software-tested; eligibility unverified                                 |
| Microsoft Real World / Customer Impact                                           | Owner dashboard + real customer/owner evidence                 | Dashboard browser-tested, customer evidence blocked                        |
| Spacetime                                                                        | Registry, transitions, live update reaching UI                 | Local service, app CAS, SSE-only browser update and restart verified       |
| Apify                                                                            | Source-backed unfamiliar driver search                         | P2 planned                                                                 |
| Factory                                                                          | Generated adapter + tests + supervised physical result         | P2 planned                                                                 |
| Cartesia                                                                         | Spoken request and quote                                       | P2 planned                                                                 |
| Atlassian                                                                        | Failure issue opened and closed after recovery                 | P2 planned                                                                 |
| Capital One Nessie                                                               | Mock owner payout linked to job                                | P2 planned; mock ledger alone is not Nessie integration                    |
| Anthropic                                                                        | Claude intake/verification + consenting named community        | Claude provider wired/software-tested; live and community evidence blocked |
| Creao AI                                                                         | Contribution qualifying under actual rules                     | Rules-dependent opportunity; unverified                                    |
| Figma                                                                            | Requester/owner designs + usable handoff                       | P2 opportunity, no Figma claim                                             |
| Mana                                                                             | Qualifying platform use                                        | Rules-dependent opportunity; unverified                                    |
| Wajo (no prize)                                                                  | Courier booking with owner packing/handoff                     | P2 planned                                                                 |
| Convex / Bright Data                                                             | Skipped per PRD; existing store/search role overlaps           | Explicitly skipped                                                         |
| Hyphenate / CRS Credit / Notability / Moss / Bitdeer / SpaceXAI / Meta / Armadin | Outside loop                                                   | Explicitly skipped per PRD                                                 |

No optional add-ons selected: required hardware/live loop stability gate not met.

## External prerequisites and resumption

No relevant environment credentials were present and no team-device configuration was supplied. Local macOS Darwin 25.6 arm64, Node 25.8.1, system Python 3.10.16; uv obtains locked compatible Python. Only generic Bluetooth serial entry exists; no scan of unrelated LAN or Bluetooth devices was performed.

1. Configure team-owned Phomemo serial/RFCOMM or tested Linux/Pi node, printable media width and baseline/result camera. Explicit owner readiness unlocks finite calibration then 10 jobs.
2. Configure exact Instax Link 3 BLE connection and validated adapter/firmware/orientation path; supply film and camera. This remains an integration blocker until exact model works.
3. Configure Bambu LAN endpoint/access code/serial, compatible firmware settings, prepared short 3MF and camera; owner clears bed and supervises.
4. Put Base Sepolia RPC, platform test treasury address/signing key, requester and owner test addresses in ignored local env. Fund test USDC and gas externally. No production rails or purchases.
5. Put Agentverse seed/mailbox, ASI key and permitted sender identity in ignored env. Test real discovery and invocation using the authorized app flow.
6. Put Claude key in ignored env; live intake/vision then run test evidence cases.
7. Supply event rules URL/email and consenting club/owner evidence. Deadline not relied on for execution; PRD date remains unverified reference.

Continue independent implementation and software tests while these remain unavailable. Exact commands and retained service paths are in demo-runbook.md. Current task is partial completion: all remaining required physical/live/customer/rules acceptance needs the specific external prerequisites above. No optional add-ons were started.

## Current resumption order

1. Read this matrix and test-report.md; preserve the existing source, private app assets, Spacetime data and node journal.
2. Start `npm run spacetime` and `npm run demo` if not already listening. Current local runtime/data are retained under `.data/spacetime-runtime`, not `/tmp`.
3. Supply device/camera configuration and explicit owner readiness first; prove exact Link3 compatibility early. Use guarded calibration, then the finite physical suites and recorded owner handling.
4. Supply funded Base Sepolia development wallets and RPC; complete actual collection/release/refund and pending reconciliation. Supply Agentverse/ASI credentials and observe real discovery/invocation.
5. Supply Claude key and real evidence; execute live intake/verification cases. Record physical timings, costs and interviews/rules evidence without converting opportunities into eligibility claims.
6. Update only affected checks after changes. Optional P2 tracks remain behind the stability gate, at most two concurrent add-ons if later selected.
