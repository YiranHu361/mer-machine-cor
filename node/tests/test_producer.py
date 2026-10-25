import hashlib
import json
import math
import os
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path
import pytest
from PIL import Image, ImageDraw
from fabyn_node import nametag, producer, svg_subset

NS = "http://www.w3.org/2000/svg"
CAT = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="{NS}" viewBox="0 0 100 100" width="100mm" height="100mm"><title>Cat</title><desc>Outline cat</desc>
<g fill="none" stroke="black" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
<path d="M20 85 C 10 60, 15 40, 22 30 L 18 8 L 38 24 Q 50 20 62 24 L 82 8 L 78 30 C 85 40 90 60 80 85 A 30 12 0 0 1 20 85 Z"/>
<line x1="30" y1="62" x2="8" y2="58"/><line x1="30" y1="66" x2="8" y2="70"/>
<line x1="70" y1="62" x2="92" y2="58"/><line x1="70" y1="66" x2="92" y2="70"/></g>
<circle cx="38" cy="50" r="5"/><circle cx="62" cy="50" r="5"/><polygon points="46,60 54,60 50,65"/></svg>"""
BASE_PROFILE = {"version": "profile/1", "dpi": None, "printable_width_mm": None, "raster_px": None, "media_outer_mm": None,
                "printable_area_mm": None, "safe_margin_mm": None, "min_line_mm": None, "seconds_per_unit": None,
                "setup_seconds": None, "build_volume_mm": None, "material_density_g_cm3": None}
STICKER = {**BASE_PROFILE, "version": "phomemo-m02pro/1", "dpi": 300, "printable_width_mm": 53, "safe_margin_mm": 1.5,
           "min_line_mm": 0.4, "seconds_per_unit": 20, "setup_seconds": 30}
PHOTO = {**BASE_PROFILE, "version": "instax-mini-link3/1", "raster_px": [600, 800], "media_outer_mm": [54, 86],
         "printable_area_mm": [46, 62], "seconds_per_unit": 75}
FDM = {**BASE_PROFILE, "version": "a1-mini-pla/1", "build_volume_mm": [180, 180, 180], "material_density_g_cm3": 1.24,
       "setup_seconds": 180}
try:
    nametag.openscad()
    HAS_OPENSCAD = True
except nametag.GeneratorUnavailable:
    HAS_OPENSCAD = False
needs_openscad = pytest.mark.skipif(not HAS_OPENSCAD, reason="OpenSCAD renders the name tag")
ITEM = {"id": "cot-sheet", "name": "Fitted cot sheet", "unit": "sheet", "setup_seconds": 120, "seconds_per_unit": 540,
        "material_per_unit": 1.6, "material_unit": "m fabric"}


def svg(body: str, view_box: str = "0 0 100 100") -> str:
    return f'<svg xmlns="{NS}" viewBox="{view_box}">{body}</svg>'


def with_hash(design: dict) -> dict:
    canonical = json.dumps(design, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return {**design, "canonical_sha256": hashlib.sha256(canonical.encode()).hexdigest()}


def request(tmp_path, process, design, profile, *, mode="simulation", params=None, out="out", hashed=True):
    return {"operation": "prepare", "preparation_key": "prep-key-0001", "process": process, "execution_mode": mode,
            "machine": {"id": "machine_01", "model": "Test model"}, "profile": profile,
            "design": with_hash(design) if hashed else design,
            "params": {"width_mm": 53, "height_mm": 50, "quantity": 2, "material": "thermal-paper", "crop": "contain",
                       "color_mode": "mono", **(params or {})},
            "output_dir": str(tmp_path / out)}


def photo(tmp_path, *, size=(1200, 400), square=(1000, 150, 1100, 250), color="red", name="photo.png", box=True, marker=False):
    image = Image.new("RGB", size, "white")
    ImageDraw.Draw(image).rectangle(square, fill=color)
    if marker:  # neutral mark in the centre so a centre crop is not blank
        ImageDraw.Draw(image).rectangle((size[0] // 2 - 20, size[1] // 2 - 20, size[0] // 2 + 20, size[1] // 2 + 20), fill="blue")
    path = tmp_path / name
    image.save(path)
    subject = [square[0] / size[0], square[1] / size[1], square[2] / size[0], square[3] / size[1]] if box else None
    return {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "subject_box": subject}


def assert_deterministic(tmp_path, build) -> dict:
    first, second, again = producer.prepare(build("a")), producer.prepare(build("b")), producer.prepare(build("a"))
    assert first["status"] == "ready", first
    assert again == first
    normal = lambda result: json.loads(json.dumps(result).replace(str(tmp_path / "a"), "OUT").replace(str(tmp_path / "b"), "OUT"))
    assert normal(first) == normal(second)
    for key in ("artifact", "preview"):
        if first[key]:
            data = Path(first[key]["path"]).read_bytes()
            assert data == Path(second[key]["path"]).read_bytes()
            assert hashlib.sha256(data).hexdigest() == first[key]["sha256"]
    assert first["preparation_id"] == "prep_" + first["input_digest"][:24]
    body = {k: v for k, v in build("a").items() if k != "output_dir"}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    assert first["input_digest"] == hashlib.sha256(canonical.encode()).hexdigest()
    return first


# ---------------------------------------------------------------- ready paths

def test_sticker_from_svg_is_deterministic_and_preview_is_artifact(tmp_path):
    result = assert_deterministic(tmp_path, lambda out: request(tmp_path, "sticker_print", {"kind": "svg", "svg": CAT}, STICKER, mode="hardware", out=out))
    assert result["preview"]["path"] == result["artifact"]["path"]
    assert result["preview"]["sha256"] == result["artifact"]["sha256"]
    assert result["compiler_version"] == "producer-prepare/1" and result["execution_mode"] == "hardware"
    assert result["parameters"]["raster_px"] == [626, 591] and result["parameters"]["dpi"] == 300
    assert result["estimates"] == {"material": {"amount": 2, "unit": "label"}, "minutes_per_unit": 0.333,
                                   "setup_minutes": 0.5, "basis": "estimated"}
    assert result["warnings"] == []
    with Image.open(result["artifact"]["path"]) as image:
        assert image.mode == "1" and image.size == (626, 591)
        assert set(image.get_flattened_data()) == {0, 255}
        margin = round(1.5 / 25.4 * 300)
        assert image.crop((0, 0, margin, 591)).getextrema() == (255, 255)
        assert image.crop((626 - margin, 0, 626, 591)).getextrema() == (255, 255)


def test_sticker_from_photo_dithers_inside_safe_margin(tmp_path):
    entry = photo(tmp_path, size=(400, 400), square=(100, 100, 300, 300), color="black", box=False)
    result = assert_deterministic(tmp_path, lambda out: request(tmp_path, "sticker_print", {"kind": "photos", "photos": [entry]}, STICKER, mode="hardware", out=out))
    with Image.open(result["artifact"]["path"]) as image:
        assert image.mode == "1"
        assert image.getpixel((313, 295)) == 0 and image.getpixel((5, 5)) == 255


def test_sticker_caption_is_set_in_type_under_the_picture(tmp_path):
    entry = photo(tmp_path, size=(400, 400), square=(100, 100, 300, 300), color="black", box=False)
    design = {"kind": "photos", "photos": [entry], "caption": "Yiran Hu"}
    params = {"width_mm": 48, "fit": "content"}
    result = assert_deterministic(tmp_path, lambda out: request(tmp_path, "sticker_print", design, STICKER, mode="hardware", params=params, out=out))
    plain = producer.prepare(request(tmp_path, "sticker_print", {"kind": "photos", "photos": [entry]}, STICKER, mode="hardware", params=params, out="plain"))
    assert result["parameters"]["caption"] == "Yiran Hu" and "caption" not in plain["parameters"]
    # the band adds exactly its height; the picture above it is unchanged
    assert result["parameters"]["height_mm"] == plain["parameters"]["height_mm"] + producer.CAPTION_BAND_MM
    with Image.open(result["artifact"]["path"]) as image, Image.open(plain["artifact"]["path"]) as art:
        assert image.mode == "1" and image.width == art.width
        assert image.crop((0, 0, art.width, art.height)).tobytes() == art.tobytes()
        band = image.crop((0, art.height, image.width, image.height))
        assert band.getextrema() == (0, 255)  # lettering is inked
        margin = round(1.5 / 25.4 * 300)
        assert image.crop((0, art.height, margin, image.height)).getextrema() == (255, 255)
        assert image.crop((0, image.height - margin, image.width, image.height)).getextrema() == (255, 255)


@pytest.mark.parametrize("caption", ["", "far too long for a sticker", "a#b", "  Yiran", "...", 7])
def test_sticker_caption_takes_only_name_tag_lettering(tmp_path, caption):
    entry = photo(tmp_path, size=(400, 400), square=(100, 100, 300, 300), color="black", box=False)
    result = producer.prepare(request(tmp_path, "sticker_print", {"kind": "photos", "photos": [entry], "caption": caption}, STICKER, mode="hardware"))
    assert result["status"] == "rejected" and "design.caption" in result["reason"]


def test_photo_print_is_deterministic_color(tmp_path):
    entry = photo(tmp_path)
    result = assert_deterministic(tmp_path, lambda out: request(tmp_path, "photo_print", {"kind": "photos", "photos": [entry]}, PHOTO,
                                                                 mode="hardware", out=out, params={"width_mm": 54, "height_mm": 86, "color_mode": "color", "material": "instax-mini"}))
    assert result["preview"] == {**result["preview"], "path": result["artifact"]["path"], "width_px": 600, "height_px": 800, "color": "color"}
    params = result["parameters"]
    assert params["raster_px"] == [600, 800] and params["media_outer_mm"] == [54, 86] and params["printable_area_mm"] == [46, 62]
    assert result["estimates"]["material"] == {"amount": 2, "unit": "sheet"}
    with Image.open(result["artifact"]["path"]) as image:
        assert image.mode == "RGB" and image.size == (600, 800)


def test_photo_cover_crop_keeps_subject(tmp_path):
    def reds(entry):
        result = producer.prepare(request(tmp_path, "photo_print", {"kind": "photos", "photos": [entry]}, PHOTO, mode="hardware",
                                          params={"width_mm": 54, "height_mm": 86, "color_mode": "color", "crop": "cover"}))
        assert result["status"] == "ready", result
        with Image.open(result["artifact"]["path"]) as image:
            return image, sum(1 for r, g, b in image.get_flattened_data() if r > 200 and g < 60 and b < 60)
    image, count = reds(photo(tmp_path))
    assert count > 20_000 and image.getpixel((300, 400))[:3] == (255, 0, 0)
    assert reds(photo(tmp_path, box=False, marker=True, name="centre.png"))[1] == 0  # a centre crop would lose it


@needs_openscad
def test_name_tag_is_a_reproducible_closed_3mf(tmp_path):
    result = assert_deterministic(tmp_path, lambda out: request(tmp_path, "fdm_print", {"kind": "text_tag", "text": "Zoë & Co!"}, FDM, out=out,
                                                                 params={"material": "pla-white"}))
    assert result["artifact"]["media_type"] == "model/3mf" and result["recipe"] is None
    length, height, thickness = result["parameters"]["model_size_mm"]
    assert 50 < length < 100 and (height, thickness) == (20, 3.2) and result["parameters"]["text"] == "Zoë & Co!"
    with zipfile.ZipFile(result["artifact"]["path"]) as archive:
        assert archive.testzip() is None
        names = archive.namelist()
        assert names == sorted(names) and "3D/3dmodel.model" in names
        assert {info.date_time for info in archive.infolist()} == {(1980, 1, 1, 0, 0, 0)}
        model = ET.fromstring(archive.read("3D/3dmodel.model"))
    ns = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
    assert model.get("unit") == "millimeter" and len(model.findall(".//m:object", ns)) == 1
    triangles = [tuple(int(t.get(k)) for k in ("v1", "v2", "v3")) for t in model.iterfind(".//m:triangle", ns)]
    edges, directed = Counter(), Counter()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            edges[frozenset((u, v))] += 1
            directed[(u, v)] += 1
    assert set(edges.values()) == {2} and set(directed.values()) == {1}  # closed, consistently wound
    grams = nametag.volume_cm3(Path(result["artifact"]["path"]).read_bytes()) * 1.24 * nametag.FILL
    estimates = result["estimates"]
    assert abs(estimates["material"]["amount"] - grams * 2) < 0.02 and estimates["material"]["unit"] == "g"
    assert abs(estimates["minutes_per_unit"] - grams * nametag.MINUTES_PER_GRAM) <= 0.06
    assert estimates["setup_minutes"] == nametag.SETUP_MINUTES and estimates["basis"] == "estimated"
    with Image.open(result["preview"]["path"]) as image:
        assert image.width == 600 and image.convert("L").getextrema()[0] < 80


def test_name_tag_without_openscad_is_a_typed_rejection(tmp_path, monkeypatch):
    monkeypatch.setenv("FABYN_OPENSCAD", str(tmp_path / "missing"))
    monkeypatch.setattr(nametag.shutil, "which", lambda _name: None)
    monkeypatch.setattr(nametag, "APP_BINARY", str(tmp_path / "missing"))
    result = producer.prepare(request(tmp_path, "fdm_print", {"kind": "text_tag", "text": "Maya"}, FDM))
    assert result["status"] == "rejected" and result["code"] == "generator_unavailable"
    assert "OpenSCAD" in result["reason"]


def test_sim_item_is_deterministic_recipe_without_artifact(tmp_path):
    result = assert_deterministic(tmp_path, lambda out: request(tmp_path, "sewing", {"kind": "sim_catalog_item", "catalog_item": ITEM}, BASE_PROFILE, out=out,
                                                                 params={"quantity": 3}))
    assert result["artifact"] is None
    assert result["recipe"]["kind"] == "simulation" and result["recipe"]["item_id"] == "cot-sheet"
    assert result["estimates"] == {"material": {"amount": 4.8, "unit": "m fabric"}, "minutes_per_unit": 9,
                                   "setup_minutes": 2, "basis": "simulated"}
    with Image.open(result["preview"]["path"]) as image:
        assert image.size == (480, 320)


def test_catalog_model_is_copied_and_verified(tmp_path):
    model = tmp_path / "clip.3mf"
    model.write_bytes(nametag.deterministic_zip({"3D/3dmodel.model": "<model/>", "Metadata/plate_1.gcode": "G28"}))
    preview = tmp_path / "clip.png"
    Image.new("RGB", (64, 48), "orange").save(preview)
    design = {"kind": "catalog_model", "catalog_model": {"path": str(model), "sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
                                                         "preview_path": str(preview), "estimated_seconds": 1500, "grams": 7.5}}
    result = producer.prepare(request(tmp_path, "fdm_print", design, FDM, mode="hardware", params={"material": "pla"}))
    assert result["status"] == "ready", result
    assert Path(result["artifact"]["path"]).read_bytes() == model.read_bytes()
    assert result["preview"]["width_px"] == 64 and result["preview"]["color"] == "color"
    assert result["estimates"] == {"material": {"amount": 15, "unit": "g"}, "minutes_per_unit": 25, "setup_minutes": 3, "basis": "measured"}
    design["catalog_model"]["sha256"] = "0" * 64
    assert producer.prepare(request(tmp_path, "fdm_print", design, FDM, mode="hardware"))["code"] == "input_hash_mismatch"


def test_render_design_preview_is_square_padded_and_deterministic(tmp_path):
    req = {"operation": "render_design_preview", "svg": CAT, "size_px": 256, "output_dir": str(tmp_path)}
    result = producer.handle(req)
    assert result["status"] == "ready" and result == producer.handle(req)
    assert Path(result["path"]).name.startswith("design_") and len(Path(result["path"]).stem) == len("design_") + 16
    assert hashlib.sha256(Path(result["path"]).read_bytes()).hexdigest() == result["sha256"]
    with Image.open(result["path"]) as image:
        assert image.size == (256, 256) and image.getpixel((0, 0)) == 255
        left, top, right, bottom = Image.eval(image, lambda v: 255 - v).getbbox()
        assert left >= 9 and top >= 9 and right <= 247 and bottom <= 247
    bad = producer.handle({**req, "svg": svg("<script>alert(1)</script>")})
    assert bad["status"] == "rejected" and bad["code"] == "svg_unsupported"
    assert producer.handle({**req, "size_px": 32})["code"] == "invalid_request"


# ---------------------------------------------------------------- SVG subset

@pytest.mark.parametrize("text", [
    svg("<script>alert(1)</script>"),
    svg("<style>rect{fill:black}</style><rect width='5' height='5'/>"),
    svg("<rect style='fill:black' width='5' height='5'/>"),
    svg("<image href='x.png' width='5' height='5'/>"),
    svg("<rect id='a' width='5' height='5'/><use href='#a'/>"),
    svg("<g transform='scale(2)'><rect width='5' height='5'/></g>"),
    svg("<path href='#a' d='M0 0 L5 5'/>"),
    f'<svg xmlns="{NS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><rect xlink:href="#a" width="5" height="5"/></svg>',
    svg("<rect fill='url(#grad)' width='5' height='5'/>"),
    svg("<rect fill='red' width='5' height='5'/>"),
    svg("<line stroke='#123456' x2='5' y2='5'/>"),
    '<!DOCTYPE svg><svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>',
    '<!DOCTYPE svg [<!ENTITY lol "lol">]><svg viewBox="0 0 10 10"><desc>&lol;</desc><rect width="5" height="5"/></svg>',
    '<?xml-stylesheet href="evil.css"?>' + svg("<rect width='5' height='5'/>"),
    svg("<?evil data?><rect width='5' height='5'/>"),
    svg("<foreignObject><div/></foreignObject>"),
    svg("<rect onclick='alert(1)' width='5' height='5'/>"),
    svg("<rect class='x' width='5' height='5'/>"),
    svg("<defs><rect width='5' height='5'/></defs>"),
    svg("<clipPath><rect width='5' height='5'/></clipPath>"),
    svg("<a><rect width='5' height='5'/></a>"),
    svg("<svg viewBox='0 0 5 5'><rect width='5' height='5'/></svg>"),
    svg("<text>Hi</text>"),
    svg("<rect width='5' height='5'><![CDATA[x]]></rect>"),
    svg("<rect fill='inherit' width='5' height='5'/>"),
    '<html xmlns="http://www.w3.org/1999/xhtml"/>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>',
    svg("<rect width='5' height='5'/>", "0 0 5000 10"),
    svg("<rect width='5' height='5'/><evil:x xmlns:evil='urn:evil'/>"),
    svg("<g>" * 40 + "<rect width='5' height='5'/>" + "</g>" * 40),
    svg("<path d='" + "M1 1 H99 V99 H1 Z " * 1001 + "'/>"),
])
def test_svg_subset_rejects_unsupported_content(text):
    with pytest.raises(svg_subset.SvgError) as caught:
        svg_subset.parse_svg(text)
    assert caught.value.code == "svg_unsupported"


@pytest.mark.parametrize("d", ["M 10 10 L 20", "M 10 10 X 5 5", "L 10 10", "M 1e 2", "M 10 10 L 5 5 Z 3 3",
                               "M 10 10 A 5 5 0 2 1 20 20", "M 10 10 L 5 -", "M 10 10 C 1 2 3 4 5", "M,10 10 L 5 5"])
def test_malformed_path_rejected(tmp_path, d):
    with pytest.raises(svg_subset.SvgError) as caught:
        svg_subset.parse_svg(svg(f"<path stroke='black' d='{d}'/>"))
    assert caught.value.code == "svg_invalid"
    result = producer.prepare(request(tmp_path, "sticker_print", {"kind": "svg", "svg": svg(f"<path d='{d}'/>")}, STICKER, mode="hardware"))
    assert result["status"] == "rejected" and result["code"] == "svg_invalid" and len(result["input_digest"]) == 64
    assert "artifact" not in result


@pytest.mark.parametrize("text,code", [
    (svg("<circle r='-1'/>"), "svg_invalid"), (svg("<circle r='abc'/>"), "svg_invalid"), ("<svg", "svg_invalid"),
    (svg("<desc>" + "x" * 110_000 + "</desc><rect width='5' height='5'/>"), "svg_too_large"),
    (svg("<rect fill='white' width='5' height='5'/>"), "svg_empty"), (svg("<rect fill='none' width='5' height='5'/>"), "svg_empty"),
    (svg("<title>Nothing</title>"), "svg_empty"),
])
def test_svg_invalid_oversize_and_empty(text, code):
    with pytest.raises(svg_subset.SvgError) as caught:
        svg_subset.parse_svg(text)
    assert caught.value.code == code


def test_cat_parses_curves_and_arcs():
    drawing = svg_subset.parse_svg(CAT)
    assert drawing.view_box == (0, 0, 100, 100) and len(drawing.shapes) == 8
    assert svg_subset.min_stroke_width(drawing) == 4
    head = drawing.shapes[0].subpaths[0]
    assert head.closed and len(head.points) > 64 and max(y for _, y in head.points) > 90  # arc chin below y=85


@pytest.mark.parametrize("d,through", [("M10 50 A40 40 0 0 1 90 50", (50, 10)), ("M10 50 A40 40 0 0 0 90 50", (50, 90)),
                                       ("M10 50 A10 10 0 0 1 90 50", (50, 10)), ("M10 50 a40 40 0 1 1 80 0", (50, 10))])
def test_arc_endpoint_to_centre_conversion(d, through):
    points = svg_subset.parse_path(d, 100)[0].points
    assert points[0] == (10, 50) and points[-1] == (90, 50)
    assert all(abs(math.dist(p, (50, 50)) - 40) < 1e-6 for p in points)
    assert min(math.dist(p, through) for p in points) < 0.5


@pytest.mark.parametrize("rule,inner,hole", [("nonzero", "M30 30 L30 70 L70 70 L70 30 Z", True),
                                             ("evenodd", "M30 30 L30 70 L70 70 L70 30 Z", True),
                                             ("nonzero", "M30 30 L70 30 L70 70 L30 70 Z", False),
                                             ("evenodd", "M30 30 L70 30 L70 70 L30 70 Z", True)])
def test_fill_rules(rule, inner, hole):
    drawing = svg_subset.parse_svg(svg(f"<path fill-rule='{rule}' d='M10 10 L90 10 L90 90 L10 90 Z {inner}'/>"))
    image = svg_subset.render(drawing, (100, 100))
    assert image.getpixel((20, 20)) == 0 and image.getpixel((50, 50)) == (255 if hole else 0)


def test_white_paint_erases_and_strokes_render():
    drawing = svg_subset.parse_svg(svg("<rect width='100' height='100'/><circle cx='50' cy='50' r='20' fill='#FFF'/>"
                                       "<line x1='0' y1='5' x2='100' y2='5' stroke='white' stroke-width='4' stroke-linecap='square'/>"))
    image = svg_subset.render(drawing, (100, 100))
    assert image.getpixel((50, 50)) == 255 and image.getpixel((50, 5)) == 255 and image.getpixel((90, 90)) == 0


# ---------------------------------------------------------------- rejections

def test_svg_rejection_through_prepare_keeps_digest(tmp_path):
    result = producer.prepare(request(tmp_path, "sticker_print", {"kind": "svg", "svg": svg("<script/>")}, STICKER, mode="hardware"))
    assert result["status"] == "rejected" and result["code"] == "svg_unsupported" and len(result["input_digest"]) == 64
    assert not (tmp_path / "out").exists()


@pytest.mark.parametrize("body,code", [("<circle cx='50' cy='50' r='0.3'/>", "preflight_empty"),
                                       ("<rect width='106' height='100'/>", "preflight_solid")])
def test_sticker_preflight(tmp_path, body, code):
    design = {"kind": "svg", "svg": svg(body, "0 0 106 100")}
    result = producer.prepare(request(tmp_path, "sticker_print", design, STICKER, mode="hardware"))
    assert result["status"] == "rejected" and result["code"] == code


def test_thin_lines_warn_without_failing(tmp_path):
    design = {"kind": "svg", "svg": svg("<rect x='10' y='10' width='80' height='80' fill='none' stroke='black' stroke-width='0.6'/>"
                                        "<circle cx='50' cy='50' r='20'/>")}
    result = producer.prepare(request(tmp_path, "sticker_print", design, STICKER, mode="hardware"))
    assert result["status"] == "ready" and "Thinnest line is 0.28 mm" in result["warnings"][0]


@pytest.mark.parametrize("params,code", [({"width_mm": 52}, "dimensions_unsupported"), ({"height_mm": 200}, "dimensions_unsupported"),
                                         ({"color_mode": "color"}, "color_mode_unsupported")])
def test_sticker_parameter_rejections(tmp_path, params, code):
    result = producer.prepare(request(tmp_path, "sticker_print", {"kind": "svg", "svg": CAT}, STICKER, mode="hardware", params=params))
    assert result["status"] == "rejected" and result["code"] == code


@pytest.mark.parametrize("text", ["A#B", "", "   ", " Maya", "Ma  ya", "x" * 17, "...", "日本", 'a"b'])
def test_text_tag_charset(tmp_path, text):
    result = producer.prepare(request(tmp_path, "fdm_print", {"kind": "text_tag", "text": text}, FDM))
    assert result["status"] == "rejected" and result["code"] == "template_charset"


@needs_openscad
def test_hardware_name_tag_is_unsliced_for_the_receiver(tmp_path):
    result = producer.prepare(request(tmp_path, "fdm_print", {"kind": "text_tag", "text": "CAT"}, FDM, mode="hardware"))
    assert result["status"] == "ready" and result["execution_mode"] == "hardware"
    assert result["artifact"]["media_type"] == "model/3mf"
    assert result["parameters"]["slicing"] == "receiver"
    assert "node slices it" in result["handling"][0]
    with zipfile.ZipFile(result["artifact"]["path"]) as archive:
        assert not any(name.endswith(".gcode") for name in archive.namelist())


@needs_openscad
def test_name_tag_build_volume(tmp_path):
    profile = {**FDM, "build_volume_mm": [60, 60, 60]}
    result = producer.prepare(request(tmp_path, "fdm_print", {"kind": "text_tag", "text": "FABYN 10"}, profile))
    assert result["code"] == "exceeds_build_volume"


@pytest.mark.parametrize("process", ["laser_cut", "cnc_route", "vinyl_cut", "large_format_print", "document_print", "sewing", "heat_press", "sticker_print"])
def test_simulation_only_rejects_hardware(tmp_path, process):
    result = producer.prepare(request(tmp_path, process, {"kind": "sim_catalog_item", "catalog_item": ITEM}, BASE_PROFILE, mode="hardware"))
    assert result["status"] == "rejected" and result["code"] == "simulation_only_process"
    other = producer.prepare(request(tmp_path, "laser_cut", {"kind": "svg", "svg": CAT}, BASE_PROFILE))
    assert other["code"] == "design_unsupported"


def test_input_hash_mismatch(tmp_path):
    entry = {**photo(tmp_path), "sha256": "f" * 64}
    result = producer.prepare(request(tmp_path, "photo_print", {"kind": "photos", "photos": [entry]}, PHOTO,
                                      params={"width_mm": 54, "height_mm": 86, "color_mode": "color"}))
    assert result["status"] == "rejected" and result["code"] == "input_hash_mismatch"


def test_symlink_escape_rejected(tmp_path):
    entry = photo(tmp_path)
    inside = tmp_path / "uploads"
    inside.mkdir()
    link = inside / "photo.png"
    os.symlink(entry["path"], link)
    result = producer.prepare(request(tmp_path, "photo_print", {"kind": "photos", "photos": [{**entry, "path": str(link)}]}, PHOTO,
                                      params={"width_mm": 54, "height_mm": 86, "color_mode": "color"}))
    assert result["code"] == "input_unreadable"
    relative = producer.prepare(request(tmp_path, "photo_print", {"kind": "photos", "photos": [{**entry, "path": "photo.png"}]}, PHOTO,
                                        params={"width_mm": 54, "height_mm": 86, "color_mode": "color"}))
    assert relative["code"] == "invalid_request"


def test_canonical_mismatch(tmp_path):
    design = {**with_hash({"kind": "svg", "svg": CAT}), "svg": CAT.replace("r=\"5\"", "r=\"6\"")}
    result = producer.prepare(request(tmp_path, "sticker_print", design, STICKER, mode="hardware", hashed=False))
    assert result["status"] == "rejected" and result["code"] == "canonical_mismatch"


@pytest.mark.parametrize("process,design,profile,params", [
    ("sticker_print", {"kind": "svg", "svg": CAT}, {**STICKER, "dpi": None}, {}),
    ("sticker_print", {"kind": "svg", "svg": CAT}, {**STICKER, "safe_margin_mm": None}, {}),
    ("photo_print", {"kind": "svg", "svg": CAT}, {**PHOTO, "printable_area_mm": None}, {"width_mm": 54, "height_mm": 86}),
    ("fdm_print", {"kind": "text_tag", "text": "CAT"}, {**FDM, "material_density_g_cm3": None}, {}),
])
def test_missing_profile_fact_needs_review(tmp_path, process, design, profile, params):
    result = producer.prepare(request(tmp_path, process, design, profile, params=params))
    assert result["status"] == "needs_review" and result["code"] == "profile_incomplete"


@pytest.mark.parametrize("change", [{"preparation_key": "short"}, {"output_dir": "relative/out"}, {"process": "welding"},
                                    {"execution_mode": "live"}, {"params": {"quantity": 0}}])
def test_invalid_requests(tmp_path, change):
    req = request(tmp_path, "sticker_print", {"kind": "svg", "svg": CAT}, STICKER)
    if "params" in change:
        req["params"].update(change["params"])
    else:
        req.update(change)
    assert producer.prepare(req)["code"] == "invalid_request"


# ---------------------------------------------------------------- CLI

def run_cli(payload: bytes, command=None) -> subprocess.CompletedProcess:
    return subprocess.run(command or [sys.executable, "-m", "fabyn_node.producer"], input=payload, capture_output=True, timeout=60)


def test_cli_round_trip(tmp_path):
    req = request(tmp_path, "sticker_print", {"kind": "svg", "svg": CAT}, STICKER, mode="hardware")
    done = run_cli(json.dumps(req).encode())
    assert done.returncode == 0, done.stderr
    assert json.loads(done.stdout) == producer.prepare(req)
    script = Path(sys.executable).parent / "fabyn-producer"
    if script.exists():
        installed = run_cli(json.dumps({"operation": "render_design_preview", "svg": CAT, "size_px": 64,
                                        "output_dir": str(tmp_path / "p")}).encode(), [str(script)])
        assert installed.returncode == 0 and json.loads(installed.stdout)["status"] == "ready"
    for payload in (b"{not json", b"[1, 2]", b'{"operation": "prepare", "x": NaN}', b"\xff\xfe", b" " * (2 * 1024 * 1024 + 1)):
        rejected = run_cli(payload)
        assert rejected.returncode == 0
        assert json.loads(rejected.stdout)["code"] == "invalid_request"
    if HAS_OPENSCAD:
        hardware = run_cli(json.dumps(request(tmp_path, "fdm_print", {"kind": "text_tag", "text": "CAT"}, FDM, mode="hardware")).encode())
        assert hardware.returncode == 0 and json.loads(hardware.stdout)["parameters"]["slicing"] == "receiver"


# ---------------------------------------------------------------- fitting the file to the picture

def ink_box(path):
    with Image.open(path) as image:
        return image.convert("L").point(lambda v: 255 if v < 128 else 0).getbbox(), image.size


MARGIN = round(1.5 / 25.4 * 300)
WIDE = {"width_mm": 54, "height_mm": 86, "color_mode": "color", "crop": "auto", "orientation": "auto"}


def test_sticker_fit_content_makes_a_tall_design_a_long_label(tmp_path):
    tall = svg('<rect x="45" y="5" width="10" height="90" fill="black"/>')
    result = producer.prepare(request(tmp_path, "sticker_print", {"kind": "svg", "svg": tall}, STICKER, params={"fit": "content"}))
    assert result["status"] == "ready", result
    assert result["parameters"]["height_mm"] == 150 and any("150 mm" in w for w in result["warnings"])
    (x0, y0, x1, y1), (w, h) = ink_box(result["artifact"]["path"])
    assert (w, h) == (626, round(150 / 25.4 * 300))
    assert y0 <= MARGIN + 6 and y1 >= h - MARGIN - 6  # the bar runs the whole label


def test_sticker_fit_content_trims_an_off_centre_drawing(tmp_path):
    corner = svg('<circle cx="15" cy="15" r="10" fill="black"/>')
    result = producer.prepare(request(tmp_path, "sticker_print", {"kind": "svg", "svg": corner}, STICKER, params={"fit": "content"}))
    assert result["status"] == "ready", result
    assert result["parameters"]["height_mm"] == 53  # a round design gives a square label
    (x0, y0, x1, y1), (w, h) = ink_box(result["artifact"]["path"])
    assert x1 - x0 > 0.9 * (w - 2 * MARGIN)  # fills the label instead of sitting in a corner
    assert abs((x0 + x1) / 2 - w / 2) < 4 and abs((y0 + y1) / 2 - h / 2) < 4


def test_sticker_fit_content_trims_a_photo_border_and_follows_its_shape(tmp_path):
    entry = photo(tmp_path, size=(1200, 1200), square=(300, 500, 900, 700), color="black", box=False)
    result = producer.prepare(request(tmp_path, "sticker_print", {"kind": "photos", "photos": [entry]}, STICKER,
                                      params={"fit": "content", "crop": "auto"}))
    assert result["status"] == "ready", result
    assert 15 <= result["parameters"]["height_mm"] <= 25  # a wide bar, not a 53 mm square of white


def test_photo_print_turns_a_wide_photo_and_keeps_the_preview_upright(tmp_path):
    entry = photo(tmp_path, size=(1600, 1200), square=(100, 100, 400, 400), color="red", box=False)
    result = producer.prepare(request(tmp_path, "photo_print", {"kind": "photos", "photos": [entry]}, PHOTO,
                                      mode="hardware", params=WIDE))
    assert result["status"] == "ready", result
    assert result["parameters"]["rotated_degrees"] == 90 and result["parameters"]["crop"] == "cover"
    assert any("sideways" in note for note in result["handling"])
    with Image.open(result["artifact"]["path"]) as printed:
        assert printed.size == (600, 800)
        assert printed.getpixel((100, 700))[:3] == (255, 0, 0)  # top-left of the picture is now bottom-left
    assert result["preview"]["path"] != result["artifact"]["path"]
    with Image.open(result["preview"]["path"]) as upright:
        assert upright.size == (800, 600) and upright.getpixel((100, 100))[:3] == (255, 0, 0)


def test_photo_print_prints_a_panorama_whole(tmp_path):
    entry = photo(tmp_path, size=(3000, 800), square=(0, 0, 3000, 800), color="green", box=False)
    result = producer.prepare(request(tmp_path, "photo_print", {"kind": "photos", "photos": [entry]}, PHOTO,
                                      mode="hardware", params=WIDE))
    assert result["status"] == "ready", result
    assert result["parameters"]["crop"] == "contain" and any("printed whole" in w for w in result["warnings"])
    with Image.open(result["artifact"]["path"]) as printed:
        assert printed.getpixel((300, 400))[:3] == (0, 128, 0) and printed.getpixel((10, 400))[:3] == (255, 255, 255)


def test_photo_print_keeps_a_portrait_photo_upright(tmp_path):
    entry = photo(tmp_path, size=(1200, 1600), square=(100, 100, 400, 400), color="red", box=False)
    result = producer.prepare(request(tmp_path, "photo_print", {"kind": "photos", "photos": [entry]}, PHOTO,
                                      mode="hardware", params=WIDE))
    assert result["status"] == "ready", result
    assert result["parameters"]["rotated_degrees"] == 0 and result["preview"]["path"] == result["artifact"]["path"]


def test_subject_box_turns_with_the_picture():
    assert producer._turn_box([0.1, 0.2, 0.3, 0.4]) == pytest.approx([0.2, 0.7, 0.4, 0.9])
    assert producer._turn_box(None) is None
