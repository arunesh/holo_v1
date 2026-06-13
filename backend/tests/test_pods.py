"""Schema + API smoke tests (no network, no model download)."""

from fastapi.testclient import TestClient

from app.main import app
from app.schemas.pod import DEFAULT_AFFORDANCES, Pod
from app.services import pod_store
from app.services.anthropic_client import _clean_commands, _fallback

client = TestClient(app)


def test_gpt2_pod_validates():
    pod = pod_store.load_pod("gpt2")
    assert isinstance(pod, Pod)
    assert pod.scene.params.n_layers == 12
    assert len(pod.narration) >= 8
    valid_ops = {a.op for a in DEFAULT_AFFORDANCES}
    for beat in pod.narration:
        for cmd in beat.commands:
            assert cmd.op in valid_ops


def test_list_pods_endpoint():
    r = client.get("/api/pods")
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()]
    assert "gpt2" in ids


def test_get_pod_endpoint():
    r = client.get("/api/pods/gpt2")
    assert r.status_code == 200
    assert r.json()["id"] == "gpt2"
    assert client.get("/api/pods/does-not-exist").status_code == 404


def test_voice_status():
    r = client.get("/api/voice/status")
    assert r.status_code == 200
    assert set(r.json().keys()) == {"tts", "stt"}


def test_fallback_orchestration_is_valid():
    pod = pod_store.load_pod("gpt2")
    valid_ops = {a.op for a in DEFAULT_AFFORDANCES}
    for q in ["zoom into layer 5 attention", "show head 3 in block 2", "run the model on: hello world", "overview"]:
        out = _fallback(pod, q)
        assert out["narration"]
        for c in out["commands"]:
            assert c["op"] in valid_ops


def test_clean_commands_filters_invalid():
    cmds = [{"op": "focusOn", "args": {}}, {"op": "bogus", "args": {}}, {"nope": 1}]
    assert _clean_commands(cmds) == [{"op": "focusOn", "args": {}}]
