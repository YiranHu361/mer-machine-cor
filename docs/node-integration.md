# Machine node implementation and verification

The node is a separate local Python process. It exposes the same six functions through JSON HTTP and FastMCP: `get_capabilities`, `get_status`, `run_job`, `camera_snapshot`, `abort`, and `cancel_before_acceptance`. Simulation is a device boundary and produces labeled synthetic evidence. It does not establish any physical acceptance result.

## Setup

From the application directory:

```sh
uv sync --project node --locked
uv run --project node pytest -q node/tests
uv run --project node fabrary-node
```

Set `FABRARY_NODE_KEY` (at least 16 random characters) and the same `FABRARY_TOKEN_SECRET` as the backend in the environment. The HMAC secret defaults to the node key if omitted. No default credential is built into the node. See [node/.env.example](../node/.env.example) for all names. The default node address is `http://127.0.0.1:8788`; the allowed backend asset prefix is `http://127.0.0.1:4318/assets`. The node binds loopback and uses one process per journal, enforced by a process lock. Run one MQTT client for the configured Bambu printer.

An omitted `FABRARY_MACHINES_FILE` starts three labeled simulated devices: `phomemo_01`, `instax_01`, and `bambu_01`. To configure real devices, copy [machines.example.json](../node/machines.example.json) into ignored `.data/machines.json`, set its absolute path in the environment, and fill only the exact team-owned devices. There is no discovery scan. All hardware starts paused and uncalibrated. Configuration and pairing never imply calibration.

For Bambu dependencies, run `uv sync --project node --extra hardware --locked`. The MIT InstaxBLE source is vendored at `804dca8cfaba5db48bc5f961aab106006e600303`, with license and exact source hashes alongside it. `simplepyble==1.2.0` was installed, imported, and checked for its paired-handle API without invoking discovery. The candidate uses only the exact configured paired peripheral, pins service/characteristic UUIDs from the actual device, caps JPEG payloads at 55 KB, supports the measured vertical flip, bounds response waits, and waits at least 90 seconds for development. It stays blocked without explicit exact-device compatibility proof; transfer acknowledgment still requires physical inspection. Bambu API 2.6.6 was installed and its constructor, MQTT, upload, start, state and stop signatures were checked locally without connecting to a device. Phomemo-printer 1.0.5 was installed and inspected as a candidate; its `print_image` rotates, resizes and substitutes pixels, so Fabrary does **not** call it after approval. Fabrary sends the approved raster directly using the documented upstream M02 protocol. The pinned upstream protocol reference is `vivier/phomemo-tools@2b767486d4590676f1ffb61c7ca870984978a980`. No claim of hardware compatibility follows from an import check.

## Image preparation

```sh
uv run --project node fabrary-prepare INPUT OUTPUT.png \
  --extra SECOND_INPUT --extra THIRD_INPUT --extra FOURTH_INPUT \
  --output-type sticker --width-mm 53 --height-mm 50 --crop contain
```

`--extra` is optional and repeatable, with at most four total sources. Images appear in a deterministic grid. The command accepts PNG/JPEG/WebP, handles EXIF orientation and transparency, checks size, applies the approved contain/cover crop and writes a 300 dpi, 1-bit dithered lossless PNG for thermal output. The final bytes are the production preview and are SHA256-bound at dispatch. Sticker roll widths are 15, 25 or 53 mm, with 5–150 mm length. The CLI returns JSON containing `sha256`, `width`, `height`, `sourceCount`, `format` and `colorMode`.

Instax uses `--output-type instax --width-mm 54 --height-mm 86`, producing the upstream mini image size of 600×800 inside the fixed film format. Image preparation does not prove Link 3 compatibility. 3D rejects image conversion and accepts only prepared, reviewed model catalog artifacts.

## Authenticated tools

Every route, including health, frames and `/mcp/`, requires `Authorization: Bearer <FABRARY_NODE_KEY>`. JSON tools use `POST /tools/<name>`. FastMCP uses Streamable HTTP at `/mcp/`. Signed authorization is `base64url(JSON payload).hex_hmac_sha256`, with expiry in epoch seconds and scope `dispatch`, `camera`, `abort` or `calibration`. Dispatch binds machine, job, attempt, hash, expiry and the exact canonical parameters:

```json
{
  "outputType": "sticker",
  "widthMm": 53,
  "heightMm": 50,
  "quantity": 1,
  "material": "thermal-paper",
  "crop": "contain",
  "specVersion": 1
}
```

The node compares recursively sorted JSON, checks owner limits and hours (UTC), media, loaded material, dimensions and readiness, fetches only a signed `expires`/`sig` URL from its configured asset prefix without redirects or environment proxying, then hashes and verifies the exact prepared raster. The backend validates its asset URL signature. Changing an attempt's content is rejected. A job cannot be silently retried with a new attempt ID.

`run_job` is nonblocking. `get_status` accepts `{machine_id,job_id?,attempt_id?}` and returns `execution_status` (`idle`, `accepted`, `running`, `completed`, `uncertain` or `failed`), `completion_credible`, timestamps, readiness and a reason. Acceptance is committed with SQLite FULL synchronous mode. A running record is committed **before** the adapter can perform a side effect. Repeated requests return the existing attempt. On restart, an accepted job that never started becomes failed; a running job becomes uncertain. Neither is automatically reprinted. Active/uncertain attempts hold the execution slot.

A completed or failed attempt pauses the machine. Passing calibration also preserves pause until explicit owner resume. `PATCH /machines/<id>/policy` persists owner policy. Resume requires `{paused:false,ready:true,cleared:true,inspected:true}`, a successful calibration, and no active/uncertain attempt. Supported fields also include `listed`, `mediaRemaining`, `material`, `maxJobSeconds`, `maxQuantity`, `widthsMm`, and `hours:{start,end}` with integer UTC hours (start 0–23, end 1–24; `{start:0,end:24}` is always open). Previous item collection is outside node readiness and cannot hold the device slot.

`POST /simulation/<id> {outcome:"pass"|"fail"|"review"|"lost_ack"}` sets the next simulated execution outcome. Hardware rejects this route. `lost_ack` records acceptance then returns 503, allowing reconciliation of the same attempt without a second execution.

Camera tokens bind machine, job and attempt. Baseline capture can precede dispatch; result capture requires a journaled execution outcome. Every capture gets a unique private frame and time. Camera images are returned only to the authenticated backend, which stores/proxies them privately. Hardware accepts a fixed `cameraCommand` argument list returning one image to stdout, or a configured camera URL fetched fresh without redirects; it never reuses a local image file as a fresh frame. A configured command is local owner configuration, never a requester-controlled shell string. Bambu SDK cached images are not silently treated as fresh evidence. Simulated fixtures have `source:"simulation"` and the observation `visible`, `missing` or `ambiguous`; hardware does not invent an observation.

Abort responses distinguish `stopped` (simulation task cancelled), `unsupported` (Phomemo and unverified Link 3), `requested` (Bambu stop published), and `unknown`. A Bambu publish acknowledgment is never reported as confirmed physical stoppage. Timeout requests stop and records uncertainty.

## Calibration and operator recovery

`POST /calibrate {machine_id,inspected}` passes only a labeled simulation calibration fixture. Real hardware requires a separate finite authorized calibration attempt. Supply `job` with the same fields as `run_job`, but a token with `scope:"calibration"`; this allows an unlisted/uncalibrated configured machine to run a reviewed calibration artifact under local limits. Then call `/calibrate {machine_id,inspected:true,attempt_id,reason}` after completion and owner inspection. Hardware calibration also requires an associated result camera frame captured after the attempt began and within the last ten minutes. A transport-only attempt must first be explicitly reconciled as completed, and the owner must provide an inspection reason of at least ten characters. Calibration records `source:"owner-inspection"`, the frame ID and the reason while retaining `completion_credible:false` on the execution attempt. Missing adapters, pairing, camera, reviewed artifact, supervision or credible completion block calibration.

Phomemo raster delivery has no verified physical completion signal. A successful write becomes **uncertain**, requiring inspection; it cannot automatically release a payout. To record a physical inspection without reprinting, use `POST /reconcile {machine_id,job_id,attempt_id,inspected:true,result:"completed"|"failed",reason}`. This durable operator event clears an uncertain execution slot but preserves pause, and it keeps `completion_credible:false`. A backend operator override and its reason must remain visible. An inspected calibration output can subsequently establish calibration; it does not create an automated completion signal. Terminal contradictory resolutions are rejected.

## Hardware prerequisites and blockers

The actual host is macOS/Darwin arm64. The environment inspection found no configured machine-file path, node key, token secret or asset origin. No device scan, camera opening or physical job was attempted. Physical suites remain **BLOCKED**, rather than passed or skipped as success.

| Device             | Implemented path                                                                                                                                                                                | Exact missing prerequisite and acceptance                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phomemo M02Pro     | Direct Linux RFCOMM approved raster transport; 1-bit encoding software-tested                                                                                                                   | Team device's paired Bluetooth address and channel; Linux/Pi node; loaded roll and measured printable width; fixed fresh camera; owner supervision; calibration and ten consecutive jobs with timings. No automatic physical completion signal is available in this path.                                                                                                                                                              |
| Instax Mini Link 3 | Pinned upstream InstaxBLE transport candidate, paired-only device selection, bounded 55 KB JPEG transfer, configurable UUID/orientation and film development allowance; guarded until validated | Exact paired Link 3 identity, device service/write/notify UUIDs, owner-confirmed compatibility test (`compatibilityValidated`), orientation, loaded film and camera. Upstream issues remain open. The candidate never scans and never claims ejection/completion from a print-command acknowledgment. Validate its physical path before claiming P1 completion, then run three complete jobs with development time and fresh evidence. |
| Bambu Lab A1 mini  | Pinned `bambulabs-api` MQTT/FTPS upload, prepared 3MF start, exact-file running→FINISH observation and stop request                                                                             | Configured IP and serial, access-code env, owner-confirmed LAN Only/Developer Mode/firmware, loaded single-color PLA, clear bed, reviewed A1-mini-sliced catalog file and SHA, fixed fresh camera, calibration and a complete short print.                                                                                                                                                                                             |

A catalog entry contains `{id,sha256,machineModel:"Bambu Lab A1 mini",reviewed:true,widthMm,heightMm,depthMm,color,material:"pla",plateNumber,estimatedSeconds}`. See [catalog-entry.example.json](../node/catalog-entry.example.json); its placeholder hash and `reviewed:false` are intentionally not production-ready. 3D signed parameters contain the original seven fields plus exactly `depthMm`, `color` and `estimatedSeconds`; sticker and Instax retain exactly the original seven fields. Depth must be finite, positive and at most 180 mm; color must be nonempty; estimated duration must be finite, positive and within the owner time limit. The Bambu adapter requires every dimension, color, material and duration to match the reviewed catalog entry exactly, together with the artifact SHA256. The actual uploaded 3MF bytes must match the reviewed hash. No arbitrary filesystem path or requester-uploaded model is selected by the node. Bambu reports completion only after observing this exact dispatched filename running and then FINISH.

## Verified versions and primary references

Package registry metadata and upstream sources were checked on October 22, 2026 (Pacific time). Locked versions: Python 3.12.11 used locally; FastMCP 4.1.3; FastAPI 0.161.1; uvicorn 0.54.0; Pillow 13.0.0; httpx 0.28.1; pytest 9.1.1; pytest-asyncio 1.3.0. The complete dependency graph and package hashes are in [uv.lock](../node/uv.lock).

- [FastMCP HTTP deployment](https://gofastmcp.com/deployment/http): ASGI mounting and Streamable HTTP.
- [Phomemo official M02Pro specifications](https://phomemo.com/products/m02-pro-portable-printer): 300 dpi and roll formats; actual printable calibration remains required.
- [phomemo-printer 1.0.5](https://pypi.org/project/phomemo-printer/1.0.5/) and [upstream image implementation](https://github.com/hkeward/phomemo_printer/blob/master/phomemo_printer/ESCPOS_printer.py): candidate behavior inspected.
- [phomemo-tools](https://github.com/vivier/phomemo-tools): Linux connection and raster protocol reference.
- [InstaxBLE upstream](https://github.com/javl/InstaxBLE), [Link 3 transfer issue 21](https://github.com/javl/InstaxBLE/issues/21), [Link 3 service/orientation issue 24](https://github.com/javl/InstaxBLE/issues/24): exact-device compatibility remains unverified; reports describe a 55 KB workaround and service/orientation differences.
- [Bambu API upstream](https://github.com/BambuTools/bambulabs_api), [API 2.6.6 release](https://pypi.org/project/bambulabs-api/2.6.6/): installed signature validation.
- [Bambu's third-party integration announcement](https://forum.bambulab.com/t/updates-and-third-party-integration-with-bambu-connect/137408/): optional Developer Mode leaves MQTT/FTP/live streams open; exact printer firmware must be checked by the owner.

## Executed evidence

October 23 overnight follow-up: **65/65 node tests pass**, including policy
changes during downloads, configuration-bound calibration and migration,
pairing changes after restart, stops before worker start, delayed/cancelled stop
transports, active-worker reconciliation and bounded/erroring camera capture.
These regressions use isolated fixtures and no physical I/O. See
[overnight QA](overnight-qa.md) for the integrated checkpoint. Hardware journals
without configuration provenance require fresh calibration once; no simulated
calibration is accepted for replacement hardware.

The deterministic node suite initially passed 35 tests in 7.09 seconds. Added operator-resolution, exclusive-journal and actual loopback HTTP/FastMCP checks passed (3/3 in 1.38 seconds), then the full suite passed 38/38 in 4.29 seconds. An additional integer owner-hours regression test passed (1/1 in 0.43 seconds). These tests use real SQLite, real FastMCP and HTTP authentication, and the simulator only at the external device boundary. They exercise wrong-machine/expired/tampered tokens, camera scope, exact artifact hash and monochrome raster validation, local policy rejection, competing execution slots, durable retry, pre-start restart failure, running restart uncertainty, lost acknowledgment, fresh pass/fail/review fixtures, owner resume, next-job independence from collection, and accurate abort outcomes. The final isolated node command, `uv run --project node --extra hardware pytest -q node/tests`, passed **45/45** in 4.67 seconds. It additionally verifies that token expiry is rechecked after network retrieval, a normal production attempt cannot be relabeled as calibration, and transport-only calibration needs a fresh associated frame plus an explicit owner inspection without upgrading the completion signal. The calibration policy test mocks the camera/configuration boundary and is not hardware evidence. No hardware completion, physical timing or camera quality has been measured.

Prepared 3D contract correction: the focused catalog/policy/signed-characteristics checks passed 3/3 in 0.93 seconds. The full node suite was then run once after the correction; all 45 tests passed. These checks prove rejection of omitted or tampered depth, color and duration, exact reviewed catalog matching, local duration limits and durable retry binding; they do not establish physical printer behavior.

## New authorization mode and legacy replay

Every new dispatch, calibration, camera and abort token carries signed `expected_mode`, matching the configured node. Backend and node must be updated/restarted together. A mode-less legacy token may only read its exact durable accepted attempt through run-job replay; it cannot authorize new output, capture or stop. Reissue short-lived camera/abort tokens through the backend. An old attempt's private configuration binding must match before capture or stop; replacement devices/cameras require fresh supervised calibration. No hardware acceptance is implied by these software guards.

## Cancellation before acceptance and unusable calibration output

`cancel_before_acceptance` is a signed recovery operation for one exact dispatch/calibration machine, job, attempt, artifact and approved parameter tuple. It creates a durable SQLite cancellation record only when no execution attempt exists. Acceptance checks that record in its own atomic transaction, including after a delayed artifact download. The operation never fetches an artifact, captures a frame, starts a worker or sends stop. Existing accepted/running/uncertain/terminal attempts refuse this cancellation and require their existing reconciliation path. Exact cancellation proof can be recovered after a lost reply/restart; never delete the journal to bypass it. A current404 status lookup is insufficient evidence that a request cannot later be accepted.

The backend validates the full proof, mode and bounded clock tolerance before retiring its matching calibration intent or allocating a customer refund. Newer owner/configuration/payment state wins inside CAS retries. Device clocks need to remain within the signed authorization and proof tolerance. Uncertain replies preserve the blocked attempt; there is no automatic replacement output.

Completed but unusable calibration output is a separate rejected inspection. The node execution remains completed; the backend stays paused/unready/uncalibrated and requires a fresh supervised request. An old rejected/cancelled result cannot later become calibration proof.
