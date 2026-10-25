import { useEffect, useId, useRef, useState } from "react";
import { describeError, createOrder, ensureSession, newKey, uploadPhotos, type Experience } from "./orders";
import { rememberOrder, type Profile } from "./profile";
import type { OrderView } from "./model";
import { PLACE_SHORT } from "./model";
import { Composer, OptionChips, Say, Thinking, YouMessage, checkPhotos } from "./Chat";
import { conversationEntries, saveThread, youEntry } from "./thread";
import {
  getConversation,
  liveOptions,
  rememberConversation,
  sendMessage,
  settled,
  startConversation,
  type ConversationOption,
  type ConversationReply,
  type ConversationView,
} from "./conversation";

/* The first screen of every visit: a conversation with fabyn. The person can
   ask what the machines make, describe who something is for, and pick one of
   the options fabyn offers; the pick becomes a real order and the thread
   carries on from there. The conversation is kept on the server, so a reload
   of this tab picks it up again. The three-piece gift set skips the
   conversation and orders the set directly, as before. */

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
  resume,
  onCreated,
}: {
  profile: Profile;
  /** the conversation this tab had open before a reload */
  resume: string | null;
  onCreated: (order: OrderView, fresh: boolean) => void;
}) {
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [gift, setGift] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saying, setSaying] = useState("");
  const [error, setError] = useState("");
  const [resuming, setResuming] = useState(!!resume);
  const pickId = `${useId()}-photos`;
  // one key per payload: a retry of the same message is answered once
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  const uploadedRef = useRef<{ files: File[]; ids: string[] } | null>(null);
  const name = keychainName(profile.name);

  /** A reply with an order moves on to the order's thread, which starts with this conversation. */
  const land = (reply: ConversationReply, fresh: boolean) => {
    setConversation(reply.conversation);
    rememberConversation(reply.conversation.id);
    if (!reply.order) return;
    saveThread(reply.order.id, conversationEntries(reply.conversation));
    rememberOrder({ id: reply.order.id, title: reply.order.draft.requestText.split("\n")[0] || "Order", at: reply.order.createdAt });
    onCreated(reply.order, fresh);
  };

  useEffect(() => {
    if (!resume) return;
    let live = true;
    getConversation(resume)
      .then((r) => settled(r))
      .then((r) => live && land(r, false))
      .catch(() => rememberConversation(null))
      .finally(() => live && setResuming(false));
    return () => {
      live = false;
    };
    // the conversation to resume is read once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const orderGiftSet = async (requestText: string, photoAssetIds: string[]) => {
    const experience: Experience = "gift";
    const sig = JSON.stringify({ requestText, photoAssetIds, experience, name: profile.name });
    if (keyRef.current?.sig !== sig) keyRef.current = { sig, key: newKey() };
    const requesterName = profile.name.replace(/[<>]/g, "").trim().slice(0, 40);
    const order = await createOrder({ requestText, photoAssetIds, experience, key: keyRef.current.key, requesterName });
    saveThread(order.id, [youEntry(requestText, photoAssetIds)]);
    rememberOrder({ id: order.id, title: requestText || "Gift set", at: order.createdAt });
    onCreated(order, true);
  };

  const submit = async (choice?: ConversationOption) => {
    const message = choice ? "" : text.trim();
    if (!message && !files.length && !choice) return;
    setError("");
    setBusy(true);
    setSaying(choice ? choice.title : message || "(a photo)");
    try {
      await ensureSession();
      if (files.length && uploadedRef.current?.files !== files) uploadedRef.current = { files, ids: await uploadPhotos(files) };
      const photoAssetIds = files.length ? uploadedRef.current!.ids : [];
      if (gift && !conversation) {
        await orderGiftSet(message, photoAssetIds);
        return;
      }
      const sig = JSON.stringify({ c: conversation?.id ?? null, v: conversation?.version ?? 0, message, photoAssetIds, choice: choice?.id });
      if (keyRef.current?.sig !== sig) keyRef.current = { sig, key: newKey() };
      const requesterName = profile.name.replace(/[<>]/g, "").trim().slice(0, 40);
      const reply = await settled(
        conversation
          ? await sendMessage(conversation, {
              messageId: keyRef.current.key,
              ...(message ? { text: message } : {}),
              ...(choice ? { choiceIds: [choice.id] } : {}),
              ...(photoAssetIds.length ? { photoAssetIds } : {}),
            })
          : await startConversation({ text: message, photoAssetIds, key: keyRef.current.key, requesterName }),
      );
      keyRef.current = null;
      uploadedRef.current = null;
      if (!choice) setText("");
      setFiles([]);
      land(reply, true);
    } catch (e) {
      const d = describeError(e);
      if (["STALE_CONVERSATION", "CONVERSATION_BUSY", "STALE_CHOICE"].includes(d.code) && conversation) {
        keyRef.current = null;
        setError("The conversation moved on while you were typing. Here is the latest; send it again if it still applies.");
        try {
          land(await settled(await getConversation(conversation.id)), true);
        } catch {
          /* the error above already says to try again */
        }
      } else {
        if (!d.unknown) keyRef.current = null;
        setError(
          d.unknown
            ? "We could not tell whether that went through. Press send again to check; it will not be sent twice."
            : d.message,
        );
      }
    } finally {
      setBusy(false);
      setSaying("");
    }
  };

  // a new message or reply scrolls into view
  const lastRef = useRef<HTMLLIElement | null>(null);
  const count = (conversation?.turns.length ?? 0) + (saying ? 1 : 0);
  useEffect(() => {
    if (count) lastRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [count]);

  const turns = conversation?.turns ?? [];
  const pressable = conversation ? liveOptions(conversation) : [];
  const lastAssistant = turns.map((t) => t.role).lastIndexOf("assistant");
  const chips = conversation ? undefined : (
    <>
      <button type="button" className="cs-chip" disabled={busy} onClick={() => setText("I'm looking for a gift for my friend ")}>
        a gift for someone
      </button>
      <button type="button" className="cs-chip" disabled={busy} onClick={() => setText("What can you make right now?")}>
        what can you make?
      </button>
      {name && (
        <button type="button" className="cs-chip" disabled={busy} onClick={() => setText(`A name tag that says "${name}"`)}>
          use my name · <b>{name}</b>
        </button>
      )}
      <label htmlFor={pickId} className={`cs-chip ${busy ? "is-off" : ""}`}>
        print my photo
      </label>
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
      <ol className="cs-thread" aria-label="Your conversation with fabyn" aria-busy={busy || resuming || undefined}>
        <li className="cs-msg is-fabyn">
          <Say>
            Hi {profile.name}. Tell me what you'd like made, or who it's for and what they love: I know what the machines
            nearby can make right now and I'll suggest something. Ask me anything along the way. Nothing is ordered until you
            confirm the price.
          </Say>
        </li>
        {turns.map((t, i) => {
          const ref = i === turns.length - 1 && !saying ? lastRef : undefined;
          if (t.role === "user")
            return (
              <li key={t.id} ref={ref} className="cs-msg is-you">
                <YouMessage text={t.text} photos={t.photoAssetIds} />
              </li>
            );
          return (
            <li key={t.id} ref={ref} className="cs-msg is-fabyn is-said">
              <Say>{t.text}</Say>
              {i === lastAssistant && pressable.length > 0 ? (
                <OptionChips options={pressable} busy={busy} onPick={(o) => void submit(o)} />
              ) : (
                t.options && t.options.length > 0 && <div className="cs-fold">{t.options.map((o) => o.title).join(" · ")}</div>
              )}
            </li>
          );
        })}
        {saying && (
          <>
            <li className="cs-msg is-you">
              <YouMessage text={saying} />
            </li>
            <li ref={lastRef} className="cs-msg is-fabyn">
              <Thinking />
            </li>
          </>
        )}
        {resuming && !conversation && (
          <li className="cs-msg is-fabyn">
            <Thinking label="picking up where you left off" />
          </li>
        )}
      </ol>
      <Composer
        big={!conversation}
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
        placeholder={conversation ? "Reply to fabyn, ask a question, or pick an option above" : "a gift for my friend who loves cats…"}
        label={conversation ? "Message fabyn" : "What do you want made?"}
        canSend={!!text.trim() || files.length > 0}
        busy={busy}
        chips={chips}
        error={error}
        fileInputId={pickId}
        sendLabel={gift && !conversation ? "make the gift set" : "send"}
      />
      <p className="cs-fine cs-chat-fine">
        Made on a spare machine near you, at the {PLACE_SHORT}. Nothing is ordered until you confirm.
      </p>
    </section>
  );
}
