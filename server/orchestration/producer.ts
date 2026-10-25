import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonical } from "../model.ts";

/** Runs one producer CLI request: JSON in, JSON out, no device access. */
export type ProducerRunner = (request: object) => Promise<any>;

export function cliRunner(projectDir = resolve("node")): ProducerRunner {
  return (request) =>
    new Promise((ok, fail) => {
      const child = spawn(
        "uv",
        ["run", "--project", projectDir, "fabyn-producer"],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let out = "",
        err = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        fail(new Error("PRODUCER_TIMEOUT: preparation took longer than 60 s"));
      }, 60_000);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        fail(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0)
          return fail(
            new Error(`PRODUCER_FAILED: ${err.trim().slice(0, 300) || code}`),
          );
        try {
          ok(JSON.parse(out));
        } catch {
          fail(new Error("PRODUCER_FAILED: unreadable reply"));
        }
      });
      child.stdin.end(JSON.stringify(request));
    });
}
/** The canonical hash the producer checks against the design it receives. */
export function designDigest(design: Record<string, unknown>) {
  const { canonical_sha256: _ignored, ...rest } = design;
  return createHash("sha256")
    .update(JSON.stringify(sortKeys(rest)))
    .digest("hex");
}
// Python's json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)
// matches JSON.stringify of a key-sorted value for the strings, integers and
// short decimals used here (callers round coordinates to 4 places).
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, sortKeys((value as any)[k])]),
    );
  return value;
}
export const preparationKey = (parts: unknown) =>
  `prepkey_${createHash("sha256").update(canonical(parts)).digest("hex").slice(0, 40)}`;
/**
 * An asset id derived from its owner and its bytes: identical outputs for two
 * people stay two private assets, while one person's repeat reuses its own.
 */
export const ownedAssetId = (prefix: string, ownerId: string, sha: string) =>
  `${prefix}_${createHash("sha256").update(`${ownerId}\n${sha}`).digest("hex").slice(0, 32)}`;
/** Copy a producer output into the asset store under an owner-scoped id. */
export async function importOutput(
  dataDir: string,
  path: string,
  prefix: string,
  expectedSha: string,
  ownerId: string,
) {
  const bytes = await readFile(path);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== expectedSha)
    throw new Error("PRODUCER_OUTPUT_MISMATCH: file changed after preparation");
  const assetId = ownedAssetId(prefix, ownerId, sha);
  await mkdir(join(dataDir, "assets"), { recursive: true });
  const dest = join(dataDir, "assets", assetId);
  await copyFile(path, dest);
  return { assetId, path: dest, sha256: sha, bytes: bytes.length };
}
