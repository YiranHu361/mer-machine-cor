"""Bounded text keychain template: a deterministic 3MF of closed box shells plus a top-down preview.

Geometry is a 2.4 mm base plate (with a square hanging hole) and 1.2 mm raised letters from a
5x7 pixel font; adjacent font pixels are merged into rectangles before becoming boxes.
"""
from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass
from xml.sax.saxutils import quoteattr
from PIL import Image, ImageDraw

MAX_CHARS = 10
PITCH = 4 / 3          # mm per font pixel; 5 px glyph + 1 px gap = 8 mm per character
WIDTH = 18.0
BASE = 2.4
RELIEF = 1.2
END_ALLOWANCE = 14.0
HOLE = (2.5, 7.0, 6.5, 11.0)  # x0, y0, x1, y1 of the square hanging hole
TEXT_START = 8.5               # letters are centred between here and LENGTH - 1.5
ZIP_DATE = (1980, 1, 1, 0, 0, 0)

_FONT_ROWS = {
    "A": ".###.|#...#|#...#|#####|#...#|#...#|#...#", "B": "####.|#...#|#...#|####.|#...#|#...#|####.",
    "C": ".###.|#...#|#....|#....|#....|#...#|.###.", "D": "###..|#..#.|#...#|#...#|#...#|#..#.|###..",
    "E": "#####|#....|#....|####.|#....|#....|#####", "F": "#####|#....|#....|####.|#....|#....|#....",
    "G": ".###.|#...#|#....|#.###|#...#|#...#|.####", "H": "#...#|#...#|#...#|#####|#...#|#...#|#...#",
    "I": ".###.|..#..|..#..|..#..|..#..|..#..|.###.", "J": "..###|...#.|...#.|...#.|...#.|#..#.|.##..",
    "K": "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#", "L": "#....|#....|#....|#....|#....|#....|#####",
    "M": "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#", "N": "#...#|#...#|##..#|#.#.#|#..##|#...#|#...#",
    "O": ".###.|#...#|#...#|#...#|#...#|#...#|.###.", "P": "####.|#...#|#...#|####.|#....|#....|#....",
    "Q": ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#", "R": "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
    "S": ".####|#....|#....|.###.|....#|....#|####.", "T": "#####|..#..|..#..|..#..|..#..|..#..|..#..",
    "U": "#...#|#...#|#...#|#...#|#...#|#...#|.###.", "V": "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..",
    "W": "#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.", "X": "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
    "Y": "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..", "Z": "#####|....#|...#.|..#..|.#...|#....|#####",
    "0": ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.", "1": "..#..|.##..|..#..|..#..|..#..|..#..|.###.",
    "2": ".###.|#...#|....#|...#.|..#..|.#...|#####", "3": "#####|...#.|..#..|...#.|....#|#...#|.###.",
    "4": "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.", "5": "#####|#....|####.|....#|....#|#...#|.###.",
    "6": "..##.|.#...|#....|####.|#...#|#...#|.###.", "7": "#####|....#|...#.|..#..|.#...|.#...|.#...",
    "8": ".###.|#...#|#...#|.###.|#...#|#...#|.###.", "9": ".###.|#...#|#...#|.####|....#|...#.|.##..",
    " ": ".....|.....|.....|.....|.....|.....|.....", "!": "..#..|..#..|..#..|..#..|..#..|.....|..#..",
    "?": ".###.|#...#|....#|...#.|..#..|.....|..#..", "-": ".....|.....|.....|#####|.....|.....|.....",
    "+": ".....|..#..|..#..|#####|..#..|..#..|.....", "&": ".##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#",
}
GLYPHS = {char: tuple(rows.split("|")) for char, rows in _FONT_ROWS.items()}
CHARSET = frozenset(GLYPHS)

# Corners: bottom face counter-clockwise, then top face; triangles wind counter-clockwise seen from outside.
_CORNERS = ((0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1))
_FACES = ((0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4),
          (3, 7, 6), (3, 6, 2), (0, 4, 7), (0, 7, 3), (1, 2, 6), (1, 6, 5))


class TemplateError(ValueError):
    pass


@dataclass(frozen=True)
class Box:
    x0: float
    y0: float
    z0: float
    x1: float
    y1: float
    z1: float

    @property
    def volume_mm3(self) -> float:
        return (self.x1 - self.x0) * (self.y1 - self.y0) * (self.z1 - self.z0)

    def corners(self) -> list[tuple[float, float, float]]:
        return [(self.x1 if cx else self.x0, self.y1 if cy else self.y0, self.z1 if cz else self.z0)
                for cx, cy, cz in _CORNERS]


@dataclass(frozen=True)
class Tag:
    text: str
    length_mm: float
    plate: tuple[Box, ...]
    letters: tuple[Box, ...]

    width_mm = WIDTH
    height_mm = BASE + RELIEF

    @property
    def boxes(self) -> tuple[Box, ...]:
        return self.plate + self.letters

    @property
    def volume_cm3(self) -> float:
        return sum(box.volume_mm3 for box in self.boxes) / 1000


def validate(text: object) -> str:
    if not isinstance(text, str) or not 1 <= len(text) <= MAX_CHARS:
        raise TemplateError(f"Tag text must be 1–{MAX_CHARS} characters")
    bad = sorted({char for char in text if char not in CHARSET})
    if bad:
        raise TemplateError("Tag text allows only A–Z, 0–9, space and ! ? - & +; found " + " ".join(repr(c) for c in bad))
    if not text.strip():
        raise TemplateError("Tag text needs at least one visible character")
    return text


def build(text: str) -> Tag:
    text = validate(text)
    length = 8 * len(text) + END_ALLOWANCE
    hx0, hy0, hx1, hy1 = HOLE
    plate = (Box(0, 0, 0, hx0, WIDTH, BASE), Box(hx1, 0, 0, length, WIDTH, BASE),
             Box(hx0, 0, 0, hx1, hy0, BASE), Box(hx0, hy1, 0, hx1, WIDTH, BASE))
    columns = 6 * len(text) - 1
    grid = [[col % 6 < 5 and GLYPHS[text[col // 6]][row][col % 6] == "#" for col in range(columns)]
            for row in range(7)]
    text_width = columns * PITCH
    x_start = TEXT_START + ((length - 1.5 - TEXT_START) - text_width) / 2
    y_top = (WIDTH + 7 * PITCH) / 2
    letters = tuple(Box(x_start + c * PITCH, y_top - (r + h) * PITCH, BASE, x_start + (c + w) * PITCH, y_top - r * PITCH, BASE + RELIEF)
                    for r, c, w, h in _rectangles(grid))
    return Tag(text, length, plate, letters)


def _rectangles(grid: list[list[bool]]) -> list[tuple[int, int, int, int]]:
    """Greedy row-major merge of filled cells into (row, col, width, height) rectangles."""
    rows, cols = len(grid), len(grid[0])
    used = [[False] * cols for _ in range(rows)]
    out = []
    for r in range(rows):
        for c in range(cols):
            if not grid[r][c] or used[r][c]:
                continue
            w = 1
            while c + w < cols and grid[r][c + w] and not used[r][c + w]:
                w += 1
            h = 1
            while r + h < rows and all(grid[r + h][c + k] and not used[r + h][c + k] for k in range(w)):
                h += 1
            for rr in range(r, r + h):
                for cc in range(c, c + w):
                    used[rr][cc] = True
            out.append((r, c, w, h))
    return out


def _fmt(value: float) -> str:
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def three_mf(tag: Tag) -> bytes:
    vertices, triangles = [], []
    for box in tag.boxes:
        base = len(vertices)
        vertices.extend(box.corners())
        triangles.extend((base + a, base + b, base + c) for a, b, c in _FACES)
    model = ('<?xml version="1.0" encoding="UTF-8"?>\n'
             '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
             '<metadata name="Application">fabrary-producer</metadata>'
             f'<metadata name="Title">{_escape(tag.text)} text tag</metadata>'
             f'<resources><object id="1" type="model" name={quoteattr("Text tag " + tag.text)}><mesh><vertices>'
             + "".join(f'<vertex x="{_fmt(x)}" y="{_fmt(y)}" z="{_fmt(z)}"/>' for x, y, z in vertices)
             + "</vertices><triangles>"
             + "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in triangles)
             + '</triangles></mesh></object></resources><build><item objectid="1"/></build></model>')
    files = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
            'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
        "3D/3dmodel.model": model,
    }
    return deterministic_zip(files)


def _escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


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


def preview(tag: Tag, width_px: int = 600) -> Image.Image:
    """Top-down view: light grey plate, dark raised letters, white background."""
    pad, factor = 24, 4
    scale = (width_px - 2 * pad) / tag.length_mm
    height_px = round(tag.width_mm * scale + 2 * pad)
    image = Image.new("L", (width_px * factor, height_px * factor), 255)
    draw = ImageDraw.Draw(image)

    def rectangle(box: Box, shade: int) -> None:
        left, right = (pad + box.x0 * scale) * factor, (pad + box.x1 * scale) * factor
        top, bottom = (pad + (tag.width_mm - box.y1) * scale) * factor, (pad + (tag.width_mm - box.y0) * scale) * factor
        draw.rectangle((round(left), round(top), round(right) - 1, round(bottom) - 1), fill=shade)

    for box in tag.plate:
        rectangle(box, 205)
    for box in tag.letters:
        rectangle(box, 45)
    return image.resize((width_px, height_px), Image.Resampling.BOX)
