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

/** Keychain text the printer accepts (Lucas's name-tag rule): up to 16 letters,
   digits, spaces or simple marks, with at least one letter or digit. Case is kept. */
const NAME_CHARS = /[^A-Za-z0-9À-ÖØ-öø-ÿ .,'&!?+-]/g;
export const NAME_RULE = /^[A-Za-z0-9À-ÖØ-öø-ÿ .,'&!?+-]{1,16}$/;
export function keychainName(raw: string) {
  const clean = raw.replace(NAME_CHARS, "").replace(/\s+/g, " ").trim().slice(0, 16).trim();
  return NAME_RULE.test(clean) && /[A-Za-z0-9À-ÖØ-öø-ÿ]/.test(clean) ? clean : "";
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
        requestText = `A keychain that says "${cleanName}"`;
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
      ? "a sticker of a cat, a name keychain…"
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
      <p className="cs-kicker">start an order · san francisco</p>
      <h1 id="cs-entry-title" className="cs-title">
        Tell us what you want to build today
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
          maxLength={mode === "name" ? 16 : 2000}
          autoComplete={mode === "name" ? "given-name" : "off"}
          disabled={!!busy}
          aria-describedby="cs-entry-hint"
        />
        {mode === "name" && (
          <p id="cs-entry-hint" className="cs-hint">
            Up to 16 letters, printed on the keychain exactly as <b>{cleanName || "Your name"}</b>.
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
            not sure? <b>use your name</b>
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
            <b>print your own photo</b>
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
            <b>describe it</b>, pick a design
          </span>
        </button>
      </div>
      {error && (
        <p role="alert" className="cs-error">
          {error}
        </p>
      )}
      <p className="cs-fine">
        Made on a spare machine near you, at the {PLACE_SHORT}. Nothing is ordered until you confirm.
      </p>
    </section>
  );
}
