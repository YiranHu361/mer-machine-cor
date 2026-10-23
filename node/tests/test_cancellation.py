"""Atomic cancellation before acceptance; all transports are isolated fakes."""
import asyncio
import time
import httpx
import pytest
from fabrary_node.journal import Journal
from fabrary_node.security import NodeError,sign_token
from .test_mode_binding import node,request_for,artifact,KEY,MID,PARAMETERS,MISSING


def cancellation(data, mode='simulation', scope='dispatch', suffix='one', parameters=None, expires=None):
    request=request_for(data,mode,scope=scope,suffix=suffix,parameters=parameters,expires=expires)
    body={k:v for k,v in request.items() if k not in {'token','artifact_url'}}
    body['target_scope']=scope
    payload={**body,'scope':'cancel_before_acceptance'}
    if mode is not MISSING: payload['expected_mode']=mode
    return {**body,'token':sign_token(payload,KEY)}


@pytest.mark.asyncio
@pytest.mark.parametrize('scope',['dispatch','calibration'])
async def test_cancel_wins_against_unaccepted_held_fetch_despite_current_404(tmp_path,scope):
    entered,release=asyncio.Event(),asyncio.Event();data=artifact()
    async def held(request):
        entered.set();await release.wait();return httpx.Response(200,content=data)
    service,fake,fetched,data=await node(tmp_path,transport=held)
    request=request_for(data,'simulation',scope=scope)
    pending=asyncio.create_task(service.run_job(**request,_scope=scope))
    try:
        await entered.wait()
        with pytest.raises(NodeError) as absent: service.get_status(MID,request['job_id'],request['attempt_id'])
        assert absent.value.code=='unknown_attempt'
        before=service.journal.machine(MID)
        proof=await service.cancel_before_acceptance(**cancellation(data,scope=scope))
        assert proof['status']=='cancelled_before_acceptance' and proof['target_scope']==scope
        assert proof['parameters']==PARAMETERS
        release.set()
        with pytest.raises(NodeError) as refused: await pending
        assert refused.value.code=='attempt_cancelled'
        assert service.journal.get(request['attempt_id']) is None
        assert service.journal.machine(MID)==before
        assert len(fetched)==1 and fake.executions==fake.stops==0
        assert await service.cancel_before_acceptance(**cancellation(data,scope=scope))==proof
    finally:
        release.set();await asyncio.gather(pending,return_exceptions=True);await service.close()


@pytest.mark.asyncio
async def test_cancellation_survives_lost_reply_restart_and_rejects_fetch_or_replacement_identity(tmp_path):
    service,fake,fetched,data=await node(tmp_path)
    proof=await service.cancel_before_acceptance(**cancellation(data))
    await service.close()
    service,fake,fetched,data=await node(tmp_path)
    try:
        assert await service.cancel_before_acceptance(**cancellation(data,expires=int(time.time())+600))==proof
        for request in (request_for(data,'simulation'),request_for(data,'simulation',suffix='replacement')|{'job_id':'job_one'}):
            if request['attempt_id']=='attempt_replacement':
                payload={k:v for k,v in request.items() if k not in {'token','artifact_url'}}
                request['token']=sign_token({**payload,'scope':'dispatch','expected_mode':'simulation'},KEY)
            with pytest.raises(NodeError) as refused: await service.run_job(**request)
            assert refused.value.code in {'attempt_cancelled','attempt_conflict'}
        assert fetched==[] and fake.executions==fake.stops==0
        accepted=await service.run_job(**request_for(data,'simulation',suffix='unrelated'))
        await service.tasks['attempt_unrelated']
        assert accepted['status']=='accepted' and fake.executions==1
    finally: await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('status',['accepted','running','uncertain','completed','failed'])
async def test_every_existing_attempt_refuses_cancellation_without_modifying_execution(tmp_path,status):
    for scope in ('dispatch','calibration'):
        service,fake,fetched,data=await node(tmp_path/scope)
        try:
            request=request_for(data,'simulation',scope=scope)
            service.journal.accept(request,'pass',scope,service.journal.machine(MID)['configurationBinding'])
            if status!='accepted': service.journal.update(request['attempt_id'],'running')
            if status not in {'accepted','running'}: service.journal.update(request['attempt_id'],status)
            before=service.journal.get(request['attempt_id'])
            with pytest.raises(NodeError) as refused: await service.cancel_before_acceptance(**cancellation(data,scope=scope))
            assert refused.value.code=='attempt_already_accepted'
            assert service.journal.get(request['attempt_id'])==before
            assert service.journal.db.execute('SELECT count(*) FROM cancelled_attempts').fetchone()[0]==0
            assert fetched==[] and fake.executions==fake.stops==0
        finally: await service.close()


@pytest.mark.asyncio
async def test_fresh_sqlite_tombstone_is_checked_inside_accept_even_after_prior_absence(tmp_path):
    service,fake,fetched,data=await node(tmp_path)
    other=Journal(tmp_path/'journal.sqlite')
    request=request_for(data,'simulation')
    try:
        assert service.journal.cancelled(request) is None
        other.cancel_before_acceptance(request,'dispatch','simulation')
        with pytest.raises(NodeError) as refused:
            service.journal.accept(request,'pass','dispatch',service.journal.machine(MID)['configurationBinding'])
        assert refused.value.code=='attempt_cancelled'
        assert service.journal.get(request['attempt_id']) is None
        assert fake.executions==fake.stops==0 and fetched==[]
    finally: other.close();await service.close()


@pytest.mark.asyncio
async def test_invalid_cancellation_authorization_has_no_tombstone_or_io(tmp_path):
    service,fake,fetched,data=await node(tmp_path)
    try:
        variants=[cancellation(data,mode=m) for m in (MISSING,None,False,[],{},'hardware','bogus')]
        valid=cancellation(data)
        variants += [cancellation(data,expires=int(time.time())-1),dict(valid,parameters={**PARAMETERS,'quantity':2}),dict(valid,target_scope='calibration'),dict(valid,token=valid['token'][:-1]+('0' if valid['token'][-1]!='0' else '1'))]
        for request in variants:
            with pytest.raises(NodeError) as refused: await service.cancel_before_acceptance(**request)
            assert refused.value.status==403
        assert service.journal.db.execute('SELECT count(*) FROM cancelled_attempts').fetchone()[0]==0
        assert fetched==[] and fake.executions==fake.stops==0
    finally: await service.close()


@pytest.mark.asyncio
async def test_tombstone_conflicts_bind_content_scope_and_mode_but_exact_proof_is_read_only(tmp_path):
    service,fake,fetched,data=await node(tmp_path)
    try:
        proof=await service.cancel_before_acceptance(**cancellation(data))
        for request in (cancellation(data,parameters={**PARAMETERS,'quantity':2}),cancellation(data,scope='calibration'),cancellation(data,mode='hardware')):
            with pytest.raises(NodeError) as refused: await service.cancel_before_acceptance(**request)
            assert refused.value.code=='attempt_conflict'
        service.machines[MID]=dict(service.machines[MID],mode='hardware')
        state=service.journal.machine(MID);state['configurationBinding']='f'*64;service.journal.save_machine(MID,state)
        assert await service.cancel_before_acceptance(**cancellation(data))==proof
        assert service.journal.db.execute('SELECT count(*) FROM cancelled_attempts').fetchone()[0]==1
        assert fetched==[] and fake.executions==fake.stops==0
    finally: await service.close()


@pytest.mark.asyncio
async def test_http_cancellation_requires_bearer_exact_body_and_valid_signed_context(tmp_path):
    from fabrary_node.server import create_app
    service,fake,fetched,data=await node(tmp_path)
    app=create_app(service)
    valid=cancellation(data)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            assert (await client.post('/tools/cancel_before_acceptance',json=valid)).status_code==401
            headers={'Authorization':'Bearer '+KEY}
            invalid=[None,[],dict(valid,artifact_url='http://never-fetch.invalid/'),dict(valid,expected_mode='simulation'),{k:v for k,v in valid.items() if k!='artifact_sha256'},dict(valid,target_scope={}),dict(valid,parameters={**PARAMETERS,'quantity':2})]
            for body in invalid:
                response=await client.post('/tools/cancel_before_acceptance',json=body,headers=headers)
                assert response.status_code in {403,422},response.text
            assert service.journal.db.execute('SELECT count(*) FROM cancelled_attempts').fetchone()[0]==0
            response=await client.post('/tools/cancel_before_acceptance',json=valid,headers=headers)
            assert response.status_code==200
            proof=response.json()
            assert set(proof)=={'status','machine_id','job_id','attempt_id','artifact_sha256','parameters','target_scope','expected_mode','cancelled_at'}
            assert proof['status']=='cancelled_before_acceptance'
            replay=await client.post('/tools/cancel_before_acceptance',json=valid,headers=headers)
            assert replay.json()==proof
            assert fetched==[] and fake.executions==fake.stops==0
    finally: await service.close()


@pytest.mark.asyncio
async def test_actual_fastmcp_cancellation_is_same_durable_no_io_operation(tmp_path):
    import socket
    import uvicorn
    from fastmcp import Client
    from fastmcp.exceptions import ToolError
    from fastmcp.client.transports import StreamableHttpTransport
    from fabrary_node.server import create_app
    service,fake,fetched,data=await node(tmp_path)
    sock=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
    sock.bind(('127.0.0.1',0));sock.listen(128);sock.setblocking(False)
    url='http://127.0.0.1:'+str(sock.getsockname()[1])
    server=uvicorn.Server(uvicorn.Config(create_app(service),log_level='error',access_log=False))
    task=asyncio.create_task(server.serve(sockets=[sock]))
    try:
        for _ in range(100):
            if server.started:break
            await asyncio.sleep(.02)
        assert server.started
        async with httpx.AsyncClient(base_url=url) as http:
            assert (await http.post('/mcp/',json={})).status_code==401
        transport=StreamableHttpTransport(url+'/mcp/',headers={'Authorization':'Bearer '+KEY})
        async with Client(transport) as client:
            assert 'cancel_before_acceptance' in {tool.name for tool in await client.list_tools()}
            valid=cancellation(data,scope='calibration')
            result=await client.call_tool('cancel_before_acceptance',valid)
            assert not result.is_error
            proof=result.data
            assert proof['status']=='cancelled_before_acceptance' and proof['target_scope']=='calibration'
            assert proof==await service.cancel_before_acceptance(**valid)
            missing={k:v for k,v in valid.items() if k!='target_scope'}
            with pytest.raises(ToolError, match='target_scope'): await client.call_tool('cancel_before_acceptance',missing)
            assert service.journal.db.execute('SELECT count(*) FROM cancelled_attempts').fetchone()[0]==1
            assert fetched==[] and fake.executions==fake.stops==0
    finally:
        server.should_exit=True
        await task


class ConnectionProxy:
    def __init__(self, connection, *, commit_failure=None, entered=None, release=None):
        self.connection=connection
        self.commit_failure=commit_failure
        self.entered,self.release=entered,release
    def __getattr__(self,name): return getattr(self.connection,name)
    def execute(self,sql,*args):
        import sqlite3
        if sql=='BEGIN IMMEDIATE' and self.entered:
            if self.release:
                result=self.connection.execute(sql,*args)
                self.entered.set()
                assert self.release.wait(5), 'Controlled transaction was not released'
                return result
            self.entered.set()
        if sql=='COMMIT' and self.commit_failure:
            failure,self.commit_failure=self.commit_failure,None
            if failure=='after': self.connection.execute(sql,*args)
            raise sqlite3.OperationalError('Isolated commit acknowledgement failure')
        return self.connection.execute(sql,*args)


@pytest.mark.asyncio
async def test_failed_tombstone_insert_returns_no_proof_and_rolls_back(tmp_path):
    import sqlite3
    service,fake,fetched,data=await node(tmp_path)
    try:
        service.journal.db.execute("CREATE TRIGGER reject_fixture_cancel BEFORE INSERT ON cancelled_attempts BEGIN SELECT RAISE(ABORT,'Isolated full-store failure'); END")
        with pytest.raises(sqlite3.IntegrityError): await service.cancel_before_acceptance(**cancellation(data))
        assert not service.journal.db.in_transaction
        assert service.journal.cancelled(cancellation(data)) is None
        assert service.journal.db.execute("SELECT count(*) FROM audit WHERE event='cancelled_before_acceptance'").fetchone()[0]==0
        service.journal.db.execute('DROP TRIGGER reject_fixture_cancel')
        proof=await service.cancel_before_acceptance(**cancellation(data))
        assert proof['status']=='cancelled_before_acceptance'
        assert fetched==[] and fake.executions==fake.stops==0
    finally: await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('failure',['before','after'])
async def test_commit_failure_never_returns_success_and_exact_restart_retry_recovers(tmp_path,failure):
    import sqlite3
    service,fake,fetched,data=await node(tmp_path)
    service.journal.db=ConnectionProxy(service.journal.db,commit_failure=failure)
    try:
        with pytest.raises(sqlite3.OperationalError): await service.cancel_before_acceptance(**cancellation(data))
        assert not service.journal.db.in_transaction
        stored=service.journal.cancelled(cancellation(data))
        assert bool(stored)==(failure=='after')
        assert fetched==[] and fake.executions==fake.stops==0
    finally: await service.close()
    service,fake,fetched,data=await node(tmp_path)
    try:
        proof=await service.cancel_before_acceptance(**cancellation(data))
        if stored: assert proof==service.journal.cancellation_proof(stored)
        with pytest.raises(NodeError) as refused: await service.run_job(**request_for(data,'simulation'))
        assert refused.value.code=='attempt_cancelled'
        assert fetched==[] and fake.executions==fake.stops==0
    finally: await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('winner',['cancel','accept'])
async def test_contended_sqlite_transactions_have_one_safe_durable_winner(tmp_path,winner):
    import threading
    service,fake,fetched,data=await node(tmp_path)
    second=Journal(tmp_path/'journal.sqlite')
    first_entered,second_entered,release=threading.Event(),threading.Event(),threading.Event()
    service.journal.db=ConnectionProxy(service.journal.db,entered=first_entered,release=release)
    second.db=ConnectionProxy(second.db,entered=second_entered)
    request=request_for(data,'simulation')
    binding=service.journal.machine(MID)['configurationBinding']
    cancel=lambda journal: journal.cancel_before_acceptance(request,'dispatch','simulation')
    accept=lambda journal: journal.accept(request,'pass','dispatch',binding)
    first_operation,second_operation=(cancel,accept) if winner=='cancel' else (accept,cancel)
    first=asyncio.create_task(asyncio.to_thread(first_operation,service.journal))
    second_task=None
    try:
        assert await asyncio.to_thread(first_entered.wait,5)
        second_task=asyncio.create_task(asyncio.to_thread(second_operation,second))
        assert await asyncio.to_thread(second_entered.wait,5)
        release.set()
        first_result,second_result=await asyncio.gather(first,second_task,return_exceptions=True)
        assert isinstance(second_result,NodeError)
        if winner=='cancel':
            assert first_result['status']=='cancelled_before_acceptance'
            assert second_result.code=='attempt_cancelled'
            assert service.journal.get(request['attempt_id']) is None
            assert service.journal.cancelled(request) is not None
        else:
            assert first_result[1] is True
            assert second_result.code=='attempt_already_accepted'
            assert service.journal.get(request['attempt_id'])['status']=='accepted'
            assert service.journal.cancelled(request) is None
        assert fetched==[] and fake.executions==fake.stops==0
    finally:
        release.set()
        await asyncio.gather(first,*([second_task] if second_task else []),return_exceptions=True)
        second.close()
        await service.close()
