import ContextDev, { APIError, RateLimitError } from "context.dev";

/**
 * The only module that talks to context.dev. It runs on the server at
 * onboarding/build time, sends only public model names and URLs, and never
 * runs during an order. The key is read from CONTEXT_DEV_API_KEY by callers.
 */
export interface ContextDevOptions {
  apiKey: string;
  /** Tests inject a fake; production uses the global fetch. */
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}
export interface ExtractedPage {
  data: Record<string, unknown>;
  truncated: boolean;
  /** The page's Markdown, used to check that every quoted value is really there. */
  markdown: string;
  requestId: string;
}
// Spec pages change rarely; a day-old cached copy is fresh enough for a profile.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export class ContextDevClient {
  private readonly sdk: ContextDev;
  constructor(options: ContextDevOptions) {
    if (!options.apiKey)
      throw new Error("CONTEXT_DEV_BLOCKED: CONTEXT_DEV_API_KEY is missing");
    // The SDK retries 408, 409, 429 (honouring Retry-After) and 5xx with
    // bounded backoff, and never retries a validation error.
    this.sdk = new ContextDev({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      fetch: options.fetch,
      timeout: options.timeoutMs ?? 60_000,
      maxRetries: 2,
    });
  }
  /** POST /web/search, limited to the given domains. */
  async search(query: string, includeDomains: string[]) {
    const data = await call(() =>
      this.sdk.web.search({ query, numResults: 10, includeDomains }),
    );
    return (Array.isArray(data?.results) ? data.results : [])
      .map((r) => ({
        url: String(r?.url ?? ""),
        title: String(r?.title ?? ""),
      }))
      .filter((r) => safePublicUrl(r.url));
  }
  /** POST /web/scrape with JSON extraction against `schema`, plus Markdown. */
  async extract(
    url: string,
    schema: Record<string, unknown>,
    instructions: string,
  ): Promise<ExtractedPage> {
    if (!safePublicUrl(url)) throw new Error("CONTEXT_DEV_UNSAFE_URL");
    const page = await call(() =>
      this.sdk.web.scrape({
        url,
        formats: { json: true, markdown: true },
        jsonParams: { schema, instructions },
        maxAgeMs: MAX_AGE_MS,
      }),
    );
    const json = page?.json;
    if (json?.success !== true || !json.data || typeof json.data !== "object")
      throw new Error(
        `CONTEXT_DEV_EXTRACTION_FAILED: ${json?.error_code ?? "no data"} (request ${page?.request_id ?? "unknown"})`,
      );
    return {
      data: json.data as Record<string, unknown>,
      truncated: json.isTruncated === true,
      markdown:
        page.markdown?.success === true &&
        typeof page.markdown.data === "string"
          ? page.markdown.data
          : "",
      requestId: page.request_id,
    };
  }
}
async function call<T>(request: () => PromiseLike<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof RateLimitError)
      throw new Error("CONTEXT_DEV_RATE_LIMITED: retry later");
    if (error instanceof APIError)
      throw new Error(
        `CONTEXT_DEV_REQUEST_FAILED: ${error.status ?? "no response"}`,
      );
    throw error;
  }
}
/** Public HTTPS only: no credentials, no local or private addresses. */
export function safePublicUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return !(
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith("[") ||
    /^\d+$/.test(host)
  );
}
