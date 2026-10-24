import struct

from PIL import Image

from node.adapters.phomemo.raster import encode_raster, prepare_image


def test_encode_header_blocks_footer():
    img = Image.new("1", (576, 300), 1)
    img.putpixel((0, 0), 0)  # one black dot, top-left
    out = encode_raster(img, density=4, feed_lines=2)

    assert out.startswith(b"\x1b\x40\x1b\x61\x01\x1f\x11\x02\x04")
    first = out.index(b"\x1d\x76\x30\x00")
    width_bytes, lines = struct.unpack("<HH", out[first + 4 : first + 8])
    assert (width_bytes, lines) == (72, 255)
    assert out[first + 8] == 0x80  # 1 = black, MSB first
    assert out.count(b"\x1d\x76\x30\x00") == 2  # 255 + 45 lines
    assert out.endswith(b"\x1b\x64\x02\x1b\x64\x02\x1f\x11\x08\x1f\x11\x0e\x1f\x11\x07\x1f\x11\x09")
    header, footer, block_headers = 9, 6 + 12, 2 * 8
    assert len(out) == header + block_headers + 72 * 300 + footer


def test_prepare_scales_to_target_mm_and_centers():
    src = Image.new("L", (1000, 500), 0)  # all black
    bw = prepare_image(src, width_dots=576, dpi=300, target_mm=(24, 0))
    assert bw.mode == "1" and bw.width == 576
    assert bw.height == round(283 * 500 / 1000)  # 24 mm = 283 dots wide
    left_margin = (576 - 283) // 2
    assert bw.getpixel((left_margin - 1, 10))  # white padding (Pillow: 1 or 255)
    assert not bw.getpixel((left_margin + 5, 10))


def test_prepare_never_wider_than_head_and_flattens_alpha():
    src = Image.new("RGBA", (2000, 400), (0, 0, 0, 0))  # fully transparent -> white
    bw = prepare_image(src, width_dots=576, dpi=300)
    assert bw.width == 576
    assert bw.convert("L").getextrema() == (255, 255)  # all white


def test_prepare_crops_to_max_length():
    src = Image.new("L", (576, 5000), 0)
    bw = prepare_image(src, width_dots=576, dpi=300, max_length_dots=1000)
    assert bw.height == 1000
