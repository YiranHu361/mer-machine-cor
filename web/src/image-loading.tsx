import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type ImageStatus = "loading" | "loaded" | "failed" | "timed-out";

// The caller keys its component by approved artifact identity. Each hook instance
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
  url.searchParams.set("fabyn_image_retry", retryKey);
  return url.href;
}
