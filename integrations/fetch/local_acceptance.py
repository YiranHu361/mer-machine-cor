"""Actual local backend acceptance for the FastMCP bridge, never ASI:One discovery.

Always creates a separate requester. Full mode explicitly approves its own test
artifact via HTTP, then uses actual FastMCP quote/checkout/dispatch tools. It only
runs against a backend that labels the device simulation and payments mock.
"""
from __future__ import annotations
import asyncio
import json
import os
from pathlib import Path
import httpx
from bridge import BackendClient,AdapterServer,build_mcp

async def main():
    origin=os.environ.get('FABYN_API_ORIGIN','http://127.0.0.1:4318')
    async with httpx.AsyncClient(base_url=origin,timeout=30) as http:
        health=(await http.get('/api/health')).json()
        session=await http.post('/api/session',json={'role':'requester'})
        session.raise_for_status()
        cookie='; '.join(f'{name}={value}' for name,value in http.cookies.items())
        backend=BackendClient(origin,cookie)
        await backend.validate_requester()
        bridge=AdapterServer(build_mcp(backend))
        tools=await bridge.list_tools()
        response=await bridge.call_tool('list_machines',{})
        machines=json.loads(response[0].text)['machines']
        evidence={'status':'PASS','scope':'actual local FastMCP -> requester API','store':health.get('store'),'tools':[t.name for t in tools],'machineCount':len(machines),'discovery':'NOT_TESTED; local invocation is not ASI:One discovery'}
        if os.environ.get('FABYN_FETCH_FULL_LOCAL')!='1':
            print(json.dumps(evidence));return
        if health.get('paymentMode')!='mock':raise ValueError('Full local fixture requires explicitly labeled mock payments')
        instax=next((m for m in machines if m.get('id')=='instax_01'),None)
        if not instax or instax.get('mode')!='simulation' or instax.get('activeJobId'):raise ValueError('Idle Instax simulation is required; fixture never uses hardware')
        credentials=Path(os.environ.get('FABYN_LOCAL_CREDENTIALS_PATH',str(Path(__file__).resolve().parents[2]/'.data/local-credentials.json')))
        owner=httpx.AsyncClient(base_url=origin,timeout=30)
        login=await owner.post('/api/session',json={'role':'owner','accessCode':json.loads(credentials.read_text())['ownerCode']});login.raise_for_status()
        registered=await owner.post('/api/owner/machines',json={'model':'instax-mini-link-3','mode':'simulation'});registered.raise_for_status()
        calibrated=await owner.post('/api/owner/machines/instax_01/calibrate',json={'inspected':True});calibrated.raise_for_status()
        resumed=await owner.patch('/api/owner/machines/instax_01',json={'listed':True,'paused':False,'inspected':True,'cleared':True,'hours':{'start':0,'end':24}});resumed.raise_for_status()
        # A small bundled test PNG is just fixture data, not a physical output.
        import base64
        png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv3kAAAAASUVORK5CYII=')
        upload=await http.post('/api/uploads',files=[('images',('fixture.png',png,'image/png'))]);upload.raise_for_status();asset=upload.json()['assets'][0]
        created=await bridge.call_tool('create_request',{'asset_ids':[asset['id']],'intent':'Local bridge acceptance photo fixture','output_type':'instax','width_mm':54,'height_mm':86,'quantity':1,'material':'photo-film','permission':'authorized','budget_cap_cents':1000})
        job=json.loads(created[0].text)['job'];job_id=job['id']
        # Explicit local test approval through the ordinary requester route. This
        # approval action is intentionally not exposed as an agent tool.
        approved=await http.post(f'/api/jobs/{job_id}/approve',json={'artifactSha256':job['artifact']['sha256'],'specVersion':job['specVersion']});approved.raise_for_status()
        quoted=await bridge.call_tool('request_quote',{'job_id':job_id,'auto_accept':True})
        paid=await bridge.call_tool('checkout_job',{'job_id':job_id,'idempotency_key':job_id+'-local-checkout'})
        dispatched=await bridge.call_tool('dispatch_job',{'job_id':job_id})
        latest={}
        for _ in range(120):
            result=await bridge.call_tool('job_status',{'job_id':job_id});latest=json.loads(result[0].text)['job']
            if latest['productionState']=='needs_review' or latest['productionState']=='produced' and latest['paymentState']=='released' or latest['productionState']=='failed' and latest['paymentState']=='refunded':break
            await asyncio.sleep(.5)
        if latest.get('productionState')!='produced':raise ValueError(f"Fixture did not produce: {latest.get('productionState')}")
        prepared=await owner.post(f'/api/owner/jobs/{job_id}/prepare',json={'removed':True,'labeled':True,'stored':True,'cleared':True});prepared.raise_for_status()
        pickup_code=prepared.json()['job']['pickup']['code']
        redeemed=await owner.post(f'/api/owner/jobs/{job_id}/redeem',json={'code':pickup_code});redeemed.raise_for_status()
        restored=await owner.patch('/api/owner/machines/instax_01',json={'paused':False,'inspected':True,'cleared':True});restored.raise_for_status()
        await owner.aclose()
        evidence.update({'fulfillmentState':redeemed.json()['job']['fulfillmentState'],'jobId':job_id,'productionState':latest['productionState'],'paymentState':latest['paymentState'],'machineMode':'simulation','paymentMode':'mock','steps':['dedicated requester session','FastMCP machine list','upload fixture','FastMCP create request','explicit fixture preview approval via normal HTTP','FastMCP quote','FastMCP checkout','FastMCP dispatch','FastMCP job status until produced','owner fixture prepares item','single-use pickup redemption','owner resumes cleared simulation']})
        print(json.dumps(evidence))

if __name__=='__main__':asyncio.run(main())
