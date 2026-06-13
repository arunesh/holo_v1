from fastapi import APIRouter, UploadFile, File
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel

from ..services import elevenlabs

router = APIRouter(prefix="/api", tags=["voice"])


class TTSRequest(BaseModel):
    text: str


@router.get("/voice/status")
def voice_status():
    return elevenlabs.available()


@router.post("/tts")
async def tts(req: TTSRequest):
    audio = await elevenlabs.text_to_speech(req.text)
    if audio is None:
        # No key configured — signal the client to use browser TTS.
        return Response(status_code=204)
    return Response(content=audio, media_type="audio/mpeg")


@router.post("/stt")
async def stt(audio: UploadFile = File(...)):
    data = await audio.read()
    text = await elevenlabs.speech_to_text(data, audio.filename or "audio.webm")
    if text is None:
        return Response(status_code=204)
    return JSONResponse({"text": text})
