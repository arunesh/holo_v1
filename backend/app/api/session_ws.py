import asyncio
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..services import anthropic_client, pod_store

router = APIRouter()
_pool = ThreadPoolExecutor(max_workers=2)


@router.websocket("/ws/session/{pod_id}")
async def session(ws: WebSocket, pod_id: str):
    await ws.accept()
    try:
        pod = pod_store.load_pod(pod_id)
    except FileNotFoundError:
        await ws.send_json({"type": "error", "message": "pod not found"})
        await ws.close()
        return

    loop = asyncio.get_event_loop()
    try:
        if pod.scene.type == "gpu-memory":
            from ..lessons.declarative_attention.session import memory_session
            await memory_session(ws, pod)
            return
        if pod.scene.type == "paged-kv":
            from ..lessons.declarative_attention.session import memory_session
            from ..lessons.paged_attention.tutor import respond_async
            await memory_session(ws, pod, respond_async)
            return
        while True:
            msg = await ws.receive_json()
            query = (msg.get("query") or "").strip()
            scene = msg.get("scene") or {}
            if not query:
                continue

            await ws.send_json({"type": "thinking"})
            # Claude SDK is sync + the GPT-2 fallback is CPU work — run off-loop.
            result = await loop.run_in_executor(
                _pool, anthropic_client.respond, pod, query, scene
            )
            if result.get("narration"):
                await ws.send_json({"type": "narration", "text": result["narration"]})
            if result.get("commands"):
                await ws.send_json({"type": "commands", "commands": result["commands"]})
            await ws.send_json({"type": "done"})
    except WebSocketDisconnect:
        return
    except Exception:
        try:
            await ws.send_json({"type": "error", "message": "Session unavailable. Please try again."})
        except Exception:
            pass
