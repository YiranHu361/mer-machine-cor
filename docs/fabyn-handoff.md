# Fabyn UI/UX branch: handoff

Branch `UI/UX` (Henry's UI/web branch) holds the latest `origin/main` plus the new **fabyn** web app at `/fabyn`. The existing screens (`/make`, `/owner`, `/live`, `/relief`) are unchanged. This page covers what the branch adds, how to run it, and what is left.

## What the branch adds

| Area | Where | Status |
|---|---|---|
| App shell | `web/src/main.tsx` loads `web/src/fabyn/FabynApp.tsx` for `/fabyn*` and the legacy app for everything else. `server/app.ts` serves `/fabyn`, `/fabyn/order` and `/fabyn/seller`. | Done |
| Home `/fabyn` | `web/src/fabyn/home/`: a React and three.js port of the approved hero (the HENRY keychain, the YIRAN sticker, the fabyn logo photo, the SF map). START DEMO opens the consumer / seller chooser. | Done |
| Consumer `/fabyn/order` | `web/src/fabyn/consumer/`: "tell us what you want to build", the agent understands, it matches a machine type, an SF map of makers, the Palace of Fine Arts machine (owner, current job, queue), a preview before ordering (picture drafts, the real OpenSCAD keychain render, photo), add to queue, checkout (x402 test wallet), printing tiles, delivery or pickup on the map, and my orders. | v1 verified end to end. v2 (map, machine, checkout steps): see "Left to do" |
| Seller `/fabyn/seller` | `web/src/fabyn/seller/`: owner sign-in, then the Overview, Machines (3D models, status lights, printer check, A1 plate approval), Map, Orders (tagged by source, including ASI:One), Delivery (call a courier or pickup code), Income (owner ledger and x402 receipts) and Supplies (耗材 refill) tabs. | v1 verified end to end. v2 tabs: see "Left to do" |
| Shared 3D | `web/src/fabyn/shared/three/`: faithful A1 mini, M02 Pro and instax models (`build(THREE, kit)`). | Done |
| Convex store | `FABYN_STORE=convex` (`server/convex-store.ts`, `convex/state.ts`): all app state lives in Convex, in an atomic compare-and-set across chunked documents. SpacetimeDB and SQLite stay in the code but are not used. | Done (tests pass) |
| Live machines API | `GET /api/machines/live` (public): location, owner name, status, current job and queue. | Done |
| Printer check | `POST /api/owner/machines/:id/check` → `{ok, detail, checkedAt}`. | Done |
| Order source | `order.source` / `job.source` = `"web"` or `"asi1"`. The ASI:One agent sends `"asi1"`. | Done |
| Built-in test wallet | `GET /api/payments/config` and `POST /api/orders/:id/test-wallet-pay`. The server pays the x402 Base Sepolia payment with `FABYN_TEST_PAYER_PRIVATE_KEY`, so no MetaMask is needed. Only testnet, chain 84532, a capped amount and payTo = `FABYN_TREASURY_ADDRESS`. Spec: x402 section below. | Done (tests pass, no live payment run yet) |
| Simulated machines charged on testnet | Henry's decision: on testnet, the three local simulated machines charge and issue pickup codes like hardware. | In progress, see below |

Merged upstream: `origin/main` up to `788cb9a` (the Fabyn rebrand, x402 testnet checkout, machine-status completion with the camera check removed, the Instax adapter, picture drafts, printer checks, Lucas's name tags via OpenSCAD, and Yiran's ASI:One agent). Merge conflicts were resolved by keeping both sides. When main resolved the same conflicts later, main's version was taken.

## Henry's product decisions (round 2)

1. Pay before printing.
2. Lucas's x402 testnet payment, with the built-in Fabyn wallet as the default (MetaMask is optional).
3. Other makers on the map are view-only (busy, too far or the wrong type). Only the Palace of Fine Arts machines take orders.
4. The ASI:One agent is a second way to order, and its orders are tagged in the seller view.
5. On testnet, simulated machines charge and issue pickup codes.
6. Convex is the only store.
7. Progress and ETA use the current display estimate (`estimate.ts`). Real-time progress comes later.
8. Never show "demo", "simulated" or "simulation" in visible copy. The one exception is "demo payment" in mock mode.

## Run it locally

Prerequisites:
- Node 24, `uv`.
- OpenSCAD for name tags: `brew install --cask openscad@snapshot`.
- `npm install` in the repo root, `web/` and `integrations/`.

1. **`.env`** (ignored; copy from `.env.example`):
   - `FABYN_STORE=convex`
   - `CONVEX_URL=http://127.0.0.1:3210`
   - `FABYN_PUBLISH_SECRET`
   - `FABYN_MODE=simulation`
   - `FABYN_ALLOWED_MODES=simulation,hardware`
   - `FABYN_PAYMENT_MODE=testnet`
   - `FABYN_TREASURY_ADDRESS` (a test recipient)
   - `FABYN_TEST_PAYER_PRIVATE_KEY` (a disposable test payer with Base Sepolia test USDC)
   - `FABYN_BASE_SEPOLIA_RPC=https://sepolia.base.org`
   - `FABYN_PUBLIC_ORIGIN=http://127.0.0.1:4318`
   - Keys as needed: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ASI1_API_KEY`, `CONTEXT_DEV_API_KEY`.
2. **Convex:** `npm run convex:local`. Keep it running. It deploys `convex/` to the local backend on :3210. If the deployment is reset, run `npx convex env set FABYN_PUBLISH_SECRET <value from .env>`.
3. **Backend:** `npm run demo` serves the app on :4318 and the node on :8788.
   - For builds and tests, start it with `FABYN_DESIGN_PROVIDER=fixture ANTHROPIC_API_KEY= OPENAI_API_KEY= GEMINI_API_KEY=` so nothing makes paid calls.
   - The startup line should read `(simulation, convex, testnet, … test wallet 0x…)`.
4. **macOS Desktop gotcha:** on `~/Desktop`, macOS marks `node/.venv/lib/python3.12/site-packages/*.pth` hidden, and Python 3.12 skips them. Orders then fail with `PRODUCER_FAILED … No module named 'fabyn_node'`. After every backend start, run `ln -sfn "$PWD/node/fabyn_node" node/.venv/lib/python3.12/site-packages/fabyn_node`. Check it with `node/.venv/bin/fabyn-producer --help`; it should print a JSON rejection, not a traceback.
5. **Make the machines ready:** sign in as owner (code in `.data/local-credentials.json`), then calibrate, list and resume each machine. Give the A1 a job time limit of 1800 s, because a keychain takes about 14 minutes and the default is 15. Henry's Mac has helpers for this in `.data/tools/` (`run-backend.sh`, `free.mjs`, `dev-ready.mjs`).
6. **Web:** `npm --prefix web run dev` on :4317. Open:
   - http://127.0.0.1:4317/fabyn (home)
   - http://127.0.0.1:4317/fabyn/order (consumer)
   - http://127.0.0.1:4317/fabyn/seller (seller; owner code)
7. **ASI:One agent:** `npm run agent`. It needs `ASI1_API_KEY` and `FABYN_AGENT_SEED`, and connects to Agentverse through its mailbox. Before you run it, check with Yiran that nobody else is running an agent with the same seed.

Checks: `npm run typecheck`, `npm test` (349/349 at the last run), `npm --prefix web run typecheck`.

## x402 checkout (web)

- `GET /api/payments/config` → `{mode: "mock"|"testnet", network: "eip155:84532", asset, builtInWallet: {available, address}}`.
- Built-in wallet: `POST /api/orders/:id/test-wallet-pay`.
  - Request: the `/confirm` body (`offerId`, `planVersion`, `planDigest`, `permission`, `consent`, `idempotencyKey`).
  - Response: `200 {order}`.
  - Errors: `409 TEST_WALLET_UNAVAILABLE`, `409 TEST_WALLET_REFUSED` (nothing was signed), `403` (someone else's order).
- Receipt: `order.makeIntent.payment.{status, transactionHash, reason}`. Link to `https://sepolia.basescan.org/tx/<hash>`. While the status is `pending`, poll the order.
- Own wallet (MetaMask): `web/src/wallet.ts`. The PAYMENT-SIGNATURE header is sent on `/confirm`.

## Left to do

1. **Simulated machines charged on testnet** (`server/orchestration/orchestrator.ts` `chargeable()`):
   - Done: the charge, behind `FABYN_CHARGE_SIMULATED=1` for now.
   - Still to do: make it the default on testnet, issue pickup codes to charged simulated children after the owner prepares the item, and update the two tests that encode the old rule ("testnet mode does not ask for a wallet…" and "x402 order HTTP challenge… mixed plan").
2. **Consumer v2** (`Find.tsx`, `Order.tsx`, `After.tsx`, `checkout.ts`, `machines.ts`, `steps.ts`): typecheck passes, but the full v2 flow has not been verified end to end in a browser. The name, cat and photo paths each need a real click-through on desktop and phone.
3. **Seller v2** (`Orders.tsx`, `MapTab.tsx`, `Delivery.tsx`, `Income.tsx`, `Supplies.tsx`, `deliveries.ts`): typecheck passes, but these have not been verified end to end. The courier choice is stored in the browser only, because no delivery service is connected yet.
4. **One live testnet payment:** run one through the built-in wallet (the payer had 19.98 test USDC) and check the BaseScan receipt and the pickup code.
5. **Real AI keys:** every test so far used fixture drafts. The first live run with the keys costs money (images about $0.03–0.04 each, three per round).
6. **Design conflict to agree as a team:** the docs describe Convex as a read-only mirror that never sits on the order path. With `FABYN_STORE=convex` it is the authoritative store, so a Convex outage stops orders.
7. **Real-time print progress:** later. Today progress and ETA come from `estimate.ts`, and the delivery courier is display-only.
