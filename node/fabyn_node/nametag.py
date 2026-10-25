"""Name tag template: OpenSCAD renders nametag.scad into a single-colour 3MF and a preview picture.

The name is checked here (Latin letters, digits, spaces and a little punctuation, 1-16 characters)
so it reaches OpenSCAD as a plain string literal. The 3MF is made reproducible: OpenSCAD writes a
random object UUID, which is replaced by one derived from the mesh, and the zip gets fixed dates.
"""
from __future__ import annotations

import hashlib
import io
import os
import re
import shutil
import subprocess
import tempfile
import uuid
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from pathlib import Path
from PIL import Image, ImageChops

TEMPLATE = Path(__file__).with_name("nametag.scad")
MAX_CHARS = 16
NAME = re.compile(r"[A-Za-z0-9À-ÖØ-öø-ÿ .,'&!?+-]{1,16}")
FONT_FAMILY = "Liberation Sans"  # ships inside OpenSCAD.app
APP_BINARY = "/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD"
TIMEOUT_S = 30
PREVIEW_WIDTH = 600
ZIP_DATE = (1980, 1, 1, 0, 0, 0)
CORE = "{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}"
ECHO = re.compile(r'ECHO: nametag = \[([-\d.e]+), ([-\d.e]+), ([-\d.e]+), ([-\d.e]+), "([^"]*)"\]')
UUID_ATTR = re.compile(r'p:UUID="[0-9a-fA-F-]{36}"')
CREATED = re.compile(r'(<metadata name="CreationDate"[^>]*>)[^<]*(</metadata>)')

# Calibrated against Bambu Studio slicing these tags for the A1 mini (0.20 mm Standard, PLA Basic,
# 15 % infill): "Maya" 3.05 g / 7.5 min of printing, "Lucas Jiang" 5.29 g / 12.4 min. The printer
# spends about 6 min heating, wiping and levelling before the first layer.
FILL = 0.80
MINUTES_PER_GRAM = 2.4
SETUP_MINUTES = 6


class TemplateError(ValueError):
    """The name cannot go on a tag."""


class GeneratorUnavailable(RuntimeError):
    """OpenSCAD is missing or failed; nothing about the name is wrong."""


@dataclass(frozen=True)
class NameTag:
    name: str
    model: bytes  # reproducible 3MF
    preview: Image.Image
    size_mm: tuple[float, float, float]
    text_size: float
    volume_cm3: float


def validate(name: object) -> str:
    if not isinstance(name, str) or not NAME.fullmatch(name) or name != " ".join(name.split()):
        raise TemplateError(f"A name tag takes 1–{MAX_CHARS} characters: letters, digits, single spaces "
                            "and . , ' & ! ? + -")
    if not any(char.isalnum() for char in name):
        raise TemplateError("A name tag needs at least one letter or digit")
    return name


def openscad() -> str:
    for candidate in (os.environ.get("FABYN_OPENSCAD"), shutil.which("openscad"), APP_BINARY):
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    raise GeneratorUnavailable("OpenSCAD is not installed: brew install --cask openscad@snapshot, "
                               "or set FABYN_OPENSCAD to its binary")


def render(name: str) -> NameTag:
    name = validate(name)
    binary = openscad()
    with tempfile.TemporaryDirectory(prefix="nametag-") as tmp:
        model_path, png_path = Path(tmp, "tag.3mf"), Path(tmp, "tag.png")
        log = _run(binary, ["-D", f'name="{name}"', "-o", str(model_path)], model_path)
        _run(binary, ["-D", f'name="{name}"', "-D", "preview=true", "--render", "--imgsize=1600,700",
                      "--projection=o", "--camera=0,0,0,0,0,0,0", "--viewall", "--autocenter",
                      "--colorscheme=Tomorrow", "-o", str(png_path)], png_path)
        echo = ECHO.search(log)
        if not echo:
            raise GeneratorUnavailable("OpenSCAD did not report the tag size")
        if echo[5] != FONT_FAMILY:
            raise GeneratorUnavailable(f"OpenSCAD used the font {echo[5] or 'unknown'} instead of {FONT_FAMILY}")
        model = normalize_3mf(model_path.read_bytes())
        with Image.open(png_path) as image:
            preview = _crop(image.convert("RGB"))
    length, height, thickness, size = (float(echo[i]) for i in range(1, 5))
    return NameTag(name, model, preview, (round(length, 2), height, thickness), round(size, 2), volume_cm3(model))


def _run(binary: str, args: list[str], output: Path) -> str:
    try:
        done = subprocess.run([binary, *args, str(TEMPLATE)], capture_output=True, text=True, timeout=TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GeneratorUnavailable(f"OpenSCAD did not finish: {exc}") from exc
    if done.returncode != 0 or not output.is_file():
        raise GeneratorUnavailable(f"OpenSCAD failed: {(done.stderr or done.stdout).strip()[-300:]}")
    return done.stderr + done.stdout


def normalize_3mf(data: bytes) -> bytes:
    """The same mesh always gives the same bytes: no creation time, UUIDs from the content, fixed zip dates."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = {info.filename: archive.read(info) for info in archive.infolist() if not info.is_dir()}
    model = CREATED.sub(r"\g<1>1980-01-01T00:00:00Z\g<2>", files["3D/3dmodel.model"].decode("utf-8"))
    seed = hashlib.sha256(UUID_ATTR.sub("", model).encode("utf-8")).hexdigest()
    count = iter(range(1_000_000))
    model = UUID_ATTR.sub(lambda _: f'p:UUID="{uuid.uuid5(uuid.NAMESPACE_OID, f"{seed}/{next(count)}")}"', model)
    files["3D/3dmodel.model"] = model.replace('name="OpenSCAD Model"', 'name="Name tag"').encode("utf-8")
    return deterministic_zip(files)


def volume_cm3(model_3mf: bytes) -> float:
    with zipfile.ZipFile(io.BytesIO(model_3mf)) as archive:
        root = ET.fromstring(archive.read("3D/3dmodel.model"))
    total = 0.0
    for mesh in root.iter(f"{CORE}mesh"):
        v = [(float(p.get("x")), float(p.get("y")), float(p.get("z"))) for p in mesh.iter(f"{CORE}vertex")]
        for t in mesh.iter(f"{CORE}triangle"):
            (ax, ay, az), (bx, by, bz), (cx, cy, cz) = (v[int(t.get(k))] for k in ("v1", "v2", "v3"))
            total += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
    return round(total / 6 / 1000, 3)


def deterministic_zip(files: dict[str, str | bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, date_time=ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o644 << 16
            data = files[name]
            archive.writestr(info, data.encode("utf-8") if isinstance(data, str) else data, compresslevel=6)
    return buffer.getvalue()


def _crop(image: Image.Image) -> Image.Image:
    """Trim the empty background OpenSCAD leaves around the tag, then scale to the preview width."""
    background = Image.new("RGB", image.size, image.getpixel((0, 0)))
    box = ImageChops.difference(image, background).getbbox() or (0, 0, *image.size)
    pad = 24
    box = (max(0, box[0] - pad), max(0, box[1] - pad), min(image.width, box[2] + pad), min(image.height, box[3] + pad))
    tag = image.crop(box)
    return tag.resize((PREVIEW_WIDTH, max(1, round(tag.height * PREVIEW_WIDTH / tag.width))), Image.Resampling.LANCZOS)
