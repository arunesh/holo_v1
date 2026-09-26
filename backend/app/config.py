import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

# Load .env from the repo root if present.
ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

PODS_DIR = Path(__file__).resolve().parent / "pods"


class Settings:
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    elevenlabs_api_key: str = os.getenv("ELEVENLABS_API_KEY", "")
    # Latest Claude models per the README (Opus / Fable). Override via env.
    claude_model: str = os.getenv("HOLODECK_CLAUDE_MODEL", "claude-opus-4-8")
    generator_model: str = os.getenv("HOLODECK_GENERATOR_MODEL", "claude-opus-4-8")
    # GPT-2 variant for the flagship pod (124M "gpt2" is the default).
    gpt2_model: str = os.getenv("HOLODECK_GPT2_MODEL", "gpt2")
    elevenlabs_voice_id: str = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    elevenlabs_tts_model: str = os.getenv("ELEVENLABS_TTS_MODEL", "eleven_turbo_v2_5")
    elevenlabs_stt_model: str = os.getenv("ELEVENLABS_STT_MODEL", "scribe_v1")
    # Sign-in: the Google OAuth web client whose tokens we accept, and our own session tokens.
    google_client_id: str = os.getenv("HOLODECK_GOOGLE_CLIENT_ID", "")
    session_secret: str = os.getenv("HOLODECK_SESSION_SECRET", "")
    session_ttl: int = int(os.getenv("HOLODECK_SESSION_TTL", "3600"))
    allow_guest: bool = os.getenv("HOLODECK_ALLOW_GUEST", "").lower() == "true"

    @property
    def has_anthropic(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def has_elevenlabs(self) -> bool:
        return bool(self.elevenlabs_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
