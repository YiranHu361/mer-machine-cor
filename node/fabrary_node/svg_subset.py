"""Strict, script-free SVG subset: parse a small vocabulary and rasterize it with Pillow.

Anything outside the allow-lists (elements, attributes, paints, transforms, references,
DTDs, processing instructions) is rejected rather than ignored.
"""
from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from PIL import Image, ImageChops, ImageDraw

SVG_NS = "http://www.w3.org/2000/svg"
MAX_BYTES = 100 * 1024
MAX_ELEMENTS = 5000
MAX_DEPTH = 32
MAX_POINTS = 150_000
MAX_SUBPATHS = 1000  # bounds per-subpath fill compositing work
MAX_COORD = 1e6
ELEMENTS = {"svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "title", "desc"}
ATTRIBUTES = {"viewBox", "xmlns", "version", "width", "height", "id", "fill", "stroke", "stroke-width",
              "stroke-linecap", "stroke-linejoin", "fill-rule", "d", "points", "x", "y", "cx", "cy", "r",
              "rx", "ry", "x1", "y1", "x2", "y2"}
PAINTS = {"none": None, "black": 0, "#000": 0, "#000000": 0, "white": 255, "#fff": 255, "#ffffff": 255}
ENUMS = {"stroke-linecap": {"butt", "round", "square"}, "stroke-linejoin": {"miter", "round", "bevel"},
         "fill-rule": {"nonzero", "evenodd"}}
DEFAULT_STYLE = {"fill": 0, "stroke": None, "stroke-width": 1.0, "stroke-linecap": "butt",
                 "stroke-linejoin": "miter", "fill-rule": "nonzero"}
NUMBER = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")
PATH_ARITY = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}

Point = tuple[float, float]


class SvgError(ValueError):
    def __init__(self, code: str, reason: str):
        super().__init__(reason)
        self.code, self.reason = code, reason


def _unsupported(reason: str) -> SvgError:
    return SvgError("svg_unsupported", reason)


def _invalid(reason: str) -> SvgError:
    return SvgError("svg_invalid", reason)


@dataclass(frozen=True)
class Subpath:
    points: tuple[Point, ...]
    closed: bool


@dataclass(frozen=True)
class Shape:
    subpaths: tuple[Subpath, ...]
    fill: int | None
    stroke: int | None
    stroke_width: float
    linecap: str
    linejoin: str
    fill_rule: str


@dataclass(frozen=True)
class Drawing:
    view_box: tuple[float, float, float, float]
    shapes: tuple[Shape, ...]


# ---------------------------------------------------------------- parsing

def parse_svg(text: str) -> Drawing:
    if not isinstance(text, str):
        raise _invalid("SVG must be a string")
    try:
        size = len(text.encode("utf-8"))
    except UnicodeEncodeError as exc:
        raise _invalid("SVG is not valid UTF-8 text") from exc
    if size > MAX_BYTES:
        raise SvgError("svg_too_large", f"SVG is {size} bytes; the limit is {MAX_BYTES}")
    _check_markup(text)
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise _invalid(f"SVG is not well-formed XML: {exc}") from exc
    if _local(root.tag) != "svg":
        raise _unsupported("Root element must be <svg>")
    _check_attributes(root)
    view_box = _view_box(root.attrib.get("viewBox"))
    _check_text(root.text)
    style = _style(root, DEFAULT_STYLE)
    shapes: list[Shape] = []
    budget = {"elements": 0, "points": 0, "subpaths": 0}
    _walk(root, style, 1, max(view_box[2], view_box[3]), shapes, budget)
    if not any(_has_ink(shape) for shape in shapes):
        raise SvgError("svg_empty", "SVG contains no black ink to draw")
    return Drawing(view_box, tuple(shapes))


def _check_markup(text: str) -> None:
    lowered = text.lower()
    for token in ("<!doctype", "<!entity", "<?xml-stylesheet"):
        if token in lowered:
            raise _unsupported(f"{token.upper()} is not allowed")
    body = text.lstrip("﻿ \t\r\n")
    if body.startswith("<?xml") and body[5:6] in (" ", "\t", "\r", "\n", "?"):
        end = body.find("?>")
        if end < 0:
            raise _invalid("Unterminated XML declaration")
        body = body[end + 2:]
    if "<?" in body:
        raise _unsupported("Processing instructions are not allowed")
    if re.search(r"<!(?!--)", body):
        raise _unsupported("Only comments are allowed among <! declarations")


def _local(tag: object) -> str:
    if not isinstance(tag, str):
        raise _unsupported("Unexpected XML node")
    if tag.startswith("{"):
        namespace, _, name = tag[1:].partition("}")
        if namespace != SVG_NS:
            raise _unsupported(f"Namespace {namespace} is not allowed")
        return name
    return tag


def _check_attributes(element: ET.Element) -> None:
    for key in element.attrib:
        if key not in ATTRIBUTES:
            raise _unsupported(f"Attribute {key.split('}')[-1]!r} is not allowed")


def _check_text(text: str | None) -> None:
    if text and text.strip():
        raise _unsupported("Text content is only allowed inside <title> and <desc>")


def _view_box(value: str | None) -> tuple[float, float, float, float]:
    if value is None:
        raise _unsupported("Root <svg> needs a viewBox")
    numbers = _number_list(value, "viewBox")
    if len(numbers) != 4:
        raise _invalid("viewBox needs four numbers")
    if not (0 < numbers[2] <= 4096 and 0 < numbers[3] <= 4096):
        raise _unsupported("viewBox width and height must be in (0, 4096]")
    return numbers[0], numbers[1], numbers[2], numbers[3]


def _number(value: str, name: str) -> float:
    text = value.strip()
    if text.endswith("px"):
        text = text[:-2].rstrip()
    if not NUMBER.fullmatch(text):
        raise _invalid(f"{name} is not a plain number")
    return _finite(float(text), name)


def _finite(number: float, name: str) -> float:
    if not math.isfinite(number) or abs(number) > MAX_COORD:
        raise _unsupported(f"{name} is out of range")
    return number


def _number_list(value: str, name: str) -> list[float]:
    numbers, i, text = [], 0, value.strip()
    while i < len(text):
        match = NUMBER.match(text, i)
        if not match:
            raise _invalid(f"{name} contains a malformed number")
        numbers.append(_finite(float(match.group()), name))
        i = match.end()
        i = _skip_separator(text, i)
    return numbers


def _skip_separator(text: str, i: int) -> int:
    while i < len(text) and text[i] in " \t\r\n":
        i += 1
    if i < len(text) and text[i] == ",":
        i += 1
        while i < len(text) and text[i] in " \t\r\n":
            i += 1
    return i


def _style(element: ET.Element, parent: dict) -> dict:
    style = dict(parent)
    for key in ("fill", "stroke"):
        if key in element.attrib:
            value = element.attrib[key].strip().lower()
            if value not in PAINTS:
                raise _unsupported(f"{key} {value[:40]!r} is not allowed; use black, white or none")
            style[key] = PAINTS[value]
    if "stroke-width" in element.attrib:
        width = _number(element.attrib["stroke-width"], "stroke-width")
        if width < 0:
            raise _invalid("stroke-width cannot be negative")
        style["stroke-width"] = width
    for key, allowed in ENUMS.items():
        if key in element.attrib:
            value = element.attrib[key].strip()
            if value not in allowed:
                raise _unsupported(f"{key} {value[:40]!r} is not supported")
            style[key] = value
    return style


def _walk(parent: ET.Element, style: dict, depth: int, extent: float, out: list[Shape], budget: dict) -> None:
    if depth > MAX_DEPTH:
        raise _unsupported("SVG nesting is too deep")
    for child in parent:
        name = _local(child.tag)
        budget["elements"] += 1
        if budget["elements"] > MAX_ELEMENTS:
            raise _unsupported("SVG has too many elements")
        if name not in ELEMENTS or name == "svg":
            raise _unsupported(f"Element <{name[:40]}> is not allowed")
        _check_attributes(child)
        _check_text(child.tail)
        child_style = _style(child, style)
        if name in {"title", "desc"}:
            if len(child):
                raise _unsupported(f"<{name}> cannot contain elements")
            continue
        _check_text(child.text)
        if name == "g":
            _walk(child, child_style, depth + 1, extent, out, budget)
            continue
        if len(child):
            raise _unsupported(f"<{name}> cannot contain elements")
        subpaths = _geometry(name, child.attrib, extent)
        budget["points"] += sum(len(path.points) for path in subpaths)
        budget["subpaths"] += len(subpaths)
        if budget["points"] > MAX_POINTS or budget["subpaths"] > MAX_SUBPATHS:
            raise _unsupported("SVG geometry is too complex")
        if subpaths:
            out.append(Shape(tuple(subpaths), child_style["fill"], child_style["stroke"], child_style["stroke-width"],
                             child_style["stroke-linecap"], child_style["stroke-linejoin"], child_style["fill-rule"]))


def _has_ink(shape: Shape) -> bool:
    return shape.fill == 0 or (shape.stroke == 0 and shape.stroke_width > 0)


def _segments(length: float, extent: float) -> int:
    return max(16, min(128, math.ceil(length / extent * 128)))


def _geometry(name: str, attrs: dict, extent: float) -> list[Subpath]:
    def num(key: str, default: float = 0.0) -> float:
        return _number(attrs[key], key) if key in attrs else default

    def positive(key: str) -> float:
        value = num(key)
        if value < 0:
            raise _invalid(f"{name} {key} cannot be negative")
        return value

    if name == "path":
        return parse_path(attrs.get("d", ""), extent)
    if name in {"polyline", "polygon"}:
        values = _number_list(attrs.get("points", ""), "points")
        if len(values) % 2:
            raise _invalid(f"{name} points need x,y pairs")
        points = tuple(zip(values[::2], values[1::2]))
        return [Subpath(points, name == "polygon")] if len(points) >= 2 else []
    if name == "line":
        return [Subpath(((num("x1"), num("y1")), (num("x2"), num("y2"))), False)]
    if name == "circle":
        r = positive("r")
        return [_ellipse(num("cx"), num("cy"), r, r, extent)] if r > 0 else []
    if name == "ellipse":
        rx, ry = positive("rx"), positive("ry")
        return [_ellipse(num("cx"), num("cy"), rx, ry, extent)] if rx > 0 and ry > 0 else []
    if name == "rect":
        x, y, w, h = num("x"), num("y"), positive("width"), positive("height")
        if w == 0 or h == 0:
            return []
        rx = positive("rx") if "rx" in attrs else None
        ry = positive("ry") if "ry" in attrs else None
        rx, ry = (rx if rx is not None else ry or 0.0), (ry if ry is not None else rx or 0.0)
        return [_rect(x, y, w, h, min(rx, w / 2), min(ry, h / 2), extent)]
    raise _unsupported(f"Element <{name}> is not drawable")


def _ellipse(cx: float, cy: float, rx: float, ry: float, extent: float) -> Subpath:
    n = _segments(2 * math.pi * max(rx, ry), extent)
    return Subpath(tuple((cx + rx * math.cos(2 * math.pi * k / n), cy + ry * math.sin(2 * math.pi * k / n))
                         for k in range(n)), True)


def _rect(x: float, y: float, w: float, h: float, rx: float, ry: float, extent: float) -> Subpath:
    if rx <= 0 or ry <= 0:
        return Subpath(((x, y), (x + w, y), (x + w, y + h), (x, y + h)), True)
    n = max(4, _segments(math.pi / 2 * max(rx, ry), extent) // 4)
    corners = ((x + w - rx, y + ry, -math.pi / 2), (x + w - rx, y + h - ry, 0.0),
               (x + rx, y + h - ry, math.pi / 2), (x + rx, y + ry, math.pi))
    points = [(cx + rx * math.cos(start + math.pi / 2 * k / n), cy + ry * math.sin(start + math.pi / 2 * k / n))
              for cx, cy, start in corners for k in range(n + 1)]
    return Subpath(tuple(points), True)


# ---------------------------------------------------------------- path data

def parse_path(d: str, extent: float) -> list[Subpath]:
    """Parse SVG path data into flattened subpaths (viewBox units)."""
    text, i = d, 0
    subpaths: list[Subpath] = []
    current: list[Point] = []
    x = y = sx = sy = 0.0
    command = previous = None
    control: Point | None = None

    def flush(closed: bool) -> None:
        nonlocal current
        if len(current) >= 2 or (closed and current):
            subpaths.append(Subpath(tuple(current), closed))
        current = []

    def read_arguments(cmd: str) -> list[float]:
        nonlocal i
        values = []
        for index in range(PATH_ARITY[cmd.upper()]):
            if index:
                i = _skip_separator(text, i)
            if cmd in "Aa" and index in (3, 4):
                if i >= len(text) or text[i] not in "01":
                    raise _invalid("Arc flags must be 0 or 1")
                values.append(float(text[i]))
                i += 1
                continue
            match = NUMBER.match(text, i)
            if not match:
                raise _invalid(f"Path command {cmd} has a malformed or missing number")
            values.append(_finite(float(match.group()), "path coordinate"))
            i = match.end()
        return values

    while True:
        while i < len(text) and text[i] in " \t\r\n":
            i += 1
        if i >= len(text):
            break
        char = text[i]
        if char.isalpha():
            if char.upper() not in PATH_ARITY:
                raise _invalid(f"Unknown path command {char!r}")
            if command is None and char not in "Mm":
                raise _invalid("Path data must start with a moveto")
            command, i = char, i + 1
            if command in "Zz":
                if current:
                    flush(True)
                x, y, previous = sx, sy, command
                continue
            while i < len(text) and text[i] in " \t\r\n":
                i += 1
        else:
            if command is None or command in "Zz":
                raise _invalid("Path data has numbers without a command")
            if char == ",":
                i = _skip_separator(text, i)
        args = read_arguments(command)
        relative = command.islower()
        kind = command.upper()
        ox, oy = (x, y) if relative else (0.0, 0.0)
        if kind == "M":
            flush(False)
            x, y = ox + args[0], oy + args[1]
            sx, sy, current = x, y, [(x, y)]
            command = "l" if relative else "L"
            previous = "M"
            continue
        if not current:
            current = [(x, y)]
        if kind == "L":
            x, y = ox + args[0], oy + args[1]
            current.append((x, y))
        elif kind == "H":
            x = (x if relative else 0.0) + args[0]
            current.append((x, y))
        elif kind == "V":
            y = (y if relative else 0.0) + args[0]
            current.append((x, y))
        elif kind in "CS":
            if kind == "C":
                c1 = (ox + args[0], oy + args[1])
                rest = args[2:]
            else:
                c1 = (2 * x - control[0], 2 * y - control[1]) if previous in ("C", "S") and control else (x, y)
                rest = args
            c2, end = (ox + rest[0], oy + rest[1]), (ox + rest[2], oy + rest[3])
            current.extend(_cubic((x, y), c1, c2, end, extent))
            control, (x, y) = c2, end
        elif kind in "QT":
            if kind == "Q":
                c1, end = (ox + args[0], oy + args[1]), (ox + args[2], oy + args[3])
            else:
                c1 = (2 * x - control[0], 2 * y - control[1]) if previous in ("Q", "T") and control else (x, y)
                end = (ox + args[0], oy + args[1])
            current.extend(_quadratic((x, y), c1, end, extent))
            control, (x, y) = c1, end
        elif kind == "A":
            end = (ox + args[5], oy + args[6])
            current.extend(_arc((x, y), args[0], args[1], args[2], bool(args[3]), bool(args[4]), end, extent))
            x, y = end
        previous = kind
    flush(False)
    return subpaths


def _cubic(p0: Point, p1: Point, p2: Point, p3: Point, extent: float) -> list[Point]:
    n = _segments(math.dist(p0, p1) + math.dist(p1, p2) + math.dist(p2, p3), extent)
    out = []
    for k in range(1, n + 1):
        t = k / n
        a, b, c, e = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]))
    return out


def _quadratic(p0: Point, p1: Point, p2: Point, extent: float) -> list[Point]:
    n = _segments(math.dist(p0, p1) + math.dist(p1, p2), extent)
    out = []
    for k in range(1, n + 1):
        t = k / n
        a, b, c = (1 - t) ** 2, 2 * (1 - t) * t, t * t
        out.append((a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]))
    return out


def _arc(start: Point, rx: float, ry: float, rotation: float, large: bool, sweep: bool, end: Point,
         extent: float) -> list[Point]:
    """Endpoint-to-centre conversion from SVG 1.1 implementation notes F.6.5/F.6.6."""
    (x1, y1), (x2, y2) = start, end
    if start == end:
        return []
    rx, ry = abs(rx), abs(ry)
    if rx == 0 or ry == 0:
        return [end]
    phi = math.radians(rotation % 360)
    cos_p, sin_p = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p, y1p = cos_p * dx + sin_p * dy, -sin_p * dx + cos_p * dy
    scale = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry)
    if scale > 1:
        rx, ry = rx * math.sqrt(scale), ry * math.sqrt(scale)
    numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
    denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p
    coefficient = math.sqrt(max(0.0, numerator / denominator)) * (-1 if large == sweep else 1)
    cxp, cyp = coefficient * rx * y1p / ry, -coefficient * ry * x1p / rx
    cx = cos_p * cxp - sin_p * cyp + (x1 + x2) / 2
    cy = sin_p * cxp + cos_p * cyp + (y1 + y2) / 2
    ux, uy = (x1p - cxp) / rx, (y1p - cyp) / ry
    vx, vy = (-x1p - cxp) / rx, (-y1p - cyp) / ry
    theta = math.atan2(uy, ux)
    delta = math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    if not sweep and delta > 0:
        delta -= 2 * math.pi
    elif sweep and delta < 0:
        delta += 2 * math.pi
    n = _segments(abs(delta) * max(rx, ry), extent)
    out = []
    for k in range(1, n):
        t = theta + delta * k / n
        ex, ey = rx * math.cos(t), ry * math.sin(t)
        out.append((cx + cos_p * ex - sin_p * ey, cy + sin_p * ex + cos_p * ey))
    out.append(end)
    return out


# ---------------------------------------------------------------- rendering

def min_stroke_width(drawing: Drawing) -> float | None:
    """Thinnest painted stroke in viewBox units, or None when nothing is stroked."""
    widths = [s.stroke_width for s in drawing.shapes if s.stroke is not None and s.stroke_width > 0]
    return min(widths) if widths else None


def fit(view_box: tuple[float, float, float, float], size_px: tuple[int, int], margin_px: int) -> tuple[float, float, float]:
    """Scale and offset mapping the viewBox into the box inside the margin (xMidYMid meet)."""
    min_x, min_y, width, height = view_box
    inner_w, inner_h = size_px[0] - 2 * margin_px, size_px[1] - 2 * margin_px
    if inner_w <= 0 or inner_h <= 0:
        raise ValueError("Margin leaves no drawing area")
    scale = min(inner_w / width, inner_h / height)
    return (scale, margin_px + (inner_w - width * scale) / 2 - min_x * scale,
            margin_px + (inner_h - height * scale) / 2 - min_y * scale)


def render(drawing: Drawing, size_px: tuple[int, int], margin_px: int = 0) -> Image.Image:
    """Black ink on white, anti-aliased greyscale ("L") at exactly size_px."""
    width, height = size_px
    factor = 4 if width * height <= 1_200_000 else 2 if width * height <= 5_000_000 else 1
    canvas = Image.new("L", (width * factor, height * factor), 255)
    scale, ox, oy = fit(drawing.view_box, canvas.size, margin_px * factor)
    limit = 8 * max(canvas.size)
    for shape in drawing.shapes:
        paths = [([(_clamp(ox + px * scale, limit), _clamp(oy + py * scale, limit)) for px, py in sub.points], sub.closed)
                 for sub in shape.subpaths]
        if shape.fill is not None:
            _paint(canvas, _fill_mask([p for p, _ in paths], shape.fill_rule, canvas.size), shape.fill)
        if shape.stroke is not None and shape.stroke_width > 0:
            half = min(shape.stroke_width * scale / 2, 2.0 * max(canvas.size))
            _paint(canvas, _stroke_mask(paths, half, shape.linecap, shape.linejoin, canvas.size), shape.stroke)
    return canvas.resize(size_px, Image.Resampling.BOX) if factor > 1 else canvas


def _clamp(value: float, limit: float) -> float:
    return max(-limit, min(limit, value))


def _paint(canvas: Image.Image, mask: tuple[Image.Image, tuple[int, int]] | None, ink: int) -> None:
    if mask is None:
        return
    image, (left, top) = mask
    canvas.paste(ink, (left, top, left + image.width, top + image.height), image)


def _bbox(points: list[Point], pad: float, size: tuple[int, int]) -> tuple[int, int, int, int] | None:
    left = max(0, math.floor(min(p[0] for p in points) - pad))
    top = max(0, math.floor(min(p[1] for p in points) - pad))
    right = min(size[0], math.ceil(max(p[0] for p in points) + pad) + 1)
    bottom = min(size[1], math.ceil(max(p[1] for p in points) + pad) + 1)
    return (left, top, right, bottom) if right > left and bottom > top else None


def _signed_area(points: list[Point]) -> float:
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, points[1:] + points[:1])) / 2


def _fill_mask(paths: list[list[Point]], rule: str, size: tuple[int, int]):
    polygons = [p for p in paths if len(p) >= 3]
    if not polygons:
        return None
    box = _bbox([pt for p in polygons for pt in p], 1, size)
    if box is None:
        return None
    left, top, right, bottom = box
    area = (right - left, bottom - top)
    shifted = [[(x - left, y - top) for x, y in p] for p in polygons]
    if len(shifted) == 1:
        mask = Image.new("L", area, 0)
        ImageDraw.Draw(mask).polygon(shifted[0], fill=255)
        return mask, (left, top)
    # Per-subpath layers: XOR gives exact even-odd; signed accumulation around 128 gives
    # non-zero winding for simple subpaths (self-intersections fall back to even-odd).
    mask = Image.new("L", area, 0 if rule == "evenodd" else 128)
    for polygon in shifted:
        sub = _bbox(polygon, 1, area)
        signed = _signed_area(polygon)
        if sub is None or (rule == "nonzero" and signed == 0):
            continue
        layer = Image.new("L", (sub[2] - sub[0], sub[3] - sub[1]), 0)
        ImageDraw.Draw(layer).polygon([(x - sub[0], y - sub[1]) for x, y in polygon],
                                      fill=255 if rule == "evenodd" else 1)
        region = mask.crop(sub)
        if rule == "evenodd":
            region = ImageChops.difference(region, layer)
        else:
            region = ImageChops.add(region, layer) if signed > 0 else ImageChops.subtract(region, layer)
        mask.paste(region, sub[:2])
    if rule != "evenodd":
        mask = mask.point(lambda v: 0 if v == 128 else 255)
    return mask, (left, top)


def _stroke_mask(paths: list[tuple[list[Point], bool]], half: float, cap: str, join: str, size: tuple[int, int]):
    points = [pt for p, _ in paths for pt in p]
    box = _bbox(points, 4 * half + 2, size) if points else None
    if box is None:
        return None
    left, top, right, bottom = box
    mask = Image.new("L", (right - left, bottom - top), 0)
    draw = ImageDraw.Draw(mask)
    for path, closed in paths:
        _stroke_polyline(draw, [(x - left, y - top) for x, y in path], closed, half, cap, join)
    return mask, (left, top)


def _stroke_polyline(draw: ImageDraw.ImageDraw, points: list[Point], closed: bool, half: float, cap: str,
                     join: str) -> None:
    pts: list[Point] = []
    for point in points:
        if not pts or math.dist(pts[-1], point) > 1e-9:
            pts.append(point)
    if closed and len(pts) > 1 and math.dist(pts[0], pts[-1]) <= 1e-9:
        pts.pop()
    if len(pts) == 1:
        if cap == "round":
            _dot(draw, pts[0], half)
        elif cap == "square":
            x, y = pts[0]
            draw.polygon([(x - half, y - half), (x + half, y - half), (x + half, y + half), (x - half, y + half)], fill=255)
        return
    segments = list(zip(pts, pts[1:])) + ([(pts[-1], pts[0])] if closed else [])
    directions = []
    for (ax, ay), (bx, by) in segments:
        length = math.hypot(bx - ax, by - ay)
        dx, dy = (bx - ax) / length, (by - ay) / length
        directions.append((dx, dy))
        nx, ny = -dy * half, dx * half
        draw.polygon([(ax + nx, ay + ny), (bx + nx, by + ny), (bx - nx, by - ny), (ax - nx, ay - ny)], fill=255)
    joints = range(len(segments)) if closed else range(1, len(segments))
    for index in joints:
        _join(draw, segments[index][0], directions[index - 1], directions[index], half, join)
    if not closed:
        for (x, y), (dx, dy), sign in ((pts[0], directions[0], -1), (pts[-1], directions[-1], 1)):
            if cap == "round":
                _dot(draw, (x, y), half)
            elif cap == "square":
                nx, ny, ex, ey = -dy * half, dx * half, sign * dx * half, sign * dy * half
                draw.polygon([(x + nx, y + ny), (x + nx + ex, y + ny + ey), (x - nx + ex, y - ny + ey), (x - nx, y - ny)], fill=255)


def _join(draw: ImageDraw.ImageDraw, vertex: Point, d1: Point, d2: Point, half: float, join: str) -> None:
    if join == "round":
        _dot(draw, vertex, half)
        return
    cross = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(cross) < 1e-12:
        return
    side = -1 if cross > 0 else 1  # outer side of the turn
    (x, y), n1, n2 = vertex, (-d1[1], d1[0]), (-d2[1], d2[0])
    a = (x + side * n1[0] * half, y + side * n1[1] * half)
    b = (x + side * n2[0] * half, y + side * n2[1] * half)
    mx, my = n1[0] + n2[0], n1[1] + n2[1]
    squared = mx * mx + my * my
    if join == "miter" and squared >= 0.25:  # SVG default miter limit of 4
        factor = 2 * half / squared
        draw.polygon([vertex, a, (x + side * mx * factor, y + side * my * factor), b], fill=255)
    else:
        draw.polygon([vertex, a, b], fill=255)


def _dot(draw: ImageDraw.ImageDraw, centre: Point, radius: float) -> None:
    n = max(8, min(64, math.ceil(radius)))
    x, y = centre
    draw.polygon([(x + radius * math.cos(2 * math.pi * k / n), y + radius * math.sin(2 * math.pi * k / n))
                  for k in range(n)], fill=255)
