// The fabyn homepage: the hero scene (heroScene.ts) with the overlay UI from fabyn-reference/hero.html.
import { useEffect, useRef, useState } from "react";
import { go, ROUTES } from "../shared/nav";
import { mountHeroScene } from "./heroScene";
import "./home.css";

type Role = "consumer" | "seller";

function Mark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <clipPath id="fb-mark">
          <circle cx="12" cy="12" r="11" />
        </clipPath>
      </defs>
      <g clipPath="url(#fb-mark)" style={{ fill: "var(--acc)" }}>
        <rect x="0" y="8.4" width="24" height="2.1" rx="1" />
        <rect x="0" y="11.5" width="24" height="2.1" rx="1" />
        <rect x="0" y="14.6" width="24" height="2.1" rx="1" />
        <rect x="0" y="17.7" width="24" height="2.1" rx="1" />
        <rect x="0" y="20.8" width="24" height="2.1" rx="1" />
      </g>
      <circle cx="12" cy="12" r="11" style={{ fill: "none", stroke: "var(--acc)", strokeOpacity: 0.5, strokeWidth: 0.8 }} />
    </svg>
  );
}

function Chooser({ onClose }: { onClose: () => void }) {
  const [role, setRole] = useState<Role>("consumer");
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose]);
  const cards: { role: Role; title: string; line: string; detail: string }[] = [
    { role: "consumer", title: "consumer", line: "order something made nearby", detail: "Type what you want, or start from a name. Pick a design from previews, then follow it to the machine." },
    { role: "seller", title: "seller / maker", line: "put idle machines or a whole factory to work", detail: "One person with an idle printer, or a factory with spare capacity. See the queue on each machine and act on it." },
  ];
  return (
    <div className="hm-chooser-scrim" onClick={onClose}>
      <div className="hm-chooser" role="dialog" aria-modal="true" aria-labelledby="hm-chooser-title" onClick={(e) => e.stopPropagation()}>
        <p className="hm-kicker">start demo</p>
        <h2 id="hm-chooser-title" className="hm-chooser-title">Who are you today?</h2>
        <div className="hm-cards" role="radiogroup" aria-label="Choose a side">
          {cards.map((c, i) => (
            <button
              key={c.role}
              ref={i === 0 ? first : undefined}
              type="button"
              role="radio"
              aria-checked={role === c.role}
              className={`hm-card${role === c.role ? " on" : ""}`}
              onClick={() => setRole(c.role)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  setRole(role === "consumer" ? "seller" : "consumer");
                }
              }}
            >
              <span className="hm-card-tag">{c.role === "consumer" ? "01 · default" : "02"}</span>
              <b>{c.title}</b>
              <span className="hm-card-line">{c.line}</span>
              <small>{c.detail}</small>
            </button>
          ))}
        </div>
        <div className="hm-chooser-actions">
          <button type="button" className="hm-btn ghost" onClick={onClose}>
            back
          </button>
          <button
            type="button"
            className="hm-btn solid"
            onClick={() => go(role === "consumer" ? ROUTES.order : ROUTES.seller)}
          >
            continue as {role === "consumer" ? "consumer" : "seller"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!rootRef.current || !stageRef.current) return;
    try {
      return mountHeroScene(rootRef.current, stageRef.current);
    } catch (error) {
      console.error("The homepage scene could not start", error);
      return undefined;
    }
  }, []);

  return (
    <div className="hm-root" ref={rootRef}>
      <div className="hm-stage" ref={stageRef} />
      <div className="hm-ui">
        <nav className="hm-nav" aria-label="fabyn">
          <div className="hm-word">
            <i className="hm-wm">
              <Mark />
              fabyn
            </i>
            <span>spare machines, made nearby</span>
          </div>
          <div className="hm-item">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <rect x="7" y="17" width="26" height="18" />
              <rect x="5" y="12" width="30" height="5" />
              <path d="M20 12V35" />
              <path d="M20 12C15 5 9 7 12 12M20 12C25 5 31 7 28 12" />
            </svg>
            <div>
              <b>gift</b>
              <small>
                send one
                <br />
                track it
                <br />
                pick it up
              </small>
            </div>
          </div>
          <div className="hm-item">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <path d="M4 34L20 7L36 34Z" />
              <path d="M20 7L15 34M20 7L25 34" />
              <path d="M1 34H39" />
            </svg>
            <div>
              <b>relief</b>
              <small>
                supplies
                <br />
                outage
                <br />
                re-plan
              </small>
            </div>
          </div>
          <div className="hm-item">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <rect x="6" y="15" width="28" height="15" rx="2" />
              <path d="M12 15V6H28V15" />
              <path d="M12 30V36H28V30" />
              <circle cx="29" cy="21" r="1.2" />
            </svg>
            <div>
              <b>machines</b>
              <small>
                add yours
                <br />
                owner view
                <br />
                payouts
              </small>
            </div>
          </div>
          <div className="hm-item">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <path d="M4 10L14 6L26 10L36 6V30L26 34L14 30L4 34Z" />
              <path d="M14 6V30M26 10V34" />
            </svg>
            <div>
              <b>network</b>
              <small>
                live map
                <br />
                ledger
              </small>
            </div>
          </div>
          <div className="hm-micro">
            <b>153</b> machines online
            <br />
            <b>10</b> kinds of making
            <br />
            <b data-shipped>1,284</b> things shipped
            <br />
            demo payment
          </div>
        </nav>
        <div className="hm-scenes" aria-hidden="true">
          <span data-scene>01 machines</span>
          <span data-scene>02 network</span>
          <span data-scene>03 shipping</span>
          <i data-scene-bar />
        </div>
        <div className="hm-cta">
          <div className="hm-h">MADE NEARBY!</div>
          <div className="hm-sub">spare machines near the people you love make the gift. you just send the message.</div>
          <button type="button" className="hm-btn" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
            START DEMO
          </button>
        </div>
        <div className="hm-labels" data-labels aria-hidden="true" />
      </div>
      {open && <Chooser onClose={close} />}
    </div>
  );
}
