import hashlib
import pytest
from PIL import Image, ImageDraw
from fabrary_node.prepare import prepare
from fabrary_node.adapters import Phomemo


@pytest.mark.parametrize("format,extension",[("PNG","png"),("JPEG","jpg"),("WEBP","webp")])
def test_preparation_produces_actual_monochrome_raster(tmp_path,format,extension):
    source=tmp_path / ("in."+extension)
    im=Image.new("RGB",(300,200),"white");ImageDraw.Draw(im).ellipse((20,20,180,180),fill="black");im.save(source,format)
    target=tmp_path / "approved.png"
    result=prepare(source,target)
    assert result["sha256"] == hashlib.sha256(target.read_bytes()).hexdigest()
    with Image.open(target) as actual:
        assert actual.mode == "1" and actual.size == (626,591)
        assert set(actual.get_flattened_data()) == {0,255}
    encoded=Phomemo.raster(target)
    assert encoded.startswith(b"\x1b\x40")
    # First raster block is 79 bytes/row, preserving the 626 approved pixels.
    assert b"\x1d\x76\x30\x00\x4f\x00\xff\x00" in encoded


def test_all_four_sources_appear_in_preview(tmp_path):
    paths=[]
    for i,color in enumerate(["red","blue","green","yellow"]):
        p=tmp_path / (str(i)+".png");Image.new("RGB",(20,20),color).save(p);paths.append(p)
    result=prepare(paths[0],tmp_path/"out.png",output_type="instax",width_mm=54,height_mm=86,crop="cover",extras=paths[1:])
    assert result["sourceCount"] == 4
    with Image.open(tmp_path/"out.png") as out:
        assert out.getpixel((100,100)) == (255,0,0)
        assert out.getpixel((400,100)) == (0,0,255)
        assert out.getpixel((100,500)) == (0,128,0)
        assert out.getpixel((400,500)) == (255,255,0)


def test_unsupported_inputs_rejected(tmp_path):
    source=tmp_path/"in.gif";Image.new("RGB",(10,10),"white").save(source)
    with pytest.raises(ValueError,match="Only PNG"):prepare(source,tmp_path/"out.png")
    with pytest.raises(ValueError,match="width"):prepare(source,tmp_path/"out.png",width_mm=52)
    with pytest.raises(ValueError,match="prepared catalog"):prepare(source,tmp_path/"out.png",output_type="3d")


def test_instax_candidate_bounds_jpeg_and_orientation_without_device(tmp_path):
    from fabrary_node.adapters import InstaxLink3
    source=tmp_path/"instax.png"
    im=Image.new("RGB",(600,800),"white")
    ImageDraw.Draw(im).rectangle((0,0,600,300),fill="black")
    im.save(source)
    data=InstaxLink3.jpeg_payload(source,True)
    assert len(data) <= 55000
    import io
    with Image.open(io.BytesIO(data)) as actual:
        assert actual.size == (600,800)
        assert actual.getpixel((100,100))[0] > 240
        assert actual.getpixel((100,700))[0] < 15
