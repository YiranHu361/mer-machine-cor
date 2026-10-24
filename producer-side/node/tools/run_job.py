"""Run one job straight through a machine's adapter, no hub. For hardware bring-up.

Works for any adapter in node/adapters: it builds a Job from the flags, then calls
adapter.prepare and adapter.run exactly as node/client.py does.

  python -m node.tools.run_job --machine node/machines/m_sticker_01.json path/to/sticker.png
  python -m node.tools.run_job --machine node/machines/m_sticker_01.json --text "Happy bday Maya"
  python -m node.tools.run_job ... --transport file       # dry run (adapters that support it)
  python -m node.tools.run_job ... --width-mm 40          # sets job.params.width_mm
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from ..adapters import make_adapter
from ..protocol import Job


def text_label(text: str, width_px: int = 576, height_px: int = 300) -> Image.Image:
    img = Image.new("L", (width_px, height_px), 255)
    draw = ImageDraw.Draw(img)
    size = 120
    while size > 12:
        font = ImageFont.load_default(size=size)
        box = draw.textbbox((0, 0), text, font=font)
        if box[2] - box[0] <= width_px - 30 and box[3] - box[1] <= height_px - 30:
            break
        size -= 4
    box = draw.textbbox((0, 0), text, font=font)
    xy = ((width_px - (box[2] - box[0])) // 2 - box[0], (height_px - (box[3] - box[1])) // 2 - box[1])
    draw.text(xy, text, fill=0, font=font)
    draw.rectangle((4, 4, width_px - 5, height_px - 5), outline=0, width=4)
    return img


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--machine", required=True, type=Path)
    ap.add_argument("image", nargs="?", type=Path)
    ap.add_argument("--text")
    ap.add_argument("--copies", type=int, default=1)
    ap.add_argument("--width-mm", type=float)
    ap.add_argument("--transport", choices=["ble", "serial", "lan", "file"])
    ap.add_argument("--out", type=Path, default=Path(".work/run_job"))
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(levelname).1s %(name)s: %(message)s")

    manifest = json.loads(a.machine.read_text())
    if a.transport:
        manifest["adapter"]["transport"] = a.transport
    manifest["adapter"].setdefault("out_dir", str(a.out / "printer_out"))
    adapter = make_adapter(manifest)

    a.out.mkdir(parents=True, exist_ok=True)
    if a.text:
        src = a.out / "text_label.png"
        text_label(a.text, manifest["adapter"].get("print_width_dots", 576)).save(src)
    elif a.image:
        src = a.out / a.image.name
        src.write_bytes(a.image.read_bytes())
    else:
        ap.error("give an image path or --text")

    params = {"width_mm": a.width_mm} if a.width_mm else {}
    job = Job(job_id="job_local", order_id="ord_local", item_id="it_local",
              machine_id=manifest["machine_id"], process=manifest["process"],
              quantity=a.copies, params=params)
    native = await adapter.prepare(job, src)
    print(f"prepared {native} ({native.stat().st_size} bytes)")
    async for p in adapter.run(job, native):
        print(f"  {p.state} {p.progress:.0%} eta={p.eta_s}s {p.message or ''}")
    print("done")


if __name__ == "__main__":
    asyncio.run(main())
