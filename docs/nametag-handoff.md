# Name tag on the Bambu Lab A1 mini: handoff

Someone types a name on `/make`; the A1 mini prints it as a single-colour tag with a keyring hole and the name engraved into the top. The feature is in `main` (commit `b7a1f8f`, since merged with the Fabyn rename and x402 work; checked against `df653aa`). The branch `nametag-printing` still exists on `origin`.

## Status

| | |
| --- | --- |
| Automated tests (on `df653aa`) | Pass: 337 server, 254 node, 36 producer-side, 34 integrations, 32 web unit; server typecheck clean. OpenSCAD and Bambu Studio are installed, so no test skipped |
| Dry run (`npm run mvp -- --dry-run`) | Before the merge: two orders ("Maya", "Lucas Jiang") went from `/make` to pickup code, with real OpenSCAD and Bambu Studio and only the printer faked. Not re-run on the merged tree |
| Real printer | Lucas ran it on the A1 mini and reported it working. Nobody has recorded the finished part, its print time or weight against the estimates, so do that on the first real tag |

## How a tag gets made

1. **`/make`**: the "Or make a name tag" field sends the request `A name tag that says "<name>"`. Typing the same sentence in the main box works too. [intent.ts](../server/orchestration/intent.ts) `nameFromRequest` pulls the name out (quotes, or after "says / named / called / my name is"). A stated name skips Claude and uses the local rules ([orchestrator.ts](../server/orchestration/orchestrator.ts) `understand`).
2. **Prepare** (app side): the orchestrator asks the Python producer ([producer.py](../node/fabyn_node/producer.py) `_text_tag`) for the model. [nametag.py](../node/fabyn_node/nametag.py) validates the name, runs OpenSCAD on [nametag.scad](../node/fabyn_node/nametag.scad) and returns a reproducible 3MF, a cropped preview PNG and estimates. The proposal screen shows that preview and price.
3. **Dispatch**: after Pay & make, the app offers the job to the producer side's hub (`m_fdm_01`) with a signed link to the 3MF. The A1 mini's node downloads it.
4. **Slice** (printer side): [adapter.py](../producer-side/node/adapters/bambu/adapter.py) `prepare` sniffs the file type (the signed links have no extension), and [slicer.py](../producer-side/node/adapters/bambu/slicer.py) runs the Bambu Studio CLI at its standard A1 mini settings (0.20 mm Standard, Bambu PLA Basic, white, Textured PEI Plate). The G-code is wrapped as `.gcode.3mf`.
5. **Print**: the existing adapter code runs pre-flight, uploads over FTPS, starts it over MQTT and follows progress.
6. **Finish**: there is no camera or owner check any more. When the machine reports the job finished, the app marks it `produced` and the order completes. A 3D job is never handled automatically (the part is still on the plate): the owner takes it off and presses **Item removed · clear the printer** in `/owner` (`POST /api/owner/jobs/:id/clear-print`, [service.ts](../server/service.ts) `clearHubPrint`). That resumes the machine with `cleared: true`, [producer-hub.ts](../server/producer-hub.ts) sends the hub `POST /dev/plate-cleared`, and the hub sends `plate.cleared` to the node so it accepts the next job.

## The tag

`nametag.scad`: a 20 mm tall, 3.2 mm thick plate; a 5 mm hole 10 mm from the left end; the name engraved 1.2 mm deep in Liberation Sans Bold (ships inside OpenSCAD.app). The plate length follows the name's measured width. Names wider than 72 mm are set smaller, down to a minimum size. Allowed names: 1-16 characters, Latin letters (accents allowed), digits, single spaces and `. , ' & ! ? + -`. Anything else is rejected with `template_charset`.

Estimates (`nametag.py` constants `FILL`, `MINUTES_PER_GRAM`, `SETUP_MINUTES`) come from Bambu Studio slicing "Maya" (3.05 g, 13.5 min total) and "Lucas Jiang" (5.29 g, 18.4 min total). Two data points only; adjust after real prints.

## Traps (read before changing the slicer)

- **The Bambu Studio CLI ignores a preset's `inherits` chain and its `include` G-code templates.** Given the bundled A1 mini preset files directly, it reports success but slices with generic defaults: no A1 mini start sequence (no bed levelling), 200 °C, a 2 mm³/s flow cap, Cool Plate, 0 g weight. `adapter.py inspect` passes that file, since model, nozzle and material all match. `slicer.py` flattens the presets (parents, then included templates, then the preset's own keys) and `check_gcode` refuses G-code without the start sequence, PLA temperatures or filament weight. Keep both.
- **Slicer paths:** the CLI writes into its working directory and needs absolute paths; `slice_model` resolves them.
- **A 3D print is never handled automatically**, even with `FABYN_AUTO_PREPARE_PRINTS=1` (what `npm run mvp` sets for stickers): [service.ts](../server/service.ts) skips it for `outputType === "3d"`.
- **Plate-cleared** goes out when the owner clears the print or resumes the machine with `cleared: true`. Until then the node refuses jobs with `plate_not_cleared`. `node.client --probe` flags a part left from an earlier print; `--plate-cleared` (or `npm run mvp -- --plate-cleared`) says the plate is empty.
- **`producer-side/.env`** (git-ignored) holds `BAMBU_ACCESS_CODE`. The node loads it ([env.py](../producer-side/node/env.py)); before this feature only the `bambu` CLI tool did.
- **Printer address:** `adapter.host` in [m_fdm_01.json](../producer-side/node/machines/m_fdm_01.json) (`172.20.10.8` when last committed). On an iPhone hotspot it can change after a restart: run `node.tools.bambu discover`. Mac setup for the hotspot: [MAC_NETWORK_SETUP.md](../producer-side/MAC_NETWORK_SETUP.md).
- **Filament left** (`media_loaded.remaining_est`, 15 g) is manual. The node subtracts each print in memory only, and it resets on restart.

## Setup on a new machine

```sh
brew install --cask openscad@snapshot        # the stable 2021 build is too old (needs textmetrics)
# Bambu Studio in /Applications; override with adapter.slicer_path or $BAMBU_STUDIO_CLI
# producer-side/.env: BAMBU_ACCESS_CODE=<from the printer: Settings > WLAN, LAN Only + Developer Mode on>
npm run mvp -- --plate-cleared               # --dry-run for a fake printer, --no-3d for stickers only
```

Printer: PLA on the external spool, microSD card in, Textured PEI plate (slicing assumes it; change `slice_profile.bed_type` for another), plate empty.

## Testing

```sh
npm test && npm run typecheck
(cd node && .venv/bin/python -m pytest -q)
(cd producer-side && .venv/bin/python -m pytest -q)
npm --prefix integrations test
git checkout -- docs/evidence/process-recovery.json   # npm test rewrites it every run
```

Tests that need OpenSCAD or Bambu Studio skip when it isn't installed. The end-to-end app test is the name tag test in `tests/producer-hub.test.ts`; the hub and plate test is `producer-side/tests/test_end_to_end.py`.

## Loose ends

- **Open issue:** a blank `FABYN_ALLOWED_MODES=` or `FABYN_PRODUCER_HUB_URL=` copied from `.env.example` crashes `npm run mvp`, because the launcher uses `??` instead of `||` ([mvp.mjs](../scripts/mvp.mjs)).
- **Unused dependency:** `package.json` has an npm package named `claude` (`^0.1.1`) that nothing in this feature uses; it looks accidental. Remove it if so.
- **Working tree** (as of this doc): `producer-side/samples/test.jpg` shows as deleted, and `.DS_Store` and a `Weixin Image_….jpg` in `producer-side/samples/` are untracked. None of it is from the feature.
- **Local `main`** is 3 commits behind `origin/main` (the Fabyn agent for ASI:One).
- **Machines:** the app's `bambu_01` is "Model counter"; `npm run mvp` moves it onto the hub as `m_fdm_01`. Ports 8000 (hub) and 4318 (app) must be free, so stop any earlier `npm run mvp`.

## Not done

- Single colour only; no manual filament swap.
- One tag per order (the spec requires quantity 1); no copies on one plate.
- No camera on the printer; nothing checks the finished tag except the owner's eyes.
- Estimates from two slices; the 15 g spool figure is manual.
- The Convex live view logs `machine.plate_cleared` only as a generic event; there is no dedicated display for it.
