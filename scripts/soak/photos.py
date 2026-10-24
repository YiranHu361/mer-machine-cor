"""Generate 40 varied, deterministic test photos for the soak run (no network).

Usage: python photos.py OUTPUT_DIR  -> writes the images and manifest.json.
"""
import json
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


def scene(w, h, rng):
    """A colourful landscape: sky gradient, sun, hills and noise like a camera photo."""
    top = (rng.randint(20, 120), rng.randint(60, 160), rng.randint(150, 255))
    bottom = (rng.randint(200, 255), rng.randint(120, 200), rng.randint(40, 120))
    image = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(image)
    for y in range(h):
        t = y / max(1, h - 1)
        draw.line([(0, y), (w, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    r = min(w, h) // 8
    cx, cy = rng.randint(r, w - r), rng.randint(r, h // 2)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, rng.randint(180, 240), 60))
    for layer in range(3):
        base = h * (0.55 + 0.12 * layer)
        points = [(0, h)] + [(x, base - rng.randint(0, h // 6)) for x in range(0, w + 1, max(1, w // 8))] + [(w, h)]
        draw.polygon(points, fill=(rng.randint(20, 90), rng.randint(90, 170), rng.randint(30, 90)))
    noise = Image.effect_noise((w, h), 18).convert("RGB")
    return Image.blend(image, noise, 0.08).filter(ImageFilter.GaussianBlur(0.6))


def blobs(w, h, rng):
    image = Image.new("RGB", (w, h), (rng.randint(200, 255),) * 3)
    draw = ImageDraw.Draw(image)
    for _ in range(14):
        x, y, r = rng.randint(0, w), rng.randint(0, h), rng.randint(min(w, h) // 12, min(w, h) // 4)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=tuple(rng.randint(0, 255) for _ in range(3)))
    return image.filter(ImageFilter.GaussianBlur(2))


def graphic(w, h, rng, label):
    """Black-on-white artwork: a ring, bars and text, like a club logo."""
    image = Image.new("RGB", (w, h), "white")
    draw = ImageDraw.Draw(image)
    m = min(w, h)
    draw.ellipse([w / 2 - m * 0.4, h / 2 - m * 0.4, w / 2 + m * 0.4, h / 2 + m * 0.4], outline="black", width=max(2, m // 30))
    for k in range(rng.randint(3, 7)):
        x = w / 2 - m * 0.25 + k * m * 0.08
        draw.rectangle([x, h / 2 - m * 0.15, x + m * 0.04, h / 2 + m * 0.15], fill="black")
    font = ImageFont.load_default(size=max(10, m // 12))
    draw.text((w / 2, h / 2 + m * 0.28), label, fill="black", anchor="mm", font=font)
    return image


def low_contrast(w, h, rng):
    image = scene(w, h, rng).convert("L").point(lambda v: 110 + v // 6).convert("RGB")
    return image


def main(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(20261024)
    plan = []
    sizes = [(1600, 1200), (1200, 1600), (1000, 1000), (2400, 1600)]
    for i in range(12):
        plan.append(("scene", sizes[i % 4], ["png", "jpeg", "webp"][i % 3]))
    for i in range(6):
        plan.append(("blobs", sizes[(i + 1) % 4], ["jpeg", "png"][i % 2]))
    for i in range(6):
        plan.append(("graphic", [(1200, 1200), (900, 600), (600, 900)][i % 3], ["png", "jpeg"][i % 2]))
    for i in range(4):
        plan.append(("low_contrast", sizes[i % 4], "jpeg"))
    plan += [("scene", (3000, 800), "jpeg"), ("scene", (600, 2400), "png"), ("blobs", (3600, 900), "webp"), ("graphic", (500, 2000), "png")]
    plan += [("scene", (160, 120), "png"), ("blobs", (240, 320), "jpeg"), ("graphic", (200, 200), "png"), ("scene", (320, 240), "webp")]
    plan += [("scene", (4000, 3000), "jpeg"), ("blobs", (3000, 4000), "jpeg")]
    plan += [("scene", (1600, 1200), "jpeg-rotated"), ("graphic", (1200, 900), "jpeg-rotated")]
    manifest = []
    for i, (kind, (w, h), fmt) in enumerate(plan):
        image = {"scene": scene, "blobs": blobs, "low_contrast": low_contrast}.get(kind)
        image = image(w, h, rng) if image else graphic(w, h, rng, f"CLUB {i:02d}")
        ext = {"png": "png", "jpeg": "jpg", "webp": "webp", "jpeg-rotated": "jpg"}[fmt]
        path = out / f"photo-{i:02d}-{kind}.{ext}"
        if fmt == "jpeg-rotated":
            # Stored sideways with an EXIF orientation tag, as phones do.
            exif = Image.Exif()
            exif[0x0112] = 6
            image.transpose(Image.Transpose.ROTATE_90).save(path, "JPEG", quality=88, exif=exif)
        elif fmt == "jpeg":
            image.save(path, "JPEG", quality=88)
        elif fmt == "webp":
            image.save(path, "WEBP", quality=85)
        else:
            image.save(path, "PNG")
        with Image.open(path) as saved:
            width, height = saved.size
        manifest.append({"file": path.name, "kind": kind, "width": width, "height": height,
                         "mime": {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}[ext]})
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"{len(manifest)} photos in {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
