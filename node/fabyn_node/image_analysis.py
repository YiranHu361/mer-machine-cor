"""Limited image statistics for an offline format suggestion, never semantics.

The backend authorizes every input asset before invoking this local helper.
No model, network, device discovery, artifact preparation or state write occurs.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
import warnings

from PIL import Image, ImageOps


MAX_PIXELS = 20_000_000
METHOD = "local_pixel_statistics/v1"


def analyze_image(path: str | Path) -> dict:
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(path) as source:
            if source.format not in {"PNG", "JPEG", "WEBP"} or getattr(source, "is_animated", False):
                raise ValueError("Unsupported artwork")
            width, height = source.size
            if width * height > MAX_PIXELS:
                raise ValueError("Artwork exceeds the analysis limit")
            source.load()
            source.thumbnail((256, 256), Image.Resampling.LANCZOS)
            rgba = ImageOps.exif_transpose(source).convert("RGBA")
            image = Image.new("RGBA", rgba.size, "white")
            image.alpha_composite(rgba)
            image = image.convert("RGB")
    pixels = list(image.get_flattened_data())
    count = len(pixels)
    gray = list(image.convert("L").get_flattened_data())
    histogram = [0] * 256
    chromatic = binary = 0
    for (red, green, blue), tone in zip(pixels, gray):
        histogram[tone] += 1
        high, low = max(red, green, blue), min(red, green, blue)
        chromatic += high - low >= 24 and (high - low) / max(1, high) >= .12
        binary += tone <= 24 or tone >= 231
    entropy = -sum((value / count) * math.log2(value / count) for value in histogram if value)
    mean = sum(index * value for index, value in enumerate(histogram)) / count
    deviation = math.sqrt(sum((index - mean) ** 2 * value for index, value in enumerate(histogram)) / count)
    color_fraction, near_binary = chromatic / count, binary / count
    edges = comparisons = 0
    sample_width, sample_height = image.size
    for y in range(sample_height):
        for x in range(sample_width):
            index = y * sample_width + x
            if x:
                comparisons += 1
                edges += abs(gray[index] - gray[index - 1]) >= 48
            if y:
                comparisons += 1
                edges += abs(gray[index] - gray[index - sample_width]) >= 48
    # These are tonal categories, not recognition of a logo, person or subject.
    # Low-information/blank and mixed-tone images remain explicitly ambiguous.
    if deviation < 12:
        kind = "ambiguous"
    elif near_binary >= .86 and entropy <= 3.2:
        kind = "graphic"
    elif entropy >= 5 and near_binary <= .75 and (color_fraction >= .08 or entropy >= 6):
        kind = "photo"
    else:
        kind = "ambiguous"
    return {
        "kind": kind,
        "width": width,
        "height": height,
        "colorFraction": round(color_fraction, 6),
        "nearBinaryFraction": round(near_binary, 6),
        "entropy": round(entropy, 6),
        "edgeDensity": round(edges / comparisons, 6) if comparisons else 0,
    }


def analyze_paths(paths: list[str | Path]) -> dict:
    if not 1 <= len(paths) <= 4:
        raise ValueError("Analyze one to four authorized images")
    images = [analyze_image(path) for path in paths]
    kinds = {image["kind"] for image in images}
    return {
        "method": METHOD,
        "kind": next(iter(kinds)) if len(kinds) == 1 else "ambiguous",
        "colorful": any(image["colorFraction"] >= .02 for image in images),
        "images": images,
        "limitation": "Local color and tonal statistics only; no semantic recognition, image-quality guarantee, rights, machine readiness or physical compatibility assessment.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze one to four backend-authorized local image files.")
    parser.add_argument("paths", nargs="+")
    args = parser.parse_args()
    try:
        result = analyze_paths(args.paths)
    except Exception:
        # Never leak a private local asset path or decoder details to the UI.
        json.dump({"error": {"code": "IMAGE_ANALYSIS_UNAVAILABLE", "message": "Uploaded artwork could not be analyzed locally."}}, sys.stdout)
        sys.stdout.write("\n")
        return 1
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
