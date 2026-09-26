"""Explicit PagedAttention contracts. Mirrors frontend/src/lessons/paged-attention/types.ts."""
from typing import Annotated, Literal
from pydantic import Field, model_validator
from ..declarative_attention.schema import StrictModel

RequestId = Annotated[str, Field(pattern=r"^[A-Z]$")]
Token = Annotated[str, Field(min_length=1, max_length=24)]


class RequestSpec(StrictModel):
    id: RequestId
    prompt: list[Token] = Field(min_length=1, max_length=64)
    # One scripted output per sample; more than one means parallel sampling.
    outputs: list[list[Token]] = Field(min_length=1, max_length=4)
    max_tokens: int = Field(ge=1, le=128)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")

    @model_validator(mode="after")
    def prompt_fits(self):
        if len(self.prompt) > self.max_tokens:
            raise ValueError(f"Request {self.id}: prompt is longer than max_tokens")
        return self


class ModelSpec(StrictModel):
    name: str
    layers: int = Field(ge=1, le=512)
    hidden_size: int = Field(ge=1, le=65536)
    bytes_per_value: int = Field(ge=1, le=8)


class PagedConfig(StrictModel):
    block_size: int = Field(ge=1, le=16)
    num_blocks: int = Field(ge=1, le=64)
    allocation_order: list[int] = Field(default_factory=list, max_length=64)
    model: ModelSpec
    requests: list[RequestSpec] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def consistent(self):
        if len({spec.id for spec in self.requests}) != len(self.requests):
            raise ValueError("Request IDs must be unique")
        order = self.allocation_order
        if len(set(order)) != len(order) or any(not 0 <= block < self.num_blocks for block in order):
            raise ValueError("allocation_order must list distinct physical blocks")
        return self


class PagedScene(StrictModel):
    type: Literal["paged-kv"]
    params: PagedConfig


class StageArgs(StrictModel):
    stage: Literal["empty", "weights", "pool"]


class ModeArgs(StrictModel):
    mode: Literal["contiguous", "paged"]


class RequestArgs(StrictModel):
    request: RequestId


class NoArgs(StrictModel):
    pass


class StageCommand(StrictModel):
    op: Literal["paStage"]
    args: StageArgs


class ModeCommand(StrictModel):
    op: Literal["paMode"]
    args: ModeArgs


class AdmitCommand(StrictModel):
    op: Literal["paAdmit"]
    args: RequestArgs


class DecodeCommand(StrictModel):
    op: Literal["paDecode"]
    args: NoArgs = Field(default_factory=NoArgs)


class FinishCommand(StrictModel):
    op: Literal["paFinish"]
    args: RequestArgs


PACommand = Annotated[
    StageCommand | ModeCommand | AdmitCommand | DecodeCommand | FinishCommand,
    Field(discriminator="op"),
]


def validate_request_ids(commands, config: PagedConfig):
    """Authored beats and tutor replies may only name requests the pod defines."""
    known = {spec.id for spec in config.requests}
    for command in commands:
        if isinstance(command, (AdmitCommand, FinishCommand)) and command.args.request not in known:
            raise ValueError(f"Unknown request {command.args.request}")


SpotlightTarget = Annotated[
    str,
    Field(pattern=r"^(gpu|compute|l2|memory|weights|pool|pcie|host|queue|tables|swap|meter|r-[A-Z])$"),
]


class NarrationCue(StrictModel):
    text: str = Field(min_length=1, max_length=200)
    spotlight: list[SpotlightTarget] = Field(default_factory=list, max_length=6)


class PABeat(StrictModel):
    id: str
    title: str
    text: str
    cues: list[NarrationCue] | None = None
    commands: list[PACommand]
    hold_ms: int = Field(default=900, ge=0, le=10000)
    checkpoint: Literal["waste", "next-block", "cow"] | None = None
    emphasis: bool = False

    @model_validator(mode="after")
    def text_matches_cues(self):
        if self.cues and self.text != " ".join(cue.text for cue in self.cues):
            raise ValueError(f"Beat {self.id}: text must equal its cue texts joined by spaces")
        return self


class PAResult(StrictModel):
    narration: str = Field(max_length=1200)
    commands: list[PACommand] = Field(max_length=6)
