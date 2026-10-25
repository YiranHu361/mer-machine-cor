# Instax mini Link adapter

`adapter.type: "instax_mini"` · process `photo_print` · picture transfer checked on our Link 3 (`INSTAX-71659090`) on 2026-10-24 (macOS, BLE). First real print through this adapter is pending.

| File | What it does |
| --- | --- |
| `adapter.py` | `InstaxMini`: prepare (picture → JPEG), run (send, wait for the print), status, cancel, probe |
| `image.py` | Pure functions: `fit_to_film` (600 × 800 RGB) and `to_jpeg` (highest quality under the limit) |
| `link.py` | Bluetooth: finds the printer by name, sends one JPEG, waits for its print confirmation |
| `instaxble/` | The MIT [javl/InstaxBLE](https://github.com/javl/InstaxBLE) protocol code, unmodified (see `UPSTREAM.md`) |

## What happens to a job

1. **prepare**
   - The consumer sends a 600 × 800 picture, already turned if it is wide. Any other size is fitted whole on white, never cropped.
   - Flip it top to bottom if `flip_vertical` is on (some Link 3 units print upside down).
   - Encode the highest JPEG quality under `max_jpeg_kb` (55 KB; Link 3 users report bigger transfers stalling).
   - Writes `<job_id>.instax.jpg` and `<job_id>_print_preview.png` next to the asset.
2. **run**
   - Scan for `ble_name` (or `ble_address`) for up to `scan_s` seconds and connect. Refuse if the printer does not ask for 600 × 800 or has no film.
   - Per copy: send the picture, wait for the printer's print confirmation (`job_timeout_s`), then `eject_s` for the photo to come out.
   - Set `media_loaded.remaining_est` to the printer's own film count.
3. **cancel** stops the transfer. A picture the printer already confirmed still prints.

The film develops for about 90 s after the job ends, so `camera.delay_s` is 90.

## Bring-up

The printer must be on and not connected to the Fujifilm phone app (BLE allows one connection).

```sh
.venv/bin/python -m node.tools.scan_ble --prefix INSTAX --services       # name, and service 70954782-…
.venv/bin/python -m node.client --machine node/machines/m_photo_01.json --hub http://127.0.0.1:8000 --probe   # connects once, prints nothing
.venv/bin/python -m node.tools.run_job --machine node/machines/m_photo_01.json ../handoff-samples/instax-claude-cat.png --transport file   # dry run
.venv/bin/python -m node.tools.run_job --machine node/machines/m_photo_01.json ../handoff-samples/instax-claude-cat.png                  # uses one sheet
```

If the print comes out upside down, set `"flip_vertical": true` in `m_photo_01.json`.
