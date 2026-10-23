"""Single-requester FastMCP -> authorized Fabrary API bridge.

The ASI:One adapter receives a server-held requester cookie; tools cannot create an
owner session, approve a preview, or access the node directly. Every paid action is
still validated by the same backend as the browser.
"""
from __future__ import annotations
import asyncio
import json
import os
from urllib.parse import quote, urlparse
from typing import Any
import httpx
from fastmcp import FastMCP, Client

class BackendClient:
    def __init__(self, origin: str, session_cookie: str, transport=None):
        parsed = urlparse(origin)
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}):
            raise ValueError("FABRARY_API_ORIGIN must be HTTPS or loopback HTTP")
        if not session_cookie:
            raise ValueError("FABRARY_AGENT_SESSION_COOKIE required: dedicated requester session")
        self.origin, self.cookie, self.transport = origin.rstrip("/"), session_cookie, transport

    async def request(self, method: str, path: str, body=None):
        async with httpx.AsyncClient(base_url=self.origin, headers={"Cookie": self.cookie}, timeout=30, transport=self.transport, follow_redirects=False) as client:
            response = await client.request(method, path, json=body)
            data = response.json()
            if response.status_code >= 400 and response.status_code != 402:
                raise ValueError(f"Fabrary {response.status_code}: {data.get('error', {}).get('message', 'request rejected')}")
            if response.status_code == 402:
                return {"payment_required": True, "challenge": data, "payment_required_header": response.headers.get("payment-required")}
            return data

    async def validate_requester(self):
        session = await self.request("GET", "/api/session")
        role = session.get("role", session.get("session", {}).get("role"))
        if role != "requester":
            raise ValueError("AGENT_REQUESTER_REQUIRED: refusing absent or owner session")


def build_mcp(backend: BackendClient) -> FastMCP:
    mcp = FastMCP("Fabrary authorized requester")

    @mcp.tool()
    async def list_machines() -> dict:
        """List supported Fabrary outputs, current machine availability and collection point. Simulation and hardware remain labeled by the API."""
        return await backend.request("GET", "/api/machines")

    @mcp.tool()
    async def create_request(asset_ids: list[str], intent: str, output_type: str = "sticker", width_mm: float = 53, height_mm: float = 50, quantity: int = 1, material: str = "thermal-paper", permission: str = "unclear", crop: str = "contain", budget_cap_cents: int | None = None) -> dict:
        """Create a draft from assets already uploaded by this requester. Permission must be authorized or unclear. User must inspect and approve the production preview in Fabrary before quoting or payment. An optional budget cap applies only after explicit preview approval."""
        body: dict[str, Any] = {"assetIds": asset_ids, "intent": intent, "outputType": output_type, "widthMm": width_mm, "heightMm": height_mm, "quantity": quantity, "material": material, "permission": permission, "crop": crop}
        if budget_cap_cents is not None:
            body["budgetMandate"] = {"enabled": True, "capCents": budget_cap_cents}
        return await backend.request("POST", "/api/jobs", body)

    @mcp.tool()
    async def job_status(job_id: str) -> dict:
        """Read a job owned by this requester. Returns separate production, payment and pickup state. Use the backend's evidence labels and never infer a physical completion from payment."""
        return await backend.request("GET", f"/api/jobs/{quote(job_id, safe='')}")

    @mcp.tool()
    async def request_quote(job_id: str, auto_accept: bool = False) -> dict:
        """Quote an explicitly approved specification through Fabrary matching and reservation. Auto accept is permitted only if the requester configured a sufficient budget mandate; approval and changed-spec rules are enforced by the backend."""
        return await backend.request("POST", f"/api/jobs/{quote(job_id, safe='')}/quote", {"autoAccept": auto_accept})

    @mcp.tool()
    async def checkout_job(job_id: str, idempotency_key: str, payment_payload: dict | None = None) -> dict:
        """Pay an approved, reserved job within its authorized budget through the normal backend checkout. Reuse the same idempotency key on retries. Testnet requires a requester-signed x402 payload; this agent holds no payer wallet. A challenge or pending receipt is not payment confirmation."""
        current = (await backend.request("GET", f"/api/jobs/{quote(job_id, safe='')}"))["job"]
        if current.get("paymentState") == "unpaid":
            mandate = current.get("spec", {}).get("budgetMandate", {})
            priced = current.get("quote", {})
            if not (mandate.get("enabled") is True and priced.get("accepted") is True and isinstance(mandate.get("capCents"), int) and isinstance(priced.get("totalCents"), int) and priced["totalCents"] <= mandate["capCents"]):
                raise ValueError("AGENT_MANDATE_REQUIRED: requester must approve a specification with an explicit budget cap and auto-accept its quote within that cap")
        return await backend.request("POST", f"/api/jobs/{quote(job_id, safe='')}/checkout", {"idempotencyKey": idempotency_key, "paymentPayload": payment_payload})

    @mcp.tool()
    async def dispatch_job(job_id: str) -> dict:
        """Ask Fabrary to dispatch this requester's approved, paid job. The backend checks payment, reservation, approval hash, machine policy and idempotent execution attempt. This does not bypass those checks or contact hardware directly."""
        return await backend.request("POST", f"/api/jobs/{quote(job_id, safe='')}/dispatch", {})

    return mcp

class AdapterServer:
    """Use FastMCP's public in-process client for the adapter's documented API."""
    def __init__(self, mcp): self.mcp = mcp
    def run(self, transport="stdio"):
        return self.mcp.run(transport=transport)
    async def list_tools(self):
        async with Client(self.mcp) as client: return await client.list_tools()
    async def call_tool(self, name: str, args: dict):
        async with Client(self.mcp) as client: return (await client.call_tool(name, args)).content


def restrict_protocol_senders(protocol, allowed_senders: set[str]):
    """Guard signed and unsigned handler registries before including the protocol."""
    if not allowed_senders: raise ValueError("FABRARY_AGENT_ALLOWED_SENDERS required")
    for registry in (protocol.signed_message_handlers, protocol.unsigned_message_handlers):
        for digest, handler in list(registry.items()):
            async def guarded(ctx, sender, message, original=handler):
                if sender not in allowed_senders:
                    ctx.logger.warning("Rejected sender outside dedicated requester allowlist")
                    return
                return await original(ctx, sender, message)
            registry[digest] = guarded
    return protocol


def prerequisites(env=os.environ):
    return [name for name in ("FABRARY_API_ORIGIN", "FABRARY_AGENT_SESSION_COOKIE", "FABRARY_AGENT_ALLOWED_SENDERS", "FABRARY_AGENT_SEED", "ASI1_API_KEY") if not env.get(name)]

async def local_smoke():
    backend = BackendClient(os.environ["FABRARY_API_ORIGIN"], os.environ["FABRARY_AGENT_SESSION_COOKIE"])
    await backend.validate_requester()
    server = AdapterServer(build_mcp(backend))
    tools = await server.list_tools()
    response = await server.call_tool("list_machines", {})
    print(json.dumps({"status":"PASS", "scope":"local FastMCP -> authorized backend", "tools":[t.name for t in tools], "response":[r.model_dump() for r in response], "discovery":"NOT_TESTED: requires Agentverse and ASI:One"}))


def main():
    if os.environ.get("FABRARY_FETCH_LOCAL_SMOKE") == "1":
        asyncio.run(local_smoke()); return
    missing = prerequisites()
    if missing:
        print(json.dumps({"status":"BLOCKED", "integration":"Fetch.ai ASI:One discovery", "missing":missing})); raise SystemExit(2)
    from uagents import Agent
    from uagents_adapter import MCPServerAdapter
    backend = BackendClient(os.environ["FABRARY_API_ORIGIN"], os.environ["FABRARY_AGENT_SESSION_COOKIE"])
    asyncio.run(backend.validate_requester())
    allowed = {s.strip() for s in os.environ["FABRARY_AGENT_ALLOWED_SENDERS"].split(",") if s.strip()}
    adapter = MCPServerAdapter(mcp_server=AdapterServer(build_mcp(backend)), asi1_api_key=os.environ["ASI1_API_KEY"], model=os.environ.get("ASI1_MODEL", "asi1-mini"))
    agent = Agent(name="Fabrary authorized requester", seed=os.environ["FABRARY_AGENT_SEED"], port=int(os.environ.get("FABRARY_AGENT_PORT", "8011")), mailbox=True, description="Fabrary approved image-to-physical-item workflow; dedicated authorized requester agent", network="testnet")
    for protocol in adapter.protocols:
        agent.include(restrict_protocol_senders(protocol, allowed), publish_manifest=True)
    # This operation registers/publishes Agentverse details. It is only run by an
    # explicitly configured operator; tests never execute it automatically.
    adapter.run(agent)

if __name__ == "__main__": main()
