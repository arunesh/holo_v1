"""FlashAttention contracts: no network, no model loading, no credentials."""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.pod import Pod
from app.lessons.flash_attention.schema import FlashScene, block_sizes
from app.lessons.flash_attention.tutor import PRESENT_TOOL, request_arguments, respond_async, validate_result

PODS = Path(__file__).resolve().parents[1] / "app" / "pods"


@pytest.fixture
def data():
    return json.loads((PODS / "flash-attention.json").read_text())


def test_flash_lesson_loads(data):
    pod = Pod.model_validate(data)
    assert isinstance(pod.scene, FlashScene)
    assert [beat.checkpoint for beat in pod.narration if beat.checkpoint] == ["materialize", "rescale", "sparse"]
    assert pod.narration[-1].emphasis is True


def test_block_sizes_follow_algorithm_1():
    # M = 128 values, d = 4: B_c = ceil(128 / 16) = 8, B_r = min(8, 4) = 4.
    assert block_sizes(32, 4, 128) == (4, 8, 8, 4)
    # Paper scale: d = 64, M = 51,200 fp16 values (100 KB).
    assert block_sizes(1024, 64, 51200)[:2] == (64, 200)


@pytest.mark.parametrize("name", ["gpt2", "declarative-attention", "paged-attention"])
def test_other_lessons_still_load(name):
    assert Pod.model_validate_json((PODS / f"{name}.json").read_text()).id == name


def test_mask_must_match_the_tile_grid(data):
    data["scene"]["params"]["block_mask"] = data["scene"]["params"]["block_mask"][:-1]
    with pytest.raises(ValidationError):
        Pod.model_validate(data)


def test_every_query_block_needs_a_nonzero_tile(data):
    data["scene"]["params"]["block_mask"][0] = [0, 0, 0, 0]
    with pytest.raises(ValidationError):
        Pod.model_validate(data)


def test_mask_values_are_zero_or_one(data):
    data["scene"]["params"]["block_mask"][0][0] = 2
    with pytest.raises(ValidationError):
        Pod.model_validate(data)


def test_tiles_must_divide_the_sequence(data):
    data["scene"]["params"]["seq_len"] = 30
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
    {"op": "paDecode", "args": {}},
    {"op": "daStage", "args": {"stage": "prefill"}},
])
def test_other_lesson_commands_cannot_enter(data, command):
    data["narration"][0]["commands"] = [command]
    with pytest.raises(ValidationError):
        Pod.model_validate(data)


def test_tutor_accepts_valid_commands(data):
    result = validate_result({"narration": "Watch the tile.", "commands": [
        {"op": "faMode", "args": {"mode": "block-sparse"}},
        {"op": "faStep", "args": {}},
        {"op": "faRun", "args": {"until": "pass"}},
    ]}, Pod.model_validate(data))
    assert [command["op"] for command in result["commands"]] == ["faMode", "faStep", "faRun"]


@pytest.mark.parametrize("command", [
    {"op": "faMode", "args": {"mode": "sparse"}},
    {"op": "faRun", "args": {"until": "forever"}},
    {"op": "faStep", "args": {"count": 50}},
    {"op": "faStage", "args": {"stage": "prefill"}},
    {"op": "paAdmit", "args": {"request": "A"}},
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
        {"op": "faStep", "args": {}},
        {"op": "faRun", "args": {"until": "end"}},
    ]})


def test_no_key_keeps_scene_unchanged(data):
    result = asyncio.run(respond_async(Pod.model_validate(data), "step", {}, SimpleNamespace(has_anthropic=False)))
    assert result["commands"] == []
    assert "unavailable" in result["narration"]


def test_tutor_includes_recent_conversation_and_block_sizes(data):
    history = [{"role": "user", "content": "Why is S never written?"}, {"role": "assistant", "content": "It stays in SRAM."}]
    args = request_arguments(Pod.model_validate(data), "And the backward pass?", {"conversation": history},
                             SimpleNamespace(claude_model="test"))
    assert args["messages"][:2] == history
    assert args["messages"][-1]["content"] == "And the backward pass?"
    assert '"conversation"' not in args["system"]
    assert "B_c = ceil(M/4d) = 8, B_r = min(B_c, d) = 4" in args["system"]
    assert "40.3 GB" in args["system"]


def test_socket_uses_the_flash_attention_tutor(data, monkeypatch, client, socket_protocols):
    from app.lessons.flash_attention import tutor

    async def fake_respond(pod, query, scene, settings):
        assert pod.scene.type == "flash-tiles"
        return {"narration": f"You asked: {query}", "commands": [{"op": "faStep", "args": {}}]}

    monkeypatch.setattr(tutor, "respond_async", fake_respond)
    with client.websocket_connect("/ws/session/flash-attention", subprotocols=socket_protocols) as ws:
        ws.send_json({"query": "step", "scene": {}})
        messages = [ws.receive_json() for _ in range(4)]
    assert [m["type"] for m in messages] == ["thinking", "narration", "commands", "done"]
    assert messages[1]["text"] == "You asked: step"


def test_catalogue_lists_the_lesson(client):
    ids = [pod["id"] for pod in client.get("/api/pods").json()]
    assert "flash-attention" in ids
