# Running Fabyn locally

Covers the current `main` (`ec124cd`): the backend, the new `/fabyn` web app, local Convex, and optionally the MVP hardware path. Prerequisites: Node 25+ (`.node-version` says 25.8.1), `uv`, and `openscad` (`brew install --cask openscad@snapshot`) for name tags.

## 1. Install (once, and after pulling dependency changes)

```sh
npm ci
npm --prefix web ci
npm --prefix integrations ci
uv sync --project node --extra hardware
npm run setup          # creates .data/local-credentials.json (owner code, node keys)
```

Hardware path only (`npm run mvp`):

```sh
python3 -m venv producer-side/.venv && producer-side/.venv/bin/pip install -r producer-side/requirements.txt
```

The ASI:One agent also needs `uv sync --project integrations/fetch`.

## 2. Configure `.env`

Copy `.env.example` to `.env` if you don't have one. The variables use the **`FABYN_`** prefix. An older `.env` that still has `FABRARY_*` names is ignored, so rename them (`FABRARY_PUBLISH_SECRET` becomes `FABYN_PUBLISH_SECRET`, and so on).

Minimum for the `/fabyn` app:

```sh
FABYN_STORE=convex
CONVEX_URL=http://127.0.0.1:3210
FABYN_PUBLISH_SECRET=<any long random string>
FABYN_MODE=simulation
FABYN_ALLOWED_MODES=simulation,hardware
FABYN_PAYMENT_MODE=testnet                 # or mock, which needs no wallet
FABYN_TREASURY_ADDRESS=<test recipient>
FABYN_TEST_PAYER_PRIVATE_KEY=<disposable key with Base Sepolia test USDC>
FABYN_BASE_SEPOLIA_RPC=https://sepolia.base.org
FABYN_PUBLIC_ORIGIN=http://127.0.0.1:4318
```

Optional: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (picture drafts cost money, about $0.03–0.04 each, three per round), `ASI1_API_KEY` and `FABYN_AGENT_SEED` (agent). Never leave a variable set to an empty value copied from the example, because blank `FABYN_ALLOWED_MODES=` or `FABYN_PRODUCER_HUB_URL=` crashes `npm run mvp`.

## 3. Start (three terminals, from the repo root)

**Terminal 1: Convex** (keep it running)

```sh
npm run convex:local     # wait for "Convex functions ready!"
npx convex env set FABYN_PUBLISH_SECRET <same value as .env>   # first time, or if Convex was reset
```

**Terminal 2: backend** (app on :4318, node on :8788)

```sh
npm run demo
# no paid AI calls while testing:
# FABYN_DESIGN_PROVIDER=fixture ANTHROPIC_API_KEY= OPENAI_API_KEY= GEMINI_API_KEY= npm run demo
```

The startup line should read `(simulation, convex, testnet, … test wallet 0x…)`.

**Terminal 3: web dev server** (:4317)

```sh
npm --prefix web run dev
```

For a single-process alternative, `npm run build` once and use only http://127.0.0.1:4318, since the backend serves the built frontend.

## 4. Open

| Page | Dev (:4317) | Built (:4318) |
| --- | --- | --- |
| Home | http://127.0.0.1:4317/fabyn | http://127.0.0.1:4318/fabyn |
| Consumer | http://127.0.0.1:4317/fabyn/order | http://127.0.0.1:4318/fabyn/order |
| Seller | http://127.0.0.1:4317/fabyn/seller | http://127.0.0.1:4318/fabyn/seller |
| Older screens | `/make`, `/owner`, `/live`, `/relief` | same |

Seller sign-in uses `ownerCode` from `.data/local-credentials.json`. After first start, sign in as owner and calibrate, list and resume each machine before ordering. Give the A1 a job time limit of 1800 s (a keychain takes about 14 minutes; the default is 15).

## 5. Real hardware (optional)

Stickers on the Phomemo M02 Pro and name tags on the Bambu A1 mini, through the producer-side hub:

```sh
npm run mvp -- --dry-run      # fake printer, writes bytes under producer-side/.work/
npm run mvp -- --plate-cleared  # real printers; add --no-3d to skip the A1
```

Needs `BAMBU_ACCESS_CODE` in `producer-side/.env`, the A1 in LAN Only and Developer Mode, and Bambu Studio in `/Applications`. Details are in [producer-side/README.md](../producer-side/README.md) and [nametag-handoff.md](nametag-handoff.md). Ports 8000 and 4318 must be free, so stop `npm run demo` first.

## 6. ASI:One agent (optional)

```sh
npm run agent    # needs ASI1_API_KEY and FABYN_AGENT_SEED
```

Check with Yiran that nobody else runs an agent with the same seed.

## Troubleshooting

- **Only the old UI shows, or `npm run build` fails with `Cannot find module 'three'`**: the new frontend lives only at `/fabyn*` (`/`, `/make` and `/owner` stay the old app), and :4318 serves the last `web/dist` build. After pulling, run `npm --prefix web ci && npm run build`, then restart the backend.

- **`Please set CONVEX_DEPLOY_KEY to a new key`** or **`Failed to fetch latest backend version`** from Convex: both came from running `convex dev` directly. `npm run convex:local` ([scripts/convex-local.mjs](../scripts/convex-local.mjs)) hides the cloud deploy key from the CLI and, once a local deployment exists, starts the backend version already downloaded instead of asking version.convex.dev. The very first run still needs the internet to download the backend.
- **`Error: the app` from `npm run mvp`**: the app exited at start, usually because Convex is not running. `npm run mvp` now checks for Convex first and says so.

- **`PRODUCER_FAILED … No module named 'fabyn_node'`**: run `ln -sfn "$PWD/node/fabyn_node" node/.venv/lib/python3.12/site-packages/fabyn_node` after each backend start (macOS hides `.pth` files in some folders such as Desktop). Check with `node/.venv/bin/fabyn-producer --help`.
- **`TooManyWrites` from Convex**: place orders one at a time; local Convex limits writes to 4 MiB/s.
- **A payment stuck on "Checking your payment"** can hold its machine. Restart the backend.
- **Checks**: `npm run typecheck`, `npm test`, `npm --prefix web run typecheck`. If isolated-node tests time out, run `npm test -- --test-concurrency=1`.
