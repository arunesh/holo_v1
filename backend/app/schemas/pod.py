"""Pydantic models for the Holodeck Pod spec.

A Pod is the unit of content: a parameterized 3D scene, a linear narration track,
and the affordance library (the command vocabulary the scene understands). Both the
hand-authored GPT-2 pod and generator output validate against these models, and the
affordance list is also what we expose to Claude as tools.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

# The fixed command vocabulary. Authored beats and Claude both speak only these ops.
AffordanceOp = Literal[
    "focusOn",
    "highlightBlock",
    "highlightHead",
    "showActivations",
    "hideActivations",
    "showAttention",
    "hideAttention",
    "setPrecision",
    "runInference",
    "annotate",
    "reset",
]


class SceneParams(BaseModel):
    n_layers: int = 12
    n_heads: int = 12
    d_model: int = 768
    d_mlp: int = 3072
    vocab_size: int = 50257
    context: int = 1024
    model_name: str = "gpt2"


class PodScene(BaseModel):
    type: str = "transformer"
    params: SceneParams = Field(default_factory=SceneParams)
    default_input: str = "The quick brown fox"


class Command(BaseModel):
    op: AffordanceOp
    args: dict[str, Any] = Field(default_factory=dict)


class Beat(BaseModel):
    id: str
    text: str
    commands: list[Command] = Field(default_factory=list)


class AffordanceDef(BaseModel):
    op: AffordanceOp
    description: str
    args: dict[str, str] = Field(default_factory=dict)


class Pod(BaseModel):
    id: str
    title: str
    topic: str
    description: str
    scene: PodScene = Field(default_factory=PodScene)
    narration: list[Beat] = Field(default_factory=list)
    affordances: list[AffordanceDef] = Field(default_factory=list)


class PodSummary(BaseModel):
    id: str
    title: str
    topic: str
    description: str


# The canonical affordance library, shared by every transformer pod. This is the
# single description used for (a) the pod's `affordances` field and (b) Claude tools.
DEFAULT_AFFORDANCES: list[AffordanceDef] = [
    AffordanceDef(
        op="focusOn",
        description="Move the camera to frame a part of the model.",
        args={
            "target": "one of: overview, embeddings, block, attention, mlp, head, unembed, token",
            "index": "block index (0-based) when target is block/attention/mlp/head",
            "head": "attention head index when target is head",
            "tokenIndex": "token index when target is token",
        },
    ),
    AffordanceDef(
        op="highlightBlock",
        description="Highlight a transformer block by index.",
        args={"index": "block index (0-based)"},
    ),
    AffordanceDef(
        op="highlightHead",
        description="Highlight and focus a specific attention head in a block.",
        args={"block": "block index", "head": "head index"},
    ),
    AffordanceDef(
        op="showAttention",
        description="Draw the attention pattern (token-to-token arcs) for a block. Omit head to average over all heads.",
        args={"block": "block index", "head": "optional head index"},
    ),
    AffordanceDef(op="hideAttention", description="Hide attention arcs.", args={}),
    AffordanceDef(
        op="showActivations",
        description="Show residual-stream activations at a block as a heatmap; mode 'values' also prints numbers.",
        args={"index": "block index", "mode": "color or values"},
    ),
    AffordanceDef(op="hideActivations", description="Hide the activation heatmap.", args={}),
    AffordanceDef(
        op="setPrecision",
        description="Set decimal places shown for numeric values.",
        args={"decimals": "integer 0-6"},
    ),
    AffordanceDef(
        op="runInference",
        description="Run the real model forward pass on input text and light up activations/attention.",
        args={"text": "input text to feed the model"},
    ),
    AffordanceDef(
        op="annotate",
        description="Show a short caption/label on screen.",
        args={"text": "caption text"},
    ),
    AffordanceDef(op="reset", description="Reset the scene to the overview.", args={}),
]
