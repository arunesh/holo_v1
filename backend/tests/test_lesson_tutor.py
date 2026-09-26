"""Shared lesson-tutor plumbing, with a fake Messages client: no network or credentials."""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.lessons import tutor
from app.lessons.declarative_attention import tutor as da_tutor
from app.schemas.pod import Pod

PODS = Path(__file__).resolve().parents[1] / "app" / "pods"
SETTINGS = SimpleNamespace(has_anthropic=True, anthropic_api_key="test-key", claude_model="test")


@pytest.fixture
def pod():
    return Pod.model_validate_json((PODS / "declarative-attention.json").read_text())


def fake_client(monkeypatch, content):
    calls = []

    class Messages:
        async def create(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(content=content)

    monkeypatch.setattr(tutor, "_client", lambda api_key: SimpleNamespace(messages=Messages()))
    return calls


def tool_use(data):
    return SimpleNamespace(type="tool_use", name="present_scene", input=data)


def test_valid_tool_result_is_returned(pod, monkeypatch):
    calls = fake_client(monkeypatch, [tool_use({"narration": "Focus on C3.", "commands": [
        {"op": "daMode", "args": {"mode": "focus", "chunks": [3]}}]})])
    result = asyncio.run(da_tutor.respond_async(pod, "focus C3", {}, SETTINGS))
    assert result["narration"] == "Focus on C3."
    assert calls[0]["tool_choice"] == {"type": "tool", "name": "present_scene"}


@pytest.mark.parametrize("content", [
    [],
    [SimpleNamespace(type="text", text="no tool call")],
    [tool_use({"narration": "bad", "commands": [{"op": "daMode", "args": {"mode": "focus", "chunks": [99]}}]})],
])
def test_missing_or_invalid_tool_result_falls_back(pod, monkeypatch, content):
    fake_client(monkeypatch, content)
    assert asyncio.run(da_tutor.respond_async(pod, "hi", {}, SETTINGS)) == tutor.offline_result()


def test_one_client_is_reused_across_questions(monkeypatch):
    import anthropic
    made = []
    monkeypatch.setattr(anthropic, "AsyncAnthropic", lambda **kwargs: made.append(kwargs) or object())
    tutor._client.cache_clear()
    try:
        assert tutor._client("k") is tutor._client("k")
        assert len(made) == 1
    finally:
        tutor._client.cache_clear()


def test_cancellation_is_not_swallowed(pod, monkeypatch):
    class Messages:
        async def create(self, **kwargs):
            await asyncio.Future()

    monkeypatch.setattr(tutor, "_client", lambda api_key: SimpleNamespace(messages=Messages()))

    async def scenario():
        task = asyncio.create_task(da_tutor.respond_async(pod, "hi", {}, SETTINGS))
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())


def test_tool_schemas_have_no_refs():
    from app.lessons.paged_attention import tutor as pa_tutor
    for tool in (da_tutor.PRESENT_TOOL, pa_tutor.PRESENT_TOOL):
        assert '"$ref"' not in json.dumps(tool["input_schema"])
