"""Pure production preparation: canonical design in, exact artifact, preview and estimates out.

`fabyn-producer` reads one JSON request on stdin and writes one JSON result on stdout. It reads
only the declared input files and writes derived files into output_dir: no network, devices,
reservations or payment. Identical input yields byte-identical outputs and hashes.
"""
from __future__ import annotations

import functools
import hashlib
import io
import json
import math
import os
import re
import sys
import zipfile
from dataclasses import dataclass, field, replace
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps

from . import nametag, svg_subset
from .prepare import MAX_PIXELS, _load as load_image

COMPILER_VERSION = "producer-prepare/1"
MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_PHOTO_BYTES = 50 * 1024 * 1024
MAX_MODEL_BYTES = 200 * 1024 * 1024
MAX_PREVIEW_BYTES = 20 * 1024 * 1024
REAL_PROCESSES = {"sticker_print", "photo_print", "fdm_print"}
SIMULATION_ONLY = {"laser_cut", "cnc_route", "vinyl_cut", "large_format_print", "document_print", "sewing", "heat_press"}
PROCESSES = REAL_PROCESSES | SIMULATION_ONLY
KINDS = {"svg", "photos", "text_tag", "catalog_model", "sim_catalog_item"}
STICKER_WIDTHS_MM = {15, 25, 48, 53}  # 48: the M02 Pro's printable width on the 53 mm roll
SHA256 = re.compile(r"[0-9a-f]{64}")
PROFILE_NUMBERS = {  # key: (minimum, maximum, minimum is exclusive)
    "dpi": (0, 4800, True), "printable_width_mm": (0, 10_000, True), "safe_margin_mm": (0, 1000, False),
    "min_line_mm": (0, 100, True), "seconds_per_unit": (0, 1e7, False), "setup_seconds": (0, 1e7, False),
    "material_density_g_cm3": (0, 30, True),
}
PROFILE_VECTORS = {"raster_px": 2, "media_outer_mm": 2, "printable_area_mm": 2, "build_volume_mm": 3}


class Outcome(Exception):
    """A typed, expected non-ready result (rejected or needs_review)."""

    def __init__(self, code: str, reason: str, status: str = "rejected"):
        super().__init__(reason)
        self.code, self.reason, self.status = code, reason, status


def _invalid(reason: str) -> Outcome:
    return Outcome("invalid_request", reason)


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest(value: object) -> str:
    try:
        return sha256_hex(canonical_json(value).encode("utf-8"))
    except (TypeError, ValueError) as exc:
        raise _invalid("Request is not canonical JSON") from exc


@dataclass
class Job:
    digest: str
    process: str
    mode: str
    machine: dict
    profile: dict
    design: dict
    params: dict
    out: Path
    warnings: list[str] = field(default_factory=list)

    @property
    def prep_id(self) -> str:
        return "prep_" + self.digest[:24]


# ---------------------------------------------------------------- operations

def handle(request: object) -> dict:
    operation = request.get("operation") if isinstance(request, dict) else None
    if operation == "prepare":
        return prepare(request)
    if operation == "render_design_preview":
        return render_design_preview(request)
    return {"status": "rejected", "input_digest": None, "code": "invalid_request",
            "reason": "operation must be prepare or render_design_preview"}


def prepare(request: dict) -> dict:
    input_digest = None
    try:
        if not isinstance(request, dict):
            raise _invalid("Request must be a JSON object")
        input_digest = digest({k: v for k, v in request.items() if k != "output_dir"})
        job = _validate(request, input_digest)
        _check_canonical(job.design)
        result = _compile(job)
    except Outcome as exc:
        return {"status": exc.status, "input_digest": input_digest, "code": exc.code, "reason": exc.reason}
    return {"status": "ready", "preparation_id": job.prep_id, "input_digest": job.digest,
            "canonical_sha256": job.design["canonical_sha256"].lower(), "machine_id": job.machine["id"],
            "execution_mode": job.mode, "process": job.process, "profile_version": job.profile["version"],
            "compiler_version": COMPILER_VERSION, **result, "warnings": job.warnings}


def render_design_preview(request: dict) -> dict:
    try:
        size = _integer(request.get("size_px"), "size_px", 64, 1024)
        out = _output_dir(request.get("output_dir"))
        svg = request.get("svg")
        drawing = _drawing(svg)
        image = svg_subset.render(drawing, (size, size), round(size * 0.04))
        if image.getextrema()[0] >= 128:
            raise Outcome("svg_empty", "The design renders no visible ink at this size")
        name = f"design_{digest({'size_px': size, 'svg': svg})[:16]}.png"
        info = _emit(out, name, _png(image), "image/png")
    except Outcome as exc:
        return {"status": exc.status, "code": exc.code, "reason": exc.reason}
    return {"status": "ready", "path": info["path"], "sha256": info["sha256"], "width_px": size, "height_px": size}


# ---------------------------------------------------------------- validation

def _dict(value: object, name: str) -> dict:
    if not isinstance(value, dict):
        raise _invalid(f"{name} must be an object")
    return value


def _text(value: object, name: str, low: int = 1, high: int = 200) -> str:
    if not isinstance(value, str) or not low <= len(value) <= high:
        raise _invalid(f"{name} must be a string of {low}-{high} characters")
    return value


def _clean(value: float) -> float | int:
    """Whole floats become ints so echoed numbers match JavaScript's canonical form."""
    return int(value) if isinstance(value, float) and value.is_integer() else value


def _number(value: object, name: str, low: float, high: float, exclusive: bool = False) -> float | int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise _invalid(f"{name} must be a finite number")
    if value < low or value > high or (exclusive and value == low):
        raise _invalid(f"{name} is out of range")
    return _clean(value)


def _integer(value: object, name: str, low: int, high: int) -> int:
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise _invalid(f"{name} must be an integer in {low}-{high}")
    return value


def _hex(value: object, name: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value.lower()):
        raise _invalid(f"{name} must be a sha256 hex digest")
    return value.lower()


def _validate(request: dict, input_digest: str) -> Job:
    _text(request.get("preparation_key"), "preparation_key", 8, 200)
    process, mode = request.get("process"), request.get("execution_mode")
    if process not in PROCESSES:
        raise _invalid("process is not supported")
    if mode not in ("hardware", "simulation"):
        raise _invalid("execution_mode must be hardware or simulation")
    machine = _dict(request.get("machine"), "machine")
    _text(machine.get("id"), "machine.id")
    _text(machine.get("model"), "machine.model")
    design = _dict(request.get("design"), "design")
    if design.get("kind") not in KINDS:
        raise _invalid("design.kind is not supported")
    _hex(design.get("canonical_sha256"), "design.canonical_sha256")
    return Job(input_digest, process, mode, machine, _profile(request.get("profile")), design,
               _params(request.get("params")), _output_dir(request.get("output_dir")))


def _profile(value: object) -> dict:
    raw = _dict(value, "profile")
    profile = {"version": _text(raw.get("version"), "profile.version")}
    for key, (low, high, exclusive) in PROFILE_NUMBERS.items():
        profile[key] = None if raw.get(key) is None else _number(raw[key], f"profile.{key}", low, high, exclusive)
    for key, length in PROFILE_VECTORS.items():
        item = raw.get(key)
        if item is None:
            profile[key] = None
            continue
        if not isinstance(item, list) or len(item) != length:
            raise _invalid(f"profile.{key} must be a list of {length} numbers")
        if key == "raster_px":
            profile[key] = [_integer(v, "profile.raster_px", 1, 20_000) for v in item]
        else:
            profile[key] = [_number(v, f"profile.{key}", 0, 100_000, True) for v in item]
    return profile


def _params(value: object) -> dict:
    raw = _dict(value, "params")
    if raw.get("crop") not in ("contain", "cover", "auto"):
        raise _invalid("params.crop must be contain, cover or auto")
    if raw.get("fit", "frame") not in ("frame", "content"):
        raise _invalid("params.fit must be frame or content")
    if raw.get("orientation", "keep") not in ("keep", "auto"):
        raise _invalid("params.orientation must be keep or auto")
    if raw.get("color_mode") not in ("mono", "color"):
        raise _invalid("params.color_mode must be mono or color")
    return {"width_mm": _number(raw.get("width_mm"), "params.width_mm", 0, 10_000, True),
            "height_mm": _number(raw.get("height_mm"), "params.height_mm", 0, 10_000, True),
            "quantity": _integer(raw.get("quantity"), "params.quantity", 1, 100_000),
            "material": _text(raw.get("material"), "params.material", 1, 100),
            "crop": raw["crop"], "color_mode": raw["color_mode"],
            # fit=content trims empty space and sizes a sticker to the design;
            # orientation=auto turns a wide photo to use the film's long side.
            "fit": raw.get("fit", "frame"), "orientation": raw.get("orientation", "keep")}


def _output_dir(value: object) -> Path:
    if not isinstance(value, str) or not os.path.isabs(value) or "\x00" in value:
        raise _invalid("output_dir must be an absolute path")
    return Path(value)


def _check_canonical(design: dict) -> None:
    actual = digest({k: v for k, v in design.items() if k != "canonical_sha256"})
    if actual != design["canonical_sha256"].lower():
        raise Outcome("canonical_mismatch", "design.canonical_sha256 does not match the canonical JSON of the design")


def _require(job: Job, *keys: str) -> None:
    missing = [key for key in keys if job.profile[key] is None]
    if missing:
        raise Outcome("profile_incomplete", f"Profile {job.profile['version']} for {job.machine['model']} lacks "
                      f"{', '.join(missing)}; {job.process} cannot be prepared without guessing", "needs_review")


# ---------------------------------------------------------------- files

def _read_input(path: object, name: str, limit: int, expected: str | None = None) -> bytes:
    if not isinstance(path, str) or not os.path.isabs(path) or "\x00" in path or ".." in Path(path).parts:
        raise _invalid(f"{name} must be an absolute path without '..'")
    given = Path(path)
    try:
        directory, real = given.parent.resolve(strict=True), given.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise Outcome("input_unreadable", f"{name} does not exist") from exc
    if not real.is_relative_to(directory) or not real.is_file():
        raise Outcome("input_unreadable", f"{name} must be a regular file that does not link outside its directory")
    try:
        with real.open("rb") as handle:
            data = handle.read(limit + 1)
    except OSError as exc:
        raise Outcome("input_unreadable", f"{name} cannot be read") from exc
    if len(data) > limit:
        raise Outcome("input_unreadable", f"{name} exceeds {limit // (1024 * 1024)} MB")
    if expected is not None and sha256_hex(data) != expected:
        raise Outcome("input_hash_mismatch", f"{name} does not match its declared sha256")
    return data


def _emit(directory: Path, name: str, data: bytes, media_type: str) -> dict:
    target = directory / name
    try:
        directory.mkdir(parents=True, exist_ok=True)
        temporary = directory / f".{name}.{os.getpid()}.tmp"
        temporary.write_bytes(data)
        os.replace(temporary, target)
    except OSError as exc:
        raise Outcome("output_unwritable", f"Cannot write {name}: {exc.strerror or exc}") from exc
    return {"path": str(target), "sha256": sha256_hex(data), "media_type": media_type, "bytes": len(data)}


def _png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=False, compress_level=6)
    return buffer.getvalue()


def _preview(info: dict, size: tuple[int, int], color: str) -> dict:
    return {"path": info["path"], "sha256": info["sha256"], "media_type": "image/png",
            "width_px": size[0], "height_px": size[1], "color": color}


def _round(value: float, digits: int = 3) -> float | int:
    return _clean(round(value, digits))


def _estimates(amount: float, unit: str, seconds: float, setup: float | None, basis: str) -> dict:
    return {"material": {"amount": _round(amount), "unit": unit}, "minutes_per_unit": _round(seconds / 60),
            "setup_minutes": _round((setup or 0) / 60), "basis": basis}


# ---------------------------------------------------------------- designs

def _drawing(svg: object) -> svg_subset.Drawing:
    if not isinstance(svg, str):
        raise _invalid("svg must be a string")
    try:
        return svg_subset.parse_svg(svg)
    except svg_subset.SvgError as exc:
        raise Outcome(exc.code, exc.reason) from exc


def _subject_box(value: object) -> list[float] | None:
    if value is None:
        return None
    if not isinstance(value, list) or len(value) != 4:
        raise _invalid("subject_box must be [x0, y0, x1, y1] or null")
    box = [float(_number(v, "subject_box", 0, 1)) for v in value]
    if box[0] >= box[2] or box[1] >= box[3]:
        raise _invalid("subject_box must have x0 < x1 and y0 < y1")
    return box


def _photo(job: Job) -> tuple[Image.Image, list[float] | None]:
    photos = job.design.get("photos")
    if not isinstance(photos, list) or len(photos) != 1:
        raise Outcome("design_unsupported", f"{job.process} takes exactly one photo")
    entry = _dict(photos[0], "design.photos[0]")
    expected = _hex(entry.get("sha256"), "design.photos[0].sha256")
    box = _subject_box(entry.get("subject_box"))
    data = _read_input(entry.get("path"), "design.photos[0].path", MAX_PHOTO_BYTES, expected)
    try:
        return load_image(io.BytesIO(data)), box
    except Exception as exc:  # any decoder failure on untrusted bytes is a typed rejection
        raise Outcome("input_unreadable", f"Photo cannot be decoded: {exc}") from exc


def _wide(width: float, height: float, portrait_frame: bool) -> bool:
    """True when turning the picture a quarter would use the frame's long side."""
    return width > height * 1.05 if portrait_frame else height > width * 1.05


def _turn_box(box: list[float] | None) -> list[float] | None:
    """A subject box after ROTATE_90 (counter-clockwise): (x, y) -> (y, 1 - x)."""
    return None if box is None else [box[1], 1 - box[2], box[3], 1 - box[0]]


def _trim_drawing(drawing: svg_subset.Drawing) -> svg_subset.Drawing:
    """Shrink the viewBox to the inked area (including stroke width) plus a hairline."""
    min_x, min_y, width, height = drawing.view_box
    probe_size = (1024, max(1, round(1024 * height / width))) if width >= height else (max(1, round(1024 * width / height)), 1024)
    probe = svg_subset.render(drawing, probe_size, 0)
    bbox = probe.point(lambda v: 255 if v < 250 else 0).getbbox()
    if not bbox:
        return drawing  # blank: preflight reports it
    scale, ox, oy = svg_subset.fit(drawing.view_box, probe_size, 0)
    pad = 2 / scale
    x0, y0 = (bbox[0] - ox) / scale - pad, (bbox[1] - oy) / scale - pad
    x1, y1 = (bbox[2] - ox) / scale + pad, (bbox[3] - oy) / scale + pad
    return replace(drawing, view_box=(x0, y0, x1 - x0, y1 - y0))


def _trim_photo(image: Image.Image) -> Image.Image:
    """Cut away a plain border (the corner colour) around the picture's content."""
    rgb = image.convert("RGB")
    background = Image.new("RGB", rgb.size, rgb.getpixel((0, 0)))
    bbox = ImageChops.difference(rgb, background).convert("L").point(lambda v: 255 if v > 24 else 0).getbbox()
    if not bbox or (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) >= 0.98 * rgb.width * rgb.height:
        return image
    pad = max(2, round(0.02 * max(bbox[2] - bbox[0], bbox[3] - bbox[1])))
    return image.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                       min(rgb.width, bbox[2] + pad), min(rgb.height, bbox[3] + pad)))


def _fit(image: Image.Image, size: tuple[int, int], crop: str, box: list[float] | None, warnings: list[str]) -> Image.Image:
    (tw, th), (iw, ih) = size, image.size
    enlargement = (max if crop == "cover" else min)(tw / iw, th / ih)
    if enlargement > 2:
        warnings.append(f"The photo is {iw}x{ih} px and is enlarged {enlargement:.1f}x to fit; it may look soft")
    if crop == "contain":
        return ImageOps.pad(image, size, method=Image.Resampling.LANCZOS, color="white")
    aspect = tw / th
    cw, ch = (ih * aspect, float(ih)) if iw / ih > aspect else (float(iw), iw / aspect)
    cx, cy = ((box[0] + box[2]) / 2 * iw, (box[1] + box[3]) / 2 * ih) if box else (iw / 2, ih / 2)
    left, top = min(max(cx - cw / 2, 0.0), iw - cw), min(max(cy - ch / 2, 0.0), ih - ch)
    if box and (box[0] * iw < left - 0.5 or box[2] * iw > left + cw + 0.5
                or box[1] * ih < top - 0.5 or box[3] * ih > top + ch + 0.5):
        warnings.append("Part of the marked subject falls outside the cover crop; use contain to keep all of it")
    return image.resize(size, Image.Resampling.LANCZOS, box=(left, top, left + cw, top + ch))


# ---------------------------------------------------------------- processes

def _compile(job: Job) -> dict:
    if job.process in SIMULATION_ONLY or job.design["kind"] == "sim_catalog_item":
        return _simulation(job)
    return {"sticker_print": _sticker, "photo_print": _photo_print, "fdm_print": _fdm}[job.process](job)


def _sticker(job: Job) -> dict:
    _require(job, "dpi", "printable_width_mm", "safe_margin_mm", "seconds_per_unit")
    profile, params = job.profile, job.params
    if params["color_mode"] != "mono":
        raise Outcome("color_mode_unsupported", "Thermal stickers print in monochrome only")
    width, height = params["width_mm"], params["height_mm"]
    if width not in STICKER_WIDTHS_MM or width > profile["printable_width_mm"]:
        raise Outcome("dimensions_unsupported", "Sticker width must be 15, 25, 48 or 53 mm and within the "
                      f"{profile['printable_width_mm']} mm printable width")
    if not 5 <= height <= 150:
        raise Outcome("dimensions_unsupported", "Sticker height must be 5-150 mm")
    dpi = profile["dpi"]
    margin = round(profile["safe_margin_mm"] / 25.4 * dpi)
    kind = job.design["kind"]
    drawing = _drawing(job.design.get("svg")) if kind == "svg" else None
    photo, box = _photo(job) if kind == "photos" else (None, None)
    if params["fit"] == "content" and kind in ("svg", "photos"):
        # Trim empty space, then let the design's shape set the label length.
        if drawing is not None:
            drawing = _trim_drawing(drawing)
            aspect = drawing.view_box[3] / drawing.view_box[2]
        else:
            photo = _trim_photo(photo)
            aspect = photo.height / photo.width
        inner_w = round(width / 25.4 * dpi) - 2 * margin
        wanted = (inner_w * aspect + 2 * margin) / dpi * 25.4
        height = min(150, max(5, round(wanted)))
        if wanted > 150.5:
            job.warnings.append("The design is taller than the longest label, so it is printed 150 mm long and narrower")
        params = {**params, "height_mm": height}
    size = (round(width / 25.4 * dpi), round(height / 25.4 * dpi))
    if min(size) - 2 * margin < 8:
        raise Outcome("dimensions_unsupported", "The safe margin leaves no printable area")
    if kind == "svg":
        bitmap = svg_subset.render(drawing, size, margin).convert("1", dither=Image.Dither.NONE)
        thinnest = svg_subset.min_stroke_width(drawing)
        if profile["min_line_mm"] is not None and thinnest is not None:
            line_mm = thinnest * svg_subset.fit(drawing.view_box, size, margin)[0] * 25.4 / dpi
            if line_mm < profile["min_line_mm"]:
                job.warnings.append(f"Thinnest line is {line_mm:.2f} mm; this printer reliably prints lines "
                                    f"from {profile['min_line_mm']} mm, so it may break up")
    elif kind == "photos":
        inner = (size[0] - 2 * margin, size[1] - 2 * margin)
        crop = "contain" if params["crop"] == "auto" else params["crop"]
        fitted = ImageOps.autocontrast(_fit(photo, inner, crop, box, job.warnings).convert("L"))
        bitmap = Image.new("1", size, 1)
        bitmap.paste(fitted.convert("1", dither=Image.Dither.FLOYDSTEINBERG), (margin, margin))
    else:
        raise Outcome("design_unsupported", f"Stickers are prepared from an SVG or one photo, not {kind}")
    printable = bitmap.crop((margin, margin, size[0] - margin, size[1] - margin))
    ink = printable.histogram()[0] / (printable.width * printable.height)
    if ink <= 0.003:
        raise Outcome("preflight_empty", "The prepared sticker is (almost) blank")
    if ink >= 0.97:
        raise Outcome("preflight_solid", "The prepared sticker is (almost) solid black")
    artifact = _emit(job.out, f"{job.prep_id}_sticker.png", _png(bitmap), "image/png")
    return {"artifact": artifact, "recipe": None, "preview": _preview(artifact, size, "mono"),
            "parameters": {**params, "dpi": dpi, "raster_px": list(size), "safe_margin_mm": profile["safe_margin_mm"]},
            "estimates": _estimates(params["quantity"], "label", profile["seconds_per_unit"], profile["setup_seconds"], "estimated"),
            "handling": ["Thermal label: tear against the cutter edge; keep away from heat and direct sunlight"]}


def _photo_print(job: Job) -> dict:
    _require(job, "raster_px", "media_outer_mm", "printable_area_mm", "seconds_per_unit")
    profile, params = job.profile, job.params
    outer = profile["media_outer_mm"]
    if abs(params["width_mm"] - outer[0]) > 0.01 or abs(params["height_mm"] - outer[1]) > 0.01:
        raise Outcome("dimensions_unsupported", f"This media has a fixed {outer[0]} x {outer[1]} mm outside format")
    raster = (profile["raster_px"][0], profile["raster_px"][1])
    kind = job.design["kind"]
    portrait = raster[0] <= raster[1]
    rotated = False
    if kind == "photos":
        image, box = _photo(job)
        if params["orientation"] == "auto" and _wide(image.width, image.height, portrait):
            # Use the film's long side: turn the picture a quarter (top edge to the left).
            image, box, rotated = image.transpose(Image.Transpose.ROTATE_90), _turn_box(box), True
        crop = params["crop"]
        if crop == "auto":
            # Fill the frame unless that would cut away more than a fifth of the picture.
            kept = min(raster[0] / raster[1] / (image.width / image.height),
                       (image.width / image.height) / (raster[0] / raster[1]))
            crop = "cover" if kept >= 0.8 else "contain"
            if crop == "contain":
                job.warnings.append("The picture is very wide or tall, so it is printed whole with white borders")
        prepared = _fit(image, raster, crop, box, job.warnings)
        params = {**params, "crop": crop}
    elif kind == "svg":
        drawing = _drawing(job.design.get("svg"))
        _, _, vw, vh = drawing.view_box
        frame = raster
        if params["orientation"] == "auto" and _wide(vw, vh, portrait):
            frame, rotated = (raster[1], raster[0]), True
        prepared = svg_subset.render(drawing, frame, round(0.04 * min(frame))).convert("RGB")
        if rotated:
            prepared = prepared.transpose(Image.Transpose.ROTATE_90)
        params = {**params, "crop": "contain"}  # a drawing is always fitted whole
    else:
        raise Outcome("design_unsupported", f"Photo prints are prepared from one photo or an SVG, not {kind}")
    if params["color_mode"] == "mono":
        prepared = prepared.convert("L").convert("RGB")
    low, high = prepared.convert("L").getextrema()
    if high - low < 8:
        raise Outcome("preflight_empty", "The prepared photo is blank or a single flat tone")
    artifact = _emit(job.out, f"{job.prep_id}_photo.png", _png(prepared), "image/png")
    preview = _preview(artifact, raster, params["color_mode"])
    handling = ["Photo print: keep it flat and out of direct light while it develops"]
    if rotated:
        # The person approves the picture upright; the printer gets the turned file.
        upright = prepared.transpose(Image.Transpose.ROTATE_270)
        preview = _preview(_emit(job.out, f"{job.prep_id}_photo_preview.png", _png(upright), "image/png"),
                           upright.size, params["color_mode"])
        handling.append("Wide picture: printed sideways on the film; turn the print a quarter to view it")
    return {"artifact": artifact, "recipe": None, "preview": preview,
            "parameters": {**params, "dpi": profile["dpi"], "raster_px": list(raster), "media_outer_mm": outer,
                           "printable_area_mm": profile["printable_area_mm"], "rotated_degrees": 90 if rotated else 0},
            "estimates": _estimates(params["quantity"], "sheet", profile["seconds_per_unit"], profile["setup_seconds"], "estimated"),
            "handling": handling}


def _fdm(job: Job) -> dict:
    kind = job.design["kind"]
    if kind == "text_tag":
        return _text_tag(job)
    if kind == "catalog_model":
        return _catalog_model(job)
    raise Outcome("design_unsupported", "3D prints need the name tag template or a vetted catalog model")


def _single_filament(job: Job) -> None:
    if job.params["color_mode"] != "mono":
        raise Outcome("color_mode_unsupported", "Single-filament 3D prints are one color; use mono and name the filament as material")


def _text_tag(job: Job) -> dict:
    """The name tag: OpenSCAD engraves the text into a plate with a keyring hole (nametag.scad)."""
    text = job.design.get("text")
    if not isinstance(text, str):
        raise _invalid("design.text must be a string")
    _require(job, "material_density_g_cm3")
    _single_filament(job)
    try:
        tag = nametag.render(text)
    except nametag.TemplateError as exc:
        raise Outcome("template_charset", str(exc)) from exc
    except nametag.GeneratorUnavailable as exc:
        raise Outcome("generator_unavailable", str(exc)) from exc
    dims = [_round(value) for value in tag.size_mm]
    volume = job.profile["build_volume_mm"]
    flat_fit = volume and ((dims[0] <= volume[0] and dims[1] <= volume[1]) or (dims[0] <= volume[1] and dims[1] <= volume[0]))
    if volume and (not flat_fit or dims[2] > volume[2]):
        raise Outcome("exceeds_build_volume", f"A {dims[0]} x {dims[1]} x {dims[2]} mm tag does not fit the "
                      f"{volume[0]} x {volume[1]} x {volume[2]} mm build volume")
    params = job.params
    if abs(params["width_mm"] - dims[0]) > 0.5 or abs(params["height_mm"] - dims[1]) > 0.5:
        job.warnings.append(f"Tag size is set by its text: {dims[0]} x {dims[1]} mm")
    artifact = _emit(job.out, f"{job.prep_id}_nametag.3mf", tag.model, "model/3mf")
    image = tag.preview
    preview = _emit(job.out, f"{job.prep_id}_preview.png", _png(image), "image/png")
    density = job.profile["material_density_g_cm3"]
    grams = round(tag.volume_cm3 * density * nametag.FILL, 2)
    return {"artifact": artifact, "recipe": None, "preview": _preview(preview, image.size, "mono"),
            "parameters": {**params, "width_mm": dims[0], "height_mm": dims[1], "dpi": None, "raster_px": None,
                           "text": tag.name, "model_size_mm": dims, "text_size": tag.text_size,
                           "material_density_g_cm3": density, "slicing": "receiver"},
            "estimates": {"material": {"amount": _round(grams * params["quantity"], 2), "unit": "g"},
                          "minutes_per_unit": _round(grams * nametag.MINUTES_PER_GRAM, 1),
                          "setup_minutes": nametag.SETUP_MINUTES, "basis": "estimated"},
            # The receiving end slices with its own printer profile; our estimates come from the volume.
            "handling": ["Unsliced 3MF: the printer's node slices it with its own profile; estimates come from its volume"
                         if job.mode == "hardware" else
                         "Simulated 3D run: the 3MF is unsliced template geometry; estimates come from its volume"]}


def _catalog_model(job: Job) -> dict:
    entry = _dict(job.design.get("catalog_model"), "design.catalog_model")
    expected = _hex(entry.get("sha256"), "design.catalog_model.sha256")
    seconds = _integer(entry.get("estimated_seconds"), "design.catalog_model.estimated_seconds", 1, 7 * 24 * 3600)
    grams = None if entry.get("grams") is None else _number(entry["grams"], "design.catalog_model.grams", 0, 100_000)
    _single_filament(job)
    model = _read_input(entry.get("path"), "design.catalog_model.path", MAX_MODEL_BYTES, expected)
    try:
        with zipfile.ZipFile(io.BytesIO(model)) as archive:
            names = {info.filename.lower() for info in archive.infolist()}
    except (zipfile.BadZipFile, ValueError) as exc:
        raise Outcome("artifact_invalid", "Catalog model is not a 3MF package") from exc
    if "3d/3dmodel.model" not in names:
        raise Outcome("artifact_invalid", "Catalog 3MF lacks 3D/3dmodel.model")
    preview_bytes = _read_input(entry.get("preview_path"), "design.catalog_model.preview_path", MAX_PREVIEW_BYTES)
    try:
        with Image.open(io.BytesIO(preview_bytes)) as image:
            if image.format != "PNG" or image.width * image.height > MAX_PIXELS:
                raise ValueError("not a bounded PNG")
            image.load()
            size, color = image.size, "mono" if image.mode in ("1", "L", "LA", "I;16") else "color"
    except Exception as exc:  # any decoder failure on untrusted bytes is a typed rejection
        raise Outcome("input_unreadable", "Catalog preview must be a decodable PNG") from exc
    artifact = _emit(job.out, f"model_{expected}.3mf", model, "model/3mf")
    preview = _emit(job.out, f"model_preview_{sha256_hex(preview_bytes)}.png", preview_bytes, "image/png")
    quantity = job.params["quantity"]
    if grams is None:
        job.warnings.append("Filament use is not recorded for this catalog model; material is counted per model")
    material = {"amount": _round(grams * quantity, 2), "unit": "g"} if grams is not None else {"amount": quantity, "unit": "model"}
    return {"artifact": artifact, "recipe": None, "preview": _preview(preview, size, color),
            "parameters": {**job.params, "dpi": None, "raster_px": None, "model_sha256": expected},
            "estimates": {"material": material, "minutes_per_unit": _round(seconds / 60),
                          "setup_minutes": _round((job.profile["setup_seconds"] or 0) / 60),
                          "basis": "measured" if grams is not None else "estimated"},
            "handling": ["Let the build plate cool before removing the part"]}


def _catalog_item(value: object) -> dict:
    raw = _dict(value, "design.catalog_item")
    item = {key: _text(raw.get(key), f"design.catalog_item.{key}", 1, limit)
            for key, limit in (("id", 100), ("name", 120), ("unit", 40), ("material_unit", 40))}
    for key in ("setup_seconds", "seconds_per_unit", "material_per_unit"):
        item[key] = _number(raw.get(key), f"design.catalog_item.{key}", 0, 1e7)
    return item


def _simulation(job: Job) -> dict:
    if job.mode != "simulation":
        raise Outcome("simulation_only_process", f"{job.process} with a {job.design['kind']} design runs only in simulation mode")
    if job.design["kind"] != "sim_catalog_item":
        raise Outcome("design_unsupported", f"{job.process} accepts only a simulated catalog item")
    item, params = _catalog_item(job.design.get("catalog_item")), job.params
    amount = _round(params["quantity"] * item["material_per_unit"])
    card = _simulation_card(item, params["quantity"], amount)
    preview = _emit(job.out, f"{job.prep_id}_simulated.png", _png(card), "image/png")
    estimates = _estimates(amount, item["material_unit"], item["seconds_per_unit"], item["setup_seconds"], "simulated")
    return {"artifact": None,
            "recipe": {"kind": "simulation", "sha256": digest({"item": item, "params": params}),
                       "item_id": item["id"], "name": item["name"]},
            "preview": _preview(preview, card.size, "color"),
            "parameters": {**params, "dpi": None, "raster_px": None},
            "estimates": estimates,
            "handling": ["Simulation only: nothing physical is produced, shipped or collected"]}


@functools.lru_cache(maxsize=8)
def _font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    return ImageFont.load_default(size=size)


def _truncate(text: str, font, width: float) -> str:
    if font.getlength(text) <= width:
        return text
    while text and font.getlength(text + "...") > width:
        text = text[:-1]
    return text + "..."


def _wrap(text: str, font, width: float, max_lines: int) -> list[str]:
    lines, current = [], ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and font.getlength(candidate) > width:
            lines.append(current)
            current = word
        else:
            current = candidate
    lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] += " ..."
    return [_truncate(line, font, width) for line in lines]


def _simulation_card(item: dict, quantity: int, material: float | int) -> Image.Image:
    card = Image.new("RGB", (480, 320), "white")
    draw = ImageDraw.Draw(card)
    ink, muted = (24, 24, 27), (82, 82, 91)
    draw.rectangle((0, 0, 479, 319), outline=(161, 161, 170), width=2)
    draw.rounded_rectangle((28, 36, 148, 156), radius=12, outline=muted, width=3)  # outline icon area
    draw.line((28, 78, 148, 78), fill=muted, width=3)
    draw.line((88, 36, 88, 78), fill=muted, width=3)
    left, width = 172, 480 - 172 - 24
    for index, line in enumerate(_wrap(item["name"], _font(22), width, 2)):
        draw.text((left, 36 + index * 28), line, fill=ink, font=_font(22))
    draw.text((left, 104), _truncate(f"Quantity: {quantity} {item['unit']}", _font(16), width), fill=muted, font=_font(16))
    draw.text((left, 128), _truncate(f"Material: {material} {item['material_unit']}", _font(16), width), fill=muted, font=_font(16))
    draw.text((left, 152), _truncate(f"Item: {item['id']}", _font(16), width), fill=muted, font=_font(16))
    draw.rectangle((2, 232, 477, 317), fill=(255, 237, 213))
    draw.text((28, 260), "SIMULATED - no physical item", fill=(154, 52, 18), font=_font(24))
    return card


# ---------------------------------------------------------------- CLI

def _parse(raw: bytes) -> object:
    def constant(name: str) -> None:
        raise ValueError(f"{name} is not valid JSON")
    return json.loads(raw.decode("utf-8"), parse_constant=constant)


def main() -> None:
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            result = {"status": "rejected", "input_digest": None, "code": "invalid_request", "reason": "Request exceeds 2 MB"}
        else:
            try:
                request = _parse(raw)
            except (ValueError, RecursionError):
                result = {"status": "rejected", "input_digest": None, "code": "invalid_request",
                          "reason": "Request is not a valid UTF-8 JSON object"}
            else:
                result = handle(request)
        sys.stdout.write(json.dumps(result, sort_keys=True) + "\n")
        sys.stdout.flush()
    except Exception as exc:  # unexpected crash: short message and a nonzero exit
        print(f"fabyn-producer: internal error: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
