import { useId, useRef, useState } from "react";
import { describeError, createOrder, ensureSession, newKey, uploadPhotos, type Experience } from "./orders";
import { rememberOrder, type Profile } from "./profile";
import type { OrderView } from "./model";
import { PLACE_SHORT } from "./model";
import { Composer, Mark, checkPhotos } from "./Chat";
import { saveThread, youEntry } from "./thread";

/* The first screen of every visit: one chat box. Text, a name or photos all go
   in the same box; the first message creates a real order and the thread
   carries on from there. Nothing here is restored from earlier visits. */

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
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [gift, setGift] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pickId = `${useId()}-photos`;
  // one Idempotency-Key per payload: a retry of the same request replays the same order
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  const uploadedRef = useRef<{ files: File[]; ids: string[] } | null>(null);
  const name = keychainName(profile.name);

  const submit = async () => {
    const requestText = text.trim();
    if (!requestText && !files.length) return;
    setError("");
    setBusy(true);
    const experience: Experience = gift ? "gift" : "best_single";
    try {
      await ensureSession();
      if (files.length && uploadedRef.current?.files !== files) uploadedRef.current = { files, ids: await uploadPhotos(files) };
      const photoAssetIds = files.length ? uploadedRef.current!.ids : [];
      const sig = JSON.stringify({ requestText, photoAssetIds, experience, name: profile.name });
      if (keyRef.current?.sig !== sig) keyRef.current = { sig, key: newKey() };
      const requesterName = profile.name.replace(/[<>]/g, "").trim().slice(0, 40);
      const order = await createOrder({ requestText, photoAssetIds, experience, key: keyRef.current.key, requesterName });
      keyRef.current = null;
      uploadedRef.current = null;
      saveThread(order.id, [youEntry(requestText, photoAssetIds)]);
      rememberOrder({ id: order.id, title: requestText || "Photo print", at: order.createdAt });
      onCreated(order);
    } catch (e) {
      const d = describeError(e);
      if (!d.unknown) keyRef.current = null;
      setError(
        d.unknown
          ? "We could not tell whether the order went through. Press send again to check; it will not make a second order."
          : d.message,
      );
    } finally {
      setBusy(false);
    }
  };

  const chips = (
    <>
      {name && (
        <button type="button" className="cs-chip" disabled={busy} onClick={() => setText(`A keychain that says "${name}"`)}>
          use my name · <b>{name}</b>
        </button>
      )}
      <label htmlFor={pickId} className={`cs-chip ${busy ? "is-off" : ""}`}>
        print my photo
      </label>
      <button type="button" className="cs-chip" disabled={busy} onClick={() => setText(`a keychain that says "${name || "Henry"}", a cat sticker and a print of this photo`)}>
        a few things at once
      </button>
      <button type="button" className={`cs-chip ${gift ? "is-on" : ""}`} aria-pressed={gift} disabled={busy} onClick={() => setGift((g) => !g)}>
        three-piece gift set
      </button>
    </>
  );

  return (
    <section className="cs-chat cs-chat-new" aria-labelledby="cs-entry-title">
      <header className="cs-chat-head">
        <p className="cs-kicker">start an order · san francisco</p>
        <h1 id="cs-entry-title" className="cs-title">
          Tell us what you want to build today
        </h1>
      </header>
      <ol className="cs-thread" aria-label="Your conversation with fabyn">
        <li className="cs-msg is-fabyn">
          <p className="cs-say">
            <Mark className="cs-say-mark" />
            <span>
              Hi {profile.name}. Tell me what you want made: a sticker, a keychain with your name, a print of a photo, or a few
              things at once. I&apos;ll find the machines nearby and show you drafts. Nothing is ordered until you confirm.
            </span>
          </p>
        </li>
      </ol>
      <Composer
        big
        value={text}
        onChange={setText}
        files={files}
        onFiles={(picked) => {
          const c = checkPhotos(picked, files.length);
          setError(c.error);
          uploadedRef.current = null;
          setFiles([...files, ...c.files]);
        }}
        onSend={() => void submit()}
        placeholder="a sticker of a cat, a name keychain…"
        label="What do you want made?"
        canSend={!!text.trim() || files.length > 0}
        busy={busy}
        chips={chips}
        error={error}
        fileInputId={pickId}
        sendLabel={gift ? "make the gift set" : "send"}
      />
      <p className="cs-fine cs-chat-fine">
        Made on a spare machine near you, at the {PLACE_SHORT}. Nothing is ordered until you confirm.
      </p>
    </section>
  );
}
