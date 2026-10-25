"""Pure image helpers for the Instax mini: no Bluetooth, so tests run anywhere."""
from __future__ import annotations

import io

from PIL import Image, ImageOps

# The size the printer itself asks for (IMAGE_SUPPORT_INFO): portrait, 600 x 800.
FILM_PX = (600, 800)


def fit_to_film(src: Image.Image, size: tuple[int, int] = FILM_PX) -> Image.Image:
    """RGB at the film's size. The consumer already sends exactly 600 x 800; any other
    size is fitted whole on white, never cropped, because cropping is the consumer's call."""
    img = ImageOps.exif_transpose(src)
    if img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        flat = Image.new("RGB", rgba.size, "white")
        flat.paste(rgba, mask=rgba.getchannel("A"))
        img = flat
    img = img.convert("RGB")
    if img.size == size:
        return img
    return ImageOps.pad(img, size, method=Image.Resampling.LANCZOS, color="white")


def to_jpeg(img: Image.Image, max_bytes: int, flip_vertical: bool = False) -> bytes:
    """The highest JPEG quality that fits the transfer limit. Link 3 users report
    transfers stalling above about 55 KB, so the limit is the manifest's max_jpeg_kb."""
    if flip_vertical:
        img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    for quality in range(95, 9, -5):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=quality)
        if buf.tell() <= max_bytes:
            return buf.getvalue()
    raise ValueError(f"picture does not fit in {max_bytes} bytes even at low JPEG quality")
