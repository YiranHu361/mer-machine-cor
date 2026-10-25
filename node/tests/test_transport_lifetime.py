"""Blocking hardware transports remain fenced; all sockets/printers are fakes."""
import asyncio
import io
import socket
import threading
import time
import types
import sys
import httpx
import pytest
from PIL import Image
from fabyn_node.service import NodeService
from fabyn_node.security import NodeError,sign_token
from fabyn_node import adapters
from .test_mode_binding import KEY,MID,PARAMETERS,artifact,request_for
from .test_cancellation import ConnectionProxy


def scoped(request,scope):
    context={key:request[key] for key in ('machine_id','job_id','attempt_id')}
    return {**context,'token':sign_token({**context,'scope':scope,'expected_mode':'hardware','expires_at':int(time.time())+300},KEY)}


async def phomemo(tmp_path,monkeypatch,*,late_error=False):
    entered,release,closed=threading.Event(),threading.Event(),threading.Event()
    sends=[];fetched=[]
    original=socket.socket
    class FakeSocket:
        def settimeout(self,value):pass
        def connect(self,address):pass
        def sendall(self,data):
            sends.append(len(data))
            if len(sends)==1:
                entered.set();assert release.wait(5)
            elif late_error:raise OSError('Fake late transport failure')
        def close(self):closed.set()
    monkeypatch.setattr(socket,'AF_BLUETOOTH',999,raising=False)
    monkeypatch.setattr(socket,'BTPROTO_RFCOMM',42,raising=False)
    monkeypatch.setattr(socket,'socket',lambda *a,**kw:FakeSocket() if a and a[0]==999 else original(*a,**kw))
    data=artifact()
    def serve(request):fetched.append(request.url.path);return httpx.Response(200,content=data)
    config={'id':MID,'model':'Phomemo M02Pro','mode':'hardware','paired':True,'bluetoothAddress':'fake-owner-device','rfcommChannel':1, 'ownerReady':True}
    service=NodeService(key=KEY,data_dir=tmp_path,machines=[config],artifact_transport=httpx.MockTransport(serve))
    monkeypatch.setattr(service.adapters[MID],'blockers',lambda:[])
    state=service.journal.machine(MID);state.update(calibrated=True,configured=True,listed=True,ready=True,paused=False,mediaRemaining=100,maxJobSeconds=1);service.journal.save_machine(MID,state)
    request=request_for(data,'hardware',parameters={**PARAMETERS,'quantity':2})
    return service,request,entered,release,closed,sends,fetched,config


def force_deadline(monkeypatch,entered):
    original=asyncio.wait_for
    async def wait(awaitable,timeout):
        if timeout==31:
            assert await asyncio.to_thread(entered.wait,3)
            awaitable.cancel()  # Match wait_for cancelling its shield, not the I/O task.
            raise TimeoutError('Deterministic fixture deadline')
        return await original(awaitable,timeout)
    monkeypatch.setattr(asyncio,'wait_for',wait)


@pytest.mark.asyncio
@pytest.mark.parametrize('interruption',['timeout','cancel'])
async def test_phomemo_real_thread_fences_release_and_reuse_until_it_actually_finishes(tmp_path,monkeypatch,interruption):
    service,request,entered,release,closed,sends,fetched,config=await phomemo(tmp_path,monkeypatch)
    if interruption=='timeout':force_deadline(monkeypatch,entered)
    try:
        await service.run_job(**request)
        assert await asyncio.to_thread(entered.wait,3)
        if interruption=='cancel':
            service.tasks[request['attempt_id']].cancel()
            await asyncio.gather(service.tasks[request['attempt_id']],return_exceptions=True)
            await service.abort(**scoped(request,'abort'))
        else:await service.tasks[request['attempt_id']]
        before=service.journal.get(request['attempt_id'])
        assert before['status']=='uncertain' and not closed.is_set()
        assert service.get_status(MID)['transport_pending'] is True
        assert service.get_capabilities(MID)['ready'] is False
        resolution={k:request[k] for k in ('machine_id','job_id','attempt_id')}
        resolution.update(inspected=True,result='failed',reason='Owner inspected after the fake transport settled')
        resume={'paused':False,'ready':True,'cleared':True,'inspected':True}
        for operation in (lambda:service.reconcile(**resolution),lambda:service.update_policy(MID,resume),lambda:service.calibrate(MID,True,request['attempt_id'])):
            with pytest.raises(NodeError) as blocked:operation()
            assert blocked.value.code=='transport_pending'
        following=request_for(artifact(),'hardware',suffix='next')
        with pytest.raises(NodeError) as blocked:await service.run_job(**following)
        assert blocked.value.code=='transport_pending' and len(fetched)==1
        assert (await service.run_job(**request))['status']=='already_accepted'
        release.set();await service.transport_tasks[MID]['task']
        after=service.journal.get(request['attempt_id'])
        for field in ('status','reason','completion_credible','started_at','completed_at'):
            assert after[field]==before[field]
        assert after['estimated_consumption_recorded']==1
        assert service.journal.machine(MID)['mediaRemaining']==98
        assert len(sends)==2 and closed.is_set() and not service.transport_pending(MID)
        service.reconcile(**resolution);service.update_policy(MID,resume)
        assert (await service.run_job(**following))['status']=='accepted'
        await service.abort(**scoped(following,'abort'))
        assert len(sends)==2
    finally:release.set();await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('cancel_close',[False,True])
async def test_shutdown_waits_for_actual_transport_before_releasing_journal_ownership(tmp_path,monkeypatch,cancel_close):
    service,request,entered,release,closed,sends,fetched,config=await phomemo(tmp_path,monkeypatch)
    closing=None
    try:
        await service.run_job(**request);assert await asyncio.to_thread(entered.wait,3)
        transport=service.transport_tasks[MID]['task']
        waiting=asyncio.Event();original_shield=asyncio.shield
        def shield(awaitable):
            if awaitable is transport:waiting.set()
            return original_shield(awaitable)
        monkeypatch.setattr(asyncio,'shield',shield)
        closing=asyncio.create_task(service.close());await waiting.wait()
        assert not closing.done() and not closed.is_set()
        with pytest.raises(RuntimeError,match='Another node'):NodeService(key=KEY,data_dir=tmp_path,machines=[config])
        if cancel_close:
            closing.cancel();await asyncio.gather(closing,return_exceptions=True)
            assert closing.cancelled() and not transport.done()
            assert service.get_status(MID)['transport_pending'] is True
            assert not closed.is_set()
            with pytest.raises(RuntimeError,match='Another node'):NodeService(key=KEY,data_dir=tmp_path,machines=[config])
        release.set()
        if cancel_close:
            await transport;closing=asyncio.create_task(service.close())
        await closing
        restored=NodeService(key=KEY,data_dir=tmp_path,machines=[config])
        try:
            assert restored.journal.get(request['attempt_id'])['status']=='uncertain'
            assert restored.journal.get(request['attempt_id'])['estimated_consumption_recorded']==1
            assert restored.journal.machine(MID)['mediaRemaining']==98
        finally:await restored.close()
    finally:
        release.set()
        if closing and not closing.cancelled():await closing
        else:await service.close()


@pytest.mark.asyncio
async def test_cancelled_shutdown_keeps_actual_stop_task_and_journal_ownership(tmp_path,monkeypatch):
    service,request,entered,release,closed,sends,fetched,config=await phomemo(tmp_path,monkeypatch)
    running,finish_run=asyncio.Event(),asyncio.Event()
    stop_entered,finish_stop,stop_closed=threading.Event(),threading.Event(),threading.Event()
    closing=aborting=None
    async def run(*args):
        running.set();await finish_run.wait()
        return 'completed',True,'Fake execution returned after owner stop'
    def blocking_stop():
        stop_entered.set();assert finish_stop.wait(5)
        stop_closed.set()
        return {'status':'requested','reason':'Fake physical stop returned'}
    async def abort():return await asyncio.to_thread(blocking_stop)
    monkeypatch.setattr(service.adapters[MID],'run',run)
    monkeypatch.setattr(service.adapters[MID],'abort',abort)
    try:
        await service.run_job(**request);await running.wait()
        aborting=asyncio.create_task(service.abort(**scoped(request,'abort')))
        assert await asyncio.to_thread(stop_entered.wait,3)
        finish_run.set();await service.tasks[request['attempt_id']]
        stop=service.stop_tasks[MID][1]
        waiting=asyncio.Event();original_shield=asyncio.shield
        def shield(awaitable):
            if awaitable is stop:waiting.set()
            return original_shield(awaitable)
        monkeypatch.setattr(asyncio,'shield',shield)
        closing=asyncio.create_task(service.close());await waiting.wait()
        closing.cancel();await asyncio.gather(closing,return_exceptions=True)
        assert closing.cancelled() and not stop.done() and not stop_closed.is_set()
        assert service.get_status(MID)['stop_pending'] is True
        with pytest.raises(RuntimeError,match='Another node'):NodeService(key=KEY,data_dir=tmp_path,machines=[config])
        with pytest.raises(NodeError) as blocked:
            service.reconcile(machine_id=MID,job_id=request['job_id'],attempt_id=request['attempt_id'],inspected=True,result='failed',reason='Cannot release while the fake stop thread is still pending')
        assert blocked.value.code=='stop_pending'
        finish_stop.set();await aborting
        assert stop_closed.is_set() and not service.stop_pending(MID)
        closing=asyncio.create_task(service.close());await closing
        restored=NodeService(key=KEY,data_dir=tmp_path,machines=[config])
        try:assert restored.journal.get(request['attempt_id'])['status']=='uncertain'
        finally:await restored.close()
    finally:
        release.set();finish_run.set();finish_stop.set()
        if aborting:await aborting
        if closing and not closing.cancelled():await closing
        else:await service.close()


@pytest.mark.asyncio
async def test_late_transport_exception_does_not_claim_completion_or_infer_media(tmp_path,monkeypatch):
    service,request,entered,release,closed,sends,fetched,config=await phomemo(tmp_path,monkeypatch,late_error=True)
    force_deadline(monkeypatch,entered)
    try:
        await service.run_job(**request);await service.tasks[request['attempt_id']]
        before=service.journal.get(request['attempt_id'])
        release.set();await asyncio.gather(service.transport_tasks[MID]['task'],return_exceptions=True)
        after=service.journal.get(request['attempt_id'])
        assert after==before and after['estimated_consumption_recorded']==0
        assert service.journal.machine(MID)['mediaRemaining']==100
        assert not service.transport_pending(MID) and closed.is_set()
    finally:release.set();await service.close()


@pytest.mark.asyncio
async def test_instax_thread_fence_includes_disconnect_cleanup_after_cancelled_transfer(tmp_path,monkeypatch):
    developed,release,cleanup,finish_cleanup=threading.Event(),threading.Event(),threading.Event(),threading.Event()
    class FakePrinter:
        def __init__(self,**kwargs):
            self.peripheral=types.SimpleNamespace(is_connected=lambda:True)
            self.printerSettings={'fixture':True};self.imageSize=(600,800);self.photosLeft=2
            self.packetsForPrinting=[];self.waitingForResponse=False;self.cancelled=False
        def connect(self,timeout):pass
        def print_image(self,payload):self.print_acknowledged=True
        def disconnect(self):cleanup.set();assert finish_cleanup.wait(5)
    monkeypatch.setitem(sys.modules,'fabyn_node.instaxble.InstaxBLE',types.SimpleNamespace(InstaxBLE=FakePrinter))
    original_sleep=adapters.time.sleep
    def sleep(seconds):
        if seconds==90:developed.set();assert release.wait(5)
        else:original_sleep(seconds)
    monkeypatch.setattr(adapters.time,'sleep',sleep)
    image=io.BytesIO();Image.new('RGB',(600,800),'white').save(image,'PNG');data=image.getvalue()
    machine='instax_01'
    config={'id':machine,'model':'Instax Mini Link 3','mode':'hardware','paired':True,'ownerReady':True,'bluetoothAddress':'fake-owner-instax','serviceUUID':'fixture-service','writeCharUUID':'fixture-write','notifyCharUUID':'fixture-notify','compatibilityValidated':True,'developmentSeconds':90,'maxJobSeconds':240}
    service=NodeService(key=KEY,data_dir=tmp_path,machines=[config],artifact_transport=httpx.MockTransport(lambda _:httpx.Response(200,content=data)))
    monkeypatch.setattr(service.adapters[machine],'blockers',lambda:[])
    state=service.journal.machine(machine);state.update(calibrated=True,configured=True,listed=True,ready=True,paused=False,mediaRemaining=100,maxJobSeconds=1);service.journal.save_machine(machine,state)
    base=request_for(data,'hardware',parameters={**PARAMETERS,'outputType':'instax','widthMm':54,'heightMm':86,'material':'photo-film'})
    request={**base,'machine_id':machine};payload={k:v for k,v in request.items() if k not in {'token','artifact_url'}};request['token']=sign_token({**payload,'scope':'dispatch','expected_mode':'hardware'},KEY)
    force_deadline(monkeypatch,developed)
    try:
        await service.run_job(**request);await service.tasks[request['attempt_id']]
        assert service.get_status(machine)['transport_pending'] is True
        release.set();assert await asyncio.to_thread(cleanup.wait,3)
        assert service.get_status(machine)['transport_pending'] is True
        with pytest.raises(NodeError) as blocked:
            service.reconcile(machine_id=machine,job_id=request['job_id'],attempt_id=request['attempt_id'],inspected=True,result='failed',reason='Owner inspected the fake film output after cleanup')
        assert blocked.value.code=='transport_pending'
        finish_cleanup.set();await service.transport_tasks[machine]['task']
        assert not service.transport_pending(machine) and service.adapters[machine].device is None
        assert service.journal.machine(machine)['mediaRemaining']==99
        assert service.journal.get(request['attempt_id'])['status']=='uncertain'
    finally:release.set();finish_cleanup.set();await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('failure',['before','after'])
async def test_late_accounting_storage_failure_stays_fenced_and_explicit_resolution_recovers_once(tmp_path,monkeypatch,failure):
    service,request,entered,release,closed,sends,fetched,config=await phomemo(tmp_path,monkeypatch)
    force_deadline(monkeypatch,entered)
    try:
        await service.run_job(**request);await service.tasks[request['attempt_id']]
        before=service.journal.get(request['attempt_id'])
        service.journal.db=ConnectionProxy(service.journal.db,commit_failure=failure)
        release.set();await asyncio.gather(service.transport_tasks[MID]['task'],return_exceptions=True)
        assert closed.is_set() and service.transport_pending(MID)
        assert not service.get_capabilities(MID)['ready']
        after=service.journal.get(request['attempt_id'])
        for field in ('status','reason','completion_credible','started_at','completed_at'):
            assert after[field]==before[field]
        assert service.journal.machine(MID)['mediaRemaining']==(100 if failure=='before' else 98)
        assert not service.journal.db.in_transaction
        remaining=service.journal.machine(MID)['mediaRemaining']
        with pytest.raises(NodeError) as foreign:
            service.reconcile(machine_id=MID,job_id='foreign-job',attempt_id=request['attempt_id'],inspected=True,result='failed',reason='This context does not belong to the requested attempt')
        assert foreign.value.code=='attempt_binding'
        assert service.journal.machine(MID)['mediaRemaining']==remaining and service.transport_pending(MID)
        result=service.reconcile(machine_id=MID,job_id=request['job_id'],attempt_id=request['attempt_id'],inspected=True,result='failed',reason='Owner inspected only after the fake thread and cleanup settled')
        assert result['execution_status']=='failed' and result['transport_pending'] is False
        assert service.journal.machine(MID)['mediaRemaining']==98
        assert service.journal.get(request['attempt_id'])['estimated_consumption_recorded']==1
        service.reconcile(machine_id=MID,job_id=request['job_id'],attempt_id=request['attempt_id'],inspected=True,result='failed',reason='Owner repeated the same settled observation')
        assert service.journal.machine(MID)['mediaRemaining']==98 and len(sends)==2
    finally:release.set();await service.close()
