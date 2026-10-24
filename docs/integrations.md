# Fabrary integration implementation and evidence

Checked against official upstream documentation on October 22, 2026. This document distinguishes implemented adapters, local integration evidence, and missing live prerequisites. An adapter being configured is never reported as a successful live transaction or discovery.

## Verified locally

October 23 overnight follow-up: the payment/Claude fixture suite now passes
**25 tests**, with typecheck passing. Added cases preserve a known settlement
transaction hash when its durable checkpoint is unavailable and send unchanged
baseline/result images, contradictory observations, invalid images and
unavailable verification to review. No live transaction or model call was made.
See [overnight QA](overnight-qa.md) for the latest integrated evidence.

- **SpacetimeDB 2.13.0:** installed an actual standalone server on this Apple Silicon host, bound only to `127.0.0.1:3002`, published the TypeScript module, and generated official TypeScript SDK bindings. Two real SDK clients passed initialization, persisted state read, atomic compare-and-set conflict rejection, and cross-client live subscription. An anonymous SDK client received no application rows and its mutation failed `FORBIDDEN`. `fabrary-local` is the integration test database; `fabrary-app` was separately published clean for application acceptance. This is an actual database integration, not an in-memory substitute.
- **Payments:** twelve deterministic adapter tests validate challenge encoding, exact cents, mock labeling, wrong-chain/quote rejection, unsettled authorization remaining pending, receipt confirmation, exact token-transfer matching, unknown-settlement reconciliation, and saving a signed transfer hash before broadcast. These tests use a facilitator/RPC fixture and do not establish a live blockchain result.
- **Claude:** seven deterministic tests exercise Messages request image blocks, bounded parsing, approval/permission fields being dropped, invalid spec values, malformed visual output, stale evidence and credible-completion gates. No live Claude call has been made without an API key.
- **Fetch.ai:** pinned Python packages installed; in-process FastMCP tools invoke the requester backend client, reject owner sessions, and enforce a uAgent sender allowlist. The actual local bridge-to-application flow also passed on `http://127.0.0.1:4318` backed by SpacetimeDB: dedicated requester, upload, FastMCP draft, explicit test preview approval through requester HTTP, FastMCP quote/checkout/dispatch/status, produced output, released mock payment, owner preparation and pickup redemption. The Instax simulation was cleared and resumed afterward. Job `job_dac0f4c1-b282-4439-bad4-0fe780f02d8b` finished `produced / released / collected`; machine source is simulation and money is mock. No Agentverse publication, ASI:One discovery or remote chat invocation is claimed without live evidence.

Machine-readable observed evidence is saved in `integrations/evidence/local-acceptance.json`. Tests pass as 19 TypeScript cases and five Python bridge cases.

Run from the application root:

```sh
npm --prefix integrations ci
npm --prefix integrations test
npm --prefix integrations run typecheck
uv sync --project integrations/fetch --frozen
uv run --project integrations/fetch --directory integrations/fetch python -m unittest -v test_bridge.py
```

## Authoritative SpacetimeDB store

`integrations/spacetimedb/src/index.ts` contains the real module. Its private `app_state` table stores the full JSON application state and monotonically increasing version. Its private `config` records the publishing identity at module initialization. The public `backend_state` view returns rows only to that identity. Browser and agent access goes through the application's requester/owner authorization; anonymous database clients cannot read jobs, sessions or pickup codes.

The `compare_and_set` reducer checks the publishing identity, JSON validity, size, and expected version in one SpacetimeDB transaction. The application performs its domain mutation on a snapshot and retries only after a version conflict. This keeps reservation, cancellation/dispatch races, payment reference assignment, execution attempts and pickup redemption within the same atomic state boundary. The backend is the trusted domain-policy writer; clients cannot bypass it by calling reducers.

`integrations/src/spacetime-store.ts` exports:

```ts
interface AuthoritativeStore<T> {
  read(): Promise<{ version: number; data: T }>;
  compareAndSet(expectedVersion: number, data: T): Promise<boolean>;
  subscribe(callback: (snapshot: { version: number; data: T }) => void): () => void;
  close(): Promise<void>;
}
connectSpacetimeStore<T>({ uri, database, token, initialState, timeoutMs? });
```

A disconnected authoritative store fails operations with `SPACETIME_UNAVAILABLE`; it never silently falls back to SQLite. SQLite remains an explicitly labeled development mode. The JSON state approach prioritizes a small auditable transaction boundary for this demo; it is not a normalized multi-owner database design.

For a reproducible installation, install the CLI using the official installation page, then use CLI **2.13.0** with SDK **2.13.0**. The module has its own pinned package and lockfile:

```sh
npm --prefix integrations/spacetimedb ci
spacetime start --listen-addr 127.0.0.1:3002 --data-dir .data/spacetime --non-interactive
# In another terminal; this publishes only to the local server.
spacetime publish fabrary-app --server http://127.0.0.1:3002 --module-path integrations/spacetimedb --yes
spacetime generate --lang typescript --module-path integrations/spacetimedb --out-dir integrations/src/module_bindings --yes
```

Set `FABRARY_SPACETIME_URI=ws://127.0.0.1:3002`, `FABRARY_SPACETIME_DATABASE=fabrary-app`, and `FABRARY_SPACETIME_TOKEN` to the publishing identity's local-server token. The token must stay in an ignored environment file. The CLI initially authenticates directly to the local standalone server; no cloud account is required. Generated bindings are checked in. Regenerate them from the module after schema changes, then typecheck.

The session's installed runtime, data and JWT keys were preserved under ignored `.data/spacetime-runtime/` and restarted with identical authoritative state. `npm run spacetime` starts that retained runtime; it is not committed or a substitute for fresh-machine installation. The private isolated-test configuration is `.data/spacetime-test-config.json` (0600). The initial installer under `/tmp` is no longer required by the running application. The SDK integration test accepts `FABRARY_SPACETIME_CONFIG` pointing to a private JSON file `{uri,database,token}` and runs with `npm --prefix integrations run test:spacetime`.

Sources: [official installation](https://spacetimedb.com/install), [TypeScript quickstart](https://spacetimedb.com/docs/quickstarts/typescript/), [atomic reducers](https://spacetimedb.com/docs/functions/reducers/), [publishing identity initialization](https://spacetimedb.com/docs/functions/reducers/lifecycle/), [caller-specific views](https://spacetimedb.com/docs/functions/views/).

## x402 and Base Sepolia USDC

`integrations/src/payments.ts` exports `PaymentAdapter`, `createPaymentAdapter`, `MockPaymentAdapter`, and `BaseSepoliaPaymentAdapter`. Dependencies are pinned to `@x402/core` and `@x402/evm` **2.28.0** and `viem` **2.57.10** in the integrations lockfile.

The testnet path is hard restricted to chain **84532** (`eip155:84532`) and Base Sepolia USDC **0x036CbD53842c5426634e7929541eC2318f3dCF7e**. Integer USD cents convert exactly to six-decimal token units. There is no mainnet mode.

- `challenge(operation)` returns HTTP status 402, x402 v2 `PAYMENT-REQUIRED`, and the same JSON body. The resource binds the job and quote. Exact amount, USDC asset, recipient, network and authorization nonce are validated before submission. The authorization must be active and expire within the quote; challenge timeout reflects the remaining quote lifetime. An offline interoperability test signs the challenge with the official x402 EVM client and cryptographically verifies its EIP-3009 signature. The live harness uses that same official client.
- `collect(operation)` calls the official facilitator client's `verify` and `settle`. A valid signature is insufficient. A confirmed result additionally requires a successful onchain receipt, configured confirmation count (two by default), and the exact USDC `Transfer(from, to, amount)` log for this expected payer and treasury.
- `release` transfers the owner portion from the application treasury. `refund` transfers the total collection back to the payer. The application ledger tracks a held test balance; **this is not a deployed escrow contract**. Platform fees remain at the treasury after owner release.
- Treasury transfers are signed locally. Their hash is passed to `onSubmitted` before broadcast so the application can persist it. The application must serialize transfers sharing a treasury nonce and durably reserve collection nonce references globally to one job.
- An unknown settlement or missing receipt stays **pending**. `reconcile` reads an existing transaction and never creates another collection, transfer, nonce or authorization. A settle timeout without a transaction hash requires facilitator/onchain investigation by authorization nonce; it does not automatically charge again. A failed receipt is never relabeled refunded or released.

Operations carry `{jobId, operationId, quote, payload?, requesterAddress?, ownerAddress?, receipt?, onSubmitted?}`. Receipts carry `{status, reference, mode, transactionHash?, payer?, payee?, amountCents?, kind?, reason?}`. They are trusted backend records, never client-supplied claims. `onSubmitted` must persist before returning. The root application enforces which lifecycle state may request collection, release or refund and makes each operation idempotent. `decodeX402PaymentSignature` wraps the official v2 request header codec; `x402PaymentResponseHeader` wraps the official settlement codec and emits a header only for an actually confirmed testnet collection (never pending, mock, release or refund).

Required configuration:

| Purpose            | Variables and prerequisites                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Testnet collection | `FABRARY_PAYMENT_MODE=testnet`, `FABRARY_TREASURY_ADDRESS`, `FABRARY_BASE_SEPOLIA_RPC`, `FABRARY_PUBLIC_ORIGIN`; requester signed authorization and test USDC     |
| Facilitator        | `FABRARY_X402_FACILITATOR` optional, defaults to official testnet `https://x402.org/facilitator`; selected facilitator must support x402 v2 exact on Base Sepolia |
| Release/refund     | `FABRARY_TREASURY_PRIVATE_KEY` matching treasury address, treasury test ETH for gas and sufficient test USDC; explicit owner/payer addresses                      |
| Live acceptance    | All above plus `FABRARY_RUN_LIVE_PAYMENTS=1`, `FABRARY_TEST_PAYER_PRIVATE_KEY`, `FABRARY_OWNER_WALLET`                                                            |

`npm --prefix integrations run test:live` prints **BLOCKED** and exits 2 when live prerequisites are missing. With explicit opt-in, the script performs two distinct one-cent **testnet** collections, releases one to the owner, refunds the other to the payer, and records transaction hashes in a private JSONL journal. It polls existing transactions only. Its live result has **not** been obtained in this session because funded test wallets, their private keys and RPC configuration were unavailable. A read-only upstream smoke did succeed: the default facilitator advertised x402 v2 `exact` on `eip155:84532`, and the public Base Sepolia RPC reported chain ID 84532 and the configured token name `USDC`. This establishes public endpoint compatibility only. No token purchase, real funds or live blockchain submission was made.

Sources: [official seller quickstart](https://docs.cdp.coinbase.com/x402/seller/quickstart), [x402 facilitator behavior and indeterminate timeouts](https://github.com/x402-foundation/x402/blob/main/docs/core-concepts/facilitator.md), [v2 payment types](https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/src/types/payments.ts), [official HTTP facilitator client](https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/src/http/httpFacilitatorClient.ts), [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses), [viem receipt API](https://viem.sh/docs/actions/public/getTransactionReceipt).

## Fetch.ai, FastMCP and ASI:One

`integrations/fetch/bridge.py` builds a real FastMCP server and wraps it with the official `uagents_adapter.MCPServerAdapter`. Python **3.12** and `uv.lock` pin `uagents` **0.26.1**, `uagents-adapter[mcp]` **0.6.2**, `fastmcp` **2.14.5**, and `httpx` **0.28.1**. A public in-process FastMCP client supplies the adapter's documented `list_tools` and `call_tool` methods.

Tools are `list_machines`, `create_request`, `job_status`, `request_quote`, `checkout_job`, and `dispatch_job`. Every action calls the same `/api` routes used by the browser. There is no preview-approval tool, owner tool, general HTTP tool or node endpoint. A requester uploads assets and explicitly approves the production preview in Fabrary; later quote, budget, payment and dispatch checks still run in the backend. Agent checkout additionally reloads its job and requires an enabled budget mandate plus a quote already auto-accepted within that cap; it cannot use the browser checkout action as implicit authority to accept a new price. The bridge holds no payer key, so testnet checkout needs a requester-signed x402 payload. Simulation/mock paths stay labeled by the backend.

This is deliberately a **dedicated single-requester agent**. `FABRARY_AGENT_SESSION_COOKIE` must be a valid requester session (`fabrary_session=...`), never an owner cookie. Startup checks the role. `FABRARY_AGENT_ALLOWED_SENDERS` lists trusted uAgent addresses; guarded signed and unsigned protocol handlers reject other senders before tool invocation. Public multi-user deployment needs a sender-to-requester credential mapping and is outside this bridge's scope.

Local invocation against a running app:

```sh
FABRARY_FETCH_LOCAL_SMOKE=1 uv run --project integrations/fetch python integrations/fetch/bridge.py
```

For an actual local application test with a newly created requester, `uv run --project integrations/fetch python integrations/fetch/local_acceptance.py` performs read-only tool invocation (the requester session is created separately). `FABRARY_FETCH_FULL_LOCAL=1` opts into the complete Instax **simulation/mock** fixture, requires the local credential file, calibrates and resumes only an idle simulation, approves its own test preview through the ordinary HTTP route, and cleans up its own stored output. It never takes over another requester's cookie or selects hardware.

Set `FABRARY_API_ORIGIN` and a dedicated `FABRARY_AGENT_SESSION_COOKIE` first. The smoke check validates the requester session and invokes `list_machines` through actual FastMCP. It does not claim remote discovery.

For Agentverse/ASI:One, additionally set `FABRARY_AGENT_SEED`, `FABRARY_AGENT_ALLOWED_SENDERS`, and `ASI1_API_KEY`. `ASI1_MODEL` defaults to the documented `asi1-mini`; `FABRARY_AGENT_PORT` defaults to 8011. Launching the bridge without `FABRARY_FETCH_LOCAL_SMOKE` uses uAgents mailbox mode on testnet, includes MCP and Chat Protocol manifests, and runs the official adapter. This can publish/register external agent metadata, so it is a separate operator action, never run by local tests. Ensure the allowed sender list includes the intended trusted ASI:One caller for this dedicated requester.

**Live blocker:** ASI:One key, a configured persistent agent seed, trusted sender binding and Agentverse/mailbox discovery evidence are absent. Registration alone would not prove discovery. Acceptance requires an observed ASI:One lookup, a remote Chat Protocol tool invocation, and the corresponding authorized backend job history. None is claimed in this session.

Sources: [official MCP adapter README](https://github.com/fetchai/uAgents/blob/main/python/uagents-adapter/README.md), [official adapter implementation](https://github.com/fetchai/uAgents/blob/main/python/uagents-adapter/src/uagents_adapter/mcp/adapter.py), [ASI:One Chat Protocol guide](https://uagents.fetch.ai/docs/examples/asi-1), [FastMCP in-process client](https://gofastmcp.com/clients/client).

## Claude intake and visible-output checks

`integrations/src/claude.ts` uses the official HTTPS Messages API directly, with `x-api-key` and `anthropic-version: 2023-06-01`, and labeled base64 image blocks. No SDK dependency or remote image-fetch permission is needed. `ANTHROPIC_API_KEY` is required; `FABRARY_CLAUDE_MODEL` overrides the default **claude-sonnet-5-5**, the current Sonnet model documented on October 22, 2026. The request omits temperature and forced tools, which that model rejects.

`draftIntake({intent,images})` returns a schema-checked suggestion and bundled unresolved questions. It cannot approve a preview, grant artwork permission, set prices, mark a machine ready, or make an image printable as 3D. Backend capability, dimensions, media and owner-policy validation remains authoritative. Prompt text inside uploaded art is treated as data.

`readMachine({description?,photo?})` reads the make and model from a photo of a machine, its label or its box. It only transcribes what is legible (brand, model designation, the label text relied on, whether it was readable); it never sees the supported list and never picks a model. `server/machine-identification.ts` then matches brand and model with fixed rules: exact supported models are selected, near relatives (plain M02, mini Link, full-size A1) ask for confirmation, and other models are named as unsupported. Text on paper or film packaging that lists compatible models is ignored. Typed names are matched locally without a Claude call; a photo that contradicts the typed name selects nothing. Photos are shrunk to JPEG in the browser, checked by their bytes and limited to 4 MiB. One live call on October 24, 2026 read a generated M02 Pro label correctly (claude-sonnet-5-5); no real label photo has been read yet.

`verifyOutput({approvedArtifact,resultFrame,baselineFrame?,capturedAt,completionCredible,jobId,machineId,expected?})` requires credible machine completion, an independent result image and a frame no more than two minutes old. Invalid/future timestamps, identical artifact/result bytes, unavailable API, malformed results and contradictory pass observations become **review**. A pass also requires explicit usable-frame, visible-output and artwork-match observations. Claude is only a coarse visible-output check; it cannot establish dimensions, structural integrity, film development, pickup or delivery. The backend separately binds capture time, machine/job/attempt and source.

`npm --prefix integrations run test:claude:live` is opt-in with `FABRARY_RUN_LIVE_CLAUDE=1`, `ANTHROPIC_API_KEY`, `FABRARY_CLAUDE_ARTIFACT_PATH`, `FABRARY_CLAUDE_RESULT_PATH`, `FABRARY_CLAUDE_CAPTURED_AT` and `FABRARY_CLAUDE_COMPLETION_CREDIBLE=1`. Missing prerequisites print **BLOCKED**, exit 2 and make no API call. The result is an observed model response, not proof of a hardware loop. **No live Claude response was obtained in this session.**

Sources: [official current Sonnet model](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), [vision and image blocks](https://platform.claude.com/docs/en/build-with-claude/vision), [Messages API](https://platform.claude.com/docs/en/api/messages).

## context.dev machine profiles

`server/orchestration/context-dev.ts` is the only module that calls context.dev. It wraps the official `context.dev` TypeScript SDK (pinned at 3.15.0) and reads `CONTEXT_DEV_API_KEY` from the ignored `.env` through its callers; the key never reaches the browser. It accepts public HTTPS URLs only and sends only a model name or a page URL. The SDK retries 408, 409, 429 (honouring `Retry-After`) and 5xx twice and never retries validation errors.

It is used only to build machine profiles at onboarding or build time, never while an order is being prepared: `npm run profile:build -- "Phomemo M02Pro" https://phomemo.com/products/m02-pro-portable-printer` reads one official page with `POST /web/scrape` (JSON extraction plus Markdown, cached copies up to one day old) and prints a candidate profile for review. Without an official URL it first runs `POST /web/search` restricted to the manufacturer's domains and reads at most two pages. A value is kept only when the extraction quotes it, the quote appears in the page's Markdown, and the field applies to that process. A documented value that disagrees with an adapter fact makes the profile `needs_review`. The builder returns the context.dev `request_id` of each page.

Verified: wrapper tests with an injected fetch (quoted values, an invented quote, a body size that is not a build volume, unsafe URLs, a 422 that is not retried, a 429 retried twice). One live call on October 24, 2026 read the official M02 Pro page (request `f32a5be3-2ef1-49f3-a5b3-79eec0fab425`) and confirmed 300 DPI ("**DPI:** 300DPI") with no conflict. That run also read the printer's 85×85×46 mm body as a build volume; the per-process field rule above was added after it and is covered by a test, not by a second paid call.

Sources: [scrape](https://docs.context.dev/api-reference/web-scraping/scrape), [search](https://docs.context.dev/api-reference/web-scraping/search), [agent feedback](https://docs.context.dev/optimization/agent-feedback).
