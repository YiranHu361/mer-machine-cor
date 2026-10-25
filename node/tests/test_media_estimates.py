"""Atomic planned-media estimates; no case uses a physical adapter."""
import asyncio
import sqlite3
import time
import httpx
import pytest
from fabyn_node.service import NodeService
from fabyn_node.security import NodeError,sign_token
from .test_mode_binding import node,request_for,KEY,MID,PARAMETERS
from .test_cancellation import cancellation,ConnectionProxy


def restarted(directory):
    return NodeService(key=KEY,data_dir=directory,machines=[{'id':MID,'model':'Phomemo M02Pro','mode':'simulation','paired':True}])


@pytest.mark.asyncio
async def test_completion_estimate_commits_once_and_survives_exact_replay_restart(tmp_path):
    service,fake,fetched,data=await node(tmp_path)
    request=request_for(data,'simulation')
    await service.run_job(**request);await service.tasks[request['attempt_id']]
    assert service.journal.machine(MID)['mediaRemaining']==99
    assert service.journal.get(request['attempt_id'])['estimated_consumption_recorded']==1
    service.journal.update(request['attempt_id'],'completed',credible=True,account_consumption=True)
    assert service.journal.machine(MID)['mediaRemaining']==99 and fake.executions==1
    await service.close()
    service=restarted(tmp_path)
    try:
        saved=service.journal.get(request['attempt_id'])
        assert (await service.run_job(**request))['status']=='already_accepted'
        assert service.journal.get(request['attempt_id'])==saved
        assert saved['status']=='completed' and saved['estimated_consumption_recorded']==1
        assert service.get_status(MID)['media_remaining']==99
    finally:await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('failure',['before','after'])
async def test_terminal_fact_and_estimate_cannot_split_at_commit_failure(tmp_path,failure):
    service,fake,fetched,data=await node(tmp_path)
    request=request_for(data,'simulation')
    service.journal.accept(request,'pass','dispatch',service.journal.machine(MID)['configurationBinding'])
    service.journal.update(request['attempt_id'],'running')
    service.journal.db=ConnectionProxy(service.journal.db,commit_failure=failure)
    try:
        with pytest.raises(sqlite3.OperationalError):
            service.journal.update(request['attempt_id'],'completed',credible=True,account_consumption=True)
        row=service.journal.get(request['attempt_id'])
        assert row['status']==('running' if failure=='before' else 'completed')
        assert row['estimated_consumption_recorded']==(0 if failure=='before' else 1)
        assert service.journal.machine(MID)['mediaRemaining']==(100 if failure=='before' else 99)
        assert not service.journal.db.in_transaction
        # Repeating the same known completion event recovers either commit result.
        service.journal.update(request['attempt_id'],'completed',credible=True,account_consumption=True)
        assert service.journal.machine(MID)['mediaRemaining']==99
        assert fetched==[] and fake.executions==fake.stops==0
    finally:await service.close()
    service=restarted(tmp_path)
    try:
        assert service.journal.get(request['attempt_id'])['status']=='completed'
        assert service.journal.get(request['attempt_id'])['estimated_consumption_recorded']==1
        assert service.journal.machine(MID)['mediaRemaining']==99
    finally:await service.close()


@pytest.mark.asyncio
async def test_terminal_estimate_uses_latest_owner_stock_and_keeps_other_policy_updates(tmp_path,monkeypatch):
    service,fake,fetched,data=await node(tmp_path)
    entered,release=asyncio.Event(),asyncio.Event()
    async def run(path,parameters,attempt):
        fake.executions+=1;entered.set();await release.wait()
        return 'completed',True,'Fake completion only'
    monkeypatch.setattr(fake,'run',run)
    request=request_for(data,'simulation',parameters={**PARAMETERS,'quantity':2})
    try:
        await service.run_job(**request);await entered.wait()
        service.update_policy(MID,{'mediaRemaining':70,'maxQuantity':3,'maxJobSeconds':240})
        release.set();await service.tasks[request['attempt_id']]
        state=service.journal.machine(MID)
        assert state['mediaRemaining']==68 and state['maxQuantity']==3 and state['maxJobSeconds']==240
        assert service.journal.get(request['attempt_id'])['estimated_consumption_recorded']==1
        assert fake.executions==1 and fake.stops==0
    finally:release.set();await service.close()


@pytest.mark.asyncio
async def test_late_completion_after_stop_accounts_once_without_rewriting_uncertainty(tmp_path,monkeypatch):
    service,fake,fetched,data=await node(tmp_path,'hardware')
    entered,release=asyncio.Event(),asyncio.Event()
    async def run(path,parameters,attempt):
        fake.executions+=1;entered.set();await release.wait()
        return 'completed',True,'Fake late completion only'
    monkeypatch.setattr(fake,'run',run)
    request=request_for(data,'hardware',parameters={**PARAMETERS,'quantity':2})
    context={k:request[k] for k in ('machine_id','job_id','attempt_id')}
    token=sign_token({**context,'scope':'abort','expected_mode':'hardware','expires_at':int(time.time())+300},KEY)
    try:
        await service.run_job(**request);await entered.wait()
        await service.abort(**context,token=token)
        stopped=service.journal.get(request['attempt_id'])
        release.set();await service.tasks[request['attempt_id']]
        row=service.journal.get(request['attempt_id'])
        assert row['status']=='uncertain' and row['reason']==stopped['reason']
        assert row['estimated_consumption_recorded']==1 and service.journal.machine(MID)['mediaRemaining']==98
        service.reconcile(**context,inspected=True,result='completed',reason='Owner inspected the settled fake outcome')
        assert service.journal.machine(MID)['mediaRemaining']==98
        assert fake.executions==fake.stops==1
    finally:release.set();await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('scenario',['preflight','driver_exception','tombstone'])
async def test_no_quantity_is_inferred_for_unstarted_or_unknown_exception_paths(tmp_path,monkeypatch,scenario):
    service,fake,fetched,data=await node(tmp_path)
    request=request_for(data,'simulation')
    try:
        if scenario=='tombstone':
            await service.cancel_before_acceptance(**cancellation(data))
            with pytest.raises(NodeError):await service.run_job(**request)
            assert service.journal.get(request['attempt_id']) is None
        else:
            if scenario=='driver_exception':
                async def run(*args):
                    fake.executions+=1
                    raise RuntimeError('Fake driver outcome unknown')
                monkeypatch.setattr(fake,'run',run)
            await service.run_job(**request)
            if scenario=='preflight':service.machines[MID]=dict(service.machines[MID],mode='hardware')
            await service.tasks[request['attempt_id']]
            row=service.journal.get(request['attempt_id'])
            assert row['estimated_consumption_recorded']==0
            assert row['status']==('failed' if scenario=='preflight' else 'uncertain')
        assert service.journal.machine(MID)['mediaRemaining']==100
        assert fake.executions==(1 if scenario=='driver_exception' else 0) and fake.stops==(1 if scenario=='driver_exception' else 0)
    finally:await service.close()


@pytest.mark.asyncio
async def test_legacy_terminal_migration_does_not_backfill_an_old_media_estimate(tmp_path):
    service,fake,fetched,data=await node(tmp_path)
    request=request_for(data)
    service.journal.accept(request,'pass','dispatch')
    service.journal.update(request['attempt_id'],'running')
    service.journal.update(request['attempt_id'],'completed',credible=True)
    state=service.journal.machine(MID);state['mediaRemaining']=99;service.journal.save_machine(MID,state)
    await service.close()
    database=sqlite3.connect(tmp_path/'journal.sqlite')
    database.execute('ALTER TABLE attempts DROP COLUMN estimated_consumption_recorded');database.commit();database.close()
    service=restarted(tmp_path)
    try:
        assert service.journal.get(request['attempt_id'])['estimated_consumption_recorded']==0
        assert (await service.run_job(**request))['status']=='already_accepted'
        assert service.journal.machine(MID)['mediaRemaining']==99
    finally:await service.close()


@pytest.mark.asyncio
async def test_calibration_ack_never_echoes_unknown_or_foreign_request_identity(tmp_path):
    service,fake,fetched,data=await node(tmp_path)
    try:
        foreign={**request_for(data,'simulation'),'machine_id':'instax_01'}
        service.journal.accept(foreign,'pass','calibration')
        service.journal.update(foreign['attempt_id'],'running')
        service.journal.update(foreign['attempt_id'],'completed',credible=True)
        for malformed in ({},[]):
            with pytest.raises(NodeError) as error:service.calibrate(MID,True,malformed)
            assert error.value.status==422
        for target in (None,'unknown-attempt',foreign['attempt_id']):
            result=service.calibrate(MID,True,target)
            assert result['machine_id']==MID and result['media_remaining']==100
            assert not {'job_id','attempt_id','execution_status'} & result.keys()
        assert fetched==[] and fake.executions==fake.stops==0
    finally:await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('status',['completed','failed'])
async def test_calibration_ack_binds_count_to_actual_matching_terminal_row(tmp_path,status):
    service,fake,fetched,data=await node(tmp_path)
    request=request_for(data,'simulation',scope='calibration')
    try:
        service.journal.accept(request,'pass','calibration',service.journal.machine(MID)['configurationBinding'])
        service.journal.update(request['attempt_id'],'running')
        service.journal.update(request['attempt_id'],status,account_consumption=True)
        result=service.calibrate(MID,True,request['attempt_id'])
        assert result['machine_id']==MID and result['media_remaining']==99
        assert result['job_id']==request['job_id'] and result['attempt_id']==request['attempt_id']
        assert result['execution_status']==status
        assert fetched==[] and fake.executions==fake.stops==0
    finally:await service.close()
