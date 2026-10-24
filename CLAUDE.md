# Fabrary agent notes

Local-only app: Express/TypeScript backend (`server/`), React web (`web/`), Python node and producer (`node/`). Keep work in simulation with mock payments unless told otherwise; never operate hardware, move funds or call paid APIs in tests. `docs/` holds the contracts ([working PRD](docs/working-prd.md), [orchestration design](docs/orchestration-design.md), [test report](docs/test-report.md)).

## Context.dev

- **Key:** `CONTEXT_DEV_API_KEY` in the ignored `.env` (server-side only; never in `web/`, logs, docs or commits). Rotate at https://www.context.dev/dashboard/api-keys.
- **Wrapper:** every call goes through [`server/orchestration/context-dev.ts`](server/orchestration/context-dev.ts) (`ContextDevClient`, built on the official `context.dev` SDK, pinned exactly). Don't call the API or SDK anywhere else. It accepts public HTTPS URLs only and sends only model names and URLs.
- **Use:** building machine profiles at onboarding/build time ([`buildProfile`](server/orchestration/knowledge.ts), `npm run profile:build -- "<model>" [official-url]`). Never during an order. A value is kept only when its quote appears in the page text and the field applies to that process; disagreements with adapter facts become `needs_review`.
- **Endpoints:**
  - `POST /web/scrape` with `formats: {json, markdown}`, `jsonParams: {schema, instructions}` and `maxAgeMs` of one day — https://docs.context.dev/api-reference/web-scraping/scrape
  - `POST /web/search` with `includeDomains`, only when no official page is given — https://docs.context.dev/api-reference/web-scraping/search
- **Errors:** the SDK retries 408/409/429 (honouring `Retry-After`) and 5xx twice; validation errors are never retried. Report an endpoint that disagrees with its docs via Agent Feedback (`POST /feedback`, include the `request_id`; `buildProfile` returns `requestIds`) — https://docs.context.dev/optimization/agent-feedback
- **Tests:** stay off the live API. Inject `fetch` into `ContextDevClient` (see `tests/orchestration.test.ts`); every real call costs credits, so ask before running one.
- Docs index: https://docs.context.dev/llms.txt (append `.md` to any docs URL for Markdown).
