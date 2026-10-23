from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import hashlib
import fcntl
import io
import json
import math
import os
from pathlib import Path
import re
import time
import uuid
import httpx
from PIL import Image, ImageDraw, ImageFilter
from .adapters import Bambu, adapter_for, capture_camera, normalized_catalog_color
from .journal import Journal, now
from .security import NodeError, canonical, require_expected_mode, validate_artifact_url, verify_token

DEFAULT_MACHINES = [
    {"id": "phomemo_01", "model": "Phomemo M02Pro", "outputType": "sticker", "material": "thermal-paper"},
    {"id": "instax_01", "model": "Instax Mini Link 3", "outputType": "instax", "material": "photo-film"},
    {"id": "bambu_01", "model": "Bambu Lab A1 mini", "outputType": "3d", "material": "pla"},
]


class NodeService:
    def __init__(self, *, key: str, token_secret: str | None = None, data_dir: Path | None = None,
                 asset_origin: str = "http://127.0.0.1:4318/assets", machines: list[dict] | None = None,
                 public_url: str = "http://127.0.0.1:8788", artifact_transport=None):
        if not key or len(key) < 16:
            raise ValueError("FABRARY_NODE_KEY must be configured with at least 16 characters")
        self.key, self.token_secret = key, token_secret or key
        self.data_dir = (data_dir or Path(".data/node")).resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.process_lock = (self.data_dir / "node.lock").open("a+")
        try:
            fcntl.flock(self.process_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.process_lock.close()
            raise RuntimeError("Another node owns this journal; run one process per node") from None
        self.frames = self.data_dir / "frames"
        self.frames.mkdir(exist_ok=True)
        self.artifacts = self.data_dir / "artifacts"
        self.artifacts.mkdir(exist_ok=True)
        self.asset_origin, self.public_url = asset_origin, public_url.rstrip("/")
        self.artifact_transport = artifact_transport
        self.journal = Journal(self.data_dir / "journal.sqlite")
        self.machines, self.adapters, self.tasks = {}, {}, {}
        self.stop_tasks: dict[str, tuple[str, asyncio.Task]] = {}
        for given in (machines if machines is not None else DEFAULT_MACHINES):
            config = dict(given)
            if config.get("mode", "simulation") not in {"simulation", "hardware"}:
                raise ValueError("Machine mode must be simulation or hardware")
            config.setdefault("mode", "simulation")
            model = next((m for m in DEFAULT_MACHINES if m["model"] == config["model"]), None)
            if not model:
                raise ValueError("Unsupported configured machine model")
            config.setdefault("outputType", model["outputType"])
            config.setdefault("material", model["material"])
            self.machines[config["id"]] = config
            self.adapters[config["id"]] = adapter_for(config)
            # Calibration belongs to an exact device, transport, and camera,
            # never just its human-readable machine ID. Hash private config so
            # camera URLs or other local connection details stay out of state.
            calibration_fields = ("mode", "model", "outputType", "material", "bluetoothAddress", "rfcommChannel",
                "serviceUUID", "writeCharUUID", "notifyCharUUID", "flipVertical", "compatibilityValidated",
                "host", "serial", "cameraCommand", "cameraUrl")
            calibration_config = {key: config.get(key) for key in calibration_fields}
            calibration_config["adapterVersion"] = self.adapters[config["id"]].version
            configuration_binding = hashlib.sha256(canonical(calibration_config).encode()).hexdigest()
            existing_state = self.journal.machine(config["id"])
            if existing_state and isinstance(existing_state.get("hours", {}).get("start"), str):
                existing_state["hours"] = {k: min(24, int(v.split(":")[0]) + (1 if k == "end" and v.endswith(":59") else 0)) for k,v in existing_state["hours"].items()}
                self.journal.save_machine(config["id"], existing_state)
            if existing_state:
                prior_binding = existing_state.get("configurationBinding")
                # Legacy hardware journals cannot prove which physical setup
                # was inspected. Existing simulation fixtures can migrate safely.
                changed = prior_binding != configuration_binding and (prior_binding is not None or config["mode"] == "hardware")
                if changed:
                    simulation = config["mode"] == "simulation"
                    existing_state.update(paired=simulation or bool(config.get("paired")), configured=simulation,
                        calibrated=simulation, listed=simulation, ready=simulation, paused=not simulation,
                        mediaRemaining=100 if simulation else 0, material=config["material"],
                        reason="Simulation fixture calibrated; no physical device" if simulation else "Device or capture configuration changed; physical calibration and explicit owner resume are required")
                # Pairing is a current owner confirmation, not a one-time
                # calibration result. Reflect both confirmation and revocation
                # without requiring a new journal for the same physical device.
                existing_state["paired"] = config["mode"] == "simulation" or bool(config.get("paired"))
                existing_state["configurationBinding"] = configuration_binding
                self.journal.save_machine(config["id"], existing_state)
            else:
                simulation = config["mode"] == "simulation"
                self.journal.save_machine(config["id"], {
                    "configurationBinding": configuration_binding,
                    "paired": simulation or bool(config.get("paired")), "configured": simulation,
                    "calibrated": simulation, "listed": simulation, "ready": simulation,
                    "paused": not simulation, "mediaRemaining": 100 if simulation else 0,
                    "material": config["material"], "maxJobSeconds": config.get("maxJobSeconds", 900),
                    "maxQuantity": 10, "widthsMm": [15, 25, 53], "hours": {"start": 0, "end": 24},
                    "reason": "Simulation fixture calibrated; no physical device" if simulation else "Hardware not yet calibrated",
                    "simulationOutcome": "pass",
                })

    @classmethod
    def from_environment(cls):
        path = os.environ.get("FABRARY_MACHINES_FILE")
        machines = json.loads(Path(path).read_text()) if path else None
        if isinstance(machines, dict):
            machines = machines["machines"]
        return cls(key=os.environ.get("FABRARY_NODE_KEY", ""), token_secret=os.environ.get("FABRARY_TOKEN_SECRET"),
            data_dir=Path(os.environ.get("FABRARY_NODE_DATA", ".data/node")),
            asset_origin=os.environ.get("FABRARY_ASSET_ORIGIN", "http://127.0.0.1:4318/assets"), machines=machines,
            public_url=os.environ.get("FABRARY_NODE_URL", "http://127.0.0.1:8788"))

    def machine(self, machine_id: str) -> dict:
        if not isinstance(machine_id, str) or machine_id not in self.machines:
            raise NodeError("unknown_machine", "Machine is not configured on this node", 404)
        return self.machines[machine_id]

    def require_configuration_binding(self, machine_id: str, binding: str | None) -> None:
        current = self.journal.machine(machine_id).get("configurationBinding")
        if not isinstance(binding, str) or not binding or binding != current:
            raise NodeError("configuration_binding", "Attempt belongs to another device or capture configuration; this authorization cannot be applied to the current setup", 403)

    def stop_pending(self, machine_id: str) -> bool:
        stop = self.stop_tasks.get(machine_id)
        return bool(stop and not stop[1].done())

    def require_stop_settled(self, machine_id: str) -> None:
        if self.stop_pending(machine_id):
            raise NodeError("stop_pending", "The device stop operation is still pending; wait for its transport to finish before releasing or reusing the machine", 409)

    async def request_device_stop(self, machine_id: str, attempt_id: str) -> dict:
        # Device I/O survives an individual HTTP/worker caller cancellation.
        # Duplicate requests for the same attempt share the original transport.
        stop = self.stop_tasks.get(machine_id)
        if not stop or stop[0] != attempt_id:
            self.require_stop_settled(machine_id)
            async def request_stop():
                try:
                    return await self.adapters[machine_id].abort()
                except Exception:
                    return {"status": "unknown", "reason": "Stop transport failed; physical stoppage is unconfirmed"}
            stop = (attempt_id, asyncio.create_task(request_stop()))
            self.stop_tasks[machine_id] = stop
        return await asyncio.shield(stop[1])

    def get_capabilities(self, machine_id: str) -> dict:
        config = self.machine(machine_id)
        state, adapter = self.journal.machine(machine_id), self.adapters[machine_id]
        blockers = adapter.blockers()
        return {"manifest_version": 1, "machine_id": machine_id, "model": config["model"],
            "mode": config["mode"], "adapter_version": adapter.version, "output_types": [config["outputType"]],
            "materials": [state["material"]], "color_modes": ["monochrome" if config["outputType"] == "sticker" else "single-color" if config["outputType"] == "3d" else "color"],
            "dimensions_mm": {"widths": state["widthsMm"], "height_min": 5, "height_max": 150} if config["outputType"] == "sticker" else {"width": 54, "height": 86} if config["outputType"] == "instax" else {"catalog_only": True},
            "camera": "simulation" if config["mode"] == "simulation" else "configured" if config.get("cameraCommand") or config.get("cameraUrl") else "unconfigured",
            "abort_support": "confirmed" if config["mode"] == "simulation" else "requested" if isinstance(adapter, Bambu) else "unsupported",
            "paired": state["paired"], "configured": not blockers, "calibrated": state["calibrated"],
            "listed": state["listed"], "ready": bool(state["ready"] and not state["paused"] and not blockers and not self.journal.active(machine_id) and not self.stop_pending(machine_id)),
            "stop_pending": self.stop_pending(machine_id),
            "paused": state["paused"], "media_remaining": state["mediaRemaining"], "max_quantity": state["maxQuantity"],
            "max_job_seconds": state["maxJobSeconds"], "hours": {**state["hours"], "timezone": "UTC"},
            "handling": ["remove", "label", "store", "clear", "explicitly resume"],
            "blockers": blockers, "reason": "; ".join(blockers) if blockers else "Device stop operation is still pending; wait before reusing this machine" if self.stop_pending(machine_id) else state.get("reason"),
            "catalog": [{k: e[k] for k in ("id", "sha256", "widthMm", "heightMm", "depthMm", "color", "material", "estimatedSeconds") if k in e} for e in config.get("catalog", []) if e.get("reviewed") is True]}

    def get_status(self, machine_id: str, job_id: str | None = None, attempt_id: str | None = None) -> dict:
        config = self.machine(machine_id)
        state = self.journal.machine(machine_id)
        attempt = self.journal.get(attempt_id) if attempt_id else self.journal.active(machine_id) or self.journal.latest(machine_id)
        if attempt and (attempt["machine_id"] != machine_id or job_id and attempt["job_id"] != job_id):
            raise NodeError("attempt_binding", "Attempt does not belong to this machine and job", 403)
        if attempt_id and not attempt:
            raise NodeError("unknown_attempt", "Attempt is not in the durable node journal", 404)
        manifest = self.get_capabilities(machine_id)
        return {"machine_id": machine_id, "mode": config["mode"], "ready": manifest["ready"],
            "paused": state["paused"], "configured": manifest["configured"], "calibrated": state["calibrated"],
            "stop_pending": manifest["stop_pending"],
            "media_remaining": state["mediaRemaining"], "execution_status": attempt["status"] if attempt else "idle",
            "job_id": attempt["job_id"] if attempt else None, "attempt_id": attempt["attempt_id"] if attempt else None,
            "completion_credible": bool(attempt and attempt["completion_credible"]),
            "accepted_at": attempt["accepted_at"] if attempt else None, "started_at": attempt["started_at"] if attempt else None,
            "completed_at": attempt["completed_at"] if attempt else None,
            "reason": manifest["reason"] if manifest["stop_pending"] else attempt["reason"] if attempt and attempt["reason"] else manifest["reason"], "blockers": manifest["blockers"]}

    def validate_parameters(self, machine_id: str, parameters: dict) -> None:
        config, state = self.machine(machine_id), self.journal.machine(machine_id)
        required = {"outputType", "widthMm", "heightMm", "quantity", "material", "crop", "specVersion"}
        if isinstance(parameters, dict) and parameters.get("outputType") == "3d":
            required |= {"depthMm", "color", "estimatedSeconds"}
        if not isinstance(parameters, dict) or set(parameters) != required:
            raise NodeError("parameters", "Parameters must contain exactly the approved base fields, plus depthMm, color and estimatedSeconds for 3D only", 422)
        if parameters["outputType"] != config["outputType"] or parameters["material"] != state["material"]:
            raise NodeError("unsupported_material", "Output type or material is not loaded on this machine", 422)
        if not isinstance(parameters["crop"], str) or parameters["crop"] not in {"contain", "cover"}:
            raise NodeError("unsupported_crop", "Crop must be contain or cover", 422)
        for key in ("widthMm", "heightMm"):
            value = parameters[key]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise NodeError("dimensions", "Dimensions must be finite positive numbers", 422)
        for key in ("quantity", "specVersion"):
            if type(parameters[key]) is not int or parameters[key] < 1:
                raise NodeError("parameters", key + " must be a positive integer", 422)
        if parameters["quantity"] > state["maxQuantity"] or parameters["quantity"] > state["mediaRemaining"]:
            raise NodeError("owner_policy", "Quantity exceeds owner limit or estimated remaining media", 422)
        if config["outputType"] == "sticker" and (parameters["widthMm"] not in state["widthsMm"] or not 5 <= parameters["heightMm"] <= 150):
            raise NodeError("unsupported_dimensions", "Loaded sticker roll supports widths 15, 25 or 53 mm and heights 5–150 mm", 422)
        if config["outputType"] == "instax" and (parameters["widthMm"], parameters["heightMm"]) != (54, 86):
            raise NodeError("unsupported_dimensions", "Instax mini has fixed 54 × 86 mm film", 422)
        if config["outputType"] == "3d":
            if parameters["quantity"] != 1:
                raise NodeError("catalog_quantity", "Prepared single-color 3D jobs require quantity one", 422)
            depth = parameters["depthMm"]
            duration = parameters["estimatedSeconds"]
            if isinstance(depth, bool) or not isinstance(depth, (int, float)) or not math.isfinite(depth) or not 0 < depth <= 180:
                raise NodeError("dimensions", "Prepared 3D depth must be positive and no greater than 180 mm", 422)
            if normalized_catalog_color(parameters["color"]) != parameters["color"]:
                raise NodeError("catalog_color", "Signed prepared 3D color must already match the normalized catalog color", 422)
            if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 0 < duration <= state["maxJobSeconds"]:
                raise NodeError("catalog_duration", "Prepared 3D duration must be positive and within the owner time limit", 422)

    def validate_acceptance_policy(self, machine_id: str, parameters: dict, scope: str) -> dict:
        self.require_stop_settled(machine_id)
        self.validate_parameters(machine_id, parameters)
        manifest, state = self.get_capabilities(machine_id), self.journal.machine(machine_id)
        if scope == "calibration":
            if manifest["blockers"] or self.journal.active(machine_id):
                raise NodeError("calibration_blocked", manifest.get("reason") or "Device has an active attempt", 409)
        elif not manifest["ready"] or not state["listed"] or not state["calibrated"]:
            raise NodeError("machine_not_ready", manifest.get("reason") or "Machine is unavailable under owner policy", 409)
        utc = datetime.now(timezone.utc)
        current = utc.hour + utc.minute / 60 + utc.second / 3600
        start, end = state["hours"]["start"], state["hours"]["end"]
        if not (start <= current < end if start < end else current >= start or current < end):
            raise NodeError("owner_hours", "Machine is outside owner operating hours (UTC)", 409)
        return state

    async def fetch_artifact(self, url: str, digest: str, config: dict, parameters: dict) -> Path:
        validate_artifact_url(url, self.asset_origin)
        maximum = 50 * 1024 * 1024 if config["outputType"] == "3d" else 10 * 1024 * 1024
        content = bytearray()
        async with httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False, transport=self.artifact_transport) as client:
            async with client.stream("GET", url) as response:
                if response.status_code != 200:
                    raise NodeError("artifact_fetch", "Approved asset could not be retrieved", 502)
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > maximum:
                        raise NodeError("artifact_oversize", "Approved artifact exceeds the node limit", 422)
        if not hashlib.sha256(content).hexdigest() == digest:
            raise NodeError("artifact_hash", "Artifact bytes do not match the approved SHA256", 422)
        if config["outputType"] != "3d":
            try:
                with Image.open(io.BytesIO(content)) as image:
                    if image.format != "PNG":
                        raise ValueError()
                    expected = (round(parameters["widthMm"] / 25.4 * 300), round(parameters["heightMm"] / 25.4 * 300)) if config["outputType"] == "sticker" else (600, 800)
                    if image.size != expected or config["outputType"] == "sticker" and image.mode != "1":
                        raise ValueError()
                    image.verify()
            except Exception:
                raise NodeError("artifact_format", "Artifact is not the exact prepared production PNG for these dimensions", 422) from None
        target = self.artifacts / (digest + (".3mf" if config["outputType"] == "3d" else ".png"))
        target.write_bytes(content)
        return target

    async def run_job(self, *, token: str, job_id: str, attempt_id: str, machine_id: str,
                      artifact_url: str, artifact_sha256: str, parameters: dict, expires_at: int | float, _scope: str = "dispatch") -> dict:
        if not all(isinstance(value,str) for value in (token,job_id,attempt_id,machine_id,artifact_url,artifact_sha256)) or not isinstance(parameters,dict) or isinstance(expires_at,bool) or not isinstance(expires_at,(int,float)) or not math.isfinite(expires_at):
            raise NodeError("request", "Run request fields have invalid types", 422)
        request = {"machine_id": machine_id, "job_id": job_id, "attempt_id": attempt_id,
                   "artifact_sha256": artifact_sha256, "parameters": parameters, "expires_at": expires_at}
        payload = verify_token(token, self.token_secret, scope=_scope, expected=request)
        config = self.machine(machine_id)
        if not all(isinstance(value, str) and 1 <= len(value) <= 128 for value in (job_id, attempt_id)) or not re.fullmatch(r"[0-9a-f]{64}", artifact_sha256):
            raise NodeError("request", "Invalid job, attempt or artifact hash", 422)
        existing = self.journal.get(attempt_id)
        if existing:
            binding = canonical({k: request[k] for k in ("machine_id", "job_id", "attempt_id", "artifact_sha256", "parameters")})
            if existing["binding"] != binding or existing["scope"] != _scope:
                raise NodeError("attempt_conflict", "Attempt ID already binds different approved content", 409)
            return self.acceptance(existing, False)
        expected_mode = require_expected_mode(payload, config["mode"])
        self.journal.reject_cancelled(request, _scope)
        state = self.validate_acceptance_policy(machine_id, parameters, _scope)
        configuration_binding = state["configurationBinding"]
        if config["outputType"] == "3d" and config["mode"] == "hardware":
            self.adapters[machine_id].catalog_entry(artifact_sha256, parameters)
        path = await self.fetch_artifact(artifact_url, artifact_sha256, config, parameters)
        payload = verify_token(token, self.token_secret, scope=_scope, expected=request)
        # Another identical request may have finished downloading first. Replay
        # its durable acceptance before checking the now-busy machine policy.
        existing = self.journal.get(attempt_id)
        if existing:
            binding = canonical({k: request[k] for k in ("machine_id", "job_id", "attempt_id", "artifact_sha256", "parameters")})
            if existing["binding"] != binding or existing["scope"] != _scope:
                raise NodeError("attempt_conflict", "Attempt ID already binds different approved content", 409)
            return self.acceptance(existing, False)
        # Mode and the private device/camera binding must still describe the
        # configuration authorized before download. Exact durable replay above
        # stays read-only, including for older tokens and configurations.
        config = self.machine(machine_id)
        require_expected_mode(payload, config["mode"])
        self.require_configuration_binding(machine_id, configuration_binding)
        # Re-read every policy after the network await. Acceptance and saving
        # this fresh state are synchronous in one event-loop turn.
        state = self.validate_acceptance_policy(machine_id, parameters, _scope)
        row, created = self.journal.accept(request, state.get("simulationOutcome", "pass"), _scope, state["configurationBinding"])
        if created:
            state["simulationOutcome"] = "pass"
            if _scope == "calibration":
                state.update(calibrated=False, paused=True, ready=False, reason="Calibration attempt in progress; owner inspection required")
            self.journal.save_machine(machine_id, state)
            self.tasks[attempt_id] = asyncio.create_task(self._execute(row, path, parameters, expected_mode))
            if row["outcome"] == "lost_ack":
                raise NodeError("simulated_lost_ack", "Simulation: acknowledgment lost after durable acceptance; reconcile this attempt", 503)
        return self.acceptance(row, created)

    async def cancel_before_acceptance(self, *, token: str, job_id: str, attempt_id: str, machine_id: str,
                                       artifact_sha256: str, parameters: dict, target_scope: str, expires_at: int | float) -> dict:
        if not all(isinstance(value, str) for value in (token, job_id, attempt_id, machine_id, artifact_sha256)) or not isinstance(parameters, dict) or isinstance(expires_at, bool) or not isinstance(expires_at, (int, float)) or not math.isfinite(expires_at):
            raise NodeError("request", "Cancellation request fields have invalid types", 422)
        if not isinstance(target_scope, str) or target_scope not in {"dispatch", "calibration"}:
            raise NodeError("request", "Cancellation target scope must be dispatch or calibration", 422)
        request = {"machine_id": machine_id, "job_id": job_id, "attempt_id": attempt_id, "artifact_sha256": artifact_sha256,
            "parameters": parameters, "expires_at": expires_at, "target_scope": target_scope}
        payload = verify_token(token, self.token_secret, scope="cancel_before_acceptance", expected=request)
        # New cancellations bind the current mode. Exact durable proof replay
        # remains read-only after reconfiguration, using its original signed mode.
        mode = require_expected_mode(payload, payload.get("expected_mode"))
        config = self.machine(machine_id)
        if not all(1 <= len(value) <= 128 for value in (job_id, attempt_id)) or not re.fullmatch(r"[0-9a-f]{64}", artifact_sha256):
            raise NodeError("request", "Invalid job, attempt or artifact hash", 422)
        if not self.journal.cancelled(request):
            require_expected_mode(payload, config["mode"])
        return self.journal.cancel_before_acceptance(request, target_scope, mode)

    @staticmethod
    def acceptance(row: dict, created: bool) -> dict:
        return {"status": "accepted" if created else "already_accepted", "execution_status": row["status"],
            "attempt_id": row["attempt_id"], "reason": row["reason"], "completion_credible": bool(row["completion_credible"])}

    async def _execute(self, row: dict, path: Path, parameters: dict, expected_mode: str) -> None:
        machine_id, attempt_id = row["machine_id"], row["attempt_id"]
        if self.journal.get(attempt_id)["status"] != "accepted":
            return
        try:
            require_expected_mode({"expected_mode": expected_mode}, self.machine(machine_id)["mode"])
            self.require_configuration_binding(machine_id, row["configuration_binding"])
        except NodeError:
            self.journal.update(attempt_id, "failed", reason="Device or capture configuration changed before any physical start; no device operation was issued")
            return
        # FULL-sync commit MUST complete before anything can reach hardware.
        self.journal.update(attempt_id, "running", artifact_path=str(path))
        if self.journal.get(attempt_id)["status"] != "running":
            return
        try:
            timeout = self.journal.machine(machine_id)["maxJobSeconds"] + 30
            status, credible, reason = await asyncio.wait_for(self.adapters[machine_id].run(path, parameters, attempt_id), timeout)
            if row["outcome"] == "lost_ack":
                status, credible, reason = "uncertain", False, "Simulation: physical outcome intentionally uncertain after lost acknowledgment; do not reprint"
            self.journal.update(attempt_id, status, reason=reason, credible=credible)
            state = self.journal.machine(machine_id)
            state["mediaRemaining"] = max(0, state["mediaRemaining"] - parameters["quantity"])
            self.journal.save_machine(machine_id, state)
        except asyncio.CancelledError:
            # Process shutdown retains running; the next startup marks uncertain.
            raise
        except Exception as exc:
            stop = await self.request_device_stop(machine_id, attempt_id)
            self.journal.update(attempt_id, "uncertain", reason="Execution error after possible start (" + type(exc).__name__ + "); " + stop["reason"])

    async def camera_snapshot(self, *, token: str, machine_id: str, job_id: str,
                              attempt_id: str, phase: str = "result") -> dict:
        payload = verify_token(token, self.token_secret, scope="camera", expected={"machine_id": machine_id, "job_id": job_id, "attempt_id": attempt_id})
        config = self.machine(machine_id)
        require_expected_mode(payload, config["mode"])
        configuration_binding = self.journal.machine(machine_id).get("configurationBinding")
        if not isinstance(phase, str) or phase not in {"baseline", "result"}:
            raise NodeError("camera_phase", "Camera phase must be baseline or result", 422)
        row = self.journal.get(attempt_id)
        if row and (row["machine_id"] != machine_id or row["job_id"] != job_id):
            raise NodeError("attempt_binding", "Camera context is not associated with this attempt", 403)
        if row:
            self.require_configuration_binding(machine_id, row["configuration_binding"])
        if phase == "result" and not row:
            raise NodeError("unknown_attempt", "Result capture requires a journaled attempt", 404)
        if phase == "result" and row["status"] not in {"completed", "failed", "uncertain"}:
            raise NodeError("camera_too_early", "Device has not reported an execution outcome", 409)
        result = {"captured_at": now(), "machine_id": machine_id, "job_id": job_id,
            "attempt_id": attempt_id, "phase": phase, "source": "simulation" if config["mode"] == "simulation" else "camera",
            "completion_credible": bool(row and row["completion_credible"] and row["status"] == "completed")}
        if config["mode"] == "simulation":
            observation = "missing" if phase == "baseline" or row and row["outcome"] == "fail" else "ambiguous" if row and row["outcome"] in {"review", "lost_ack"} else "visible"
            image = Image.new("RGB", (800, 600), "#ddd9cf")
            drawing = ImageDraw.Draw(image)
            drawing.rectangle((60, 80, 740, 540), outline="#77736c", width=3)
            if observation == "visible" and row and row["artifact_path"]:
                try:
                    with Image.open(row["artifact_path"]) as artwork:
                        artwork.thumbnail((400, 380))
                        image.paste(artwork.convert("RGB"), ((800-artwork.width)//2, 100))
                except Exception:
                    drawing.rectangle((280, 180, 520, 420), fill="#aaa28f")
            if observation == "ambiguous":
                image = image.filter(ImageFilter.GaussianBlur(12))
                drawing = ImageDraw.Draw(image)
            drawing.rectangle((0, 0, 800, 55), fill="#4a4b42")
            drawing.text((20, 16), "SIMULATION / NO PHYSICAL CAMERA — " + phase.upper(), fill="white")
            drawing.text((20, 565), machine_id + " / " + job_id + " / " + result["captured_at"], fill="black")
            stream = io.BytesIO()
            image.save(stream, "PNG")
            data = stream.getvalue()
            result["observation"] = observation
        else:
            data = await capture_camera(config)
            result["captured_at"] = now()
        # A capture may finish after a configuration change. Never publish its
        # bytes under metadata for a different mode, device, or camera setup.
        require_expected_mode(payload, self.machine(machine_id)["mode"])
        self.require_configuration_binding(machine_id, configuration_binding)
        frame_id = uuid.uuid4().hex + ".png"
        # Normalize camera bytes after validation; source metadata stays truthful.
        with Image.open(io.BytesIO(data)) as image:
            image.convert("RGB").save(self.frames / frame_id, "PNG")
        result["frame_url"] = self.public_url + "/frames/" + frame_id
        (self.frames / (frame_id + ".json")).write_text(json.dumps(result))
        with self.journal.transaction():
            self.journal.db.execute("INSERT INTO frames VALUES (?,?,?,?,?,?,?,?)",
                (frame_id,machine_id,job_id,attempt_id,phase,result["source"],result["captured_at"],canonical(result)))
        return result

    async def abort(self, *, token: str, machine_id: str, job_id: str, attempt_id: str) -> dict:
        payload = verify_token(token, self.token_secret, scope="abort", expected={"machine_id": machine_id, "job_id": job_id, "attempt_id": attempt_id})
        config = self.machine(machine_id)
        require_expected_mode(payload, config["mode"])
        row = self.journal.get(attempt_id)
        if not row or row["machine_id"] != machine_id or row["job_id"] != job_id:
            raise NodeError("attempt_binding", "Abort context is not associated with this attempt", 403)
        if row["status"] in {"completed", "failed"}:
            return {"status": "unknown", "reason": "Recorded execution is already terminal; no stop was issued"}
        self.require_configuration_binding(machine_id, row["configuration_binding"])
        if row["status"] == "accepted":
            # No worker has committed a possible physical start. Fence it before
            # yielding, and never send a stop for a different device operation.
            self.journal.update(attempt_id, "failed", reason="Execution explicitly stopped before any physical start")
            task = self.tasks.get(attempt_id)
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            return {"status": "stopped", "reason": "Execution stopped before any physical start"}
        if config["mode"] == "simulation":
            task = self.tasks.get(attempt_id)
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            self.journal.update(attempt_id, "failed", reason="Simulation explicitly stopped")
        if config["mode"] == "hardware":
            # Reserve uncertainty before awaiting transport I/O so a late worker
            # result cannot claim a safely stopped or completed physical item.
            self.journal.update(attempt_id, "uncertain", reason="Owner requested stop; physical stoppage is unconfirmed")
            # A stop command can outlive the run worker. Keep its transport
            # fenced separately and shield it from an HTTP caller disconnect,
            # so a late stop can never reach a newly accepted execution.
            result = await self.request_device_stop(machine_id, attempt_id)
        else:
            result = await self.adapters[machine_id].abort()
        if config["mode"] == "hardware":
            self.journal.update(attempt_id, "uncertain", reason=result["reason"])
        return result

    def update_policy(self, machine_id: str, changes: dict) -> dict:
        self.machine(machine_id)
        allowed = {"listed", "paused", "ready", "mediaRemaining", "material", "maxJobSeconds", "maxQuantity", "widthsMm", "hours", "cleared", "inspected"}
        if set(changes) - allowed:
            raise NodeError("policy", "Unknown owner policy property", 422)
        state = self.journal.machine(machine_id)
        for key in ("listed", "paused", "ready", "cleared", "inspected"):
            if key in changes and type(changes[key]) is not bool:
                raise NodeError("policy", key + " must be boolean", 422)
        resuming = changes.get("paused") is False or changes.get("ready") is True
        if resuming:
            self.require_stop_settled(machine_id)
        if resuming and (not state["calibrated"] or not changes.get("cleared") or not changes.get("inspected") or self.journal.active(machine_id)):
            raise NodeError("inspection_required", "Resume requires calibration, explicit inspection and clearing, and no active or uncertain attempt", 409)
        for key, minimum, maximum in (("mediaRemaining", 0, 100000), ("maxQuantity", 1, 100), ("maxJobSeconds", 1, 3600)):
            if key in changes and (type(changes[key]) is not int or not minimum <= changes[key] <= maximum):
                raise NodeError("policy", key + " is out of bounds", 422)
        if "material" in changes and changes["material"] != self.machines[machine_id]["material"]:
            raise NodeError("policy", "This adapter does not support that material", 422)
        if "widthsMm" in changes and (not isinstance(changes["widthsMm"], list) or not changes["widthsMm"] or any(type(x) is not int or x not in {15,25,53} for x in changes["widthsMm"])):
            raise NodeError("policy", "Sticker widths must be a nonempty subset of 15,25,53", 422)
        if "hours" in changes:
            hours = changes["hours"]
            if not isinstance(hours, dict) or set(hours) != {"start", "end"} or any(type(v) is not int for v in hours.values()) or not 0 <= hours["start"] <= 23 or not 1 <= hours["end"] <= 24 or hours["start"] == hours["end"]:
                raise NodeError("policy", "Hours require integer UTC start 0–23 and end 1–24 with distinct bounds", 422)
        state.update({k: v for k,v in changes.items() if k not in {"cleared", "inspected"}})
        if resuming:
            state["reason"] = "Owner inspected and cleared the machine"
        elif changes.get("paused"):
            state["ready"] = False
            state["reason"] = "Paused by owner"
        self.journal.save_machine(machine_id, state)
        self.journal.audit(machine_id, None, "policy_updated", canonical(changes))
        return self.get_capabilities(machine_id)

    def calibrate(self, machine_id: str, inspected: bool, attempt_id: str | None = None, reason: str | None = None) -> dict:
        config = self.machine(machine_id)
        self.require_stop_settled(machine_id)
        state, adapter = self.journal.machine(machine_id), self.adapters[machine_id]
        blockers = adapter.blockers()
        if not inspected or blockers:
            state.update(calibrated=False, paused=True, ready=False, reason="; ".join(blockers) if blockers else "Calibration requires owner inspection")
            self.journal.save_machine(machine_id, state)
            return {"status": "blocked" if blockers else "failed", "calibrated": False, "mode": config["mode"], "reason": state["reason"]}
        if self.journal.active(machine_id):
            raise NodeError("machine_busy", "Resolve the active or uncertain attempt before calibration", 409)
        source = "simulation"
        frame_id = None
        if config["mode"] == "hardware":
            attempt = self.journal.get(attempt_id or "")
            if not attempt or attempt["machine_id"] != machine_id or attempt["status"] != "completed" or attempt["scope"] != "calibration":
                return {"status": "blocked", "calibrated": False, "mode": "hardware", "reason": "A completed attempt authorized specifically for calibration and physical inspection are required. Installing an adapter is not calibration."}
            if attempt["configuration_binding"] != state["configurationBinding"]:
                return {"status": "blocked", "calibrated": False, "mode": "hardware", "reason": "Calibration attempt belongs to another device or capture configuration; run a new physical calibration for this setup"}
            if not attempt["completion_credible"]:
                if not (attempt["reason"] or "").startswith("Operator inspected:") or not isinstance(reason,str) or len(reason.strip()) < 10:
                    return {"status": "blocked", "calibrated": False, "mode": "hardware", "reason": "Transport-only calibration requires a resolved completed attempt and an explicit physical inspection reason (at least 10 characters)"}
                source = "owner-inspection"
            else:
                source = "device-and-owner-inspection"
            evidence = self.journal.db.execute("SELECT * FROM frames WHERE machine_id=? AND job_id=? AND attempt_id=? AND phase='result' AND source='camera' ORDER BY captured_at DESC LIMIT 1",
                (machine_id,attempt["job_id"],attempt_id)).fetchone()
            if not evidence:
                return {"status": "blocked", "calibrated": False, "mode": "hardware", "reason": "Calibration requires a fresh associated result camera frame"}
            captured = datetime.fromisoformat(evidence["captured_at"].replace("Z","+00:00"))
            age = (datetime.now(timezone.utc) - captured).total_seconds()
            if not 0 <= age <= 600 or evidence["captured_at"] < (attempt["started_at"] or attempt["accepted_at"]):
                return {"status": "blocked", "calibrated": False, "mode": "hardware", "reason": "Calibration frame is stale or predates this physical attempt; capture a fresh result"}
            frame_id = evidence["frame_id"]
        calibration_reason = "Simulation calibration fixture inspected" if config["mode"] == "simulation" else "Owner inspected calibration output: " + (reason.strip() if isinstance(reason,str) and reason.strip() else "Successful device completion and fresh result image inspected")
        state.update(calibrated=True, paused=True, ready=False, configured=True, reason=calibration_reason + "; explicitly inspect/clear and resume before production")
        self.journal.save_machine(machine_id, state)
        self.journal.audit(machine_id, attempt_id, "calibrated", canonical({"source":source,"frame_id":frame_id,"reason":calibration_reason}))
        return {"status": "passed", "calibrated": True, "mode": config["mode"], "source": source, "frame_id":frame_id, "reason": state["reason"]}

    def reconcile(self, *, machine_id: str, job_id: str, attempt_id: str, inspected: bool, result: str, reason: str) -> dict:
        self.machine(machine_id)
        if inspected is not True or not isinstance(result, str) or result not in {"completed", "failed"} or not isinstance(reason, str) or not 5 <= len(reason.strip()) <= 1000:
            raise NodeError("operator_resolution", "Reconciliation requires inspection, completed/failed result and a concrete reason", 422)
        with self.journal.transaction():
            row = self.journal.get(attempt_id)
            if not row or row["machine_id"] != machine_id or row["job_id"] != job_id:
                raise NodeError("attempt_binding", "Resolution does not match this execution attempt", 403)
            self.require_stop_settled(machine_id)
            task = self.tasks.get(attempt_id)
            if task and not task.done():
                raise NodeError("attempt_active", "The execution worker is still active; wait for it to settle before inspection can release the machine", 409)
            if row["status"] not in {"uncertain", "failed", "completed"}:
                raise NodeError("attempt_active", "An active worker cannot be resolved by inspection", 409)
            if row["status"] in {"failed", "completed"}:
                if row["status"] == result:
                    return self.get_status(machine_id, job_id, attempt_id)
                raise NodeError("resolution_conflict", "Terminal resolution is already recorded", 409)
            self.journal.db.execute("UPDATE attempts SET status=?, reason=?, completed_at=?, completion_credible=0 WHERE attempt_id=?",
                (result, "Operator inspected: " + reason.strip(), now(), attempt_id))
            self.journal.audit(machine_id, attempt_id, "operator_" + result, reason.strip())
        # Manual resolution frees the execution slot but preserves pause. It is
        # not an automated device completion signal and never prints anything.
        return self.get_status(machine_id, job_id, attempt_id)

    def simulation(self, machine_id: str, outcome: str) -> dict:
        config = self.machine(machine_id)
        if config["mode"] != "simulation":
            raise NodeError("hardware_simulation_forbidden", "Simulation controls cannot affect hardware", 403)
        if not isinstance(outcome, str) or outcome not in {"pass", "fail", "review", "lost_ack"}:
            raise NodeError("simulation_outcome", "Unknown simulation outcome", 422)
        state = self.journal.machine(machine_id)
        state["simulationOutcome"] = outcome
        self.journal.save_machine(machine_id, state)
        return {"machine_id": machine_id, "mode": "simulation", "outcome": outcome}

    async def close(self):
        for task in self.tasks.values():
            if not task.done():
                task.cancel()
        await asyncio.gather(*self.tasks.values(), return_exceptions=True)
        # Retain the journal lock until any already-issued device stop has
        # actually returned; a new process must not overtake a delayed command.
        await asyncio.gather(*(task for _, task in self.stop_tasks.values()), return_exceptions=True)
        for adapter in self.adapters.values():
            if isinstance(adapter, Bambu) and adapter.printer is not None:
                await asyncio.to_thread(adapter.printer.mqtt_stop)
        self.journal.close()
        fcntl.flock(self.process_lock.fileno(), fcntl.LOCK_UN)
        self.process_lock.close()
