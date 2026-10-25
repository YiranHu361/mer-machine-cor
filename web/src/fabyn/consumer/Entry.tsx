import { useEffect, useMemo, useRef, useState } from "react";
import { describeError, createOrder, ensureSession, newKey, uploadPhotos, type Experience } from "./orders";
import { rememberOrder, type Profile } from "./profile";
import type { OrderView } from "./model";
import { PLACE_SHORT } from "./model";

/* The first screen of every visit: one big box, three ways in. Nothing here is
   restored from earlier visits; each submit creates a real order. */

type Mode = "describe" | "name" | "photos";
const MAX_PHOTOS = 4;
const MAX_BYTES = 12 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Keychain text the printer accepts: up to 10 capitals, digits or simple marks. */
export function keychainName(raw: string) {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10)
    .trim();
}

export function Entry({
  profile,
  onCreated,
}: {
  profile: Profile;
  onCreated: (order: OrderView) => void;
}) {
  const [mode, setMode] = useState<Mode>("describe");
  const [text, setText] = useState("");
  const [name, setName] = useState(profile.name);
  const [gift, setGift] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // one Idempotency-Key per payload: a retry of the same request replays the same order
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  const uploadedRef = useRef<string[] | null>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const cleanName = keychainName(name);
  const canSubmit =
    !busy &&
    (mode === "describe"
      ? text.trim().length > 0 && text.trim().length <= 2000
      : mode === "name"
        ? cleanName.length > 0
        : files.length > 0 && files.length <= MAX_PHOTOS);

  const pickFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    setError("");
    uploadedRef.current = null;
    if (picked.length > MAX_PHOTOS) {
      setError(`Choose up to ${MAX_PHOTOS} photos.`);
      setFiles(picked.slice(0, MAX_PHOTOS));
      return;
    }
    const bad = picked.find((f) => !TYPES.includes(f.type) || f.size > MAX_BYTES);
    if (bad) setError(`${bad.name}: use a PNG, JPEG or WebP under 12 MB.`);
    setFiles(picked);
  };

  const submit = async () => {
    setError("");
    setBusy("start");
    const experience: Experience = mode === "describe" && gift ? "gift" : "best_single";
    try {
      await ensureSession();
      let requestText = "";
      let photoAssetIds: string[] = [];
      if (mode === "describe") requestText = text.trim();
      if (mode === "name") {
        requestText = `a keychain that says "${cleanName}"`;
      }
      if (mode === "photos") {
        requestText = text.trim();
        if (!uploadedRef.current) uploadedRef.current = await uploadPhotos(files);
        photoAssetIds = uploadedRef.current;
      }
      const sig = JSON.stringify({ requestText, photoAssetIds, experience });
      if (keyRef.current?.sig !== sig) keyRef.current = { sig, key: newKey() };
      const order = await createOrder({ requestText, photoAssetIds, experience, key: keyRef.current.key });
      keyRef.current = null;
      uploadedRef.current = null;
      rememberOrder({ id: order.id, title: requestText || "Photo print", at: order.createdAt });
      onCreated(order);
    } catch (e) {
      const d = describeError(e);
      if (!d.unknown) keyRef.current = null;
      setError(
        d.unknown
          ? "We could not tell whether the order went through. Press the button again to check; it will not make a second order."
          : d.message,
      );
    } finally {
      setBusy("");
    }
  };

  const placeholder =
    mode === "describe"
      ? "type anything you want made"
      : mode === "name"
        ? "your name"
        : "add a note (optional)";
  const label = mode === "describe" ? "What do you want made?" : mode === "name" ? "Your name" : "Note for the photo (optional)";
  const submitLabel =
    mode === "describe"
      ? gift
        ? "make a three-piece gift"
        : "make it"
      : mode === "name"
        ? "make my keychain"
        : "make it from my photos";

  return (
    <section className="cs-entry" aria-labelledby="cs-entry-title">
      <p className="cs-kicker">start an order · {PLACE_SHORT.toLowerCase()}</p>
      <h1 id="cs-entry-title" className="cs-title">
        make something nearby
      </h1>
      <form
        className="cs-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        <label htmlFor="cs-input" className="cs-visually-hidden">
          {label}
        </label>
        <input
          id="cs-input"
          className="cs-big-input"
          value={mode === "name" ? name : text}
          onChange={(e) => (mode === "name" ? setName(e.target.value) : setText(e.target.value))}
          placeholder={placeholder}
          maxLength={mode === "name" ? 24 : 2000}
          autoComplete={mode === "name" ? "given-name" : "off"}
          disabled={!!busy}
          aria-describedby="cs-entry-hint"
        />
        {mode === "name" && (
          <p id="cs-entry-hint" className="cs-hint">
            Up to 10 letters, printed on the keychain as <b>{cleanName || "YOUR NAME"}</b>.
          </p>
        )}
        {mode === "photos" && (
          <div className="cs-photos">
            <label className="cs-drop">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(e) => pickFiles(e.target.files)}
                disabled={!!busy}
              />
              <span>{files.length ? "choose different photos" : "choose 1 to 4 photos"}</span>
              <small>PNG, JPEG or WebP · up to 12 MB each</small>
            </label>
            {previews.length > 0 && (
              <ul className="cs-thumbs" aria-label="Chosen photos">
                {previews.map((src, i) => (
                  <li key={src}>
                    <img src={src} alt={`photo ${i + 1}: ${files[i]?.name ?? ""}`} />
                    <button
                      type="button"
                      className="cs-link"
                      onClick={() => {
                        uploadedRef.current = null;
                        setFiles(files.filter((_, j) => j !== i));
                      }}
                      disabled={!!busy}
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {mode === "describe" && (
          <label className="cs-gift">
            <input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} disabled={!!busy} />
            make it a three-piece gift set
          </label>
        )}
        <button className="cs-btn cs-btn-main" type="submit" disabled={!canSubmit} aria-busy={busy === "start" || undefined}>
          {busy ? "starting…" : submitLabel}
        </button>
      </form>

      <div className="cs-paths" role="group" aria-label="Other ways to start">
        <button
          type="button"
          className={`cs-path ${mode === "name" ? "is-on" : ""}`}
          aria-pressed={mode === "name"}
          onClick={() => {
            setError("");
            setMode("name");
          }}
        >
          <span className="cs-path-n">1</span>
          <span>
            don&apos;t know? <b>use your name</b>
          </span>
          <em>suggested</em>
        </button>
        <button
          type="button"
          className={`cs-path ${mode === "photos" ? "is-on" : ""}`}
          aria-pressed={mode === "photos"}
          onClick={() => {
            setError("");
            setMode("photos");
          }}
        >
          <span className="cs-path-n">2</span>
          <span>
            <b>print your own</b> photo
          </span>
        </button>
        <button
          type="button"
          className={`cs-path ${mode === "describe" ? "is-on" : ""}`}
          aria-pressed={mode === "describe"}
          onClick={() => {
            setError("");
            setMode("describe");
          }}
        >
          <span className="cs-path-n">3</span>
          <span>
            <b>describe it</b> and pick a design
          </span>
        </button>
      </div>
      {error && (
        <p role="alert" className="cs-error">
          {error}
        </p>
      )}
      <p className="cs-fine">
        Made at {PLACE_SHORT} by spare machines nearby. Demo payment: no funds move.
      </p>
    </section>
  );
}
