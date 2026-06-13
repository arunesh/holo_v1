"""Fetch a YouTube video's title + transcript via yt-dlp (no full download needed).

Prefers human/auto captions; parses the vtt/json3 caption track into plain text.
"""

from __future__ import annotations

import json
import re
from typing import Any

import httpx


def fetch_transcript(url: str) -> dict[str, Any]:
    """Best-effort: full transcript via yt-dlp, else just the title via oEmbed.

    Cloud IPs are frequently bot-walled by YouTube. When that happens we still
    return a usable title so the generator can author from the topic + Claude's
    knowledge rather than failing outright.
    """
    try:
        return _fetch_via_ytdlp(url)
    except Exception as e:
        title = _fetch_title_oembed(url) or _id_from_url(url)
        return {
            "title": title,
            "description": "",
            "transcript": "",
            "duration": None,
            "id": _id_from_url(url),
            "warning": f"transcript unavailable ({type(e).__name__}); generated from title + model knowledge",
        }


def _fetch_via_ytdlp(url: str) -> dict[str, Any]:
    import yt_dlp

    opts = {
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": ["en", "en-US", "en-GB"],
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    title = info.get("title", "Untitled")
    description = info.get("description", "") or ""

    caption_url = _pick_caption_url(info)
    transcript = ""
    if caption_url:
        try:
            raw = httpx.get(caption_url, timeout=60).text
            transcript = _parse_captions(caption_url, raw)
        except Exception:
            transcript = ""

    return {
        "title": title,
        "description": description[:2000],
        "transcript": transcript,
        "duration": info.get("duration"),
        "id": info.get("id"),
    }


def _fetch_title_oembed(url: str) -> str | None:
    # YouTube's oEmbed endpoint returns title/author without authentication.
    try:
        r = httpx.get(
            "https://www.youtube.com/oembed",
            params={"url": url, "format": "json"},
            timeout=20,
        )
        if r.status_code == 200:
            return r.json().get("title")
    except Exception:
        pass
    return None


def _id_from_url(url: str) -> str:
    m = re.search(r"(?:v=|youtu\.be/|embed/)([\w-]{6,})", url)
    return m.group(1) if m else "video"


def _pick_caption_url(info: dict[str, Any]) -> str | None:
    for source in ("subtitles", "automatic_captions"):
        tracks = info.get(source) or {}
        for lang in ("en", "en-US", "en-GB"):
            if lang in tracks:
                entries = tracks[lang]
                # prefer json3, then vtt, then anything
                for ext in ("json3", "vtt", "srv1"):
                    for e in entries:
                        if e.get("ext") == ext and e.get("url"):
                            return e["url"]
                if entries and entries[0].get("url"):
                    return entries[0]["url"]
    return None


def _parse_captions(url: str, raw: str) -> str:
    if "json3" in url or raw.lstrip().startswith("{"):
        try:
            data = json.loads(raw)
            parts = []
            for ev in data.get("events", []):
                for seg in ev.get("segs", []) or []:
                    t = seg.get("utf8", "")
                    if t:
                        parts.append(t)
            return _dedupe(" ".join(parts))
        except Exception:
            pass
    # vtt / srt fallback: drop timestamps, cue numbers and tags
    lines = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or "-->" in line or line.isdigit() or line.startswith("WEBVTT"):
            continue
        line = re.sub(r"<[^>]+>", "", line)
        lines.append(line)
    return _dedupe(" ".join(lines))


def _dedupe(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    # collapse the rolling-duplicate words common in auto-captions
    words = text.split(" ")
    out: list[str] = []
    for w in words:
        if len(out) >= 1 and out[-1] == w:
            continue
        out.append(w)
    return " ".join(out)
