import hashlib
import io
import time
import httpx
import pytest
from PIL import Image, ImageDraw
from fabrary_node.service import NodeService
from fabrary_node.security import sign_token

KEY = "node-test-secret-at-least-32-bytes"
PARAMS = {"outputType": "sticker", "widthMm": 53, "heightMm": 50, "quantity": 1, "material": "thermal-paper", "crop": "contain", "specVersion": 1}


@pytest.fixture
def artifact():
    im = Image.new("1", (round(53/25.4*300), round(50/25.4*300)), 1)
    ImageDraw.Draw(im).rectangle((60, 60, 400, 400), fill=0)
    out = io.BytesIO()
    im.save(out, "PNG")
    return out.getvalue()


@pytest.fixture
def service(tmp_path, artifact):
    async def serve(request):
        return httpx.Response(200, content=artifact)
    return NodeService(key=KEY, data_dir=tmp_path, artifact_transport=httpx.MockTransport(serve))


def request_for(artifact, *, job="job_1", attempt="attempt_1", machine="phomemo_01", params=None, scope="dispatch", expiration=None):
    exp = expiration or int(time.time()) + 300
    payload = {"machine_id": machine, "job_id": job, "attempt_id": attempt,
        "artifact_sha256": hashlib.sha256(artifact).hexdigest(), "parameters": params or dict(PARAMS),
        "expires_at": exp, "scope": scope}
    token = sign_token(payload, KEY)
    return {**{k:v for k,v in payload.items() if k != "scope"}, "token": token,
            "artifact_url": "http://127.0.0.1:4318/assets/approved.png?expires=" + str(int(time.time())+300) + "&sig=checked-by-backend"}
