# Browser verification evidence

Current overnight checkpoint: 2026-10-23, 03:58 Pacific. **130 scenarios passed in each of Chromium, Firefox and WebKit**, with 39 automated A/AA scans and no detected violations. 28 API/storage/wallet unit cases passed (7+6+15). Current per-engine reports are `overnight-fifth-{chromium,firefox,webkit}-browser.json`; source fingerprint and scope are recorded in [the current checkpoint](../../docs/evidence/overnight-fifth-qa.json). [Overnight log](../../docs/overnight-qa.md) tracks remaining work through 9:00 a.m. Pacific.

New isolated evidence covers session-scoped preparation/pickup/review/inspection drafts, truthful interrupted-create recovery, bounded JSON and wallet transport, image deadlines, exact-frame freshness and calibration status/readiness recovery. [Owner drafts at 320px](overnight-owner-action-drafts-320.png) and [result-image recovery](overnight-evidence-recovery-320.png) show intercepted simulation fixtures. Draft memory lasts through the authenticated owner view and is not persistent browser storage.

The current actual local service-restart screenshot is [the reconnected dashboard](overnight-fifth-sse-reconnected.png). Reconnect disabled polling and used SpacetimeDB, simulation and mock payments. Earlier screenshots retain mobile pickup during incoming work, focus contrast and emulated touch/reflow. Native iOS, complete accessibility conformance, hardware output, funded payments and live model calls remain unverified.

The following entries are historical implementation baselines.

Historical baseline: 2026-10-22 11:02 PM America/Los_Angeles (`2026-10-23T06:02:14.386Z`). Working tree after the browser wallet, calibration, recovery and accessibility changes. Chromium 156.0.8078.4 / Playwright 1.64.1, macOS arm64. Backend reported `simulation`, `mock`, and authoritative `spacetimedb`.

- Production build and strict TypeScript passed.
- Eight wallet boundary unit tests passed; actual EIP712 signatures were verified offline. No live wallet or on-chain result is claimed.
- Both browser workflows passed, zero skipped/unexpected/flaky, total 7.646 seconds. This suite duration is not a physical fabrication or onboarding performance measurement.
- Dependency audit reported zero vulnerabilities.
- Desktop 1440 px and narrow 390 px screenshots were visually reviewed; both requester and owner had no horizontal overflow. Keyboard focus and the skip link were verified.

[`browser-report.json`](browser-report.json) contains the final structured result. `requester-desktop.png` shows intake; `requester-ready-desktop.png` shows the production artifact, simulated evidence and pickup readiness; `requester-mobile.png` shows collection and receipt; `owner-desktop.png` and `owner-mobile.png` show the actual handling dashboard; `expired-mobile.png` shows quote-expiry presentation using only an advanced browser date.

Earlier browser runs exposed a node/server hours mismatch, which was corrected to numeric UTC hours; accessible field labeling was also corrected so option text and help text do not pollute field labels. The final run follows those repairs. A keyboard test initially targeted an inactive browser tab and was corrected to bring the tab forward before verifying actual focus.

Required physical three-device acceptance, real testnet collection/release/refund and a real browser wallet connection remain unverified. The hardware calibration UI is implemented but was not driven against absent hardware. Consult the root test report for live service and physical prerequisites.

Additional live-subscription run: `2026-10-23T06:04:53.770Z`, one test passed in 0.799 seconds, zero skipped/unexpected/flaky. The open owner dashboard blocked every interval at or above 2 seconds, including the registered 3-second dashboard and 15-second health polls. An independent owner API session paused and resumed the idle sticker machine; the open page changed its machine reason and controls while named EventSource refresh events increased. No manual refresh or navigation occurred between mutations and assertions. The machine was restored ready. The backend reported authoritative SpacetimeDB throughout. See [`sse-browser-report.json`](sse-browser-report.json) and [`sse-live-dashboard.png`](sse-live-dashboard.png). This bounded check preserves the earlier two-workflow report and screenshots.

Additional owner-records/intake interface run: `2026-10-23T06:17:00.548Z`, two fixture-only browser tests passed in 1.315 seconds, zero skipped/unexpected/flaky. Every API request was intercepted: no migration-time application records, transactions or external services were changed. The tests cover an invalid transaction reference retaining pending state, a successful fixture response, exact measurement submission without blank-as-zero defaults, nullable draft values retaining manual fields, bundled questions, permission review preservation and a 503 suggestion fallback. See [`owner-records-ui-report.json`](owner-records-ui-report.json). The production build and strict TypeScript check passed after the fixed 3D metadata and intake wiring updates. Actual prepared-model/hardware, live Claude and payment-reference chain acceptance remain blocked by their external prerequisites.
