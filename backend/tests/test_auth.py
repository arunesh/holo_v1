"""Sign-in and session enforcement: no network (Google is faked), no credentials."""
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api import auth as auth_api
from app.auth import AUTH_PROTOCOL, issue_token, verify_token
from app.config import get_settings
from app.main import app

USER = {"sub": "ada@example.com", "name": "Ada", "provider": "google"}
anonymous = TestClient(app)


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_tokens_round_trip_and_expire():
    token, expires = issue_token(USER, now=1000)
    assert expires == 1000 + get_settings().session_ttl
    assert verify_token(token, now=1001)["sub"] == "ada@example.com"
    assert verify_token(token, now=expires) is None


@pytest.mark.parametrize("mangle", [
    lambda t: t[:-2] + ("AA" if not t.endswith("AA") else "BB"),       # forged signature
    lambda t: "e30" + t[t.index("."):],                                 # swapped claims
    lambda t: t.replace(".", ""),                                       # malformed
    lambda t: "",
])
def test_tampered_tokens_are_rejected(mangle):
    assert verify_token(mangle(issue_token(USER)[0])) is None


def test_api_needs_a_session():
    assert anonymous.get("/api/pods").status_code == 401
    assert anonymous.get("/api/pods", headers=bearer("nonsense")).status_code == 401
    expired, _ = issue_token(USER, now=time.time() - 2 * get_settings().session_ttl)
    assert anonymous.get("/api/pods", headers=bearer(expired)).status_code == 401
    assert anonymous.post("/api/gpt2/forward", json={"text": "hi"}).status_code == 401
    assert anonymous.get("/api/pods", headers=bearer(issue_token(USER)[0])).status_code == 200


def test_health_and_sign_in_config_stay_public(monkeypatch):
    monkeypatch.setattr(get_settings(), "google_client_id", "client-123")
    assert anonymous.get("/api/health").status_code == 200
    assert anonymous.get("/api/auth/config").json() == {"google_client_id": "client-123", "allow_guest": False}


def test_sockets_need_a_session():
    with pytest.raises(WebSocketDisconnect):
        with anonymous.websocket_connect("/ws/session/gpt2"):
            pass
    with pytest.raises(WebSocketDisconnect):
        with anonymous.websocket_connect("/ws/session/gpt2", subprotocols=[AUTH_PROTOCOL, "forged"]):
            pass
    with anonymous.websocket_connect("/ws/session/missing", subprotocols=[AUTH_PROTOCOL, issue_token(USER)[0]]) as ws:
        assert ws.accepted_subprotocol == AUTH_PROTOCOL
        assert ws.receive_json() == {"type": "error", "message": "pod not found"}


def fake_google(monkeypatch, tokeninfo, status=200):
    """Answer Google's tokeninfo/userinfo endpoints locally."""
    def handler(request):
        if request.url.path == "/tokeninfo":
            return httpx.Response(status, json=tokeninfo)
        return httpx.Response(200, json={"name": "Ada Lovelace", "picture": "https://example.com/a.png"})

    real = httpx.AsyncClient
    monkeypatch.setattr(auth_api.httpx, "AsyncClient",
                        lambda **kwargs: real(transport=httpx.MockTransport(handler), **kwargs))
    monkeypatch.setattr(get_settings(), "google_client_id", "client-123")


def test_google_sign_in_issues_a_session(monkeypatch):
    fake_google(monkeypatch, {"aud": "client-123", "email": "ada@example.com", "email_verified": "true"})
    body = anonymous.post("/api/auth/google", json={"access_token": "ya29.valid-token"}).json()
    assert body["user"] == {"sub": "ada@example.com", "email": "ada@example.com", "name": "Ada Lovelace",
                            "picture": "https://example.com/a.png", "provider": "google"}
    assert verify_token(body["token"])["email"] == "ada@example.com"
    assert anonymous.get("/api/pods", headers=bearer(body["token"])).status_code == 200


@pytest.mark.parametrize("tokeninfo, status", [
    ({"aud": "another-app", "email": "ada@example.com", "email_verified": "true"}, 200),
    ({"aud": "client-123", "email": "ada@example.com", "email_verified": "false"}, 200),
    ({"aud": "client-123", "email_verified": "true"}, 200),
    ({"error": "invalid_token"}, 400),
])
def test_google_tokens_for_other_apps_or_unverified_emails_are_rejected(monkeypatch, tokeninfo, status):
    fake_google(monkeypatch, tokeninfo, status)
    assert anonymous.post("/api/auth/google", json={"access_token": "ya29.some-token"}).status_code == 401


def test_google_sign_in_needs_a_client_id(monkeypatch):
    monkeypatch.setattr(get_settings(), "google_client_id", "")
    assert anonymous.post("/api/auth/google", json={"access_token": "ya29.some-token"}).status_code == 503


def test_guest_sessions_only_when_allowed(monkeypatch):
    assert anonymous.post("/api/auth/guest").status_code == 403
    monkeypatch.setattr(get_settings(), "allow_guest", True)
    token = anonymous.post("/api/auth/guest").json()["token"]
    assert anonymous.get("/api/pods", headers=bearer(token)).status_code == 200
    # Turning guests off ends existing guest sessions at their next refresh.
    monkeypatch.setattr(get_settings(), "allow_guest", False)
    assert anonymous.post("/api/auth/refresh", headers=bearer(token)).status_code == 401


def test_refresh_extends_a_valid_session():
    token, expires = issue_token(USER, now=time.time() - 60)
    body = anonymous.post("/api/auth/refresh", headers=bearer(token)).json()
    assert body["expires_at"] > expires
    assert verify_token(body["token"])["sub"] == "ada@example.com"
    assert anonymous.post("/api/auth/refresh").status_code == 401
