"""Mode and private configuration authorization; every hardware transport is fake."""
import asyncio
import hashlib
import io
import time
import httpx
import pytest
from PIL import Image
from fabrary_node import service as service_module
from fabrary_node.service import NodeService
from fabrary_node.security import NodeError, sign_token

KEY = "isolated-mode-regression-no-real-credentials"
MID = "phomemo_01"
PARAMETERS = {"outputType": "sticker", "widthMm": 53, "heightMm": 50, "quantity": 1,
              "material": "thermal-paper", "crop": "contain", "specVersion": 1}
MISSING = object()


class NoIoAdapter:
    def __init__(self, version):
        self.version, self.executions, self.stops = version, 0, 0

    def blockers(self):
        return []

    async def run(self, artifact, parameters, attempt_id):
        self.executions += 1
        return "completed", True, "Fake adapter only; no physical output"

    async def abort(self):
        self.stops += 1
        return {"status": "unknown", "reason": "Fake stop only; no physical transport"}


def artifact():
    out = io.BytesIO()
    Image.new("1", (round(53 / 25.4 * 300), round(50 / 25.4 * 300)), 1).save(out, "PNG")
    return out.getvalue()


def request_for(data, mode=MISSING, *, scope="dispatch", suffix="one", parameters=None, expires=None):
    expiry = int(time.time()) + 300 if expires is None else expires
    payload = {"machine_id": MID, "job_id": "job_" + suffix, "attempt_id": "attempt_" + suffix,
               "artifact_sha256": hashlib.sha256(data).hexdigest(), "parameters": parameters or dict(PARAMETERS),
               "expires_at": expiry, "scope": scope}
    if mode is not MISSING:
        payload["expected_mode"] = mode
    return {**{key: value for key, value in payload.items() if key not in {"scope", "expected_mode"}},
            "token": sign_token(payload, KEY),
            "artifact_url": f"http://127.0.0.1:4318/assets/prepared.png?expires={int(time.time())+300}&sig=isolated"}


async def node(tmp_path, mode="simulation", transport=None):
    data = artifact()
    fetched = []
    async def serve(request):
        fetched.append(request.url.path)
        if transport:
            return await transport(request)
        return httpx.Response(200, content=data)
    service = NodeService(key=KEY, data_dir=tmp_path, machines=[{
        "id": MID, "model": "Phomemo M02Pro", "mode": mode, "paired": True,
    }], artifact_transport=httpx.MockTransport(serve))
    fake = NoIoAdapter(service.adapters[MID].version)
    service.adapters[MID] = fake
    state = service.journal.machine(MID)
    state.update(paired=True, configured=True, calibrated=True, listed=True, ready=True,
                 paused=False, mediaRemaining=100, maxJobSeconds=180)
    service.journal.save_machine(MID, state)
    return service, fake, fetched, data


@pytest.mark.asyncio
@pytest.mark.parametrize("mode,scope", [(mode, scope) for mode in ("simulation", "hardware") for scope in ("dispatch", "calibration")])
async def test_new_authorization_rejects_missing_malformed_or_cross_mode_before_fetch_or_journal(tmp_path, mode, scope):
    service, fake, fetched, data = await node(tmp_path, mode)
    try:
        other = "hardware" if mode == "simulation" else "simulation"
        for value in (MISSING, None, False, 0, [], {}, "", "unknown", other):
            req = request_for(data, value, scope=scope)
            with pytest.raises(NodeError) as caught:
                await service.run_job(**req, _scope=scope)
            assert caught.value.status == 403
            assert "mode" in caught.value.message.lower()
            assert fetched == []
            assert service.journal.latest(MID) is None
            assert fake.executions == fake.stops == 0
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_matching_mode_allows_one_finite_dispatch_or_calibration_in_each_mode(tmp_path):
    for mode in ("simulation", "hardware"):
        for scope in ("dispatch", "calibration"):
            service, fake, fetched, data = await node(tmp_path / (mode + scope), mode)
            try:
                req = request_for(data, mode, scope=scope)
                accepted = await service.run_job(**req, _scope=scope)
                await service.tasks[req["attempt_id"]]
                assert accepted["status"] == "accepted"
                assert service.journal.get(req["attempt_id"])["status"] == "completed"
                assert len(fetched) == fake.executions == 1
            finally:
                await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["simulation", "hardware"])
async def test_fresh_configured_mode_is_rechecked_after_artifact_await(tmp_path, mode):
    entered, release = asyncio.Event(), asyncio.Event()
    data = artifact()
    async def held(request):
        entered.set()
        await release.wait()
        return httpx.Response(200, content=data)
    service, fake, fetched, data = await node(tmp_path, mode, held)
    pending = None
    try:
        req = request_for(data, mode)
        pending = asyncio.create_task(service.run_job(**req))
        await entered.wait()
        # Replace the object so an old captured config reference cannot pass.
        service.machines[MID] = dict(service.machines[MID], mode="hardware" if mode == "simulation" else "simulation")
        release.set()
        with pytest.raises(NodeError) as caught:
            await pending
        assert caught.value.status == 403
        assert len(fetched) == 1
        assert service.journal.latest(MID) is None
        assert fake.executions == fake.stops == 0
    finally:
        release.set()
        if pending:
            await asyncio.gather(pending, return_exceptions=True)
        await service.close()


@pytest.mark.asyncio
async def test_queued_worker_cannot_start_on_a_mode_changed_after_durable_acceptance(tmp_path):
    service, fake, fetched, data = await node(tmp_path)
    try:
        req = request_for(data, "simulation")
        await service.run_job(**req)
        service.machines[MID] = dict(service.machines[MID], mode="hardware")
        await service.tasks[req["attempt_id"]]
        assert service.journal.get(req["attempt_id"])["status"] == "failed"
        assert fake.executions == fake.stops == 0
        assert not service.get_status(MID)["ready"]
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_exact_legacy_or_old_mode_durable_replay_never_fetches_or_executes_after_reconfiguration(tmp_path):
    service, fake, fetched, data = await node(tmp_path, "hardware")
    try:
        req = request_for(data)
        service.journal.accept(req, "pass", scope="dispatch")
        service.journal.update(req["attempt_id"], "running")
        service.journal.update(req["attempt_id"], "completed", credible=True)
        saved = service.journal.get(req["attempt_id"])
        for mode in (MISSING, "simulation", "hardware"):
            replay = await service.run_job(**request_for(data, mode))
            assert replay["status"] == "already_accepted"
            assert replay["execution_status"] == "completed"
            assert service.journal.get(req["attempt_id"]) == saved
        assert fetched == []
        assert fake.executions == fake.stops == 0
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_legacy_replay_still_requires_exact_authenticated_content_expiry_and_scope(tmp_path):
    service, fake, fetched, data = await node(tmp_path, "hardware")
    try:
        original = request_for(data)
        service.journal.accept(original, "pass", scope="dispatch")
        service.journal.update(original["attempt_id"], "failed")
        tampered = dict(original, token=original["token"][:-1] + ("0" if original["token"][-1] != "0" else "1"))
        for req, scope in ((tampered, "dispatch"),
                           (request_for(data, expires=int(time.time())-1), "dispatch"),
                           (request_for(data, parameters={**PARAMETERS, "quantity": 2}), "dispatch"),
                           (request_for(data, scope="abort"), "dispatch"),
                           (request_for(data, scope="calibration"), "calibration")):
            with pytest.raises(NodeError):
                await service.run_job(**req, _scope=scope)
        assert fetched == []
        assert fake.executions == fake.stops == 0
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_matching_durable_attempt_found_after_fetch_remains_read_only_across_mode_change(tmp_path):
    entered, release = asyncio.Event(), asyncio.Event()
    data = artifact()
    async def held(request):
        entered.set()
        await release.wait()
        return httpx.Response(200, content=data)
    service, fake, fetched, data = await node(tmp_path, transport=held)
    pending = None
    try:
        req = request_for(data, "simulation")
        pending = asyncio.create_task(service.run_job(**req))
        await entered.wait()
        service.journal.accept(req, "pass", scope="dispatch")
        service.journal.update(req["attempt_id"], "failed")
        service.machines[MID] = dict(service.machines[MID], mode="hardware")
        release.set()
        replay = await pending
        assert replay["status"] == "already_accepted"
        assert replay["execution_status"] == "failed"
        assert fake.executions == fake.stops == 0
    finally:
        release.set()
        if pending:
            await asyncio.gather(pending, return_exceptions=True)
        await service.close()


@pytest.mark.asyncio
async def test_abort_requires_current_signed_mode_before_any_new_side_effect(tmp_path, monkeypatch):
    service, fake, fetched, data = await node(tmp_path, "hardware")
    try:
        req = request_for(data, "hardware")
        service.journal.accept(req, "pass", scope="dispatch")
        service.journal.update(req["attempt_id"], "running")
        before = service.journal.get(req["attempt_id"])
        context = {key: req[key] for key in ("machine_id", "job_id", "attempt_id")}
        for scope in ("abort",):
            for value in (MISSING, None, "simulation"):
                payload = {**context, "scope": scope, "expires_at": int(time.time())+300}
                if value is not MISSING:
                    payload["expected_mode"] = value
                with pytest.raises(NodeError) as caught:
                    await service.abort(**context, token=sign_token(payload, KEY))
                assert caught.value.status == 403
                assert "mode" in caught.value.message.lower()
                assert fake.executions == fake.stops == 0
                assert service.journal.get(req["attempt_id"]) == before
    finally:
        await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['abort'])
async def test_restarted_old_attempt_cannot_stop_replacement_same_mode(tmp_path, monkeypatch, operation):
    original = {'id': MID, 'model': 'Phomemo M02Pro', 'mode': 'hardware', 'paired': True,
                'bluetoothAddress': 'old-device'}
    service = NodeService(key=KEY, data_dir=tmp_path, machines=[original])
    data = artifact()
    request = request_for(data, 'hardware')
    old_binding = service.journal.machine(MID)['configurationBinding']
    service.journal.accept(request, 'pass', configuration_binding=old_binding)
    service.journal.update(request['attempt_id'], 'running')
    await service.close()
    service = NodeService(key=KEY, data_dir=tmp_path, machines=[dict(original,
        bluetoothAddress='replacement-device')])
    fake = NoIoAdapter(service.adapters[MID].version)
    service.adapters[MID] = fake
    context = {key: request[key] for key in ('machine_id', 'job_id', 'attempt_id')}
    token = sign_token({**context, 'scope': 'abort',
                       'expected_mode': 'hardware', 'expires_at': int(time.time())+300}, KEY)
    try:
        before = service.journal.get(request['attempt_id'])
        assert before['status'] == 'uncertain'
        assert before['configuration_binding'] == old_binding
        assert old_binding != service.journal.machine(MID)['configurationBinding']
        with pytest.raises(NodeError) as caught:
            await service.abort(**context, token=token)
        assert caught.value.status == 403
        assert fake.executions == fake.stops == 0
        assert service.journal.get(request['attempt_id']) == before
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_queued_worker_cannot_start_after_private_configuration_binding_changes(tmp_path):
    service, fake, fetched, data = await node(tmp_path)
    try:
        request = request_for(data, 'simulation')
        await service.run_job(**request)
        state = service.journal.machine(MID)
        state['configurationBinding'] = 'f'*64
        service.journal.save_machine(MID, state)
        await service.tasks[request['attempt_id']]
        assert service.journal.get(request['attempt_id'])['status'] == 'failed'
        assert fake.executions == fake.stops == 0
        assert not service.get_status(MID)['ready']
    finally:
        await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('scope', ['abort'])
async def test_legacy_unbound_attempt_cannot_authorize_stop(tmp_path, monkeypatch, scope):
    service, fake, fetched, data = await node(tmp_path, 'hardware')
    request = request_for(data, 'hardware')
    service.journal.accept(request, 'pass')
    service.journal.update(request['attempt_id'], 'running')
    service.journal.update(request['attempt_id'], 'uncertain')
    context={key:request[key] for key in ('machine_id','job_id','attempt_id')}
    token=sign_token({**context,'scope':scope,'expected_mode':'hardware','expires_at':int(time.time())+300},KEY)
    try:
        with pytest.raises(NodeError) as caught:
            await service.abort(**context,token=token)
        assert caught.value.status==403
        assert service.journal.get(request['attempt_id'])['status']=='uncertain'
    finally: await service.close()


@pytest.mark.asyncio
async def test_current_hardware_binding_allows_stop(tmp_path, monkeypatch):
    service, fake, fetched, data=await node(tmp_path,'hardware')
    request=request_for(data,'hardware')
    context={key:request[key] for key in ('machine_id','job_id','attempt_id')}
    def scoped(scope):
        return sign_token({**context,'scope':scope,'expected_mode':'hardware','expires_at':int(time.time())+300},KEY)
    try:
        binding=service.journal.machine(MID)['configurationBinding']
        service.journal.accept(request,'pass',configuration_binding=binding)
        service.journal.update(request['attempt_id'],'running')
        stopped=await service.abort(**context,token=scoped('abort'))
        assert stopped['status']=='unknown' and fake.stops==1
    finally: await service.close()


@pytest.mark.asyncio
async def test_private_configuration_change_while_fetching_does_not_accept_new_attempt(tmp_path):
    entered,release=asyncio.Event(),asyncio.Event()
    data=artifact()
    async def held(request):
        entered.set()
        await release.wait()
        return httpx.Response(200,content=data)
    service,fake,fetched,data=await node(tmp_path,transport=held)
    request=request_for(data,'simulation')
    pending=asyncio.create_task(service.run_job(**request))
    try:
        await entered.wait()
        state=service.journal.machine(MID)
        state['configurationBinding']='f'*64
        service.journal.save_machine(MID,state)
        release.set()
        with pytest.raises(NodeError) as caught: await pending
        assert caught.value.status==403
        assert service.journal.latest(MID) is None
        assert len(fetched)==1 and fake.executions==fake.stops==0
    finally:
        release.set()
        await asyncio.gather(pending,return_exceptions=True)
        await service.close()
