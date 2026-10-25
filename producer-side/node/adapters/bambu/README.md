# Bambu Lab A1 mini adapter

`adapter.type: "bambu_a1mini"` · process `fdm_print` · printed on our A1 mini (firmware 01.05.00.00, serial `0300CA661802587`) on 2026-10-24.

| File | What it does |
| --- | --- |
| `adapter.py` | `BambuA1Mini`: prepare (wrap/check the file), run (pre-flight, upload, start, follow), `preflight()` |
| `gcode.py` | Pure: `inspect_gcode` (model, nozzle, filament, grams, time from the slicer header), `build_gcode_3mf` |
| `transport.py` | `lan` (MQTT :8883 + implicit FTPS :990), `file` (dry run), SSDP `discover`, serial from the TLS cert |
| `slicer.py` | Slices an unsliced `.3mf` / `.stl` with the Bambu Studio CLI and checks the G-code before upload |

**Scope: a rudimentary first test.** It takes one G-code file someone already sliced for the A1 mini and prints it. We have printed one part with it: [`samples/yiran_PLA_11m11s.gcode`](../../../samples/yiran_PLA_11m11s.gcode), 15 layers, 1.9 g of PLA, about 11 min.

It also slices: the app's name tags arrive as unsliced 3MF models, and `prepare` slices them with Bambu Studio's standard A1 mini settings (0.20 mm Standard, Bambu PLA Basic, white, Textured PEI Plate).

Next steps:

- Test with more models (bigger, longer, overhangs, multi-object plates) before trusting the time and gram estimates for pricing.

## Printer setup (once)

1. Printer and node computer on the **same network**. Check with `python -m node.tools.bambu discover`.
2. On the printer: **Settings → WLAN → LAN Only Mode: on**, then **Developer Mode: on** (firmware ≥ 01.04 rejects third-party print commands without it). Note the **Access Code** shown there. It changes whenever LAN mode is toggled.
3. A **microSD card** in the printer. Uploaded jobs are stored on it.
4. Set the code: `echo BAMBU_ACCESS_CODE=12345678 >> producer-side/.env` (git-ignored), and the IP in `node/machines/m_fdm_01.json` → `adapter.host`.
5. On the printer, set the external spool's filament type (PLA). Pre-flight compares it with the file.

## Print a file

```sh
cd producer-side
.venv/bin/python -m node.tools.bambu status
.venv/bin/python -m node.tools.bambu inspect samples/yiran_PLA_11m11s.gcode   # would we refuse it?
.venv/bin/python -m node.tools.bambu print part.gcode            # upload, start, follow to FINISH
.venv/bin/python -m node.tools.bambu print part.gcode --dry-run  # fake printer
.venv/bin/python -m node.tools.bambu stop
```

`node.tools.run_job --machine node/machines/m_fdm_01.json part.gcode` and the hub path (`node.client`) drive the same adapter.

Input: a `.gcode` sliced in Bambu Studio / OrcaSlicer **for the A1 mini**, a `.gcode.3mf` (File → Export plate sliced file), or an unsliced `.3mf` / `.stl` model. Plain G-code is wrapped into a single-plate `.gcode.3mf`, byte for byte, because that is what the `project_file` command prints. Files from the app's signed links have no extension, so the type is read from the first bytes.

## Slicing on the node

`slicer.py` runs the Bambu Studio CLI (`/Applications/BambuStudio.app`, or `adapter.slicer_path` / `$BAMBU_STUDIO_CLI`) on plate 1. The CLI does not resolve a system preset's `inherits` chain or its `include` list of G-code templates: given the bundled preset files directly, it reports success but slices with generic defaults (no A1 mini start sequence, so no bed levelling; 200 °C; a 2 mm³/s flow cap; Cool Plate). So `slicer.py` flattens each preset first (parents, then included templates, then its own keys), then refuses any G-code without the A1 mini start sequence, with a nozzle temperature outside 190–240 °C, the generic flow cap, no filament weight or the wrong plate. Change the presets with `adapter.slice_profile` (`machine`, `process`, `filament`, `bed_type`, `filament_colour`).

## What happens to a job

1. **prepare** slices a model if needed, reads the slicer's header and wraps the file → `<job_id>.gcode.3mf`.
2. **run**:
   1. MQTT connect and `pushall` for a full report.
   2. **Pre-flight.** Any failure refuses the job before anything is uploaded:

      | Reason | When |
      | --- | --- |
      | `wrong_printer` / `wrong_nozzle` | File sliced for another model or nozzle |
      | `printer_busy` | Printer is PREPARE, RUNNING or PAUSE |
      | `plate_not_cleared` | This node printed and nobody cleared the plate, or the printer says FINISH/FAILED and `--plate-cleared` wasn't given |
      | `no_sd_card` | No microSD card in the printer |
      | `wrong_material` | File's filament type ≠ printer's spool setting (manifest if unset). Override: `--allow-material-mismatch` |
      | `out_of_media` | File's grams + `min_spare_g` (2 g) > `media_loaded.remaining_est` |
      | `too_long` | Slicer estimate > `limits.max_job_minutes` |

   3. FTPS upload to the SD card root as `fabrary_<job_id>.gcode.3mf`.
   4. `project_file` over MQTT: bed leveling on, flow/vibration calibration off, external spool.
   5. Follow the reports. The job counts as started when the printer reports PREPARE/RUNNING for our `subtask_name` (120 s limit). Progress maps 0–100 % to 0.05–0.9, then 1.0 on FINISH. FAILED raises with `print_error` and HMS codes.
   6. Subtract the file's grams from `remaining_est`, and set status `error` / `plate_not_cleared`. Policy then rejects jobs until `plate_cleared()` is called: the hub's `plate.cleared` message (`POST /dev/plate-cleared {"machine_id"}`), which the app sends when the owner approves the print or resumes the machine after clearing it. `node.client --probe` also reports a part left from an earlier print (printer FINISH/FAILED) at start; `--plate-cleared` says the plate is empty.
3. **cancel** sends `stop` at the next report (≤ 20 s). The part stays on the plate.

## Confirmed on our printer

- The minimal `.gcode.3mf` and `url: file:///sdcard/<name>` are accepted; the printer reports our `subtask_name`.
- The broker never PUBACKs QoS 1 publishes, so commands go out at QoS 0.
- Reports: `vt_tray.tray_type` = `PLA`, `sdcard: true` and `nozzle_diameter: "0.4"` are all present, so pre-flight uses live values.
- The A1 mini reports RUNNING (layer 0) during heating and leveling, before the first layer.

## Network gotcha: iPhone hotspot

On an iPhone hotspot, a Mac gets no IPv4 address and can't reach the printer, even though `discover` finds it. Fix it with a separate macOS network Location: [MAC_NETWORK_SETUP.md](../../../MAC_NETWORK_SETUP.md).
