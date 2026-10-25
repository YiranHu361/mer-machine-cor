export class ApiError extends Error {
  code: string;
  status: number;
  outcomeUnknown: boolean;
  constructor(
    message: string,
    code: string,
    status: number,
    outcomeUnknown = false,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.outcomeUnknown = outcomeUnknown;
  }
}
const UNCERTAIN_CHANGE_NOTICE =
  " The result is unknown; the server may still finish. Refresh the existing order or workshop record before retrying. Do not create a replacement order or payment.";

export function requestDeadline(path: string, method = "GET") {
  // Four uploads may each spend 30s decoding. Preparation allows 30s,
  // suggestions 45s; payment verification/settlement includes 30s calls.
  if (!["GET", "HEAD"].includes(method.toUpperCase())) return 180_000;
  // Calibration status allows time for the node observation and durable save.
  return /\/calibration(?:\?|$)/.test(path) ? 90_000 : 30_000;
}

/** Bound headers and body together. Aborting a browser request cannot undo a server commit. */
export async function requestJson(
  path: string,
  init: Omit<RequestInit, "signal"> = {},
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ response: Response; value: any }> {
  const mutation = !["GET", "HEAD"].includes(
    (init.method || "GET").toUpperCase(),
  );
  const controller = new AbortController();
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const uncertain = UNCERTAIN_CHANGE_NOTICE;
  try {
    return await Promise.race([
      (async () => {
        const response = await (options.fetcher || fetch)(path, {
          ...init,
          signal: controller.signal,
        });
        let value;
        try {
          value = await response.json();
          if (
            value === null ||
            typeof value !== "object" ||
            Array.isArray(value)
          )
            throw new Error("Expected an object response");
        } catch (error) {
          if (expired) throw error;
          throw new ApiError(
            `The workshop response could not be read.${mutation ? uncertain : " Refresh to check the saved state."}`,
            "invalid_response",
            response.status,
            mutation,
          );
        }
        return { response, value };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            expired = true;
            reject(
              new ApiError(
                `The workshop request timed out.${mutation ? uncertain : " Refresh to check the saved state."}`,
                "request_timeout",
                0,
                mutation,
              ),
            );
            controller.abort();
          },
          options.timeoutMs ?? requestDeadline(path, init.method),
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      `The workshop is disconnected.${mutation ? uncertain : " Check the local service and refresh."}`,
      "disconnected",
      0,
      mutation,
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
  options: { headers?: HeadersInit } = {},
): Promise<T> {
  if (path === "/uploads" && body instanceof FormData && import.meta.env?.VITE_FABYN_CLOUD === "1") {
    const images = body.getAll("images").filter((image): image is File => image instanceof File);
    const files = await Promise.all(images.map(async (image) => ({
      size: image.size,
      sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await image.arrayBuffer())))
        .map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    })));
    const { uploads } = await api<{ uploads: { ticketId: string; url: string }[] }>("/uploads/storage", { files });
    const completed = await Promise.all(uploads.map(async (upload, index) => {
      const response = await fetch(upload.url, {
        method: "POST", body: images[index], headers: { "Content-Type": images[index].type || "application/octet-stream" },
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new ApiError("The picture upload failed. Try again.", "upload_failed", response.status);
      const { storageId } = await response.json();
      return { ticketId: upload.ticketId, storageId };
    }));
    return api<T>("/uploads/complete", { uploads: completed });
  }
  const verb = (method || (body === undefined ? "GET" : "POST")).toUpperCase();
  const headers = new Headers(
    body instanceof FormData
      ? undefined
      : { "Content-Type": "application/json" },
  );
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  const { response, value } = await requestJson(`/api${path}`, {
    method: verb,
    credentials: "same-origin",
    headers,
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  if (!response.ok) {
    const outcomeUnknown =
      !["GET", "HEAD"].includes(verb) && response.status >= 500;
    const details = value?.error?.details || value?.details || value?.errors;
    const extra = Array.isArray(details)
      ? details
          .map((x: unknown) => (typeof x === "string" ? x : JSON.stringify(x)))
          .join(" ")
      : "";
    throw new ApiError(
      `${value?.error?.message || value?.message || `The request could not be completed (${response.status}).`}${extra ? " " + extra : ""}${outcomeUnknown ? UNCERTAIN_CHANGE_NOTICE : ""}`,
      value?.error?.code || "request_failed",
      response.status,
      outcomeUnknown,
    );
  }
  return value as T;
}
