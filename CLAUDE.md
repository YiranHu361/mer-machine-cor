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

## Picture drafts: OpenAI and Nano Banana

- **Choice:** `FABRARY_DESIGN_PROVIDER` (`openai`, `nano-banana`, `claude`, `fixture`, `none`); unset, the first key found wins: `OPENAI_API_KEY`, then `GEMINI_API_KEY`, then `ANTHROPIC_API_KEY` (SVG line art). Keys live in the ignored `.env`, server-side only. Neither image API has a free tier.
- **Shared:** [`integrations/src/picture-drafts.ts`](integrations/src/picture-drafts.ts) holds the looks, prompts and the PNG/JPEG/WebP check every returned file passes.
- **OpenAI:** [`integrations/src/openai-images.ts`](integrations/src/openai-images.ts), raw `fetch` to `POST https://api.openai.com/v1/images/generations` with `{model, prompt, n: 1, size: "1024x1024", quality: "medium", output_format: "png"}`; the picture is `data[0].b64_json`. Default model `gpt-image-2.5-flare` (`FABRARY_OPENAI_IMAGE_MODEL`). OpenAI may require organization verification. Docs: https://developers.openai.com/api/docs/guides/image-generation

## Nano Banana (design drafts)

- **Key:** `GEMINI_API_KEY`. A free-tier key gets HTTP 429 with "limit: 0 requests per day": image output needs billing.
- **Wrapper:** [`integrations/src/nano-banana.ts`](integrations/src/nano-banana.ts), raw `fetch` to `POST https://generativelanguage.googleapis.com/v1beta/interactions` with `{model, input}`; the picture is the first `steps[].content[]` block of `type: "image"` (base64 `data`). Default model `gemini-nano-banana-2.1` (`FABRARY_NANO_BANANA_MODEL`). Returned bytes are sniffed as PNG/JPEG/WebP before they are stored. Docs: https://ai.google.dev/gemini-api/docs/image-generation
- **Flow:** one call per draft, three per round, about $0.034 each. Stickers ask for black-and-white line art, photo prints for colour. A chosen picture goes to the producer as a `photos` design, so it is dithered for a sticker or fitted to the film for a photo print.
- **Tests:** stay off the live API. Inject `fetch` into `NanoBananaProvider` or `imageDraft` into the orchestrator; ask before any real call.
