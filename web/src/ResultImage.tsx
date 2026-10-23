import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type ImageStatus = "loading" | "loaded" | "failed" | "timed-out";

// The caller keys its component by frame/artifact identity. Each hook instance
// fences its own attempts, including callbacks arriving after timeout/unmount.
export function useImageAttempt({
  enabled = true,
  freshInitialSource = false,
  onTimeout,
}: {
  enabled?: boolean;
  freshInitialSource?: boolean;
  onTimeout?: () => void;
} = {}) {
  const [status, setStatus] = useState<ImageStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  const [retryKey, setRetryKey] = useState(() =>
    freshInitialSource ? crypto.randomUUID() : "",
  );
  const current = useRef({ attempt: 0, status: "loading" as ImageStatus });
  const active = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timedOut = useRef(onTimeout);
  timedOut.current = onTimeout;
  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const settle = useCallback(
    (expectedAttempt: number, next: Exclude<ImageStatus, "loading">) => {
      if (
        !active.current ||
        current.current.attempt !== expectedAttempt ||
        current.current.status !== "loading"
      )
        return false;
      clearTimer();
      current.current.status = next;
      setStatus(next);
      if (next === "timed-out") timedOut.current?.();
      return true;
    },
    [clearTimer],
  );
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      clearTimer();
    };
  }, [clearTimer]);
  useEffect(() => {
    if (enabled && current.current.status === "loading")
      timer.current = setTimeout(() => settle(attempt, "timed-out"), 30_000);
    return clearTimer;
  }, [attempt, enabled, clearTimer, settle]);
  return {
    status,
    attempt,
    retryKey,
    loaded: () => settle(attempt, "loaded"),
    failed: () => settle(attempt, "failed"),
    retry: () => {
      if (!active.current || current.current.status === "loading") return;
      clearTimer();
      current.current = {
        attempt: current.current.attempt + 1,
        status: "loading",
      };
      setStatus("loading");
      setRetryKey(crypto.randomUUID());
      setAttempt(current.current.attempt);
    },
  };
}

export function retryImageSource(source: string, retryKey: string) {
  if (!retryKey) return source;
  let url: URL;
  try {
    url = new URL(source, window.location.href);
  } catch {
    return source;
  }
  if (url.origin !== window.location.origin || !/^https?:$/.test(url.protocol))
    return source;
  // A browser can retain a failed decode for an HTTP 200 image even when a
  // replacement <img> uses the same URL. Retry local media with a fresh key.
  url.searchParams.set("fabrary_image_retry", retryKey);
  return url.href;
}

export function ResultImage(props: {
  src: string;
  frameKey: string;
  alt: string;
  owner?: boolean;
}) {
  return (
    <ImageAttempt
      key={JSON.stringify([props.src, props.frameKey])}
      src={props.src}
      alt={props.alt}
      owner={props.owner}
    />
  );
}

function ImageAttempt({
  src,
  alt,
  owner,
}: {
  src: string;
  alt: string;
  owner?: boolean;
}) {
  // Stable API endpoints can return a new captured frame. Each frame context
  // starts with a fresh URL so a previous decoded image cannot survive it.
  const { status, attempt, retryKey, loaded, failed, retry } = useImageAttempt({
    freshInitialSource: true,
  });
  const retryButton = useRef<HTMLButtonElement>(null);
  const imageLink = useRef<HTMLAnchorElement>(null);
  return (
    <div className="result-image" aria-busy={status === "loading"}>
      <a
        ref={imageLink}
        hidden={status !== "loaded"}
        href={src}
        target="_blank"
        rel="noreferrer"
        aria-label="Open result image in a new tab"
      >
        {status !== "timed-out" && (
          <img
            key={attempt}
            src={retryImageSource(src, retryKey)}
            alt={alt}
            onLoad={() => {
              if (!loaded()) return;
              const restoreFocus =
                document.activeElement === retryButton.current;
              if (restoreFocus) {
                // The link is about to replace the retry control. Keep keyboard
                // navigation at this image without moving a newer focus choice.
                imageLink.current?.removeAttribute("hidden");
                imageLink.current?.focus();
              }
            }}
            onError={() => {
              failed();
            }}
          />
        )}
      </a>
      {status !== "loaded" && (
        <div className="notice">
          <p role="status">
            {status === "loading"
              ? "Loading result image…"
              : status === "timed-out"
                ? "The result image did not finish loading. Retry the image to check it again."
                : "The result image could not be displayed."}
          </p>
          {(status === "failed" || status === "timed-out") && (
            <p>
              {owner
                ? "Retry the image, or inspect the machine and recorded outcome before making a decision."
                : "Retry the image, or ask the owner to inspect the recorded outcome."}
            </p>
          )}
          {(status === "failed" || status === "timed-out" || attempt > 0) && (
            <button
              ref={retryButton}
              type="button"
              className="text-button"
              aria-disabled={status === "loading"}
              onClick={retry}
            >
              Retry result image
            </button>
          )}
        </div>
      )}
    </div>
  );
}
