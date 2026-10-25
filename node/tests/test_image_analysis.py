"""Real Pillow analysis of controlled pixels, never semantic or vision claims."""
import json
import subprocess
import sys

from PIL import Image, ImageDraw
import pytest

from fabyn_node.image_analysis import analyze_paths


def graphic(path, *, transparent=False):
    image = Image.new("RGBA" if transparent else "RGB", (240, 160), (255, 0, 0, 0) if transparent else "white")
    drawing = ImageDraw.Draw(image)
    drawing.rectangle((20, 20, 85, 140), fill="black")
    drawing.line((115, 25, 215, 130), fill="black", width=12)
    image.save(path)
    return path


def photo(path, *, grayscale=False):
    image = Image.new("RGB", (128, 128))
    image.putdata([(x * 255 // 127,) * 3 if grayscale else
                   (x * 255 // 127, y * 255 // 127, (7 * x + 11 * y) % 256)
                   for y in range(128) for x in range(128)])
    image.save(path)
    return path


def test_high_contrast_monochrome_graphic_is_distinguished_from_continuous_tones(tmp_path):
    result = analyze_paths([graphic(tmp_path / "graphic.png")])
    assert result["method"] == "local_pixel_statistics/v1"
    assert result["kind"] == "graphic" and result["colorful"] is False
    image = result["images"][0]
    assert (image["width"], image["height"]) == (240, 160)
    assert image["nearBinaryFraction"] == 1 and image["entropy"] < 2
    assert image["colorFraction"] == 0 and image["edgeDensity"] > 0
    assert "no semantic recognition" in result["limitation"]


@pytest.mark.parametrize("suffix", ["png", "jpg"])
def test_color_continuous_tones_remain_photo_like_across_real_image_encoding(tmp_path, suffix):
    result = analyze_paths([photo(tmp_path / ("color." + suffix))])
    assert result["kind"] == "photo" and result["colorful"] is True
    image = result["images"][0]
    assert image["colorFraction"] > .8 and image["entropy"] > 6
    assert image["nearBinaryFraction"] < .4


def test_grayscale_continuous_tones_are_not_mistaken_for_binary_line_art(tmp_path):
    result = analyze_paths([photo(tmp_path / "gray.png", grayscale=True)])
    assert result["kind"] == "photo" and result["colorful"] is False
    assert result["images"][0]["entropy"] >= 6


def test_flat_low_information_image_is_explicitly_ambiguous(tmp_path):
    path = tmp_path / "flat.png"
    Image.new("RGB", (120, 120), "red").save(path)
    result = analyze_paths([path])
    assert result["kind"] == "ambiguous" and result["colorful"] is True
    assert result["images"][0]["entropy"] == 0


def test_transparent_background_is_composited_without_counting_invisible_color(tmp_path):
    opaque = analyze_paths([graphic(tmp_path / "opaque.png")])
    transparent = analyze_paths([graphic(tmp_path / "transparent.png", transparent=True)])
    assert transparent["images"] == opaque["images"]
    assert transparent["kind"] == "graphic" and transparent["colorful"] is False


def test_mixed_artwork_keeps_per_image_evidence_and_aggregate_uncertainty(tmp_path):
    result = analyze_paths([graphic(tmp_path / "graphic.png"), photo(tmp_path / "color.png")])
    assert [image["kind"] for image in result["images"]] == ["graphic", "photo"]
    assert result["kind"] == "ambiguous" and result["colorful"] is True


def test_actual_cli_outputs_only_limited_statistics_and_no_private_path(tmp_path):
    path = graphic(tmp_path / "private-owner-artwork.png")
    reply = subprocess.run([sys.executable, "-m", "fabyn_node.image_analysis", "--", str(path)], capture_output=True, text=True, timeout=10)
    assert reply.returncode == 0 and reply.stderr == ""
    assert json.loads(reply.stdout) == analyze_paths([path])
    assert str(path) not in reply.stdout


def test_actual_cli_decoder_failure_is_generic_without_private_path_or_trace(tmp_path):
    path = tmp_path / "private-sensitive-owner-name.png"
    path.write_bytes(b"not an image")
    reply = subprocess.run([sys.executable, "-m", "fabyn_node.image_analysis", "--", str(path)], capture_output=True, text=True, timeout=10)
    assert reply.returncode == 1 and reply.stderr == ""
    assert json.loads(reply.stdout)["error"]["code"] == "IMAGE_ANALYSIS_UNAVAILABLE"
    assert str(path) not in reply.stdout and "Traceback" not in reply.stdout


def test_analysis_rejects_excess_assets_and_unsupported_formats_before_classifying(tmp_path):
    path = graphic(tmp_path / "graphic.png")
    for paths in ([], [path] * 5):
        with pytest.raises(ValueError):
            analyze_paths(paths)
    unsupported = tmp_path / "animation.gif"
    Image.new("RGB", (10, 10), "white").save(unsupported)
    with pytest.raises(ValueError):
        analyze_paths([unsupported])
