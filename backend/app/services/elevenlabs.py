"""ElevenLabs TTS/STT proxy. Returns None when no key is configured so the
frontend can fall back to the browser Web Speech API."""

from __future__ import annotations

import logging

import httpx

from ..config import get_settings

BASE = "https://api.elevenlabs.io/v1"
log = logging.getLogger("holodeck.voice")


def available() -> dict[str, bool]:
    has = get_settings().has_elevenlabs
    return {"tts": has, "stt": has}


async def text_to_speech(text: str) -> bytes | None:
    s = get_settings()
    if not s.has_elevenlabs:
        return None
    url = f"{BASE}/text-to-speech/{s.elevenlabs_voice_id}"
    headers = {"xi-api-key": s.elevenlabs_api_key, "accept": "audio/mpeg"}
    body = {
        "text": text,
        "model_id": s.elevenlabs_tts_model,
        "voice_settings": {"stability": 0.4, "similarity_boost": 0.7},
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(url, headers=headers, json=body)
            r.raise_for_status()
            return r.content
    except httpx.HTTPError as e:
        # Quota/billing/network problems shouldn't break voice — fall back to browser TTS.
        log.warning("ElevenLabs TTS failed (%s); falling back to Web Speech", e)
        return None


async def speech_to_text(audio: bytes, filename: str = "audio.webm") -> str | None:
    s = get_settings()
    if not s.has_elevenlabs:
        return None
    url = f"{BASE}/speech-to-text"
    headers = {"xi-api-key": s.elevenlabs_api_key}
    files = {"file": (filename, audio, "audio/webm")}
    data = {"model_id": s.elevenlabs_stt_model}
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(url, headers=headers, files=files, data=data)
            r.raise_for_status()
            return r.json().get("text", "")
    except httpx.HTTPError as e:
        log.warning("ElevenLabs STT failed (%s); falling back to Web Speech", e)
        return None
