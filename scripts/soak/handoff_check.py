"""Offer our prepared sticker files to the producer side's hub and check what it prints.

Usage: python handoff_check.py FILES_DIR [HUB_URL] [COUNT]
FILES_DIR holds files.json from `npm run test:soak`. Each sticker is offered to
the sticker node with file:// asset URLs and our own width/height. For accepted
jobs the node's printed raster (its preview PNG) is compared pixel for pixel
with our file, centred on the print head the way the node centres it.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageChops

PRODUCER = Path(__file__).resolve().parents[2] / "producer-side"


def call(hub: str, path: str, body=None):
    request = urllib.request.Request(hub + path, data=None if body is None else json.dumps(body).encode(),
                                     headers={"content-type": "application/json"}, method="GET" if body is None else "POST")
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read())


def outcome(hub: str, job_id: str, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for event in reversed(call(hub, "/dev/events?limit=500")):
            data = event["data"]
            if data.get("job_id") != job_id:
                continue
            # The gateway reports rejected as job.updated, and job.done/job.failed.
            if event["type"] in ("job.done", "job.failed") or data.get("state") in ("rejected",):
                return data.get("state"), data
        time.sleep(0.5)
    return "timeout", {}


def compare(ours: Path, printed: Path) -> str:
    with Image.open(ours) as a, Image.open(printed) as b:
        a, b = a.convert("1"), b.convert("1")
        if a.height != b.height:
            return f"different length: ours {a.size}, printed {b.size}"
        placed = Image.new("1", b.size, 1)
        placed.paste(a, ((b.width - a.width) // 2, 0))
        diff = ImageChops.difference(placed.convert("L"), b.convert("L")).getbbox()
        changed = 0 if diff is None else sum(1 for v in ImageChops.difference(placed.convert("L"), b.convert("L")).getdata() if v)
        return "pixel-identical" if diff is None else f"{changed} of {b.width * b.height} pixels differ"


def main(folder: Path, hub: str, count: int):
    files = [f for f in json.loads((folder / "files.json").read_text()) if f["process"] == "sticker_print"][:count]
    for f in files:
        path = (folder / f["file"]).resolve()
        params = {"width_mm": f["parameters"]["width_mm"], "height_mm": f["parameters"]["height_mm"]}
        job = call(hub, "/dev/offer", {"machine_id": "m_sticker_01", "asset_url": path.as_uri(), "params": params})
        kind, data = outcome(hub, job["job_id"])
        line = f'{f["file"]}: {params["width_mm"]}x{params["height_mm"]} mm -> {kind}'
        if kind == "rejected":
            line += f' ({data.get("reason")})'
        elif kind in ("done", "failed"):
            line += f' error={data.get("error")} verification={data.get("verification")}'
            printed =PRODUCER / ".work" / "m_sticker_01" / job["job_id"] / f'{job["job_id"]}_print_preview.png'
            line += f" | {compare(path, printed) if printed.exists() else 'no print preview found'}"
        print(line, flush=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8000",
         int(sys.argv[3]) if len(sys.argv) > 3 else 3)
