"""SQLite journal: acceptance and possible hardware starts survive process death."""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from .security import NodeError, canonical

ACTIVE = ("accepted", "running", "uncertain")


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class Journal:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS attempts (
          attempt_id TEXT PRIMARY KEY, machine_id TEXT NOT NULL, job_id TEXT NOT NULL,
          binding TEXT NOT NULL, status TEXT NOT NULL, artifact_path TEXT, scope TEXT NOT NULL DEFAULT 'dispatch',
          configuration_binding TEXT,
          outcome TEXT NOT NULL DEFAULT 'pass', completion_credible INTEGER NOT NULL DEFAULT 0,
          accepted_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, reason TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS one_attempt_per_job ON attempts(machine_id,job_id);
        CREATE UNIQUE INDEX IF NOT EXISTS one_active_per_machine ON attempts(machine_id)
          WHERE status IN ('accepted','running','uncertain');
        CREATE TABLE IF NOT EXISTS machine_state (machine_id TEXT PRIMARY KEY, state TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS cancelled_attempts (
          attempt_id TEXT PRIMARY KEY, machine_id TEXT NOT NULL, job_id TEXT NOT NULL,
          binding TEXT NOT NULL, target_scope TEXT NOT NULL, expected_mode TEXT NOT NULL, cancelled_at TEXT NOT NULL,
          UNIQUE(machine_id,job_id)
        );
        CREATE TABLE IF NOT EXISTS frames (frame_id TEXT PRIMARY KEY, machine_id TEXT NOT NULL,
          job_id TEXT NOT NULL, attempt_id TEXT NOT NULL, phase TEXT NOT NULL, source TEXT NOT NULL,
          captured_at TEXT NOT NULL, metadata TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL,
          machine_id TEXT NOT NULL, attempt_id TEXT, event TEXT NOT NULL, reason TEXT);
        """)
        columns = {row[1] for row in self.db.execute("PRAGMA table_info(attempts)")}
        if "scope" not in columns:
            self.db.execute("ALTER TABLE attempts ADD COLUMN scope TEXT NOT NULL DEFAULT 'dispatch'")
        if "configuration_binding" not in columns:
            self.db.execute("ALTER TABLE attempts ADD COLUMN configuration_binding TEXT")
        with self.transaction():
            rows = self.db.execute("SELECT * FROM attempts WHERE status IN ('accepted','running')").fetchall()
            for row in rows:
                status = "uncertain" if row["status"] == "running" else "failed"
                reason = "Node restarted after possible physical start; inspect and reconcile without reprinting" if status == "uncertain" else "Node restarted before physical start; no side effect was begun"
                self.db.execute("UPDATE attempts SET status=?,reason=? WHERE attempt_id=?", (status, reason, row["attempt_id"]))
                state = self.machine(row["machine_id"])
                state.update(paused=True, ready=False, reason=reason)
                self.save_machine(row["machine_id"], state)
                self.audit(row["machine_id"], row["attempt_id"], "restart_" + status, reason)

    @contextmanager
    def transaction(self):
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield
                self.db.execute("COMMIT")
            except BaseException:
                # A failed commit must not leave a transaction open. If SQLite
                # committed before an acknowledgement error, retain that durable
                # fact and let an exact retry recover it without another action.
                if self.db.in_transaction:
                    self.db.execute("ROLLBACK")
                raise

    def machine(self, machine_id: str) -> dict:
        with self.lock:
            row = self.db.execute("SELECT state FROM machine_state WHERE machine_id=?", (machine_id,)).fetchone()
            return json.loads(row[0]) if row else {}

    def save_machine(self, machine_id: str, state: dict) -> None:
        with self.lock:
            self.db.execute("INSERT INTO machine_state VALUES (?,?) ON CONFLICT(machine_id) DO UPDATE SET state=excluded.state", (machine_id, canonical(state)))

    def get(self, attempt_id: str) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT * FROM attempts WHERE attempt_id=?", (attempt_id,)).fetchone()
            return dict(row) if row else None

    def active(self, machine_id: str) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT * FROM attempts WHERE machine_id=? AND status IN ('accepted','running','uncertain')", (machine_id,)).fetchone()
            return dict(row) if row else None

    def latest(self, machine_id: str) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT * FROM attempts WHERE machine_id=? ORDER BY accepted_at DESC LIMIT 1", (machine_id,)).fetchone()
            return dict(row) if row else None

    def cancelled(self, request: dict) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT * FROM cancelled_attempts WHERE attempt_id=? OR (machine_id=? AND job_id=?) LIMIT 1",
                (request["attempt_id"], request["machine_id"], request["job_id"])).fetchone()
            return dict(row) if row else None

    def reject_cancelled(self, request: dict, scope: str) -> None:
        row = self.cancelled(request)
        if row:
            binding = canonical({k: request[k] for k in ("machine_id", "job_id", "attempt_id", "artifact_sha256", "parameters")})
            if row["binding"] != binding or row["target_scope"] != scope:
                raise NodeError("attempt_conflict", "Cancelled machine/job identity already binds another authorization", 409)
            raise NodeError("attempt_cancelled", "This authorization was durably cancelled before acceptance; it cannot run", 409)

    @staticmethod
    def cancellation_proof(row: dict) -> dict:
        return {"status": "cancelled_before_acceptance", **json.loads(row["binding"]),
            "target_scope": row["target_scope"], "expected_mode": row["expected_mode"], "cancelled_at": row["cancelled_at"]}

    def cancel_before_acceptance(self, request: dict, target_scope: str, expected_mode: str) -> dict:
        binding = canonical({k: request[k] for k in ("machine_id", "job_id", "attempt_id", "artifact_sha256", "parameters")})
        with self.transaction():
            accepted = self.db.execute("SELECT attempt_id FROM attempts WHERE attempt_id=? OR (machine_id=? AND job_id=?) LIMIT 1",
                (request["attempt_id"], request["machine_id"], request["job_id"])).fetchone()
            if accepted:
                raise NodeError("attempt_already_accepted", "A durable execution attempt already exists; reconcile it instead of cancelling acceptance", 409)
            previous = self.cancelled(request)
            if previous:
                if previous["binding"] != binding or previous["target_scope"] != target_scope or previous["expected_mode"] != expected_mode:
                    raise NodeError("attempt_conflict", "Cancelled machine/job identity already binds another authorization", 409)
                return self.cancellation_proof(previous)
            self.db.execute("INSERT INTO cancelled_attempts VALUES (?,?,?,?,?,?,?)", (request["attempt_id"], request["machine_id"],
                request["job_id"], binding, target_scope, expected_mode, now()))
            self.audit(request["machine_id"], request["attempt_id"], "cancelled_before_acceptance", target_scope)
            proof = self.cancellation_proof(self.cancelled(request))
        return proof

    def accept(self, request: dict, outcome: str, scope: str = "dispatch", configuration_binding: str | None = None) -> tuple[dict, bool]:
        binding = canonical({k: request[k] for k in ("machine_id", "job_id", "attempt_id", "artifact_sha256", "parameters")})
        with self.transaction():
            self.reject_cancelled(request, scope)
            existing = self.get(request["attempt_id"])
            if existing:
                if existing["binding"] != binding or existing["scope"] != scope:
                    raise NodeError("attempt_conflict", "Attempt ID already binds different approved content", 409)
                return existing, False
            if self.active(request["machine_id"]):
                raise NodeError("machine_busy", "Machine has an active or uncertain attempt", 409)
            try:
                self.db.execute("INSERT INTO attempts(attempt_id,machine_id,job_id,binding,status,outcome,accepted_at,scope,configuration_binding) VALUES (?,?,?,?,?,?,?,?,?)",
                    (request["attempt_id"], request["machine_id"], request["job_id"], binding, "accepted", outcome, now(), scope, configuration_binding))
            except sqlite3.IntegrityError:
                raise NodeError("job_already_executed", "Job already has an execution attempt; reconcile that attempt", 409) from None
            self.audit(request["machine_id"], request["attempt_id"], "accepted", "Authorization, policy and artifact hash checked")
        return self.get(request["attempt_id"]), True

    def update(self, attempt_id: str, status: str, *, reason: str | None = None, credible: bool = False, artifact_path: str | None = None) -> None:
        with self.transaction():
            row = self.get(attempt_id)
            if not row:
                raise NodeError("unknown_attempt", "Unknown attempt", 404)
            # A late worker completion cannot overturn an operator stop or uncertainty.
            if row["status"] in {"failed", "uncertain", "completed"} and status != row["status"]:
                return
            stamp = "started_at" if status == "running" else "completed_at"
            self.db.execute(f"UPDATE attempts SET status=?, reason=?, completion_credible=?, artifact_path=COALESCE(?,artifact_path), {stamp}=? WHERE attempt_id=?",
                (status, reason, int(credible), artifact_path, now(), attempt_id))
            self.audit(row["machine_id"], attempt_id, status, reason)
            if status in {"failed", "uncertain", "completed"}:
                state = self.machine(row["machine_id"])
                state.update(paused=True, ready=False, reason=reason or "Owner must remove output, inspect and clear the machine")
                self.save_machine(row["machine_id"], state)

    def audit(self, machine_id: str, attempt_id: str | None, event: str, reason: str | None = None) -> None:
        self.db.execute("INSERT INTO audit(at,machine_id,attempt_id,event,reason) VALUES (?,?,?,?,?)", (now(), machine_id, attempt_id, event, reason))

    def close(self) -> None:
        with self.lock:
            self.db.close()
