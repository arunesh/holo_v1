from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter
from pydantic import BaseModel

from ..services import gpt2_model

router = APIRouter(prefix="/api", tags=["inference"])

# GPT-2 forward passes are CPU-bound and blocking; run them off the event loop.
_pool = ThreadPoolExecutor(max_workers=1)


class ForwardRequest(BaseModel):
    text: str
    pod_id: str = "gpt2"


@router.post("/gpt2/forward")
async def gpt2_forward(req: ForwardRequest):
    import asyncio

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, gpt2_model.forward, req.text)
