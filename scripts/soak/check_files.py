"""Check every handed-over production file the way the receiving end will use it.

Usage: python check_files.py FILES_DIR  (reads FILES_DIR/files.json written by the soak run)
Stickers must become printer raster commands; Instax images must become the
55 KB JPEG the printer takes; 3D models must be valid, unsliced 3MF that fits.
"""
import hashlib
import json
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from PIL import Image

from fabrary_node.adapters import InstaxLink3, Phomemo

NS = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
BUILD = (180, 180, 180)


def sticker(path: Path, spec: dict) -> dict:
    with Image.open(path) as image:
        assert image.mode == "1", f"mode {image.mode}"
        assert image.width <= 640, f"width {image.width}"
        expected = (round(spec["width_mm"] / 25.4 * 300), round(spec["height_mm"] / 25.4 * 300))
        assert image.size == expected, f"size {image.size} != {expected}"
        assert 5 <= spec["height_mm"] <= 150, f"height {spec['height_mm']} mm"
        ink = image.convert("L").histogram()[0] / (image.width * image.height)
    commands = Phomemo.raster(path)
    assert commands.startswith(b"\x1b\x40"), "missing printer reset"
    return {"px": f"{image.width}x{image.height}", "heightMm": spec["height_mm"], "ink": round(ink, 3),
            "printerBytes": len(commands)}


def instax(path: Path, spec: dict) -> dict:
    with Image.open(path) as image:
        assert image.size == (600, 800), f"size {image.size}"
        assert image.mode == "RGB", f"mode {image.mode}"
        low, high = image.convert("L").getextrema()
        assert high - low >= 8, "flat image"
    payload = InstaxLink3.jpeg_payload(path, False)
    assert len(payload) <= 55_000
    return {"px": "600x800", "jpegBytes": len(payload), "rotated": spec.get("rotated_degrees", 0),
            "crop": spec.get("crop")}


def model(path: Path, spec: dict) -> dict:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        assert "3D/3dmodel.model" in names, "no model part"
        assert not any(n.endswith(".gcode") for n in names), "unexpectedly sliced"
        root = ET.fromstring(archive.read("3D/3dmodel.model"))
    vertices = [(float(v.get("x")), float(v.get("y")), float(v.get("z")))
                for v in root.iterfind(".//m:vertex", NS)]
    triangles = list(root.iterfind(".//m:triangle", NS))
    assert vertices and triangles, "empty mesh"
    for t in triangles:
        assert all(0 <= int(t.get(k)) < len(vertices) for k in ("v1", "v2", "v3")), "bad index"
    size = [round(max(v[i] for v in vertices) - min(v[i] for v in vertices), 2) for i in range(3)]
    assert all(s <= b for s, b in zip(size, BUILD)), f"size {size} exceeds build volume"
    declared = spec.get("model_size_mm")
    if declared:
        assert all(abs(a - b) <= 0.6 for a, b in zip(sorted(size), sorted(declared))), f"size {size} != {declared}"
    return {"sizeMm": size, "vertices": len(vertices), "triangles": len(triangles)}


def main(folder: Path):
    files = json.loads((folder / "files.json").read_text())
    results, failures = [], []
    for entry in files:
        path = folder / entry["file"]
        try:
            assert hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"], "hash differs from the plan"
            check = {"sticker_print": sticker, "photo_print": instax, "fdm_print": model}[entry["process"]]
            results.append({**entry, "check": check(path, entry["parameters"])})
        except Exception as error:  # report every file, then fail the run
            failures.append({**entry, "error": str(error)})
    summary = {"checked": len(files), "passed": len(results), "failed": len(failures),
               "byProcess": {p: sum(1 for r in results if r["process"] == p)
                             for p in ("sticker_print", "photo_print", "fdm_print")},
               "failures": failures}
    (folder / "checks.json").write_text(json.dumps({"summary": summary, "results": results}, indent=2))
    print(json.dumps(summary))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
