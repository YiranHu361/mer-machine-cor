# Fabrary

A local requester and owner application for stickers, instant photos and a prepared 3D model. The working build uses real SpacetimeDB with an explicitly labeled Python device simulator and mock payments. Required physical, funded testnet and ASI:One acceptance is **not complete**.

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

Open Owner workshop, enter the local owner code, and register a supported **simulation** device. Confirm simulated calibration, list it, inspect/clear and resume. In a separate requester browser session, upload artwork, enter the supported specification, approve the actual production preview, quote, mock-pay and dispatch. Review result evidence. The owner removes/labels/stores/clears, marks ready and resumes independently of collection. Redeem the pickup code once at handoff.

Testnet mode uses the browser's development wallet through EIP1193 and the official x402 client; there are no browser private keys or production payment rails. It requires a funded Base Sepolia payer/treasury, signer, RPC and owner payout address. A signature alone never counts as collected payment.

## Check

```sh
npm run check
npm run test:acceptance
FABRARY_BROWSER_URL=http://127.0.0.1:4318 npm run test:browser
npm run diagnose
```

`check` runs application logic/HTTP/process recovery, node, integration, Fetch-bridge and wallet suites plus type checks/build. `test:acceptance` requires the running app with actual SpacetimeDB, simulator devices and mock money; it refuses physical hardware or testnet funds. Browser tests also refuse physical/testnet modes. Live suites report **BLOCKED**, exit 2, when prerequisites are unavailable.

See [test evidence](docs/test-report.md), [requirements and blockers](docs/progress.md), [device setup](docs/node-integration.md), [integration setup](docs/integrations.md) and [the accepted contract](docs/working-prd.md). Unknown-machine onboarding and photo-to-3D are planned. No public service was published.
