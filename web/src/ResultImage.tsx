import { useRef, useState } from "react";

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
  alt: string;
  owner?: boolean;
}) {
  return <ImageAttempt key={props.src} {...props} />;
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
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);
  const [retryKey, setRetryKey] = useState("");
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
        <img
          key={attempt}
          src={retryImageSource(src, retryKey)}
          alt={alt}
          onLoad={() => {
            const restoreFocus = document.activeElement === retryButton.current;
            setStatus("loaded");
            if (restoreFocus) {
              // The link is about to replace the retry control. Keep keyboard
              // navigation at this image without moving a newer focus choice.
              imageLink.current?.removeAttribute("hidden");
              imageLink.current?.focus();
            }
          }}
          onError={() => setStatus("failed")}
        />
      </a>
      {status !== "loaded" && (
        <div className="notice">
          <p role="status">
            {status === "loading"
              ? "Loading result image…"
              : "The result image could not be displayed."}
          </p>
          {status === "failed" && (
            <p>
              {owner
                ? "Retry the image, or inspect the machine and recorded outcome before making a decision."
                : "Retry the image, or ask the owner to inspect the recorded outcome."}
            </p>
          )}
          {(status === "failed" || attempt > 0) && (
            <button
              ref={retryButton}
              type="button"
              className="text-button"
              aria-disabled={status === "loading"}
              onClick={() => {
                if (status === "loading") return;
                setStatus("loading");
                setRetryKey(crypto.randomUUID());
                setAttempt((value) => value + 1);
              }}
            >
              Retry result image
            </button>
          )}
        </div>
      )}
    </div>
  );
}
