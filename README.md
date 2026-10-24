# Fabrary

A local requester and owner application that starts with pictures. Upload images and Fabrary recommends a supported output and a suitable machine from the registered database. The working build uses real SpacetimeDB with an explicitly labeled Python device simulator and mock payments. Required physical, funded testnet and ASI:One acceptance is **not complete**.

Open the running application at **http://127.0.0.1:4318**. Requester sessions are private; owner access comes from ignored `.data/local-credentials.json` (`ownerCode`). Do not copy that file into reports.

## Run

From this directory, with Node 25.8.1 and uv available:

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

Start the configured local database in one terminal, and the application/node in another:

```sh
npm run spacetime
```

```sh
npm run demo
```

This session has the installed SpacetimeDB 2.13.0 runtime and persistent data under ignored `.data/spacetime-runtime/`, and a private `.env` connected to `fabrary-app`. A fresh checkout needs local database publication and a publishing-identity token; see [the runbook](docs/demo-runbook.md). SQLite is available only as an explicitly selected isolated development mode.

## Use

The requester starts with one upload target for 1–4 pictures. There is no empty preview or empty order list, and no output, machine or model picker. Fabrary recommends a supported result and a saved machine. After uploading, **Add a note** and **Optional print settings** offer secondary refinements; the selected machine stays bound to the order. With no vision key, limited local image statistics are labeled clearly and uncertain pictures need clarification. Confirm artwork permission explicitly, then select **Preview your item** to inspect the actual production file. **Approve preview & see price** approves that file and obtains its quote together. Payment confirmation and **Start production** remain separate deliberate actions; analysis and preview approval never pay or dispatch. A newly unavailable device requires a fresh recommendation.

For providers, open Owner workshop with the private local code. **Orders** starts with the work inbox: only orders needing action are shown, with search and other views available. **Machines** shows the next setup step, **Machine checks** holds inspection/calibration controls, and **Settings** holds media, pricing, hours and policy. **Add a machine** first identifies the machine from its typed name or, with a Claude key, a photo of its label (Claude only reads the label; fixed rules decide whether it is supported), then gives a one-command setup: run it on the computer next to the machine, and the connector dials out to the workshop, runs a fixed checklist (each hardware step only after you allow it in the workshop), writes the machine config and registers the machine. Manual registration of a node configured in the app’s private local setup remains available; the browser never asks for a node URL. Register a **simulation** device for the software demo, confirm its simulated calibration, list it, inspect/clear and resume. Production, payment, collection and recovery details remain available through native disclosures. **Payments** contains the mock/testnet ledger. After actual handling, one explicit checkbox confirms removal, labeling, safe storage and machine clearance; **Record steps separately** retains the four individual confirmations. Mark ready for pickup, resume independently of collection, and redeem the code once at handoff. Prepared 3D remains a reviewed backend catalog and owner-calibration capability; pictures do not become printable 3D files.

The interface is deliberately minimal: a heading, the pictures and one next action per screen, with plain-language status. Simulation and mock labels appear on the recommendation, price and provider records rather than in a global bar. Saved state names, fingerprints and connection facts remain in folded details. See [the interface redesign notes](docs/ui-redesign.md).

The requester action uses `POST /api/jobs/:id/approve-and-quote` with the displayed `artifactSha256`, `specVersion`, `recommendedMachineId` (or `null` for a legacy unbound order), and optional `autoAccept`. Approval, current machine checks, reservation and quote commit atomically; a failed quote does not leave a newly approved intermediate state. This endpoint does not collect payment or dispatch work. Budget-based quote acceptance still requires the requester’s explicit mandate, and checkout and production consent remain separate.

Testnet mode uses the browser's development wallet through EIP1193 and the official x402 client; there are no browser private keys or production payment rails. It requires a funded Base Sepolia payer/treasury, signer, RPC and owner payout address. A signature alone never counts as collected payment.

## Check

```sh
npm run check
npm run test:acceptance
FABRARY_BROWSER_URL=http://127.0.0.1:4318 npm run test:browser
npm run diagnose
```

`check` runs application logic/HTTP/process recovery, node, integration, Fetch-bridge and wallet suites plus type checks/build. `test:acceptance` requires the running app with actual SpacetimeDB, simulator devices and mock money; it refuses physical hardware or testnet funds. Browser tests also refuse physical/testnet modes. Live suites report **BLOCKED**, exit 2, when prerequisites are unavailable.

See [test evidence](docs/test-report.md), [requirements and blockers](docs/progress.md), [device setup](docs/node-integration.md), [Raspberry Pi bridge for the M02 Pro](docs/raspberry-pi-m02pro.md), [integration setup](docs/integrations.md) and [the accepted contract](docs/working-prd.md). Unknown-machine onboarding and photo-to-3D are planned. No public service was published.
