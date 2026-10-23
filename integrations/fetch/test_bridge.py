import asyncio
import json
import unittest
from types import SimpleNamespace
import httpx
from bridge import BackendClient, AdapterServer, build_mcp, restrict_protocol_senders

class BridgeTest(unittest.IsolatedAsyncioTestCase):
    async def test_fastmcp_routes_to_backend_requester(self):
        requests=[]
        async def handle(request):
            requests.append(request)
            if request.url.path == '/api/session': return httpx.Response(200,json={'role':'requester','id':'alice'})
            if request.url.path == '/api/machines': return httpx.Response(200,json={'machines':[]})
            if request.url.path.endswith('/dispatch'): return httpx.Response(409,json={'error':{'message':'Payment required'}})
            return httpx.Response(200,json={'job':{'id':'j_test','productionState':'specified'}})
        client=BackendClient('http://127.0.0.1:8787','fabrary_session=test',httpx.MockTransport(handle))
        await client.validate_requester()
        server=AdapterServer(build_mcp(client))
        names={tool.name for tool in await server.list_tools()}
        self.assertEqual(names,{'list_machines','create_request','job_status','request_quote','checkout_job','dispatch_job'})
        result=await server.call_tool('create_request',{'asset_ids':['a1'],'intent':'Club sticker','permission':'authorized'})
        self.assertIn('j_test',result[0].text)
        self.assertEqual(requests[-1].headers['cookie'],'fabrary_session=test')
        self.assertEqual(requests[-1].url.path,'/api/jobs')
        self.assertEqual(json.loads(requests[-1].content)['assetIds'],['a1'])
        with self.assertRaises(Exception): await server.call_tool('dispatch_job',{'job_id':'j_test'})
        self.assertFalse(any('/tools/' in r.url.path for r in requests))

    async def test_official_uagents_adapter_protocol_calls_fastmcp(self):
        from uagents_adapter import MCPServerAdapter
        from uagents_adapter.mcp.protocol import CallTool
        from uagents import Model
        async def handle(request):return httpx.Response(200,json={'machines':[]})
        backend=BackendClient('http://127.0.0.1:8787','fabrary_session=test',httpx.MockTransport(handle))
        adapter=MCPServerAdapter(mcp_server=AdapterServer(build_mcp(backend)),asi1_api_key='unit-test-never-sent',model='asi1-mini')
        sent=[]
        async def send(sender,message):sent.append((sender,message))
        logger=SimpleNamespace(info=lambda *args:None,warning=lambda *args:None,error=lambda *args:None)
        ctx=SimpleNamespace(logger=logger,send=send)
        protocol=restrict_protocol_senders(adapter.mcp_proto,{'agent1authorized'})
        handler=protocol.signed_message_handlers[Model.build_schema_digest(CallTool)]
        await handler(ctx,'agent1stranger',CallTool(tool='list_machines',args={}))
        self.assertEqual(len(sent),0)
        await handler(ctx,'agent1authorized',CallTool(tool='list_machines',args={}))
        self.assertEqual(sent[0][0],'agent1authorized')
        self.assertIsNone(sent[0][1].error)
        self.assertIn('machines',sent[0][1].result)

    async def test_agent_checkout_requires_preapproved_budget_mandate(self):
        requests=[]
        approved=False
        async def handle(request):
            requests.append(request)
            if request.method=='GET':
                return httpx.Response(200,json={'job':{'paymentState':'unpaid','spec':{'budgetMandate':{'enabled':True,'capCents':100}} if approved else {},'quote':{'accepted':True,'totalCents':75}}})
            return httpx.Response(200,json={'job':{'paymentState':'held'}})
        backend=BackendClient('http://127.0.0.1:8787','fabrary_session=test',httpx.MockTransport(handle))
        server=AdapterServer(build_mcp(backend))
        with self.assertRaises(Exception):await server.call_tool('checkout_job',{'job_id':'j1','idempotency_key':'stable-test-checkout'})
        self.assertFalse(any(r.method=='POST' for r in requests))
        approved=True
        result=await server.call_tool('checkout_job',{'job_id':'j1','idempotency_key':'stable-test-checkout'})
        self.assertIn('held',result[0].text)
        self.assertEqual(requests[-1].url.path,'/api/jobs/j1/checkout')

    async def test_owner_session_rejected(self):
        async def handle(request):return httpx.Response(200,json={'role':'owner'})
        client=BackendClient('http://127.0.0.1:8787','fabrary_session=owner',httpx.MockTransport(handle))
        with self.assertRaisesRegex(ValueError,'AGENT_REQUESTER_REQUIRED'):await client.validate_requester()

    async def test_sender_allowlist_guards_adapter_handlers(self):
        calls=[]
        async def handler(ctx,sender,message):calls.append(sender)
        proto=SimpleNamespace(signed_message_handlers={'chat':handler},unsigned_message_handlers={})
        restrict_protocol_senders(proto,{'agent1authorized'})
        ctx=SimpleNamespace(logger=SimpleNamespace(warning=lambda *args:None))
        await proto.signed_message_handlers['chat'](ctx,'agent1stranger',None)
        await proto.signed_message_handlers['chat'](ctx,'agent1authorized',None)
        self.assertEqual(calls,['agent1authorized'])

if __name__=='__main__':unittest.main()
