"""Explicit DA contracts. Existing transformer schemas remain independent."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Chunk(StrictModel):
    id: int = Field(ge=1, le=16)
    label: str
    tokens: int = Field(ge=1, le=1000000)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class MemoryConfig(StrictModel):
    chunks: list[Chunk] = Field(min_length=1, max_length=8)
    scaffold_tokens: int = Field(ge=1)
    kv_heads: int = Field(ge=1, le=128)
    head_dimension: int = Field(ge=1, le=512)
    bytes_per_value: int = Field(ge=1, le=8)

    @model_validator(mode="after")
    def unique_chunks(self):
        if len({chunk.id for chunk in self.chunks}) != len(self.chunks):
            raise ValueError("Chunk IDs must be unique")
        return self


class MemoryScene(StrictModel):
    type: Literal["gpu-memory"]
    params: MemoryConfig


class StageArgs(StrictModel):
    stage: Literal["empty", "weights", "request", "prefill", "decode"]


class ModeArgs(StrictModel):
    mode: Literal["global", "focus", "local"]
    chunks: list[int] = Field(default_factory=list, max_length=8)


class DecodeArgs(StrictModel):
    text: str = Field(max_length=80)


class StageCommand(StrictModel):
    op: Literal["daStage"]
    args: StageArgs


class ModeCommand(StrictModel):
    op: Literal["daMode"]
    args: ModeArgs


class DecodeCommand(StrictModel):
    op: Literal["daDecode"]
    args: DecodeArgs


DACommand = Annotated[StageCommand | ModeCommand | DecodeCommand, Field(discriminator="op")]


def validate_focus_chunks(commands, config: MemoryConfig):
    """Authored beats and tutor replies: focus must name at least one known chunk."""
    valid_ids = {chunk.id for chunk in config.chunks}
    for command in commands:
        if isinstance(command, ModeCommand) and command.args.mode == "focus":
            if not command.args.chunks or not set(command.args.chunks) <= valid_ids:
                raise ValueError("Focus requires valid chunk IDs")


SpotlightTarget = Annotated[
    str,
    Field(pattern=r"^(gpu|compute|l2|memory|weights|seats|sys|docs|reply|pcie|host|meter|c[1-9][0-9]?)$"),
]


class NarrationCue(StrictModel):
    text: str = Field(min_length=1, max_length=200)
    spotlight: list[SpotlightTarget] = Field(default_factory=list, max_length=6)


class DABeat(StrictModel):
    id: str
    title: str
    text: str
    cues: list[NarrationCue] | None = None
    commands: list[DACommand]
    hold_ms: int = Field(default=900, ge=0, le=10000)
    checkpoint: Literal["read-set", "residency", "local"] | None = None
    emphasis: bool = False

    @model_validator(mode="after")
    def text_matches_cues(self):
        if self.cues and self.text != " ".join(cue.text for cue in self.cues):
            raise ValueError(f"Beat {self.id}: text must equal its cue texts joined by spaces")
        return self


class ConversationTurn(StrictModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class DAResult(StrictModel):
    narration: str = Field(max_length=1200)
    commands: list[DACommand] = Field(max_length=6)
