"""Prepare the exact bitmap approved by requesters. No hardware is accessed."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_PIXELS = 24_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def _load(source: str | Path) -> Image.Image:
    try:
        with Image.open(source) as opened:
            if opened.format not in {"PNG", "JPEG", "WEBP"}:
                raise ValueError("Only PNG, JPEG and WebP are supported")
            if opened.width * opened.height > MAX_PIXELS:
                raise ValueError("Image exceeds 24 megapixels")
            if getattr(opened, "is_animated", False):
                raise ValueError("Animated images are unsupported")
            image = ImageOps.exif_transpose(opened).convert("RGBA")
            background = Image.new("RGBA", image.size, "white")
            background.alpha_composite(image)
            return background.convert("RGB")
    except (UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise ValueError("Invalid or oversized image") from exc


def prepare(source: str | Path, destination: str | Path, *, output_type: str = "sticker",
            width_mm: float = 53, height_mm: float = 50, crop: str = "contain",
            extras: list[str | Path] | None = None) -> dict:
    if crop not in {"contain", "cover"}:
        raise ValueError("crop must be contain or cover")
    if not all(math.isfinite(v) for v in (width_mm, height_mm)):
        raise ValueError("Dimensions must be finite")
    sources = [source, *(extras or [])]
    if not 1 <= len(sources) <= 4:
        raise ValueError("Supply one to four images")
    if output_type == "sticker":
        if width_mm not in {15, 25, 53} or not 5 <= height_mm <= 150:
            raise ValueError("Sticker width must be 15, 25 or 53 mm; height must be 5–150 mm")
        dimensions = (round(width_mm / 25.4 * 300), round(height_mm / 25.4 * 300))
    elif output_type == "instax":
        if (width_mm, height_mm) != (54, 86):
            raise ValueError("Instax mini film has a fixed 54 × 86 mm outside format")
        dimensions = (600, 800)
    else:
        raise ValueError("Only sticker and instax accept image preparation; 3D requires a prepared catalog model")
    images = [_load(path) for path in sources]
    columns, rows = (1, 1) if len(images) == 1 else (2, math.ceil(len(images) / 2))
    canvas = Image.new("RGB", dimensions, "white")
    for index, image in enumerate(images):
        column, row = index % columns, index // columns
        left, top = dimensions[0] * column // columns, dimensions[1] * row // rows
        right, bottom = dimensions[0] * (column + 1) // columns, dimensions[1] * (row + 1) // rows
        cell = (right - left, bottom - top)
        image = ImageOps.fit(image, cell, method=Image.Resampling.LANCZOS) if crop == "cover" else ImageOps.pad(image, cell, method=Image.Resampling.LANCZOS, color="white")
        canvas.paste(image, (left, top))
    if output_type == "sticker":
        canvas = ImageOps.autocontrast(canvas.convert("L")).convert("1", dither=Image.Dither.FLOYDSTEINBERG)
    target = Path(destination)
    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(target, format="PNG", optimize=False)
    data = target.read_bytes()
    return {"sha256": hashlib.sha256(data).hexdigest(), "width": canvas.width, "height": canvas.height,
            "outputType": output_type, "colorMode": "monochrome" if output_type == "sticker" else "color",
            "format": "PNG", "sourceCount": len(sources), "path": str(target.resolve())}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("destination")
    parser.add_argument("--extra", action="append", default=[])
    parser.add_argument("--output-type", default="sticker", choices=["sticker", "instax"])
    parser.add_argument("--width-mm", type=float, default=53)
    parser.add_argument("--height-mm", type=float, default=50)
    parser.add_argument("--crop", choices=["contain", "cover"], default="contain")
    args = parser.parse_args()
    try:
        result = prepare(args.source, args.destination, output_type=args.output_type,
                         width_mm=args.width_mm, height_mm=args.height_mm, crop=args.crop, extras=args.extra)
    except (ValueError, OSError) as exc:
        parser.exit(2, json.dumps({"error": str(exc)}) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
