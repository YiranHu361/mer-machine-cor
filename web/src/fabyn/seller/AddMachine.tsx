import { useState, type FormEvent } from "react";
import { api, ApiError } from "../../api";
import type { Dashboard } from "./data";

type Identification = { status: "supported" | "unsupported" | "unclear"; model?: string; modelName?: string; message: string };
type IssuedCode = { setupCode: { id: string; code: string; expiresAt: string; machineId: string }; command: string; platformUrl: string };

const MODELS = [
  { value: "phomemo-m02pro", label: "Phomemo M02 Pro · sticker printer" },
  { value: "instax-mini-link-3", label: "Instax mini Link 3 · photo printer" },
  { value: "bambu-a1-mini", label: "Bambu Lab A1 mini · 3D printer" },
];

export function AddMachine({ dash, act, busy }: { dash: Dashboard; act: (key: string, run: () => Promise<unknown>, done?: string) => Promise<boolean>; busy: string }) {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [identified, setIdentified] = useState<Identification | null>(null);
  const [identifyError, setIdentifyError] = useState("");
  const [model, setModel] = useState(MODELS[0].value);
  const [mode, setMode] = useState<"simulation" | "hardware">("simulation");
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [copied, setCopied] = useState(false);

  const identify = async (event: FormEvent) => {
    event.preventDefault();
    setIdentifyError("");
    const body = new FormData();
    body.set("description", text);
    if (photo) body.set("photo", photo);
    setIdentified(null);
    try {
      const result = await api<{ identification: Identification }>("/owner/machine-identification", body);
      setIdentified(result.identification);
      if (result.identification.model) setModel(result.identification.model);
    } catch (e) {
      setIdentifyError(e instanceof ApiError ? e.message : "The machine could not be identified right now.");
    }
  };

  const createCode = async () => {
    await act(
      "setup-code",
      async () => {
        const result = await api<IssuedCode>("/owner/setup-codes", { model, mode });
        setIssued(result);
        setCopied(false);
      },
      "Setup code ready. Run the command on the computer the machine is connected to.",
    );
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const pending = dash.setupCodes.filter((c) => !c.usedAt && Date.parse(c.expiresAt) > Date.now());

  return (
    <section aria-labelledby="sl-add-title" className="sl-add">
      <p className="sl-kicker">add a machine</p>
      <h2 id="sl-add-title" className="sl-h2">Connect a machine you own.</h2>
      <p className="sl-lede">
        Works for one idle printer or a whole floor of them. Tell us what it is, get a one-time code, and run one command where the machine is.
      </p>

      <div className="sl-two">
        <form className="sl-panel sl-form" onSubmit={identify}>
          <h3 className="sl-h3">1 · What is it?</h3>
          <div className="sl-field">
            <label className="sl-label" htmlFor="sl-describe">
              Make and model
            </label>
            <input id="sl-describe" className="sl-input" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="for example, Bambu Lab A1 mini" />
          </div>
          <div className="sl-field">
            <label className="sl-label" htmlFor="sl-photo">
              Or a photo of its label
            </label>
            <input
              id="sl-photo"
              className="sl-input sl-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setPhoto(e.currentTarget.files?.[0] ?? null)}
            />
          </div>
          <div className="sl-actions">
            <button className="sl-btn" type="submit" disabled={(!text.trim() && !photo) || Boolean(busy)}>
              Identify
            </button>
          </div>
          {identifyError && (
            <p className="sl-error" role="alert">
              {identifyError}
            </p>
          )}
          {identified && (
            <p className={`sl-note ${identified.status}`} role="status">
              {identified.status === "supported"
                ? `Identified as ${identified.modelName ?? identified.model}. It is selected in step 2.`
                : identified.status === "unsupported"
                  ? "We do not support that machine yet. Supported today: Phomemo M02 Pro, Instax mini Link 3 and Bambu Lab A1 mini."
                  : identified.message}
            </p>
          )}
        </form>

        <form
          className="sl-panel sl-form"
          onSubmit={(e) => {
            e.preventDefault();
            void createCode();
          }}
        >
          <h3 className="sl-h3">2 · Get a setup code</h3>
          <div className="sl-field">
            <label className="sl-label" htmlFor="sl-model">
              Machine
            </label>
            <select id="sl-model" className="sl-input" value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="sl-radios">
            <legend className="sl-label">How it connects</legend>
            <label>
              <input type="radio" name="sl-mode" checked={mode === "simulation"} onChange={() => setMode("simulation")} />
              <span>
                On this computer <small>no hardware needed; the workshop node runs it</small>
              </span>
            </label>
            <label>
              <input type="radio" name="sl-mode" checked={mode === "hardware"} onChange={() => setMode("hardware")} />
              <span>
                Connected machine <small>runs through a connector on its computer</small>
              </span>
            </label>
          </fieldset>
          <div className="sl-actions">
            <button className="sl-btn solid" type="submit" disabled={Boolean(busy)}>
              {busy === "setup-code" ? "Making code…" : "Make a setup code"}
            </button>
          </div>
          {issued && (
            <div className="sl-code" aria-live="polite">
              <p className="sl-label">Your one-time code</p>
              <p className="sl-code-value" aria-label={`Setup code ${issued.setupCode.code.split("").join(" ")}`}>
                {issued.setupCode.code}
              </p>
              <p className="sl-fine">Expires {new Date(issued.setupCode.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Using it again stops working.</p>
              <p className="sl-label">Run this on the machine’s computer</p>
              <pre className="sl-command">
                <code>{issued.command}</code>
              </pre>
              <div className="sl-actions">
                <button className="sl-btn" type="button" onClick={() => void copy(issued.command)}>
                  {copied ? "Copied" : "Copy command"}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>

      {pending.length > 0 && (
        <div className="sl-panel">
          <h3 className="sl-h3">Codes waiting to be used</h3>
          <ul className="sl-plain">
            {pending.map((c) => (
              <li key={c.id}>
                {c.machineId} · expires {new Date(c.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
