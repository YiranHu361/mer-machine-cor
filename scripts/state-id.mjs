import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
const roots = [
  "server",
  "tests",
  "node/fabrary_node",
  "node/tests",
  "integrations/src",
  "integrations/test",
  "integrations/spacetimedb/src",
  "integrations/fetch",
  "web/src",
  "web/unit",
  "web/tests",
  "scripts",
];
const files = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  ".node-version",
  "node/.python-version",
  "node/pyproject.toml",
  "node/uv.lock",
  "integrations/package.json",
  "integrations/package-lock.json",
  "integrations/spacetimedb/package.json",
  "integrations/spacetimedb/package-lock.json",
  "integrations/fetch/.python-version",
  "integrations/fetch/pyproject.toml",
  "integrations/fetch/uv.lock",
  "web/package.json",
  "web/package-lock.json",
  "web/vite.config.ts",
  "web/playwright.config.ts",
  "web/tsconfig.json",
];
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (
      entry.name.startsWith(".") ||
      ["__pycache__", "node_modules", "dist"].includes(entry.name)
    )
      continue;
    const p = join(path, entry.name);
    if (entry.isDirectory()) await walk(p);
    else if (entry.isFile()) files.push(p);
  }
}
for (const path of roots) await walk(path);
const hash = createHash("sha256");
for (const file of [...new Set(files)].sort()) {
  hash.update(file + "\0");
  hash.update(await readFile(file));
}
console.log(hash.digest("hex"));
