"""Explicit FlashAttention contracts. Mirrors frontend/src/lessons/flash-attention/types.ts."""
from math import ceil
from typing import Annotated, Literal
from pydantic import Field, model_validator
from ..declarative_attention.schema import StrictModel


def block_sizes(seq_len: int, head_dim: int, sram_size: int):
    """Algorithm 1 line 1: B_c = ceil(M / 4d), B_r = min(B_c, d). Returns (B_r, B_c, T_r, T_c)."""
    bc = ceil(sram_size / (4 * head_dim))
    br = min(bc, head_dim)
    return br, bc, ceil(seq_len / br), ceil(seq_len / bc)


class FlashConfig(StrictModel):
    seq_len: int = Field(ge=4, le=64)
    head_dim: int = Field(ge=1, le=8)
    sram_size: int = Field(ge=4, le=4096)
    seed: int = Field(ge=0, le=2**31 - 1)
    block_mask: list[list[Literal[0, 1]]] = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def tiles_fit(self):
        br, bc, tr, tc = block_sizes(self.seq_len, self.head_dim, self.sram_size)
        if self.seq_len % br or self.seq_len % bc:
            raise ValueError(f"seq_len must split evenly into {br}-row query and {bc}-row key blocks")
        if tr * tc > 64:
            raise ValueError("Too many tiles to show; use a larger sram_size or a shorter seq_len")
        if len(self.block_mask) != tr or any(len(row) != tc for row in self.block_mask):
            raise ValueError(f"block_mask must be {tr} x {tc}")
        if any(not any(row) for row in self.block_mask):
            raise ValueError("Every query block needs at least one nonzero tile, or its softmax is empty")
        return self


class FlashScene(StrictModel):
    type: Literal["flash-tiles"]
    params: FlashConfig


class StageArgs(StrictModel):
    stage: Literal["hardware", "inputs"]


class ModeArgs(StrictModel):
    mode: Literal["standard", "flash", "block-sparse"]


class RunArgs(StrictModel):
    until: Literal["tile", "pass", "end"]


class NoArgs(StrictModel):
    pass


class StageCommand(StrictModel):
    op: Literal["faStage"]
    args: StageArgs


class ModeCommand(StrictModel):
    op: Literal["faMode"]
    args: ModeArgs


class StepCommand(StrictModel):
    op: Literal["faStep"]
    args: NoArgs = Field(default_factory=NoArgs)


class RunCommand(StrictModel):
    op: Literal["faRun"]
    args: RunArgs


FACommand = Annotated[
    StageCommand | ModeCommand | StepCommand | RunCommand,
    Field(discriminator="op"),
]

SpotlightTarget = Annotated[
    str,
    Field(pattern=r"^(gpu|hbm|sram|bus|q|k|v|o|stats|scores|tile|meter)$"),
]


class NarrationCue(StrictModel):
    text: str = Field(min_length=1, max_length=200)
    spotlight: list[SpotlightTarget] = Field(default_factory=list, max_length=6)


class FABeat(StrictModel):
    id: str
    title: str
    text: str
    cues: list[NarrationCue] | None = None
    commands: list[FACommand]
    hold_ms: int = Field(default=900, ge=0, le=10000)
    checkpoint: Literal["materialize", "rescale", "sparse"] | None = None
    emphasis: bool = False

    @model_validator(mode="after")
    def text_matches_cues(self):
        if self.cues and self.text != " ".join(cue.text for cue in self.cues):
            raise ValueError(f"Beat {self.id}: text must equal its cue texts joined by spaces")
        return self


class FAResult(StrictModel):
    narration: str = Field(max_length=1200)
    commands: list[FACommand] = Field(max_length=6)
