"""Shared HMAC authorization and strict artifact-store URL validation."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import time
from urllib.parse import parse_qs, unquote, urlsplit


class NodeError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def sign_token(payload: dict, key: str) -> str:
    encoded = base64.urlsafe_b64encode(canonical(payload).encode()).decode().rstrip("=")
    return encoded + "." + hmac.new(key.encode(), encoded.encode(), hashlib.sha256).hexdigest()


def verify_token(token: str, key: str, *, scope: str, expected: dict) -> dict:
    try:
        if len(token) > 32768:
            raise ValueError()
        encoded, signature = token.split(".")
        wanted = hmac.new(key.encode(), encoded.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, wanted):
            raise ValueError()
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        if not isinstance(payload, dict):
            raise ValueError()
        expiration = payload.get("expires_at")
        if not isinstance(expiration, (int, float)) or not math.isfinite(expiration) or expiration <= time.time():
            raise NodeError("expired_token", "Authorization has expired", 403)
        if payload.get("scope") != scope:
            raise NodeError("wrong_scope", "Authorization does not allow this tool", 403)
        for name, value in expected.items():
            if name not in payload or canonical(payload[name]) != canonical(value):
                raise NodeError("token_binding", "Authorization does not match " + name, 403)
        return payload
    except NodeError:
        raise
    except (ValueError, TypeError, KeyError, UnicodeDecodeError):
        raise NodeError("invalid_token", "Invalid signed authorization", 403) from None


def require_expected_mode(payload: dict, configured_mode: str) -> str:
    expected_mode = payload.get("expected_mode")
    if not isinstance(expected_mode, str) or expected_mode not in {"simulation", "hardware"} or expected_mode != configured_mode:
        raise NodeError("mode_binding", "Authorization does not match the configured machine mode", 403)
    return expected_mode


def validate_artifact_url(url: str, origin: str) -> None:
    try:
        candidate, allowed = urlsplit(url), urlsplit(origin)
        if candidate.scheme not in {"http", "https"} or candidate.username or candidate.password or candidate.fragment:
            raise ValueError()
        if (candidate.scheme, candidate.hostname, candidate.port) != (allowed.scheme, allowed.hostname, allowed.port):
            raise ValueError()
        prefix = allowed.path.rstrip("/") + "/"
        path = candidate.path
        for _ in range(4):
            decoded = unquote(path)
            if decoded == path:
                break
            path = decoded
        if "%" in path or not path.startswith(prefix) or any(part in {".", ".."} for part in path.split("/")) or "\\" in path:
            raise ValueError()
        query = parse_qs(candidate.query)
        if not query.get("sig", [""])[0] or int(query.get("expires", ["0"])[0]) <= time.time():
            raise ValueError()
    except (ValueError, TypeError):
        raise NodeError("artifact_origin", "Artifact must use an unexpired signed URL at the configured asset store", 403) from None
