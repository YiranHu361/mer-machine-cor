import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
await mkdir(".data", { recursive: true });
try {
  await readFile(".data/local-credentials.json");
  console.log("Existing local access configuration retained.");
} catch {
  await writeFile(
    ".data/local-credentials.json",
    JSON.stringify(
      {
        ownerCode: randomBytes(16).toString("hex"),
        nodeKey: randomBytes(32).toString("hex"),
        secret: randomBytes(32).toString("hex"),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "Local access configuration created at .data/local-credentials.json. Keep this file private.",
  );
}
