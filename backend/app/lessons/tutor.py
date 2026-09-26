"""Shared Claude plumbing for lesson tutors: one forced tool call, strict validation, safe fallback."""
from functools import lru_cache
from .declarative_attention.schema import ConversationTurn


def inline_schema(schema):
    """Inline our local Pydantic definitions for the narrow Messages bridge."""
    definitions = schema.get("$defs", {})

    def expand(value):
        if isinstance(value, list):
            return [expand(item) for item in value]
        if not isinstance(value, dict):
            return value
        if "$ref" in value:
            return expand(definitions[value["$ref"].split("/")[-1]])
        return {key: expand(item) for key, item in value.items() if key not in ("$defs", "discriminator")}

    return expand(schema)


def present_tool(description, result_model):
    return {"name": "present_scene", "description": description,
            "input_schema": inline_schema(result_model.model_json_schema())}


def offline_result():
    return {"narration": "The live tutor is unavailable right now. Your scene is unchanged; the guided lesson and controls still work.", "commands": []}


def request_arguments(system_prompt, tool, pod, query, scene, settings):
    state = dict(scene) if isinstance(scene, dict) else {}
    raw_history = state.pop("conversation", [])
    history = [ConversationTurn.model_validate(turn).model_dump() for turn in raw_history[-12:]] if isinstance(raw_history, list) else []
    return dict(model=settings.claude_model, max_tokens=1024, system=system_prompt(pod, state),
                messages=history + [{"role": "user", "content": query[:4000]}],
                tools=[tool], tool_choice={"type": "tool", "name": tool["name"]})


@lru_cache(maxsize=1)
def _client(api_key):
    """One pooled client per process (uvicorn runs a single event loop), not one per question."""
    import anthropic
    return anthropic.AsyncAnthropic(api_key=api_key, max_retries=0, timeout=95)


async def respond_with_tool(pod, query, scene, settings, *, system_prompt, tool, validate):
    """Cancelling the awaiting task aborts the upstream HTTP request."""
    if not settings.has_anthropic:
        return offline_result()
    try:
        message = await _client(settings.anthropic_api_key).messages.create(
            **request_arguments(system_prompt, tool, pod, query, scene, settings))
        for block in message.content:
            if block.type == "tool_use" and block.name == tool["name"]:
                return validate(block.input, pod)
        raise ValueError("Missing tool result")
    except Exception:
        # asyncio.CancelledError is a BaseException: never swallow cancellation.
        # Never read provider exception bodies into speech or expose credentials.
        return offline_result()
