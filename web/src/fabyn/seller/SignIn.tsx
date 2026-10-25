import { useState, type FormEvent } from "react";
import { api, ApiError } from "../../api";
import { MAKER } from "./data";

export function SignIn({ onSignedIn, notice }: { onSignedIn: () => void; notice?: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api("/session", { role: "owner", accessCode: code });
      setCode("");
      onSignedIn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The workshop could not be reached. Check the local service and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="sl-signin">
      <div className="sl-signin-card">
        <p className="sl-kicker">maker side</p>
        <h1 className="sl-title">Put your machines to work.</h1>
        <p className="sl-lede">
          Makers can be one person with an idle printer, or a factory with spare capacity. Connect a machine, check each print,
          and fabyn sends it orders from people nearby.
        </p>
        <form className="sl-form" onSubmit={submit} noValidate>
          <div className="sl-field">
            <span className="sl-label" id="sl-maker-label">Maker</span>
            <p className="sl-maker" aria-labelledby="sl-maker-label">
              {MAKER.name} · {MAKER.place}
            </p>
          </div>
          <div className="sl-field">
            <label htmlFor="sl-code" className="sl-label">
              Access code
            </label>
            <input
              id="sl-code"
              className="sl-input"
              type="password"
              autoComplete="current-password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "sl-code-error" : undefined}
              required
            />
          </div>
          {notice && !error && <p className="sl-note" role="status">{notice}</p>}
          {error && (
            <p className="sl-error" id="sl-code-error" role="alert">
              {error}
            </p>
          )}
          <button className="sl-btn solid" type="submit" disabled={busy || !code.trim()}>
            {busy ? "Opening…" : "Open the workshop"}
          </button>
        </form>
      </div>
    </main>
  );
}
