import "dotenv/config";
if (!process.argv.includes("--confirm-test-prints")) {
  console.error(
    "Run a successful test print on each machine first, then pass --confirm-test-prints to attest to those results.",
  );
  process.exit(1);
}
const origin = process.env.FABYN_PUBLIC_ORIGIN;
const accessCode = process.env.FABYN_OWNER_CODE;
if (!origin || !accessCode)
  throw new Error(
    "Set FABYN_PUBLIC_ORIGIN and FABYN_OWNER_CODE in the root .env.",
  );
const login = await fetch(`${origin}/api/session`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ role: "owner", accessCode }),
});
if (!login.ok)
  throw new Error("Owner login failed; check the cloud owner code.");
const cookie = login.headers.get("set-cookie")?.split(";")[0];
for (const [ours, theirs] of [
  ["phomemo_01", "m_sticker_01"],
  ["instax_01", "m_photo_01"],
  ["bambu_01", "m_fdm_01"],
]) {
  const response = await fetch(
    `${origin}/api/owner/machines/${ours}/producer-hub`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        producerMachineId: theirs,
        confirmTestPrint: true,
      }),
    },
  );
  if (!response.ok)
    throw new Error(
      `${ours}: ${(await response.json()).error?.message ?? response.status}`,
    );
  console.log(`${ours} linked to the local producer's ${theirs}.`);
}
