"""Outbound-only producer for the Vercel app. Run with python -m hub.cloud.

The cloud never receives device credentials or a local network address. SQLite
records delivery and progress before either can be acknowledged to the cloud.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import os
import sqlite3
import sys
from pathlib import Path
from urllib.parse import urlparse

import httpx

from node.client import NodeClient, load_manifest, UNREACHED
from node.env import load_dotenv
from node.protocol import JOB_ACCEPT, JOB_PROGRESS, JOB_REJECT, JOB_RESULT

ROOT = Path(__file__).resolve().parents[2]
log = logging.getLogger("cloud_producer")


class Journal:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.executescript("""
          PRAGMA journal_mode=WAL;
          PRAGMA synchronous=FULL;
          CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, result TEXT);
          CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, state TEXT NOT NULL);
        """)

    def begin(self, task_id: str) -> bool:
        with self.db:
            return bool(self.db.execute("INSERT OR IGNORE INTO tasks VALUES (?,NULL)", (task_id,)).rowcount)

    def finish(self, task_id: str, result: dict):
        with self.db:
            self.db.execute("UPDATE tasks SET result=? WHERE id=?", (json.dumps(result), task_id))

    def event(self, type_: str, data: dict):
        with self.db:
            self.db.execute("INSERT INTO events(body) VALUES (?)", (json.dumps({"type": type_, "data": data}),))
            if type_ in {JOB_ACCEPT, JOB_PROGRESS, JOB_REJECT, JOB_RESULT}:
                terminal = type_ in {JOB_REJECT, JOB_RESULT}
                self.db.execute("INSERT OR REPLACE INTO jobs VALUES (?,?)", (data["job_id"], "terminal" if terminal else "active"))

    def recover(self):
        # A restart cannot prove whether the printer consumed the final bytes.
        for (job_id,) in self.db.execute("SELECT id FROM jobs WHERE state='active'").fetchall():
            self.event(JOB_PROGRESS, {"job_id": job_id, "state": "needs_review",
                                     "reason": "Producer restarted during printing; inspect the machine before reconciling."})
            with self.db:
                self.db.execute("UPDATE jobs SET state='review' WHERE id=?", (job_id,))
        for (task_id,) in self.db.execute("SELECT id FROM tasks WHERE result IS NULL").fetchall():
            self.finish(task_id, {"id": task_id, "error": "Producer restarted after delivery; inspect any physical outcome before retrying.", "files": []})


class CloudNode(NodeClient):
    def __init__(self, *args, journal: Journal, **kwargs):
        super().__init__(*args, **kwargs)
        self.journal = journal
        self.probe_error: str | None = None

    async def probe(self):
        try:
            await self.adapter.probe()
            self.probe_error = None
            status = await self.adapter.status()
            clear = getattr(self.adapter, "clear_error", None)
            if clear and status["state"] == "error" and UNREACHED.search(status.get("detail") or ""):
                clear()
        except Exception as error:
            self.probe_error = str(error)
            raise

    async def public_manifest(self):
        result = await super().public_manifest()
        if self.probe_error:
            result.update(status="error", detail=self.probe_error)
        return result

    def send(self, type_: str, data: dict) -> None:
        self.journal.event(type_, data)

    async def _on_cancel(self, data):
        queued = not self.current or self.current.job_id != data.get("job_id")
        await super()._on_cancel(data)
        if queued and data.get("job_id") in self.seen:
            self.send(JOB_RESULT, {"job_id": data["job_id"], "ok": False, "error": "cancelled_before_execution"})


def substitute(value, replacements):
    if isinstance(value, str):
        return replacements.get(value, value)
    if isinstance(value, list):
        return [substitute(x, replacements) for x in value]
    if isinstance(value, dict):
        return {k: substitute(v, replacements) for k, v in value.items()}
    return value


def prepare_local(kind: str, payload: dict, directory: Path) -> dict:
    # Pure preparation code is shared with the local demo; it never drives a device.
    sys.path.insert(0, str(ROOT / "node")) if str(ROOT / "node") not in sys.path else None
    from fabyn_node.image_analysis import analyze_paths
    from fabyn_node.prepare import prepare, _load
    from fabyn_node.producer import handle, digest
    if kind == "inspect":
        from PIL import Image
        image = _load(payload["path"])
        with Image.open(payload["path"]) as source:
            mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[source.format]
        if image.width * image.height > 20_000_000:
            raise ValueError("Image exceeds 20 megapixels")
        return {"width": image.width, "height": image.height, "mime": mime}
    if kind == "analyze":
        return analyze_paths(payload["paths"])
    if kind == "bitmap":
        return prepare(payload["source"], directory / "bitmap.png", **{k: v for k, v in payload.items() if k != "source"})
    if kind != "prepare":
        raise ValueError("Unsupported preparation operation")
    payload = {**payload, "output_dir": str(directory)}
    if "design" in payload:
        design = payload["design"]
        design["canonical_sha256"] = digest({k: v for k, v in design.items() if k != "canonical_sha256"})
    return handle(payload)


class Producer:
    def __init__(self, origin: str, key: str, work: Path, manifests: list[dict]):
        parsed = urlparse(origin)
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}):
            raise ValueError("FABYN_CLOUD_ORIGIN must use HTTPS (HTTP is allowed only for loopback tests)")
        self.origin, self.work = origin.rstrip("/"), work.resolve()
        self.journal = Journal(self.work / "producer.sqlite")
        self.journal.recover()
        self.nodes = {m["machine_id"]: CloudNode(m, self.origin, self.work, max_queue=1, journal=self.journal) for m in manifests}
        self.http = httpx.AsyncClient(base_url=self.origin, headers={"Authorization": f"Bearer {key}"}, timeout=60)
        self.active: dict[str, asyncio.Task] = {}
        self.preparation = asyncio.Semaphore(2)

    async def upload(self, path: Path) -> dict:
        r = await self.http.post("/api/producer/storage", json={})
        r.raise_for_status()
        data = path.read_bytes()
        # Use a separate client: never send the producer bearer credential to object storage.
        async with httpx.AsyncClient(timeout=60) as transfer:
            stored = await transfer.post(r.json()["url"], content=data, headers={"Content-Type": "application/octet-stream"})
            stored.raise_for_status()
        return {"path": str(path), "storageId": stored.json()["storageId"], "sha256": hashlib.sha256(data).hexdigest()}

    async def execute(self, task: dict):
        task_id, kind, payload = task["id"], task["kind"], task["payload"]
        result = {"id": task_id, "files": []}
        try:
            if kind in {"run_job", "check", "cancel", "plate_cleared"}:
                node = self.nodes[payload["machine_id"]]
                if kind == "run_job":
                    # begin() committed before _on_offer can queue a physical print.
                    await node._on_offer(payload)
                    result["result"] = {"delivered": True}
                elif kind == "cancel":
                    await node._on_cancel(payload)
                    result["result"] = {"cancelled": True}
                elif kind == "plate_cleared":
                    await node._on_plate_cleared()
                    result["result"] = {"cleared": True}
                else:
                    async with node._machine:
                        await node.probe()
                    result["result"] = {"ok": True, "detail": "Printer answered."}
            else:
                async with self.preparation:
                    directory = self.work / "tasks" / task_id
                    directory.mkdir(parents=True, exist_ok=True)
                    replacements = {}
                    async with httpx.AsyncClient(timeout=60) as transfer:
                        for index, file in enumerate(task.get("files", [])):
                            response = await transfer.get(file["url"])
                            response.raise_for_status()
                            if hashlib.sha256(response.content).hexdigest() != file["sha256"]:
                                raise ValueError("Input checksum mismatch")
                            path = directory / f"input_{index}"
                            path.write_bytes(response.content)
                            replacements[file["path"]] = str(path)
                    prepared = await asyncio.to_thread(prepare_local, kind, substitute(payload, replacements), directory)
                    outputs: set[str] = set()
                    def scan(v):
                        if isinstance(v, dict):
                            for k, x in v.items():
                                if k == "path" and isinstance(x, str):
                                    outputs.add(x)
                                else:
                                    scan(x)
                        elif isinstance(v, list):
                            for x in v:
                                scan(x)
                    scan(prepared)
                    for path in outputs:
                        local = Path(path).resolve()
                        if not local.is_relative_to(directory):
                            raise ValueError("Preparation output escaped its task directory")
                        result["files"].append(await self.upload(local))
                    result["result"] = prepared
        except Exception as error:
            log.warning("Task %s failed: %s", task_id, error)
            result["error"] = str(error)[:1000]
        self.journal.finish(task_id, result)

    async def poll(self):
        events = self.journal.db.execute("SELECT id,body FROM events ORDER BY id LIMIT 100").fetchall()
        results = self.journal.db.execute("SELECT id,result FROM tasks WHERE result IS NOT NULL AND result != '{}' LIMIT 32").fetchall()
        manifests = [await n.public_manifest() for n in self.nodes.values()]
        response = await self.http.post("/api/producer/poll", json={"machines": manifests,
            "events": [json.loads(e[1]) for e in events], "results": [json.loads(r[1]) for r in results]})
        response.raise_for_status()
        # Only clear the exact batch acknowledged by a successful cloud response.
        with self.journal.db:
            self.journal.db.executemany("DELETE FROM events WHERE id=?", [(e[0],) for e in events])
            # Keep task IDs permanently for physical deduplication, but stop reporting acknowledged results.
            self.journal.db.executemany("UPDATE tasks SET result='{}' WHERE id=?", [(r[0],) for r in results])
        for task in response.json()["tasks"]:
            if task["id"] in self.active:
                continue
            if self.journal.begin(task["id"]):
                work = asyncio.create_task(self.execute(task))
                self.active[task["id"]] = work
                work.add_done_callback(lambda _, tid=task["id"]: self.active.pop(tid, None))

    async def run(self, probe: bool):
        workers = []
        async def probe_loop(node):
            node.probe_error = "Checking the printer connection."
            while True:
                if not node.current and not node._machine.locked():
                    try:
                        async with node._machine:
                            await node.probe()
                    except Exception as error:
                        log.warning("%s probe: %s", node.machine_id, error)
                await asyncio.sleep(60)
        try:
            for node in self.nodes.values():
                if probe:
                    node.probe_error = "Checking the printer connection."
                    workers.append(asyncio.create_task(probe_loop(node)))
                workers.append(asyncio.create_task(node._worker()))
            while True:
                for worker in workers:
                    if worker.done():
                        worker.result()
                        raise RuntimeError("A required printer worker stopped")
                try:
                    await self.poll()
                except (httpx.HTTPError, ValueError, OSError) as error:
                    log.warning("Cloud unavailable; retaining reports for retry: %s", error)
                await asyncio.sleep(3)
        finally:
            for task in [*workers, *self.active.values()]:
                task.cancel()
            await self.http.aclose()


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", default=os.environ.get("FABYN_CLOUD_ORIGIN"))
    parser.add_argument("--work-dir", type=Path, default=Path(".work/cloud"))
    parser.add_argument("--machine", action="append", type=Path)
    parser.add_argument("--dry-run", action="store_true", help="File transports only; never connect to machines")
    parser.add_argument("--plate-cleared", action="store_true", help="Confirm the A1 mini build plate is empty at startup")
    args = parser.parse_args()
    key = os.environ.get("FABYN_PRODUCER_KEY", "")
    if not args.origin or len(key) < 32:
        parser.error("Set FABYN_CLOUD_ORIGIN and FABYN_PRODUCER_KEY (at least 32 characters) in producer-side/.env")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    paths = args.machine or [Path("node/machines") / f"{mid}.json" for mid in ("m_sticker_01", "m_photo_01", "m_fdm_01")]
    manifests = [load_manifest(path) for path in paths]
    for m in manifests:
        if args.dry_run:
            m["adapter"]["transport"] = "file"
            m["simulated"] = True
        if args.plate_cleared and m["process"] == "fdm_print":
            m["adapter"]["plate_clear_at_start"] = True
    producer = Producer(args.origin, key, args.work_dir, manifests)
    try:
        asyncio.run(producer.run(probe=not args.dry_run))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
