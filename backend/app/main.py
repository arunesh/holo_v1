from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from .api import generate, inference, pods, session_ws, voice

app = FastAPI(title="Holodeck", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pods.router)
app.include_router(inference.router)
app.include_router(voice.router)
app.include_router(generate.router)
app.include_router(session_ws.router)


@app.get("/api/health")
def health():
    return {"ok": True}


# Shareable pitch deck at /pitchdeck/ (must be mounted before the "/" catch-all).
_pitchdeck = Path(__file__).resolve().parents[2] / "docs" / "pitchdeck"
if _pitchdeck.exists():

    @app.get("/pitchdeck", include_in_schema=False)
    def pitchdeck_redirect():
        # Without this, /pitchdeck (no slash) falls through to the "/" mount and 404s.
        return RedirectResponse("/pitchdeck/")

    app.mount("/pitchdeck", StaticFiles(directory=str(_pitchdeck), html=True), name="pitchdeck")

# Serve the built frontend (frontend/dist) in production, if present.
_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="static")
