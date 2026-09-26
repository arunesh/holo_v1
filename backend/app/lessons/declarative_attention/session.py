"""One lesson-tutor query per socket. Disconnect cancels queued or in-flight HTTP work."""
import asyncio
from contextlib import suppress
from ...config import get_settings
from .tutor import respond_async

_capacity = asyncio.Semaphore(2)


async def answer(pod, query, scene, respond=respond_async):
    async with _capacity:
        return await respond(pod, query, scene, get_settings())


async def wait_for_disconnect(ws):
    """Ignore stray frames (keepalives, double submits); only a disconnect cancels."""
    while (await ws.receive())["type"] != "websocket.disconnect":
        pass


async def memory_session(ws, pod, respond=respond_async):
    message = await ws.receive_json()
    query = message.get("query", "")
    if not isinstance(query, str) or not query.strip() or len(query) > 4000:
        await ws.send_json({"type": "error", "message": "Invalid question"})
        await ws.close()
        return
    await ws.send_json({"type": "thinking"})
    work = asyncio.create_task(answer(pod, query.strip(), message.get("scene", {}), respond))
    disconnected = asyncio.create_task(wait_for_disconnect(ws))
    try:
        done, _ = await asyncio.wait({work, disconnected}, return_when=asyncio.FIRST_COMPLETED)
        if disconnected in done:
            return
        result = work.result()
        await ws.send_json({"type": "narration", "text": result["narration"]})
        await ws.send_json({"type": "commands", "commands": result["commands"]})
        await ws.send_json({"type": "done"})
        await ws.close()
    finally:
        for task in (work, disconnected):
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
