# Fabrary local demo and resumption runbook

## Current checkpoint

The application runs on loopback http://127.0.0.1:4318, Python node on127.0.0.1:8788 and actual SpacetimeDB2.13.0 on127.0.0.1:3002. Production frontend is served by the backend. Optional Vite development preview uses4317. The default running checkpoint is **simulation / mock / actual SpacetimeDB**. This is a functional software demonstration, not a physical acceptance claim.

All changes are inside the dedicated writable `fabrary/` directory. Original project references and pasted contract remain unchanged. Credentials, uploaded assets, journals and installed local runtime live under ignored private `.data/` or `.env`.

## Setup and start

Use Node25.8.1 (`.node-version`), npm11.11.0 and uv. Both Python environments use3.12.11; their compatible dependency graphs are separately locked because the current node FastMCP4 and Fetch adapter FastMCP2 have different requirements.

```sh
npm ci
npm --prefix integrations ci
npm --prefix integrations/spacetimedb ci
npm --prefix web ci
uv sync --project node --extra hardware
uv sync --project integrations/fetch
npm run setup
npm run build
```

`setup` creates `.data/local-credentials.json` with owner login, node Bearer and HMAC keys, file mode0600. It prints the path, never the values. Keep `.data` private. Optional overrides and their purposes are listed without values in `.env.example`. A fresh setup defaults to labeled SQLite development mode unless `.env` explicitly selects SpacetimeDB; that mode cannot satisfy Spacetime acceptance.

For this preserved session, the installed runtime and its data/config were moved out of `/tmp` into `.data/spacetime-runtime/`, then restarted with identical authoritative state (51 jobs,3 machines at the checkpoint). Start it with:

```sh
npm run spacetime
```

For a new machine, install **SpacetimeDB2.13.0** following [official installation](https://spacetimedb.com/install). Select version2.13.0, then start a standalone loopback server and publish this module **only** to that local server:

```sh
spacetime start --listen-addr 127.0.0.1:3002 --data-dir .data/spacetime-runtime/data --non-interactive
# Another terminal, after the local server is listening:
spacetime publish fabrary-app --server http://127.0.0.1:3002 --module-path integrations/spacetimedb --yes
```

Store the local publishing identity's token in ignored `.env` as `FABRARY_SPACETIME_TOKEN`; set `FABRARY_STORE=spacetimedb`, `FABRARY_SPACETIME_URI=ws://127.0.0.1:3002`, `FABRARY_SPACETIME_DATABASE=fabrary-app`, `FABRARY_MODE=simulation`, `FABRARY_PAYMENT_MODE=mock`. Those are operating choices, not credentials. Backend tokens never go to browsers. See [integration notes](integrations.md) for identity ownership and generated bindings.

Then:

```sh
npm run demo
```

This starts the node and backend with matching local credentials. Run one backend/signer process: the signing queue and in-flight submission ownership belong to it. Horizontal replicas would require distributed leases and are not supported by this local build. It stops the companion process if either fails. Open4318. Restart the backend after a database connection loss; operations fail closed and there is no automatic SQLite fallback. The node journal and authoritative state survive restart. Do not delete either to fix an uncertain physical attempt.

## Requester and owner rehearsal

1. Open `/owner` and enter `ownerCode` from the private local file. Use a separate browser profile/context for requester access; switching roles creates a new requester account.
2. Register a supported simulation machine. Paired/configured/calibrated/listed/ready are separate facts. Run the visibly labeled simulated calibration; configure media estimate, price card, UTC hours, quantity/policy and collection point. List, inspect/clear and resume.
3. Requester uploads1–4 PNG/JPEG/WebP images. The prepared preview contains all selected images; thermal output is the exact lossless monochrome raster used at the node. Enter dimensions/material/quantity and authorization. Unclear permission goes to owner review. Claude suggestions are available only with configured key; manual deterministic specification works independently.
4. Approve the current production preview. Quote a briefly reserved machine. Prices are **unmeasured development estimates**. An enabled budget mandate may auto-accept only an approved specification within its integer-cent cap. Artwork/specification/price changes invalidate approval.
5. Mock checkout is clearly labeled. Dispatch persists one attempt before contacting the node. Status, evidence, hold/release/refund and pickup are independent facts. In testnet mode the requester explicitly uses a configured Base Sepolia browser wallet. Missing wallet, wrong network or declined signature never becomes a paid order.
6. Passing visible-output evidence permits release. An unusable frame is review; missing output fails/refunds. Owner inspection overrides are recorded with reasons. Neither verification nor a test payout means collection.
7. Owner removes, labels, stores and clears before marking ready for pickup. Resume availability separately; another job can run while the older item awaits collection. Redeem the expiring pickup code once at actual handoff.

## Hardware prerequisites and finite physical acceptance

No hardware configuration was supplied or discovered; no physical job has been executed. Do not use software acceptance scripts as physical evidence.

Copy `node/machines.example.json` to an ignored private config and set `FABRARY_MACHINES_FILE`. Configure only the three team-owned devices, and set owner readiness only after loaded media, clear output area and supervision are confirmed. Use `FABRARY_MODE=hardware`, and optional per-device node URLs for a tested Pi/Linux node. Installing candidate adapters is not a calibration pass. Detailed current adapter/version/firmware/camera requirements are in [node-integration.md](node-integration.md).

- **Phomemo M02Pro:** tested Linux/Pi RFCOMM path, paired exact address/channel, intended roll width and fixed camera. The current macOS host cannot use that adapter's classic Bluetooth path. Transport acknowledgment does not prove a completed sticker; operator inspection remains visible where completion is unobservable.
- **Instax Mini Link3:** exact paired handle, known BLE service/write/notify UUIDs, tested orientation/firmware and film/camera. The vendored protocol candidate is pinned; compatibility is not proven. Do not set `compatibilityValidated` until actual testing supports it. Allow at least configured90-second development before result comparison. Three physical jobs remain required.
- **Bambu A1 mini:** exact LAN address/serial/access code, observed firmware LAN/developer settings, supervised clear bed, one compatible short single-color PLA3MF and usable camera. `FABRARY_CATALOG_FILE` loads a reviewed model and matching PNG preview with exact file hash, dimensions and estimate. Mirror its reviewed hash/material/dimensions/model into node catalog. Arbitrary uploads and photo-to-3D do not become executable models.

Owner hardware calibration UI uploads an image (or uses a reviewed3D model), explicitly authorizes one finite calibration attempt, and polls its journal. It does not silently repeat an attempt after uncertainty. Inspect fresh associated camera evidence. For transport-only devices, record explicit terminal resolution and an inspection reason; calibration source is `owner-inspection`, without inventing a device completion flag. Confirm calibration, then list/resume explicitly.

Run the PRD physical suite after calibration: **10 consecutive stickers,3 consecutive actual Link3 photos,1 full short prepared Bambu job**. For each order, record actual upload-to-ready time, transfer/ejection/development/verification intervals where applicable, every owner intervention, consumables, failures and receipts. Owner handling must be performed and confirmed in the UI between jobs. Never auto-affirm physical removal from a script. Record pass, missing-output failure, ambiguous review and recovery cases on the actual devices. The sticker median<60 seconds, Instax<2 minutes where supported by measurements, and active onboarding<5 minutes remain **unmeasured**, not met.

## Recovery and operator accounting

- Unpaid dispatch is rejected before the node. Repeated checkout uses the same key; repeated dispatch reuses its recorded attempt. Node restart around a possible start becomes uncertain. No timeout/abort request is described as confirmed physical stoppage.
- On disconnect, restore the exact configured node, inspect its journal and use **Reconcile**. An unknown acknowledgment can still have a running worker; wait for a terminal/uncertain status before owner resolution. Do not send a new print to learn whether the first printed.
- Owner pass/fail review requires a specific reason and fresh evidence for a positive override. An authenticated node can confirm that no attempt was recorded; that is distinct from an unreachable node. Failed output stays paused; **Clear failed job** records inspection/clearance before explicit resume. Replaying an old recovery cannot clear a newer execution.
- Paid cancellation before dispatch allocates refund and remains pending until its transaction is confirmed. Release and refund share a mutually exclusive allocation. Production completion is not payment confirmation.
- A definite pre-submission payment/configuration failure may retry the same allocation after repair. A persisted nonce/transaction outcome stays pending and is reconciled; never replace it blindly. For an unknown collection transaction, the owner may submit a candidate reference with reason at `/api/owner/jobs/:id/payment-reference`. The backend accepts it only after confirming the exact expected network/token/payer/payee/amount. Unknown or mismatched references leave the pending operation unchanged.
- Trial economics are owner-entered at `/api/owner/jobs/:id/economics`: integer consumables/API/machine costs plus machine/handling seconds and failed attempts. Derived platform margin and owner earnings per handling minute are estimates from those observed inputs, not invented price validation.

## Live integration resumption

Put all secrets in ignored `.env` or the environment; do not paste them into chat or reports. Restart after changing configuration.

1. **x402:** funded Base Sepolia payer/treasury, matching test treasury signer, RPC, public app origin and owner recipient address (owner settings). Use the preconfigured browser wallet; only chain84532/test USDC is supported. Run finite collection, release and refund, retain transaction references and confirmations. `npm --prefix integrations run test:live` exits2 BLOCKED until its explicit opt-in and funded test credentials exist. No credits or funds are purchased by this project.
2. **Fetch.ai:** dedicated requester session cookie, persistent Agentverse seed/mailbox, ASI key and signed sender allowlist. The bridge cannot approve previews or bypass checkout. Agent checkout requires an explicit budget mandate and accepted quote. The local FastMCP flow is proven, but actual ASI:One discovery and authorized invocation must still be observed. See integration commands; use the configured development account and existing access; no account permissions are changed.
3. **Claude:** configure `ANTHROPIC_API_KEY` and supported model. Run actual image-intake and fresh-camera verification cases; preserve provider reason and pass/fail/review. Missing key leaves manual specification usable and hardware verification in review. The live suite needs real approved/result image paths, actual capture time and credible completion assertion.
4. **Rules/community:** obtain official event/track rules and consenting named club/owner interview evidence. No rules eligibility, interview, deadline verification or customer finding has been fabricated. No optional add-on is selected before the required stability gate.

## Software checks and evidence

`npm run check` runs deterministic/application/process-recovery, node, payments/Claude, Fetch and wallet tests plus type checks/build. Browser tests require the running simulator/mock app and use actual backend persistence/node code. `FABRARY_BROWSER_URL=http://127.0.0.1:4318 npm run test:browser` runs the full UI and SSE-only cases. `npm run test:acceptance` refuses hardware/testnet/SQLite and runs finite10-sticker/3-Instax **software** loops plus failure fixtures. `npm run diagnose` reveals configuration presence and blockers without values. See [test-report.md](test-report.md) and stable [UI evidence](../web/evidence/README.md).
