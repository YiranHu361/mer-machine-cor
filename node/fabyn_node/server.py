"""Run the Fabyn tools over authenticated HTTP and FastMCP."""
from __future__ import annotations

from contextlib import asynccontextmanager
import hmac
import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastmcp import FastMCP
import uvicorn
from .security import NodeError
from .service import NodeService


class BearerMiddleware:
    def __init__(self, app, key: str):
        self.app, self.expected = app, ("Bearer " + key).encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] in {"http", "websocket"}:
            supplied = dict(scope.get("headers", [])).get(b"authorization", b"")
            if not hmac.compare_digest(supplied, self.expected):
                response = JSONResponse({"error": {"code": "unauthorized", "message": "Node bearer authorization required"}}, 401,
                    headers={"WWW-Authenticate": "Bearer", "Cache-Control": "no-store"})
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)



async def json_object(request: Request) -> dict:
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        raise NodeError("request", "Request body must be valid JSON", 422) from None
    if not isinstance(body, dict):
        raise NodeError("request", "Request body must be a JSON object", 422)
    return body


def create_app(service: NodeService) -> FastAPI:
    mcp = FastMCP("Fabyn machine node")

    @mcp.tool
    async def get_capabilities(machine_id: str) -> dict:
        """Read a versioned capability manifest for a configured machine."""
        return service.get_capabilities(machine_id)

    @mcp.tool
    async def get_status(machine_id: str, job_id: str | None = None, attempt_id: str | None = None) -> dict:
        """Reconcile a specific durable execution attempt without printing again."""
        return service.get_status(machine_id, job_id, attempt_id)

    @mcp.tool
    async def run_job(token: str, job_id: str, attempt_id: str, machine_id: str,
                      artifact_url: str, artifact_sha256: str, parameters: dict, expires_at: int) -> dict:
        """Accept one signed approved job; physical progress is asynchronous."""
        return await service.run_job(token=token, job_id=job_id, attempt_id=attempt_id, machine_id=machine_id,
            artifact_url=artifact_url, artifact_sha256=artifact_sha256, parameters=parameters, expires_at=expires_at)

    @mcp.tool
    async def cancel_before_acceptance(token: str, job_id: str, attempt_id: str, machine_id: str,
                                       artifact_sha256: str, parameters: dict, target_scope: str, expires_at: int | float) -> dict:
        """Durably prevent an unaccepted exact authorization from ever starting; never stop a device."""
        return await service.cancel_before_acceptance(token=token, job_id=job_id, attempt_id=attempt_id,
            machine_id=machine_id, artifact_sha256=artifact_sha256, parameters=parameters,
            target_scope=target_scope, expires_at=expires_at)

    @mcp.tool
    async def abort(token: str, machine_id: str, job_id: str, attempt_id: str) -> dict:
        """Report requested, stopped, unsupported or unknown truthfully."""
        return await service.abort(token=token, machine_id=machine_id, job_id=job_id, attempt_id=attempt_id)

    mcp_app = mcp.http_app(path="/", stateless_http=True)

    @asynccontextmanager
    async def lifespan(app):
        async with mcp_app.lifespan(app):
            yield
        await service.close()

    app = FastAPI(title="Fabyn node", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.add_middleware(BearerMiddleware, key=service.key)
    app.state.service, app.state.mcp = service, mcp

    @app.exception_handler(NodeError)
    async def node_error(request: Request, error: NodeError):
        return JSONResponse({"error": {"code": error.code, "message": error.message}}, status_code=error.status)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "fabyn-node", "version": "0.1.0",
                "machines": [{"id": m, "mode": c["mode"], "blockers": service.adapters[m].blockers()} for m,c in service.machines.items()]}

    @app.post("/tools/get_capabilities")
    async def http_capabilities(request: Request):
        body = await json_object(request)
        return service.get_capabilities(body.get("machine_id", ""))

    @app.post("/tools/get_status")
    async def http_status(request: Request):
        body = await json_object(request)
        return service.get_status(body.get("machine_id", ""), body.get("job_id"), body.get("attempt_id"))

    @app.post("/tools/run_job")
    async def http_run(request: Request):
        body = await json_object(request)
        required = {"token", "job_id", "attempt_id", "machine_id", "artifact_url", "artifact_sha256", "parameters", "expires_at"}
        if set(body) != required:
            raise NodeError("request", "Run request is missing required fields or contains unknown fields", 422)
        return await service.run_job(**body)

    @app.post("/tools/cancel_before_acceptance")
    async def http_cancel(request: Request):
        body = await json_object(request)
        required = {"token", "job_id", "attempt_id", "machine_id", "artifact_sha256", "parameters", "target_scope", "expires_at"}
        if set(body) != required:
            raise NodeError("request", "Cancellation requires the exact signed content and target scope", 422)
        return await service.cancel_before_acceptance(**body)

    @app.post("/tools/abort")
    async def http_abort(request: Request):
        body = await json_object(request)
        if set(body) != {"token", "machine_id", "job_id", "attempt_id"}:
            raise NodeError("request", "Abort request requires a signed job context", 422)
        return await service.abort(**body)

    @app.post("/calibrate")
    async def calibrate(request: Request):
        body = await json_object(request)
        if type(body.get("inspected")) is not bool:
            raise NodeError("inspection", "Calibration requires an explicit inspected boolean", 422)
        if body.get("job") is not None:
            job = body["job"]
            if not isinstance(job, dict) or job.get("machine_id") != body.get("machine_id") or "_scope" in job:
                raise NodeError("calibration_context", "Calibration must bind this exact machine", 422)
            return await service.run_job(**job, _scope="calibration")
        return service.calibrate(body.get("machine_id", ""), body["inspected"], body.get("attempt_id"), body.get("reason"))

    @app.patch("/machines/{machine_id}/policy")
    async def policy(machine_id: str, request: Request):
        return service.update_policy(machine_id, await json_object(request))

    @app.post("/reconcile")
    async def reconcile(request: Request):
        body = await json_object(request)
        if set(body) != {"machine_id", "job_id", "attempt_id", "inspected", "result", "reason"}:
            raise NodeError("operator_resolution", "Resolution requires complete explicit operator context", 422)
        return service.reconcile(**body)

    @app.post("/simulation/{machine_id}")
    async def simulation(machine_id: str, request: Request):
        return service.simulation(machine_id, (await json_object(request)).get("outcome", ""))

    app.mount("/mcp", mcp_app)
    return app


def main():
    service = NodeService.from_environment()
    app = create_app(service)
    host = os.environ.get("FABYN_NODE_HOST", "127.0.0.1")
    if host not in {"127.0.0.1", "::1", "localhost"}:
        raise ValueError("This local demo binds loopback only")
    uvicorn.run(app, host=host, port=int(os.environ.get("FABYN_NODE_PORT", "8788")), access_log=False)


if __name__ == "__main__":
    main()
