import asyncio
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import pod_generator, youtube

router = APIRouter(prefix="/api", tags=["generate"])
_pool = ThreadPoolExecutor(max_workers=1)


class GenerateRequest(BaseModel):
    youtube_url: str


def _run(url: str):
    meta = youtube.fetch_transcript(url)
    pod = pod_generator.generate_pod(meta)
    return pod


@router.post("/generate")
async def generate(req: GenerateRequest):
    loop = asyncio.get_event_loop()
    try:
        pod = await loop.run_in_executor(_pool, _run, req.youtube_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")
    return {"id": pod.id, "title": pod.title, "beats": len(pod.narration)}
