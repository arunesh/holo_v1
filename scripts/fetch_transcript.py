#!/usr/bin/env python3
"""Fetch a YouTube video's title + transcript on YOUR machine (residential IP / your
cookies), in the exact JSON shape Holodeck's /api/generate accepts.

Why this exists: from cloud/datacenter IPs YouTube bot-walls transcript downloads. Run
this locally instead, then either commit the JSON or pipe it straight to the server.

Requirements: Python 3.9+ and yt-dlp  →  `pip3 install yt-dlp`  (or `brew install yt-dlp`)

Examples
--------
# 1) Write the transcript JSON to a file:
python3 scripts/fetch_transcript.py "https://www.youtube.com/watch?v=wjZofJX0v4M" \
        -o backend/app/transcripts/transformers.json

# 2) Use your browser's cookies (best for bot-walls / age-gated videos):
python3 scripts/fetch_transcript.py URL --cookies-from-browser chrome -o out.json

# 3) Fetch AND generate the pod on a running Holodeck instance in one shot:
python3 scripts/fetch_transcript.py URL --post http://localhost:8000

The output JSON has: {title, description, transcript, video_id}. Feed it to the server
with:  curl -X POST $SERVER/api/generate -H 'Content-Type: application/json' -d @out.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request


def _id_from_url(url: str) -> str:
    m = re.search(r"(?:v=|youtu\.be/|embed/|shorts/)([\w-]{6,})", url)
    return m.group(1) if m else "video"


def _oembed_title(url: str) -> str | None:
    try:
        q = urllib.parse.urlencode({"url": url, "format": "json"})
        with urllib.request.urlopen(f"https://www.youtube.com/oembed?{q}", timeout=20) as r:
            return json.loads(r.read()).get("title")
    except Exception:
        return None


def _parse_json3(raw: str) -> str:
    data = json.loads(raw)
    parts = []
    for ev in data.get("events", []):
        for seg in ev.get("segs", []) or []:
            if seg.get("utf8"):
                parts.append(seg["utf8"])
    return _dedupe(" ".join(parts))


def _parse_vtt(raw: str) -> str:
    lines = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or "-->" in line or line.isdigit() or line.startswith(("WEBVTT", "Kind:", "Language:")):
            continue
        lines.append(re.sub(r"<[^>]+>", "", line))
    return _dedupe(" ".join(lines))


def _dedupe(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    out: list[str] = []
    for w in text.split(" "):
        if out and out[-1] == w:
            continue
        out.append(w)
    return " ".join(out)


def fetch(url: str, cookies_from_browser: str | None, cookies_file: str | None) -> dict:
    try:
        import yt_dlp
    except ImportError:
        sys.exit("yt-dlp not found. Install it:  pip3 install yt-dlp   (or: brew install yt-dlp)")

    opts: dict = {
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": ["en", "en-US", "en-GB"],
        "quiet": True,
        "no_warnings": True,
    }
    if cookies_from_browser:
        opts["cookiesfrombrowser"] = (cookies_from_browser,)
    if cookies_file:
        opts["cookiefile"] = cookies_file

    title = None
    description = ""
    transcript = ""
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        title = info.get("title")
        description = (info.get("description") or "")[:2000]
        caption_url = _pick_caption_url(info)
        if caption_url:
            with urllib.request.urlopen(caption_url, timeout=60) as r:
                raw = r.read().decode("utf-8", "replace")
            transcript = _parse_json3(raw) if (raw.lstrip().startswith("{")) else _parse_vtt(raw)
    except Exception as e:
        print(f"[warn] yt-dlp failed ({type(e).__name__}: {e}); using oEmbed title only.", file=sys.stderr)

    if not title:
        title = _oembed_title(url) or _id_from_url(url)

    return {
        "title": title,
        "description": description,
        "transcript": transcript,
        "video_id": _id_from_url(url),
    }


def _pick_caption_url(info: dict) -> str | None:
    for source in ("subtitles", "automatic_captions"):
        tracks = info.get(source) or {}
        for lang in ("en", "en-US", "en-GB"):
            entries = tracks.get(lang)
            if not entries:
                continue
            for ext in ("json3", "vtt", "srv1"):
                for e in entries:
                    if e.get("ext") == ext and e.get("url"):
                        return e["url"]
            if entries[0].get("url"):
                return entries[0]["url"]
    return None


def post(server: str, payload: dict) -> None:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        server.rstrip("/") + "/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        print(r.read().decode())


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch a YouTube transcript for Holodeck.")
    ap.add_argument("url", help="YouTube video URL")
    ap.add_argument("-o", "--out", help="write transcript JSON to this file")
    ap.add_argument("--cookies-from-browser", help="e.g. chrome, safari, firefox, edge")
    ap.add_argument("--cookies", help="path to a cookies.txt file")
    ap.add_argument("--post", help="POST to a running Holodeck server, e.g. http://localhost:8000")
    args = ap.parse_args()

    payload = fetch(args.url, args.cookies_from_browser, args.cookies)
    chars = len(payload["transcript"])
    print(f"[ok] title: {payload['title']}", file=sys.stderr)
    print(f"[ok] transcript: {chars} chars", file=sys.stderr)
    if chars == 0:
        print("[note] no transcript captured — the pod will be authored from the title + model knowledge.", file=sys.stderr)

    if args.out:
        with open(args.out, "w") as f:
            json.dump(payload, f, indent=2)
        print(f"[ok] wrote {args.out}", file=sys.stderr)
    if args.post:
        post(args.post, payload)
    if not args.out and not args.post:
        json.dump(payload, sys.stdout, indent=2)
        print()


if __name__ == "__main__":
    main()
