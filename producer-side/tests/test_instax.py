import asyncio
import io
import json
from pathlib import Path

from PIL import Image

from node.adapters import make_adapter
from node.adapters.instax.image import FILM_PX, fit_to_film, to_jpeg
from node.protocol import Job

MACHINE = Path(__file__).parents[1] / "node/machines/m_photo_01.json"


def _noise(size):
    # Noise blown up 4x: busy detail like a photo, unlike pure noise, which no JPEG can shrink.
    return Image.effect_noise((size[0] // 4, size[1] // 4), 80).convert("RGB").resize(size, Image.Resampling.BICUBIC)


def test_fit_keeps_exact_film_size_untouched():
    src = Image.new("RGB", FILM_PX, (200, 30, 40))
    out = fit_to_film(src)
    assert out.size == FILM_PX and out.getpixel((300, 400)) == (200, 30, 40)


def test_fit_pads_other_sizes_on_white_without_cropping():
    out = fit_to_film(Image.new("RGB", (1200, 800), (0, 0, 0)))  # wide: black band, white above and below
    assert out.size == FILM_PX
    assert out.getpixel((300, 5)) == (255, 255, 255)
    assert out.getpixel((300, 400)) == (0, 0, 0)


def test_fit_flattens_transparency_on_white():
    out = fit_to_film(Image.new("RGBA", FILM_PX, (0, 0, 0, 0)))
    assert out.getextrema() == ((255, 255), (255, 255), (255, 255))


def test_jpeg_stays_under_the_transfer_limit():
    data = to_jpeg(_noise(FILM_PX), 55_000)
    assert len(data) <= 55_000
    assert Image.open(io.BytesIO(data)).size == FILM_PX


def test_flip_turns_the_picture_top_to_bottom():
    src = Image.new("RGB", FILM_PX, "white")
    src.paste((0, 0, 0), (0, 0, 600, 100))  # black band at the top
    flipped = Image.open(io.BytesIO(to_jpeg(src, 55_000, flip_vertical=True))).convert("L")
    assert flipped.getpixel((300, 790)) < 50 and flipped.getpixel((300, 10)) > 200


def test_dry_run_writes_the_jpeg_and_reports_progress(tmp_path):
    manifest = json.loads(MACHINE.read_text())
    manifest["adapter"].update(transport="file", out_dir=str(tmp_path / "out"))
    adapter = make_adapter(manifest)
    asset = tmp_path / "photo.png"
    _noise(FILM_PX).save(asset)
    job = Job(job_id="job_t", order_id="ord_t", item_id="it_t", machine_id="m_photo_01",
              process="photo_print", quantity=2, params={"width_mm": 54, "height_mm": 86})

    async def go():
        native = await adapter.prepare(job, asset)
        return native, [p async for p in adapter.run(job, native)]

    native, progress = asyncio.run(go())
    assert native.suffix == ".jpg" and native.stat().st_size <= 55_000
    assert sorted(p.name for p in (tmp_path / "out").iterdir()) == ["job_t_1.instax.jpg", "job_t_2.instax.jpg"]
    assert progress[-1].progress == 1.0
    assert manifest["media_loaded"]["remaining_est"] == 8
