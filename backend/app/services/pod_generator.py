"""Generate a Pod spec from a YouTube transcript using Claude.

The output is constrained to the same Pod schema + affordance vocabulary as the
hand-authored GPT-2 pod, so generated pods run in the identical viewer/engine.
"""

from __future__ import annotations

import json
import re
from typing import Any

from ..config import get_settings
from ..schemas.pod import DEFAULT_AFFORDANCES, Pod, PodScene, SceneParams
from . import pod_store

EMIT_TOOL = {
    "name": "emit_pod",
    "description": "Emit a Holodeck pod spec for the video's topic.",
    "input_schema": {
        "type": "object",
        "properties": {
            "id": {"type": "string", "description": "kebab-case id, e.g. 'attention-explained'"},
            "title": {"type": "string"},
            "topic": {"type": "string", "description": "short topic tag, e.g. 'transformers'"},
            "description": {"type": "string", "description": "one-sentence summary"},
            "scene": {
                "type": "object",
                "description": "transformer scene parameters",
                "properties": {
                    "n_layers": {"type": "integer"},
                    "n_heads": {"type": "integer"},
                    "d_model": {"type": "integer"},
                    "model_name": {"type": "string"},
                    "default_input": {"type": "string"},
                },
            },
            "narration": {
                "type": "array",
                "description": "ordered beats; each drives the scene while narrating",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "text": {"type": "string", "description": "spoken narration, 1-3 sentences"},
                        "commands": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "op": {"type": "string", "enum": [a.op for a in DEFAULT_AFFORDANCES]},
                                    "args": {"type": "object"},
                                },
                                "required": ["op"],
                            },
                        },
                    },
                    "required": ["id", "text", "commands"],
                },
            },
        },
        "required": ["id", "title", "topic", "description", "scene", "narration"],
    },
}


def _affordance_doc() -> str:
    return "\n".join(
        f"- {a.op}({'; '.join(f'{k}: {v}' for k, v in a.args.items())}) — {a.description}"
        for a in DEFAULT_AFFORDANCES
    )


def _system_prompt() -> str:
    return f"""You convert a 3Blue1Brown-style explainer transcript into a Holodeck pod:
an interactive 3D transformer scene with a narration track.

The scene renders a transformer: token embeddings -> N blocks (each with attention heads
and an MLP) -> unembedding. Author a narration that walks through the topic using these
affordance commands (0-based indices):
{_affordance_doc()}

Rules:
- Produce 8-16 narration beats covering the video's arc, each with spoken text + commands.
- Open with a focusOn overview beat; use focusOn/highlightBlock/showAttention/showActivations
  to reveal structure as you explain; include at least one runInference beat with sample text.
- Keep narration spoken and concise (it is read aloud). No markdown.
- Pick scene params that match the model discussed (default to GPT-2: 12 layers, 12 heads,
  d_model 768) if unspecified.
- Call emit_pod exactly once."""


def generate_pod(meta: dict[str, Any]) -> Pod:
    settings = get_settings()
    transcript = (meta.get("transcript") or "")[:24000]
    user = (
        f"Video title: {meta.get('title')}\n\n"
        f"Transcript (may be truncated):\n{transcript or '(no transcript available; use the title and your knowledge of the topic)'}"
    )

    if not settings.has_anthropic:
        raise RuntimeError("ANTHROPIC_API_KEY required to generate pods")

    import anthropic

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    msg = client.messages.create(
        model=settings.generator_model,
        max_tokens=8000,
        system=_system_prompt(),
        tools=[EMIT_TOOL],
        tool_choice={"type": "tool", "name": "emit_pod"},
        messages=[{"role": "user", "content": user}],
    )

    payload = None
    for block in msg.content:
        if block.type == "tool_use" and block.name == "emit_pod":
            payload = block.input
            break
    if payload is None:
        raise RuntimeError("model did not emit a pod")

    pod = _to_pod(payload, meta)
    pod_store.save_pod(pod)
    return pod


def _to_pod(payload: dict[str, Any], meta: dict[str, Any]) -> Pod:
    sc = payload.get("scene", {}) or {}
    params = SceneParams(
        n_layers=int(sc.get("n_layers", 12)),
        n_heads=int(sc.get("n_heads", 12)),
        d_model=int(sc.get("d_model", 768)),
        model_name=sc.get("model_name", "gpt2"),
    )
    scene = PodScene(type="transformer", params=params, default_input=sc.get("default_input", "The quick brown fox"))

    pod_id = _slug(payload.get("id") or meta.get("id") or payload.get("title", "pod"))
    return Pod(
        id=pod_id,
        title=payload.get("title", meta.get("title", "Generated Pod")),
        topic=payload.get("topic", "transformers"),
        description=payload.get("description", ""),
        scene=scene,
        narration=payload.get("narration", []),
        affordances=DEFAULT_AFFORDANCES,
    )


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "generated-pod"
