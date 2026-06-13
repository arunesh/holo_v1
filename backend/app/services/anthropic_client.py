"""Claude orchestration: turn a spoken/typed query into narration + scene commands.

Claude is given the pod context, the live scene snapshot, and the affordance library
as a single structured `present_scene` tool. It replies with what to say and an ordered
list of affordance commands, which the frontend executes through the same engine that
plays authored narration.
"""

from __future__ import annotations

import json
import re
from typing import Any

from ..config import get_settings
from ..schemas.pod import DEFAULT_AFFORDANCES, Pod

PRESENT_TOOL = {
    "name": "present_scene",
    "description": "Narrate to the learner and drive the interactive 3D model. Always call this exactly once.",
    "input_schema": {
        "type": "object",
        "properties": {
            "narration": {
                "type": "string",
                "description": "What to say aloud to the learner. 1-4 short spoken sentences, no markdown.",
            },
            "commands": {
                "type": "array",
                "description": "Ordered affordance commands to drive the scene.",
                "items": {
                    "type": "object",
                    "properties": {
                        "op": {
                            "type": "string",
                            "enum": [a.op for a in DEFAULT_AFFORDANCES],
                        },
                        "args": {"type": "object"},
                    },
                    "required": ["op"],
                },
            },
        },
        "required": ["narration", "commands"],
    },
}


def _affordance_doc() -> str:
    lines = []
    for a in DEFAULT_AFFORDANCES:
        args = "; ".join(f"{k}: {v}" for k, v in a.args.items())
        lines.append(f"- {a.op}({args}) — {a.description}")
    return "\n".join(lines)


def _system_prompt(pod: Pod, scene: dict[str, Any]) -> str:
    p = pod.scene.params
    return f"""You are the AI tutor inside Holodeck, an interactive 3D explainer.
The current pod is "{pod.title}" — {pod.description}
The 3D scene shows a {p.model_name} transformer: {p.n_layers} blocks, each with \
{p.n_heads} attention heads and an MLP, plus token embeddings and an unembedding head.

You teach like 3Blue1Brown: warm, concrete, intuitive. You DRIVE the scene as you talk —
move the camera, highlight blocks/heads, reveal attention arcs and activation values.

Affordance commands you can emit (use 0-based indices):
{_affordance_doc()}

Guidelines:
- Always answer by calling present_scene exactly once.
- Keep narration short and spoken (it will be read aloud by TTS). No lists, no markdown.
- Sequence commands so the camera arrives before you reference what's there.
- If the user asks to run/feed/try input text, include a runInference command with that text.
- To show concrete numbers use showActivations with mode 'values' and setPrecision.
- Block indices are 0..{p.n_layers - 1}; head indices are 0..{p.n_heads - 1}.

Current scene state (what the learner is looking at right now):
{json.dumps(scene, indent=2)}
"""


def respond(pod: Pod, query: str, scene: dict[str, Any]) -> dict[str, Any]:
    """Return {"narration": str, "commands": [{op, args}]}."""
    settings = get_settings()
    if not settings.has_anthropic:
        return _fallback(pod, query)

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        msg = client.messages.create(
            model=settings.claude_model,
            max_tokens=1024,
            system=_system_prompt(pod, scene),
            tools=[PRESENT_TOOL],
            tool_choice={"type": "tool", "name": "present_scene"},
            messages=[{"role": "user", "content": query}],
        )
        for block in msg.content:
            if block.type == "tool_use" and block.name == "present_scene":
                data = block.input
                return {
                    "narration": str(data.get("narration", "")),
                    "commands": _clean_commands(data.get("commands", [])),
                }
        return _fallback(pod, query)
    except Exception as e:  # network / auth / model errors → graceful heuristic
        fb = _fallback(pod, query)
        fb["narration"] = fb["narration"] + f" (AI offline: {type(e).__name__})"
        return fb


def _clean_commands(commands: list[Any]) -> list[dict[str, Any]]:
    valid_ops = {a.op for a in DEFAULT_AFFORDANCES}
    out = []
    for c in commands:
        if isinstance(c, dict) and c.get("op") in valid_ops:
            out.append({"op": c["op"], "args": c.get("args", {}) or {}})
    return out


# ---- Heuristic fallback so the experience works even without an API key ----
def _fallback(pod: Pod, query: str) -> dict[str, Any]:
    q = query.lower()
    commands: list[dict[str, Any]] = []
    n_layers = pod.scene.params.n_layers

    block_match = re.search(r"(?:layer|block)\s*(\d+)", q)
    head_match = re.search(r"head\s*(\d+)", q)
    run_match = re.search(r"(?:run|feed|try|input|on)[:\s]+(.+)$", query, re.IGNORECASE)

    if run_match and ("run" in q or "feed" in q or "input" in q or "try" in q):
        commands.append({"op": "runInference", "args": {"text": run_match.group(1).strip()}})
        narration = f"Running {pod.scene.params.model_name} on your text and lighting up the activations."
    elif block_match:
        b = max(0, min(n_layers - 1, int(block_match.group(1))))
        if "attention" in q or head_match:
            h = int(head_match.group(1)) if head_match else None
            commands.append({"op": "focusOn", "args": {"target": "attention", "index": b}})
            commands.append({"op": "showAttention", "args": {"block": b, "head": h}})
            narration = f"Here's the attention pattern in block {b}."
        elif "mlp" in q:
            commands.append({"op": "focusOn", "args": {"target": "mlp", "index": b}})
            narration = f"This is the MLP of block {b}."
        elif "activation" in q or "value" in q:
            commands.append({"op": "focusOn", "args": {"target": "block", "index": b}})
            commands.append({"op": "showActivations", "args": {"index": b, "mode": "values"}})
            narration = f"Showing the residual activations flowing through block {b}."
        else:
            commands.append({"op": "focusOn", "args": {"target": "block", "index": b}})
            narration = f"Zooming into block {b}."
    elif "attention" in q:
        commands.append({"op": "focusOn", "args": {"target": "attention", "index": 0}})
        commands.append({"op": "showAttention", "args": {"block": 0}})
        narration = "Attention lets each token gather information from the others. Here it is in the first block."
    elif "overview" in q or "reset" in q or "whole" in q:
        commands.append({"op": "reset", "args": {}})
        narration = "Here's the whole model from end to end."
    else:
        commands.append({"op": "focusOn", "args": {"target": "overview"}})
        narration = "Tokens become embeddings, flow through the transformer blocks, and become next-token predictions. Ask me to zoom into any block, head, or activation."

    return {"narration": narration, "commands": commands}
