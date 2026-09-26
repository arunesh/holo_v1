"""Our own short-lived session tokens: issued after sign-in, required on every API call and socket.

A token is base64url(JSON claims) + "." + base64url(HMAC-SHA256), with an `exp` claim.
Browsers can't set headers on WebSockets, so sockets offer [AUTH_PROTOCOL, token] as
subprotocols; that keeps tokens out of URLs and access logs.
"""
import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from functools import lru_cache

from starlette.responses import JSONResponse
from starlette.websockets import WebSocketClose

from .config import get_settings

AUTH_PROTOCOL = "holodeck.auth"
PUBLIC_PATHS = {"/api/health", "/api/auth/config", "/api/auth/google", "/api/auth/guest"}


@lru_cache
def _secret() -> bytes:
    configured = get_settings().session_secret
    if configured:
        return configured.encode()
    logging.getLogger(__name__).warning(
        "HOLODECK_SESSION_SECRET is not set; everyone is signed out when the server restarts.")
    return secrets.token_bytes(32)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload: str) -> str:
    return _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())


def issue_token(user: dict, now: float | None = None) -> tuple[str, int]:
    expires = int(now if now is not None else time.time()) + get_settings().session_ttl
    payload = _b64(json.dumps({**user, "exp": expires}, separators=(",", ":")).encode())
    return f"{payload}.{_sign(payload)}", expires


def verify_token(token: str | None, now: float | None = None) -> dict | None:
    """Claims for a genuine, unexpired token; None for anything else."""
    try:
        payload, signature = token.split(".")
        if not hmac.compare_digest(signature, _sign(payload)):
            return None
        claims = json.loads(_unb64(payload))
        return claims if claims["exp"] > (now if now is not None else time.time()) else None
    except Exception:
        return None


def bearer_token(header: str | None) -> str | None:
    scheme, _, token = (header or "").partition(" ")
    return token.strip() if scheme.lower() == "bearer" else None


class RequireSession:
    """ASGI middleware: /api/* (except sign-in and health) and /ws/* need a valid session."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if scope["type"] == "http" and path.startswith("/api/") and path not in PUBLIC_PATHS \
                and scope.get("method") != "OPTIONS":
            header = dict(scope.get("headers") or []).get(b"authorization", b"").decode("latin-1")
            if not verify_token(bearer_token(header)):
                await JSONResponse({"detail": "Sign in required"}, status_code=401)(scope, receive, send)
                return
        elif scope["type"] == "websocket" and path.startswith("/ws/"):
            protocols = scope.get("subprotocols") or []
            if AUTH_PROTOCOL not in protocols or \
                    not any(verify_token(p) for p in protocols if p != AUTH_PROTOCOL):
                await WebSocketClose(code=4401)(scope, receive, send)
                return
        await self.app(scope, receive, send)
