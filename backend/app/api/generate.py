import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, model_validator

from ..services import pod_generator, youtube

router = APIRouter(prefix="/api", tags=["generate"])
_pool = ThreadPoolExecutor(max_workers=1)


class GenerateRequest(BaseModel):
    """Generate a pod from either a YouTube URL (server fetches the transcript) or a
    transcript fetched elsewhere (e.g. scripts/fetch_transcript.py on a non-datacenter
    machine). Supplying `transcript`/`title` skips the server-side YouTube fetch."""

    youtube_url: str | None = None
    title: str | None = None
    transcript: str | None = None
    description: str | None = None
    video_id: str | None = None

    @model_validator(mode="after")
    def _require_source(self):
        if not self.youtube_url and not self.transcript and not self.title:
            raise ValueError("provide youtube_url, or title/transcript")
        return self


def _run(req: GenerateRequest):
    if req.transcript or req.title:
        meta: dict[str, Any] = {
            "title": req.title or "Untitled",
            "description": req.description or "",
            "transcript": req.transcript or "",
            "duration": None,
            "id": req.video_id,
        }
    else:
        meta = youtube.fetch_transcript(req.youtube_url)  # type: ignore[arg-type]
    pod = pod_generator.generate_pod(meta)
    return pod, meta.get("warning")


@router.post("/generate")
async def generate(req: GenerateRequest):
    loop = asyncio.get_event_loop()
    try:
        pod, warning = await loop.run_in_executor(_pool, _run, req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")
    return {"id": pod.id, "title": pod.title, "beats": len(pod.narration), "warning": warning}
