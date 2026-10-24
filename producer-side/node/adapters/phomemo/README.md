# Phomemo M02 Pro adapter

`adapter.type: "phomemo_m02pro"` · process `sticker_print` · tested on our unit on 2026-10-24 (macOS, BLE).

| File | What it does |
| --- | --- |
| `adapter.py` | `PhomemoM02Pro`: prepare (PNG → raster), run (stream, wait for done), status, cancel |
| `raster.py` | Pure functions: `prepare_image` (scale, dither, center) and `encode_raster` (printer bytes) |
| `transport.py` | Byte pipes: `ble` (bleak), `serial` (SPP/RFCOMM), `file` (dry run); `parse_status` for printer replies |

## What happens to a job

1. **prepare**
   - Flatten alpha onto white and convert to grayscale.
   - Scale to `params.width_mm` / `params.height_mm`. Without those, use the PNG's dpi metadata; without that, fill the head width. Never wider than `print_width_dots`.
   - Dither to 1-bit: Floyd–Steinberg, or `"threshold"` for crisp text.
   - Center on a 576-dot canvas and encode.
   - Writes `<job_id>.phomemo.bin` and `<job_id>_print_preview.png` next to the asset.
2. **run**
   - Scan and connect (3 attempts).
   - Stream the bytes once per copy in 128 B chunks, 20 ms apart, reporting progress up to 90%.
   - Wait for the printer's print-complete notification, then disconnect.
   - Decrement `media_loaded.remaining_est`.
3. **cancel** stops between chunks. Whatever is already in the printer's buffer still prints.

## Protocol

From [vivier/phomemo-tools](https://github.com/vivier/phomemo-tools) (M02 section), confirmed on our M02 Pro:

```
header  1b 40 · 1b 61 01 · 1f 11 02 <density 1|2|4>
body    1d 76 30 00 <bytes/line u16le> <lines u16le> <bits, 1 = black>   (≤ 255 lines per block)
footer  1b 64 02 · 1b 64 02 · 1f 11 08 · 1f 11 0e · 1f 11 07 · 1f 11 09
```

BLE layout:

| Characteristic | Role |
| --- | --- |
| service `ff00` | Container for the three below |
| `ff02` | Write (with or without response) |
| `ff03` | Notify |
| `ff01` | Read |

Notifications seen on our unit:

| Bytes | Meaning |
| --- | --- |
| `01 01` | Flow-control credit (ignored) |
| `1a 04 NN` | Battery % (100 = `64`) |
| `1a 08 <ascii>` | Serial number |
| `1a 0f 0c` | Print complete; the job ends on this |
| `02 b6 01`, `1a 3b …`, `1a 09 0c`, `1a 07 …` | Not decoded |

## Our unit

| | |
| --- | --- |
| BLE name | `M02 Pro` |
| macOS address | `E0706B14-218F-8BF7-77C3-0088049D59F6` (CoreBluetooth UUID, specific to this Mac; name match is the fallback) |
| Serial | `Q492E68B8500010` |
| Head | 300 dpi, 576 dots (48.8 mm). Prints came out right at this width |
| Speed | 40 × 25 mm sticker ≈ 9 s end to end (scan + connect + print) |

## Config (`adapter` block of the manifest)

| Key | Default | Notes |
| --- | --- | --- |
| `transport` | `ble` | `ble` · `serial` · `file` |
| `ble_name` / `ble_address` | `M02` / null | Matches either in one scan |
| `serial_port` | null | `/dev/cu.…` on macOS, `/dev/rfcomm0` on a Pi |
| `dpi`, `print_width_dots` | 300, 576 | Some units report 624. Measure a full-width print |
| `density` | 4 | 1, 2 or 4 |
| `dither` | `floyd` | `threshold` for text-only stickers |
| `rotate` | false | Rotate 90° so landscape art runs along the feed |
| `feed_lines` | 2 | Feed after each print |
| `chunk_bytes`, `chunk_delay_s` | 128, 0.02 | Try 60 B if prints garble |
| `completion_timeout_s` | 15 | Wait for `1a 0f 0c`, then assume done |
| `settle_s` | 3 | Fixed wait for transports with no completion signal |

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Phomemo not found over BLE" | Close the Phomemo phone app (one connection at a time). Make sure the printer is on. On first run, allow Bluetooth for the terminal in System Settings → Privacy |
| Garbled or truncated print | `chunk_bytes: 60` |
| Faint print | `density: 4`, `dither: "threshold"` |
| Clipped on one side | Measure and set `print_width_dots` |
