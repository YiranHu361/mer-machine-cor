// The maker side of fabyn: sign in with the workshop access code, see the
// machines, their queues and the owner actions. Data comes from the owner API
// and refreshes from the server's change events plus a short poll.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import { go, ROUTES } from "../shared/nav";
import { SignIn } from "./SignIn";
import { Overview } from "./Overview";
import { Machines } from "./Machines";
import { AddMachine } from "./AddMachine";
import { MAKER, type Dashboard } from "./data";
import { needsMaker } from "./status";
import type { Act } from "./JobActions";
import "./seller.css";

type Tab = "overview" | "machines" | "add";
type Session = "checking" | "signed-out" | "owner";
type Notice = { tone: "ok" | "error"; text: string } | null;

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "machines", label: "Machines" },
  { id: "add", label: "Add a machine" },
];

export default function SellerApp() {
  const [session, setSession] = useState<Session>("checking");
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [live, setLive] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [signInNote, setSignInNote] = useState("");
  const revision = useRef(-1);
  const mounted = useRef(true);

  const signOut = useCallback(
    async (message = "") => {
      setDash(null);
      setSession("signed-out");
      setSignInNote(message);
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      const next = await api<Dashboard>("/owner/dashboard");
      if (!mounted.current) return true;
      // Ignore a response older than one already shown (a slow poll can land late).
      if (next.revision >= revision.current) {
        revision.current = next.revision;
        setDash(next);
      }
      setLive(true);
      return true;
    } catch (error) {
      if (!mounted.current) return false;
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        void signOut("Your workshop session ended. Enter the access code to open it again.");
        return false;
      }
      setLive(false);
      return false;
    }
  }, [signOut]);

  // Session check on load.
  useEffect(() => {
    mounted.current = true;
    api<{ role: string | null }>("/session", undefined, "GET")
      .then((s) => {
        if (!mounted.current) return;
        if (s.role === "owner") setSession("owner");
        else setSession("signed-out");
      })
      .catch(() => {
        if (mounted.current) setSession("signed-out");
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  // Data: on sign-in, then on server change events, with a poll as backup.
  useEffect(() => {
    if (session !== "owner") return;
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    let source: EventSource | undefined;
    try {
      source = new EventSource("/api/events");
      source.addEventListener("refresh", () => void refresh());
      source.onopen = () => setLive(true);
      source.onerror = () => setLive(false);
    } catch {
      setLive(false);
    }
    return () => {
      clearInterval(timer);
      source?.close();
    };
  }, [session, refresh]);

  // One clock for every countdown and progress estimate.
  useEffect(() => {
    if (session !== "owner") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session]);

  const act: Act = async (key, run, done) => {
    setBusy(key);
    setNotice(null);
    try {
      await run();
      await refresh();
      if (done) setNotice({ tone: "ok", text: done });
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "That did not go through. Refresh and try again." });
      await refresh();
      return false;
    } finally {
      setBusy("");
    }
  };

  const endSession = async () => {
    try {
      await api("/session", undefined, "DELETE");
    } catch {
      // The screen still closes; the cookie expires on its own.
    }
    setDash(null);
    setSession("signed-out");
    setSignInNote("You signed out of the workshop.");
  };

  if (session === "checking")
    return (
      <main className="sl-page">
        <p className="sl-fine" role="status">
          Opening the workshop…
        </p>
      </main>
    );
  if (session === "signed-out")
    return (
      <div className="sl-page">
        <Header onHome={() => go(ROUTES.home)} />
        <SignIn
          notice={signInNote}
          onSignedIn={() => {
            setSignInNote("");
            setSession("owner");
          }}
        />
      </div>
    );

  const attention = dash ? dash.jobs.filter(needsMaker).length + dash.machines.filter((m) => !m.calibrated).length : 0;
  return (
    <div className="sl-page">
      <Header onHome={() => go(ROUTES.home)} onSignOut={endSession} />
      <nav className="sl-tabs" aria-label="Maker sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className="sl-tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "machines" && attention > 0 && <span className="sl-badge" aria-label={`${attention} need you`}>{attention}</span>}
          </button>
        ))}
      </nav>
      <div className="sl-status" aria-live="polite">
        <span className={`sl-live ${live ? "on" : ""}`}>{live ? "live" : "reconnecting"}</span>
        {busy && <span className="sl-fine">Saving…</span>}
      </div>
      {notice && (
        <p className={`sl-notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      )}
      <main className="sl-main">
        {!dash ? (
          <p className="sl-fine" role="status">
            Loading the workshop…
          </p>
        ) : tab === "overview" ? (
          <Overview dash={dash} onGo={(t) => setTab(t)} />
        ) : tab === "machines" ? (
          <>
            <header className="sl-section-head">
              <p className="sl-kicker">machines · {MAKER.place}</p>
              <h2 className="sl-h2">Each machine, its queue, and what it needs from you.</h2>
              <p className="sl-lede">Orders that fit a machine land in its queue. Progress and times are estimates until the machines report their own.</p>
            </header>
            <Machines machines={dash.machines} jobs={dash.jobs} connectors={dash.connectors} busy={busy} act={act} now={now} />
          </>
        ) : (
          <AddMachine dash={dash} act={act} busy={busy} />
        )}
      </main>
    </div>
  );
}

function Header({ onHome, onSignOut }: { onHome: () => void; onSignOut?: () => void }) {
  return (
    <header className="sl-top">
      <button type="button" className="sl-brand" onClick={onHome} aria-label="fabyn home">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <clipPath id="sl-mark">
              <circle cx="12" cy="12" r="11" />
            </clipPath>
          </defs>
          <g clipPath="url(#sl-mark)" style={{ fill: "var(--acc)" }}>
            <rect x="0" y="8.4" width="24" height="2.1" rx="1" />
            <rect x="0" y="11.5" width="24" height="2.1" rx="1" />
            <rect x="0" y="14.6" width="24" height="2.1" rx="1" />
            <rect x="0" y="17.7" width="24" height="2.1" rx="1" />
            <rect x="0" y="20.8" width="24" height="2.1" rx="1" />
          </g>
          <circle cx="12" cy="12" r="11" style={{ fill: "none", stroke: "var(--acc)", strokeOpacity: 0.5, strokeWidth: 0.8 }} />
        </svg>
        fabyn
      </button>
      <p className="sl-who">
        <span>maker</span> {MAKER.name}
      </p>
      {onSignOut && (
        <button type="button" className="sl-btn ghost sl-signout" onClick={() => void onSignOut()}>
          Sign out
        </button>
      )}
    </header>
  );
}
