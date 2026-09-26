"""PagedAttention contracts: no network, no model loading, no credentials."""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.pod import Pod
from app.lessons.paged_attention.schema import PagedScene
from app.lessons.paged_attention.tutor import PRESENT_TOOL, request_arguments, respond_async, validate_result

PODS = Path(__file__).resolve().parents[1] / "app" / "pods"


@pytest.fixture
def data():
    return json.loads((PODS / "paged-attention.json").read_text())


def test_paged_lesson_loads(data):
    pod = Pod.model_validate(data)
    assert isinstance(pod.scene, PagedScene)
    assert [spec.id for spec in pod.scene.params.requests] == ["A", "B", "C", "D", "E", "F"]
    assert [beat.checkpoint for beat in pod.narration if beat.checkpoint] == ["waste", "next-block", "cow"]
    assert pod.narration[-1].emphasis is True


@pytest.mark.parametrize("name", ["gpt2", "declarative-attention"])
def test_other_lessons_still_load(name):
    assert Pod.model_validate_json((PODS / f"{name}.json").read_text()).id == name


def test_unknown_request_is_rejected(data):
    data["narration"][3]["commands"][0]["args"]["request"] = "Z"
    with pytest.raises(ValidationError):
        Pod.model_validate(data)


def test_duplicate_request_is_rejected(data):
    data["scene"]["params"]["requests"][1]["id"] = "A"
    with pytest.raises(ValidationError):
        Pod.model_validate(data)


def test_allocation_order_must_name_real_blocks(data):
    data["scene"]["params"]["allocation_order"] = [99]
    with pytest.raises(ValidationError):
        Pod.model_validate(data)


def test_beat_text_must_match_its_spoken_phrases(data):
    data["narration"][0]["text"] = "Something the voice never says."
    with pytest.raises(ValidationError):
        Pod.model_validate(data)


def test_unknown_spotlight_target_is_rejected(data):
    data["narration"][0]["cues"][0]["spotlight"] = ["everything"]
    with pytest.raises(ValidationError):
        Pod.model_validate(data)


@pytest.mark.parametrize("command", [
    {"op": "runInference", "args": {"text": "hello"}},
    {"op": "daStage", "args": {"stage": "prefill"}},
])
def test_other_lesson_commands_cannot_enter(data, command):
    data["narration"][0]["commands"] = [command]
    with pytest.raises(ValidationError):
        Pod.model_validate(data)


def test_tutor_accepts_valid_commands(data):
    result = validate_result({"narration": "Watch D wait.", "commands": [
        {"op": "paMode", "args": {"mode": "contiguous"}},
        {"op": "paAdmit", "args": {"request": "D"}},
        {"op": "paDecode", "args": {}},
    ]}, Pod.model_validate(data))
    assert [command["op"] for command in result["commands"]] == ["paMode", "paAdmit", "paDecode"]


@pytest.mark.parametrize("command", [
    {"op": "paAdmit", "args": {"request": "Z"}},
    {"op": "paFinish", "args": {"request": "a"}},
    {"op": "paMode", "args": {"mode": "compact"}},
    {"op": "paStage", "args": {"stage": "prefill"}},
    {"op": "paDecode", "args": {"steps": 50}},
    {"op": "daMode", "args": {"mode": "focus", "chunks": [3]}},
])
def test_tutor_rejects_invalid_commands(data, command):
    with pytest.raises((ValidationError, ValueError)):
        validate_result({"narration": "test", "commands": [command]}, Pod.model_validate(data))


def test_tool_schema_is_inline_and_bridge_compatible():
    from jsonschema import Draft202012Validator
    schema = PRESENT_TOOL["input_schema"]
    Draft202012Validator.check_schema(schema)
    assert '"$ref"' not in json.dumps(schema)
    Draft202012Validator(schema).validate({"narration": "test", "commands": [
        {"op": "paAdmit", "args": {"request": "A"}},
        {"op": "paDecode", "args": {}},
    ]})


def test_no_key_keeps_scene_unchanged(data):
    result = asyncio.run(respond_async(Pod.model_validate(data), "admit A", {}, SimpleNamespace(has_anthropic=False)))
    assert result["commands"] == []
    assert "unavailable" in result["narration"]


def test_tutor_includes_recent_conversation(data):
    history = [{"role": "user", "content": "Why does D wait?"}, {"role": "assistant", "content": "No 16 free slots in a row."}]
    args = request_arguments(Pod.model_validate(data), "And with paging?", {"conversation": history}, SimpleNamespace(claude_model="test"))
    assert args["messages"][:2] == history
    assert args["messages"][-1]["content"] == "And with paging?"
    assert '"conversation"' not in args["system"]
    assert "96.3%" in args["system"]


def test_socket_uses_the_paged_attention_tutor(data, monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.lessons.paged_attention import tutor

    async def fake_respond(pod, query, scene, settings):
        assert pod.scene.type == "paged-kv"
        return {"narration": f"You asked: {query}", "commands": [{"op": "paDecode", "args": {}}]}

    monkeypatch.setattr(tutor, "respond_async", fake_respond)
    with TestClient(app).websocket_connect("/ws/session/paged-attention") as ws:
        ws.send_json({"query": "step", "scene": {}})
        messages = [ws.receive_json() for _ in range(4)]
    assert [m["type"] for m in messages] == ["thinking", "narration", "commands", "done"]
    assert messages[1]["text"] == "You asked: step"


def test_catalogue_lists_the_lesson():
    from fastapi.testclient import TestClient
    from app.main import app
    ids = [pod["id"] for pod in TestClient(app).get("/api/pods").json()]
    assert "paged-attention" in ids
