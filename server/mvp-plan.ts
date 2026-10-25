// What a real-machine run starts on the producer side. Shared by `npm run mvp`
// (scripts/mvp.mjs, run by Node's own type stripping) and the seller page's
// Connections panel (server/mvp-setup.ts), so both start the same programs.
// Only erasable TypeScript here: no enums, namespaces or parameter properties.

/** The producer side's folder and its Python, relative to the repository root. */
export const PRODUCER_DIR = "producer-side";
export const PRODUCER_PYTHON = "producer-side/.venv/bin/python";

export interface PrinterPair {
  /** Our machine id in the app, e.g. phomemo_01. */
  ours: string;
  /** The producer side's machine id, e.g. m_sticker_01 (node/machines/<id>.json). */
  theirs: string;
  name: string;
  link: "ble" | "lan";
  threeD: boolean;
}

export function printerPairs(env: NodeJS.ProcessEnv = process.env): PrinterPair[] {
  return [
    {
      ours: env.FABYN_MVP_MACHINE ?? "phomemo_01",
      theirs: env.FABYN_MVP_PRODUCER_MACHINE ?? "m_sticker_01",
      name: "Phomemo M02 Pro",
      link: "ble",
      threeD: false,
    },
    { ours: "instax_01", theirs: "m_photo_01", name: "instax mini Link 3", link: "ble", threeD: false },
    {
      ours: env.FABYN_MVP_3D_MACHINE ?? "bambu_01",
      theirs: env.FABYN_MVP_3D_PRODUCER_MACHINE ?? "m_fdm_01",
      name: "Bambu Lab A1 mini",
      link: "lan",
      threeD: true,
    },
  ];
}

export function producerHubUrl(env: NodeJS.ProcessEnv = process.env) {
  return (env.FABYN_PRODUCER_HUB_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
}

/** The hub, run from producer-side/ with its Python. Loopback only. */
export function hubArgs(hub: string) {
  return ["-m", "hub.dev_server", "--host", "127.0.0.1", "--port", new URL(hub).port || "8000"];
}

/**
 * One printer's program, run from producer-side/. --probe connects to the
 * printer once (printing nothing) before going online; a dry run writes the
 * printer bytes under producer-side/.work/ instead.
 */
export function nodeArgs(theirs: string, hub: string, options: { dryRun?: boolean; plateCleared?: boolean } = {}) {
  return [
    "-m",
    "node.client",
    "--machine",
    `node/machines/${theirs}.json`,
    "--hub",
    hub,
    ...(options.dryRun ? ["--transport", "file"] : ["--probe"]),
    ...(options.plateCleared ? ["--plate-cleared"] : []),
  ];
}
