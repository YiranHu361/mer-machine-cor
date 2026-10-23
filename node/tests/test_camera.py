"""Finite camera boundary tests; every image and HTTP response is a fixture."""
import io
import sys
import httpx
import pytest
from PIL import Image
from fabrary_node.adapters import capture_camera
from fabrary_node.security import NodeError


@pytest.mark.asyncio
async def test_camera_command_reads_image_and_reports_missing_command(artifact):
    import base64
    payload = base64.b64encode(artifact).decode()
    result = await capture_camera({"cameraCommand": [sys.executable, "-c", "import base64,sys;sys.stdout.buffer.write(base64.b64decode(sys.argv[1]))", payload]})
    assert result == artifact
    with pytest.raises(NodeError) as error:
        await capture_camera({"cameraCommand": ["/nonexistent-fabrary-test-camera"]})
    assert error.value.code == "camera_failed" and error.value.status == 503


@pytest.mark.asyncio
async def test_camera_command_is_bounded_before_process_exits():
    # An endless stream must be cut off at the byte bound, not accumulated until
    # process exit or the ten-second capture deadline.
    command = [sys.executable, "-c", "import sys,time;sys.stdout.buffer.write(b'x'*(11*1024*1024));sys.stdout.buffer.flush();time.sleep(30)"]
    with pytest.raises(NodeError) as error:
        await capture_camera({"cameraCommand": command})
    assert error.value.code == "camera_oversize"


@pytest.mark.asyncio
async def test_camera_http_stream_stops_at_limit_and_disables_cache(monkeypatch):
    from fabrary_node import adapters
    consumed = []
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            for i in range(30):
                consumed.append(i)
                yield b"x" * (1024 * 1024)
    async def respond(request):
        assert request.headers["cache-control"] == "no-cache"
        assert request.headers["pragma"] == "no-cache"
        return httpx.Response(200, stream=Stream())
    real_client = httpx.AsyncClient
    monkeypatch.setattr(adapters.httpx, "AsyncClient", lambda **kwargs: real_client(**kwargs, transport=httpx.MockTransport(respond)))
    with pytest.raises(NodeError) as error:
        await capture_camera({"cameraUrl": "http://camera-fixture/frame"})
    assert error.value.code == "camera_oversize"
    assert len(consumed) == 11


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["offline", "redirect", "bad_image"])
async def test_camera_http_failures_are_explicit_and_do_not_return_evidence(monkeypatch, failure):
    from fabrary_node import adapters
    async def respond(request):
        if failure == "offline": raise httpx.ConnectError("fixture offline", request=request)
        if failure == "redirect": return httpx.Response(302, headers={"Location": "http://other-camera/"})
        return httpx.Response(200, content=b"not an image")
    real_client = httpx.AsyncClient
    monkeypatch.setattr(adapters.httpx, "AsyncClient", lambda **kwargs: real_client(**kwargs, transport=httpx.MockTransport(respond)))
    with pytest.raises(NodeError) as error:
        await capture_camera({"cameraUrl": "http://camera-fixture/frame"})
    assert error.value.status == 503
    assert error.value.code == ("camera_invalid" if failure == "bad_image" else "camera_failed")
