"""Image -> Phomemo M02-family raster bytes. Pure functions, no I/O.

Protocol: ESC/POS-style raster as documented by vivier/phomemo-tools (M02 section):
  header  1b 40 (init) · 1b 61 01 (center) · 1f 11 02 NN (density, NN = 1, 2 or 4)
  body    1d 76 30 00 <bytes/line u16le> <lines u16le> <bits>, at most 255 lines per block
  footer  1b 64 NN (feed) · 1f 11 08 · 1f 11 0e · 1f 11 07 · 1f 11 09 (status queries)
Bits are 1 = black, MSB first. The M02 Pro is 300 dpi with ~576 printable dots
(some report up to 624); calibrate print_width_dots with a ruler on the real unit.
"""
from __future__ import annotations

import struct

from PIL import Image, ImageOps

MM_PER_INCH = 25.4


def mm_to_dots(mm: float, dpi: int) -> int:
    return max(1, round(mm * dpi / MM_PER_INCH))


def prepare_image(
    src: Image.Image,
    *,
    width_dots: int,
    dpi: int,
    target_mm: tuple[float, float] | None = None,
    max_length_dots: int | None = None,
    rotate: bool = False,
    dither: str = "floyd",
    threshold: int = 160,
) -> Image.Image:
    """Return a mode "1" image exactly width_dots wide, content centered.

    Size precedence: target_mm from the job > the PNG's own dpi metadata > fill the width.
    Never upscales past the printable width; long images are cropped to max_length_dots.
    """
    img = ImageOps.exif_transpose(src)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        white = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(white, img)
    img = img.convert("L")
    if rotate:
        img = img.rotate(90, expand=True)

    if target_mm and target_mm[0] > 0:
        w = mm_to_dots(target_mm[0], dpi)
        if target_mm[1] > 0:
            h_fit = mm_to_dots(target_mm[1], dpi)
            w = min(w, round(h_fit * img.width / img.height))
    elif (src_dpi := src.info.get("dpi")) and src_dpi[0] and abs(src_dpi[0] - 72) > 1:
        # 72 dpi is Pillow/most tools' meaningless default, so ignore it.
        w = round(img.width * dpi / src_dpi[0])
    else:
        w = width_dots
    w = max(1, min(w, width_dots))
    h = max(1, round(img.height * w / img.width))
    img = img.resize((w, h), Image.Resampling.LANCZOS)

    if max_length_dots and img.height > max_length_dots:
        img = img.crop((0, 0, img.width, max_length_dots))

    if dither == "threshold":
        bw = img.point(lambda v: 255 if v >= threshold else 0, mode="1")
    else:
        bw = img.convert("1")  # Floyd-Steinberg

    canvas = Image.new("1", (width_dots, bw.height), 1)
    canvas.paste(bw, ((width_dots - bw.width) // 2, 0))
    return canvas


def encode_raster(img: Image.Image, *, density: int = 4, feed_lines: int = 2) -> bytes:
    """Encode a mode "1" image (white = 1 in Pillow) into printer bytes."""
    if img.mode != "1":
        raise ValueError("encode_raster needs a mode '1' image")
    if density not in (1, 2, 4):
        raise ValueError("density must be 1, 2 or 4")
    width_bytes = (img.width + 7) // 8
    if img.width != width_bytes * 8:
        padded = Image.new("1", (width_bytes * 8, img.height), 1)
        padded.paste(img, (0, 0))
        img = padded
    # Pillow packs 1 = white; the printer wants 1 = black.
    rows = bytes(b ^ 0xFF for b in img.tobytes())

    out = bytearray(b"\x1b\x40" + b"\x1b\x61\x01" + bytes([0x1F, 0x11, 0x02, density]))
    for start in range(0, img.height, 255):
        count = min(255, img.height - start)
        out += b"\x1d\x76\x30\x00" + struct.pack("<HH", width_bytes, count)
        out += rows[start * width_bytes : (start + count) * width_bytes]
    out += bytes([0x1B, 0x64, feed_lines]) * 2
    out += b"\x1f\x11\x08\x1f\x11\x0e\x1f\x11\x07\x1f\x11\x09"
    return bytes(out)
