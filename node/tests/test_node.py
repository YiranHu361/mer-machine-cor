import asyncio
import base64
import hashlib
import io
import json
import time
import httpx
import pytest
from PIL import Image
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
from fabrary_node.journal import Journal
from fabrary_node.security import NodeError, sign_token, validate_artifact_url
from fabrary_node.server import create_app
from fabrary_node.service import NodeService
from .conftest import KEY, PARAMS, request_for


async def wait_done(service, attempt="attempt_1"):
    await service.tasks[attempt]
    return service.get_status("phomemo_01", "job_1", attempt)


def camera_args(scope="camera", machine="phomemo_01", job="job_1", attempt="attempt_1"):
    payload = {"scope": scope, "machine_id": machine, "job_id": job, "attempt_id": attempt, "expires_at": int(time.time())+300}
    return {k: payload[k] for k in ("machine_id", "job_id", "attempt_id")} | {"token": sign_token(payload, KEY)}


@pytest.mark.asyncio
async def test_http_all_routes_require_auth(service):
    app = create_app(service)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        for route in ("/health", "/frames/anything.png", "/mcp/", "/openapi.json"):
            assert (await client.get(route)).status_code == 401
        assert (await client.post("/tools/get_capabilities", json={"machine_id":"phomemo_01"})).status_code == 401
        response = await client.post("/tools/get_capabilities", json={"machine_id":"phomemo_01"}, headers={"Authorization":"Bearer " + KEY})
        assert response.status_code == 200
        assert response.json()["mode"] == "simulation"
    await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("mutation", ["machine", "tampered", "expired", "scope", "parameters", "artifact", "attempt"])
async def test_signed_bindings_rejected(service, artifact, mutation):
    request = request_for(artifact)
    if mutation == "machine": request["machine_id"] = "bambu_01"
    if mutation == "tampered": request["token"] = request["token"][:-1] + ("0" if request["token"][-1] != "0" else "1")
    if mutation == "expired": request = request_for(artifact, expiration=int(time.time())-1)
    if mutation == "scope": request = request_for(artifact, scope="camera")
    if mutation == "parameters": request["parameters"]["quantity"] = 2
    if mutation == "artifact": request["artifact_sha256"] = "0"*64
    if mutation == "attempt": request["attempt_id"] = "another"
    with pytest.raises(NodeError) as caught:
        await service.run_job(**request)
    assert caught.value.status == 403
    assert not service.journal.latest("phomemo_01")
    await service.close()


@pytest.mark.asyncio
async def test_policy_artifact_integrity_and_dimensions(service, artifact):
    service.update_policy("phomemo_01", {"maxQuantity": 1})
    with pytest.raises(NodeError, match="Quantity"):
        await service.run_job(**request_for(artifact, params=PARAMS | {"quantity":2}))
    with pytest.raises(NodeError, match="Loaded sticker"):
        await service.run_job(**request_for(artifact, params=PARAMS | {"widthMm":52}))
    with pytest.raises(NodeError, match="material"):
        await service.run_job(**request_for(artifact, params=PARAMS | {"material":"vinyl"}))
    request = request_for(b"different approved bytes")
    with pytest.raises(NodeError, match="SHA256"):
        await service.run_job(**request)
    assert service.journal.latest("phomemo_01") is None
    await service.close()


@pytest.mark.asyncio
async def test_exact_prepared_raster_required(tmp_path):
    im = Image.new("RGB", (100,100), "red"); out=io.BytesIO(); im.save(out,"PNG"); data=out.getvalue()
    service=NodeService(key=KEY,data_dir=tmp_path,artifact_transport=httpx.MockTransport(lambda r:httpx.Response(200,content=data)))
    with pytest.raises(NodeError, match="prepared production"):
        await service.run_job(**request_for(data))
    await service.close()


@pytest.mark.asyncio
async def test_durable_idempotency_and_busy_slot(service, artifact, tmp_path):
    request = request_for(artifact)
    first, repeated = await asyncio.gather(service.run_job(**request), service.run_job(**request))
    assert {first["status"], repeated["status"]} == {"accepted", "already_accepted"}
    with pytest.raises(NodeError):
        await service.run_job(**request_for(artifact, job="job_2", attempt="attempt_2"))
    result = await wait_done(service)
    assert result["execution_status"] == "completed" and result["completion_credible"]
    assert service.adapters["phomemo_01"].executions == 1
    assert not result["ready"] and result["paused"]
    assert (await service.run_job(**request))["status"] == "already_accepted"
    await service.close()
    restarted=NodeService(key=KEY,data_dir=tmp_path)
    retry=await restarted.run_job(**request)
    assert retry["status"] == "already_accepted" and retry["execution_status"] == "completed"
    assert restarted.adapters["phomemo_01"].executions == 0
    with pytest.raises(NodeError, match="already binds"):
        await restarted.run_job(**request_for(artifact, params=PARAMS | {"quantity":2}))
    await restarted.close()


@pytest.mark.asyncio
async def test_resume_requires_owner_cleared_inspected_and_allows_new_job(service, artifact):
    await service.run_job(**request_for(artifact)); await wait_done(service)
    with pytest.raises(NodeError, match="inspection"):
        service.update_policy("phomemo_01", {"paused":False,"ready":True})
    service.update_policy("phomemo_01", {"paused":False,"ready":True,"cleared":True,"inspected":True})
    assert service.get_status("phomemo_01")["ready"]
    # Previous collection is outside node readiness and does not block execution.
    await service.run_job(**request_for(artifact,job="job_2",attempt="attempt_2")); await service.tasks["attempt_2"]
    assert service.adapters["phomemo_01"].executions == 2
    await service.close()


@pytest.mark.asyncio
async def test_restart_after_possible_start_uncertain_never_reprints(service, artifact, tmp_path):
    service.adapters["phomemo_01"].config["simulationSeconds"] = 30
    request=request_for(artifact)
    await service.run_job(**request)
    await asyncio.sleep(0)
    assert service.journal.get("attempt_1")["status"] == "running"
    await service.close()
    restarted=NodeService(key=KEY,data_dir=tmp_path)
    status=restarted.get_status("phomemo_01", "job_1", "attempt_1")
    assert status["execution_status"] == "uncertain" and not status["completion_credible"]
    assert (await restarted.run_job(**request))["execution_status"] == "uncertain"
    assert restarted.adapters["phomemo_01"].executions == 0
    with pytest.raises(NodeError):
        restarted.update_policy("phomemo_01", {"paused":False,"ready":True,"cleared":True,"inspected":True})
    await restarted.close()


def test_restart_before_start_records_failed_without_physical_side_effect(tmp_path, artifact):
    journal=Journal(tmp_path / "journal.sqlite")
    journal.accept(request_for(artifact),"pass")
    journal.close()
    journal=Journal(tmp_path / "journal.sqlite")
    assert journal.get("attempt_1")["status"] == "failed"
    assert "before physical start" in journal.get("attempt_1")["reason"]
    journal.close()


@pytest.mark.asyncio
async def test_lost_ack_durable_and_visible_uncertainty(service, artifact):
    service.simulation("phomemo_01", "lost_ack")
    with pytest.raises(NodeError) as caught:
        await service.run_job(**request_for(artifact))
    assert caught.value.status == 503
    assert (await service.run_job(**request_for(artifact)))["status"] == "already_accepted"
    result=await wait_done(service)
    assert result["execution_status"] == "uncertain" and not result["completion_credible"]
    assert service.adapters["phomemo_01"].executions == 1
    await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome,observation", [("pass","visible"),("fail","missing"),("review","ambiguous")])
async def test_authorized_fresh_camera_evidence(service, artifact, outcome, observation):
    service.simulation("phomemo_01", outcome)
    baseline=await service.camera_snapshot(**camera_args(),phase="baseline")
    assert baseline["observation"] == "missing" and baseline["source"] == "simulation"
    await service.run_job(**request_for(artifact)); await wait_done(service)
    first=await service.camera_snapshot(**camera_args())
    second=await service.camera_snapshot(**camera_args())
    assert first["observation"] == observation and first["completion_credible"]
    assert first["frame_url"] != second["frame_url"]
    assert first["captured_at"] != second["captured_at"]
    with pytest.raises(NodeError):
        await service.camera_snapshot(**camera_args(scope="dispatch"))
    with pytest.raises(NodeError):
        await service.camera_snapshot(**camera_args(job="another_job"))
    await service.close()


@pytest.mark.asyncio
async def test_abort_simulator_confirms_stop_hardware_does_not(service, artifact):
    service.adapters["phomemo_01"].config["simulationSeconds"] = 30
    await service.run_job(**request_for(artifact)); await asyncio.sleep(0)
    response=await service.abort(**camera_args(scope="abort"))
    assert response["status"] == "stopped"
    assert service.get_status("phomemo_01")["execution_status"] == "failed"
    assert not service.get_status("phomemo_01")["completion_credible"]
    from fabrary_node.adapters import Phomemo, Bambu
    assert (await Phomemo({}).abort())["status"] == "unsupported"
    assert (await Bambu({}).abort())["status"] == "unknown"
    await service.close()


@pytest.mark.asyncio
async def test_unconfigured_hardware_calibration_cannot_pass(tmp_path):
    machines=[{"id":"phomemo_01","model":"Phomemo M02Pro","mode":"hardware"},
              {"id":"instax_01","model":"Instax Mini Link 3","mode":"hardware"},
              {"id":"bambu_01","model":"Bambu Lab A1 mini","mode":"hardware"}]
    service=NodeService(key=KEY,data_dir=tmp_path,machines=machines)
    for machine in machines:
        manifest=service.get_capabilities(machine["id"])
        assert manifest["blockers"] and not manifest["configured"] and not manifest["ready"]
        assert service.calibrate(machine["id"],True)["status"] == "blocked"
        assert not service.journal.machine(machine["id"])["calibrated"]
        with pytest.raises(NodeError): service.simulation(machine["id"],"pass")
    await service.close()


@pytest.mark.parametrize("bad", [
    "http://localhost:4318/assets/okay?expires=9999999999&sig=x",
    "http://127.0.0.1:4318/assets2/file?expires=9999999999&sig=x",
    "http://127.0.0.1:4318/assets/%2e%2e/private?expires=9999999999&sig=x",
    "http://127.0.0.1:4318/assets/file",
    "http://127.0.0.1:4318/assets/file?expires=1&sig=x",
    "http://user:pass@127.0.0.1:4318/assets/file?expires=9999999999&sig=x",
    "file:///assets/file?expires=9999999999&sig=x",
])
def test_asset_fetch_origin_and_signature_bounds(bad):
    with pytest.raises(NodeError): validate_artifact_url(bad,"http://127.0.0.1:4318/assets")


@pytest.mark.asyncio
async def test_operator_resolution_frees_uncertainty_without_reprint(service, artifact):
    service.simulation("phomemo_01", "lost_ack")
    with pytest.raises(NodeError): await service.run_job(**request_for(artifact))
    await wait_done(service)
    status=service.reconcile(machine_id="phomemo_01",job_id="job_1",attempt_id="attempt_1",inspected=True,result="failed",reason="Owner inspected output tray and found no finished sticker")
    assert status["execution_status"] == "failed" and not status["completion_credible"]
    assert status["paused"]
    service.update_policy("phomemo_01", {"paused":False,"ready":True,"inspected":True,"cleared":True})
    assert service.get_status("phomemo_01")["ready"]
    assert service.adapters["phomemo_01"].executions == 1
    assert "Operator inspected" in status["reason"]
    await service.close()


@pytest.mark.asyncio
async def test_journal_process_exclusivity(service, tmp_path):
    with pytest.raises(RuntimeError,match="Another node"):
        NodeService(key=KEY,data_dir=tmp_path)
    await service.close()


@pytest.mark.asyncio
async def test_actual_http_and_fastmcp_same_five_tools(service, artifact):
    import socket
    import uvicorn
    sock=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
    sock.bind(("127.0.0.1",0)); sock.listen(128); sock.setblocking(False)
    port=sock.getsockname()[1]
    app=create_app(service)
    server=uvicorn.Server(uvicorn.Config(app,log_level="error",access_log=False))
    task=asyncio.create_task(server.serve(sockets=[sock]))
    try:
        for _ in range(100):
            if server.started: break
            await asyncio.sleep(.02)
        assert server.started
        url=f"http://127.0.0.1:{port}"
        async with httpx.AsyncClient(base_url=url) as http:
            assert (await http.get("/health")).status_code == 401
            response=await http.post("/tools/run_job",json=request_for(artifact),headers={"Authorization":"Bearer "+KEY})
            assert response.status_code == 200 and response.json()["status"] == "accepted"
        transport=StreamableHttpTransport(url+"/mcp/",headers={"Authorization":"Bearer "+KEY})
        async with Client(transport) as client:
            listed=await client.list_tools()
            assert {tool.name for tool in listed} == {"get_capabilities","get_status","run_job","camera_snapshot","abort"}
            result=await client.call_tool("get_status",{"machine_id":"phomemo_01","job_id":"job_1","attempt_id":"attempt_1"})
            assert not result.is_error
        await wait_done(service)
    finally:
        server.should_exit=True
        await task


@pytest.mark.asyncio
async def test_policy_integer_hours_and_closed_window(service, artifact):
    service.update_policy("phomemo_01",{"hours":{"start":0,"end":24}})
    assert service.get_capabilities("phomemo_01")["hours"] == {"start":0,"end":24,"timezone":"UTC"}
    for bad in ({"start":0,"end":25},{"start":"00:00","end":"23:59"},{"start":12,"end":12},{"start":True,"end":24}):
        with pytest.raises(NodeError): service.update_policy("phomemo_01",{"hours":bad})
    from datetime import datetime,timezone
    hour=datetime.now(timezone.utc).hour
    start=(hour+2)%24;end=start+1
    service.update_policy("phomemo_01",{"hours":{"start":start,"end":end}})
    with pytest.raises(NodeError,match="outside owner operating hours"):
        await service.run_job(**request_for(artifact))
    assert service.journal.latest("phomemo_01") is None
    await service.close()


def test_catalog_exact_hash_and_owner_review_required():
    from fabrary_node.adapters import Bambu
    from hashlib import sha256
    digest=sha256(b"prepared-file").hexdigest()
    entry={"id":"demo","sha256":digest,"machineModel":"Bambu Lab A1 mini","reviewed":True,"widthMm":30,"heightMm":20,"depthMm":10,"color":"white","material":"pla","plateNumber":1,"estimatedSeconds":300}
    adapter=Bambu({"catalog":[entry],"maxJobSeconds":600})
    params=PARAMS | {"outputType":"3d","widthMm":30,"heightMm":20,"depthMm":10,"color":"white","material":"pla","estimatedSeconds":300}
    assert adapter.catalog_entry(digest,params)["id"] == "demo"
    for bad in ("0"*64,):
        with pytest.raises(NodeError): adapter.catalog_entry(bad,params)
    for field,value in (("widthMm",31),("heightMm",21),("depthMm",11),("color","blue"),("material","petg"),("estimatedSeconds",301)):
        with pytest.raises(NodeError): adapter.catalog_entry(digest,params | {field:value})
    for field in ("depthMm","color","estimatedSeconds"):
        omitted=dict(params);del omitted[field]
        with pytest.raises(NodeError): adapter.catalog_entry(digest,omitted)
    entry["reviewed"]=False
    with pytest.raises(NodeError): adapter.catalog_entry(digest,params)
    entry["reviewed"]=True;entry["estimatedSeconds"]=601
    with pytest.raises(NodeError): adapter.catalog_entry(digest,params)


@pytest.mark.asyncio
async def test_transport_only_calibration_requires_physical_inspection_context(tmp_path, artifact, monkeypatch):
    # Deterministic policy test, not a hardware result: setup a journaled uncertain
    # attempt and mock only configuration diagnostics/camera at the device boundary.
    from fabrary_node import service as service_module
    machine={"id":"phomemo_01","model":"Phomemo M02Pro","mode":"hardware"}
    service=NodeService(key=KEY,data_dir=tmp_path,machines=[machine])
    monkeypatch.setattr(service.adapters["phomemo_01"],"blockers",lambda:[])
    service.journal.accept(request_for(artifact),"pass",scope="calibration")
    service.journal.update("attempt_1","running")
    service.journal.update("attempt_1","uncertain",reason="Transport acknowledged; ejection unknown")
    with pytest.raises(NodeError,match="Resolve the active"):
        service.calibrate("phomemo_01",True,"attempt_1",reason="Inspected the physical test pattern")
    service.reconcile(machine_id="phomemo_01",job_id="job_1",attempt_id="attempt_1",inspected=True,result="completed",reason="Owner found complete calibration print and checked alignment")
    assert service.calibrate("phomemo_01",True,"attempt_1",reason="Inspected the physical test pattern")["status"] == "blocked"
    async def camera(config): return artifact
    monkeypatch.setattr(service_module,"capture_camera",camera)
    frame=await service.camera_snapshot(**camera_args())
    assert frame["source"] == "camera"  # mocked boundary, never counted as live.
    assert service.calibrate("phomemo_01",True,"attempt_1",reason="ok")["status"] == "blocked"
    with service.journal.transaction():
        service.journal.db.execute("UPDATE frames SET captured_at='2000-01-01T00:00:00Z'")
    assert service.calibrate("phomemo_01",True,"attempt_1",reason="Inspected the physical test pattern")["status"] == "blocked"
    await service.camera_snapshot(**camera_args())
    result=service.calibrate("phomemo_01",True,"attempt_1",reason="Inspected print, verified alignment and all four image corners")
    assert result["status"] == "passed" and result["source"] == "owner-inspection"
    assert service.journal.machine("phomemo_01")["calibrated"]
    assert not service.journal.get("attempt_1")["completion_credible"]
    await service.close()


@pytest.mark.asyncio
async def test_expiry_is_rechecked_after_artifact_fetch(tmp_path,artifact):
    async def delayed_asset(request):
        await asyncio.sleep(.12)
        return httpx.Response(200,content=artifact)
    service=NodeService(key=KEY,data_dir=tmp_path,artifact_transport=httpx.MockTransport(delayed_asset))
    request=request_for(artifact,expiration=time.time()+.05)
    with pytest.raises(NodeError) as error:
        await service.run_job(**request)
    assert error.value.code == "expired_token"
    assert service.journal.latest("phomemo_01") is None
    await service.close()


@pytest.mark.asyncio
async def test_production_attempt_cannot_be_reused_as_hardware_calibration(tmp_path,artifact,monkeypatch):
    service=NodeService(key=KEY,data_dir=tmp_path,machines=[{"id":"phomemo_01","model":"Phomemo M02Pro","mode":"hardware"}])
    monkeypatch.setattr(service.adapters["phomemo_01"],"blockers",lambda:[])
    service.journal.accept(request_for(artifact),"pass",scope="dispatch")
    service.journal.update("attempt_1","running")
    service.journal.update("attempt_1","completed",credible=True)
    result=service.calibrate("phomemo_01",True,"attempt_1",reason="Inspected the finished calibration test")
    assert result["status"] == "blocked" and "specifically for calibration" in result["reason"]
    assert not service.journal.machine("phomemo_01")["calibrated"]
    await service.close()


@pytest.mark.asyncio
async def test_authenticated_malformed_http_is_rejected_before_execution(service):
    app=create_app(service)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://test",headers={"Authorization":"Bearer "+KEY}) as client:
        for body in ([],None,"text"):
            response=await client.post("/tools/run_job",json=body)
            assert response.status_code == 422
        response=await client.post("/tools/run_job",content="{malformed")
        assert response.status_code == 422
        assert service.journal.latest("phomemo_01") is None
    await service.close()


@pytest.mark.asyncio
async def test_calibration_pass_preserves_explicit_resume_requirement(service):
    result=service.calibrate("phomemo_01",True)
    assert result["status"] == "passed" and result["source"] == "simulation"
    state=service.get_status("phomemo_01")
    assert state["calibrated"] and state["paused"] and not state["ready"]
    service.update_policy("phomemo_01",{"paused":False,"ready":True,"inspected":True,"cleared":True})
    assert service.get_status("phomemo_01")["ready"]
    await service.close()


@pytest.mark.asyncio
async def test_prepared_3d_parameter_contract_and_owner_limits(service):
    parameters=PARAMS | {"outputType":"3d","widthMm":30,"heightMm":20,"depthMm":10,"color":"white","material":"pla","estimatedSeconds":300}
    service.validate_parameters("bambu_01",parameters)
    for field in ("depthMm","color","estimatedSeconds"):
        omitted=dict(parameters);del omitted[field]
        with pytest.raises(NodeError): service.validate_parameters("bambu_01",omitted)
    for changes in ({"depthMm":0},{"depthMm":181},{"depthMm":True},{"depthMm":float("inf")},{"color":""},{"color":"  "},{"color":2},{"estimatedSeconds":0},{"estimatedSeconds":901},{"estimatedSeconds":True},{"estimatedSeconds":float("nan")},{"extra":"unapproved"}):
        with pytest.raises(NodeError): service.validate_parameters("bambu_01",parameters | changes)
    service.update_policy("bambu_01",{"maxJobSeconds":299})
    with pytest.raises(NodeError) as error: service.validate_parameters("bambu_01",parameters)
    assert error.value.code == "catalog_duration"
    # Non-3D outputs retain the exact original seven-field contract.
    service.validate_parameters("phomemo_01",PARAMS)
    for field,value in (("depthMm",10),("color","white"),("estimatedSeconds",300)):
        with pytest.raises(NodeError): service.validate_parameters("phomemo_01",PARAMS | {field:value})
    await service.close()


@pytest.mark.asyncio
async def test_prepared_3d_characteristics_are_signed_and_durable(service,artifact):
    parameters=PARAMS | {"outputType":"3d","widthMm":30,"heightMm":20,"depthMm":10,"color":"white","material":"pla","estimatedSeconds":300}
    for field,value in (("depthMm",11),("color","blue"),("estimatedSeconds",301)):
        tampered=request_for(artifact,machine="bambu_01",params=dict(parameters))
        tampered["parameters"][field]=value
        with pytest.raises(NodeError) as error: await service.run_job(**tampered)
        assert error.value.code == "token_binding"
    request=request_for(artifact,machine="bambu_01",params=dict(parameters))
    accepted=await service.run_job(**request)
    assert accepted["status"] == "accepted"
    await service.tasks["attempt_1"]
    assert (await service.run_job(**request))["status"] == "already_accepted"
    changed=request_for(artifact,machine="bambu_01",params=parameters | {"color":"blue"})
    with pytest.raises(NodeError) as error: await service.run_job(**changed)
    assert error.value.code == "attempt_conflict"
    assert service.adapters["bambu_01"].executions == 1
    await service.close()
