"""Sign-in: exchange a Google access token (or a guest request) for our own session token."""
import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..auth import bearer_token, issue_token, verify_token
from ..config import get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

TOKENINFO = "https://oauth2.googleapis.com/tokeninfo"
USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo"


class GoogleSignIn(BaseModel):
    access_token: str = Field(min_length=10, max_length=4096)


def _session(user: dict) -> dict:
    user = {key: value for key, value in user.items() if value is not None and key != "exp"}
    token, expires = issue_token(user)
    return {"token": token, "expires_at": expires, "user": user}


@router.get("/config")
def config():
    settings = get_settings()
    return {"google_client_id": settings.google_client_id or None, "allow_guest": settings.allow_guest}


@router.post("/google")
async def google(body: GoogleSignIn):
    settings = get_settings()
    if not settings.google_client_id:
        raise HTTPException(503, "Google sign-in is not configured")
    async with httpx.AsyncClient(timeout=10) as client:
        info = await client.get(TOKENINFO, params={"access_token": body.access_token})
        data = info.json() if info.status_code == 200 else {}
        # The token must have been issued to *our* client, for a verified address.
        if data.get("aud") != settings.google_client_id or str(data.get("email_verified")).lower() != "true" \
                or not data.get("email"):
            raise HTTPException(401, "Google sign-in could not be verified")
        profile = await client.get(USERINFO, headers={"Authorization": f"Bearer {body.access_token}"})
        extra = profile.json() if profile.status_code == 200 else {}
    return _session({"sub": data["email"], "email": data["email"], "name": extra.get("name") or data["email"],
                     "picture": extra.get("picture"), "provider": "google"})


@router.post("/guest")
def guest():
    if not get_settings().allow_guest:
        raise HTTPException(403, "Guest access is turned off")
    return _session({"sub": "guest", "name": "Guest", "provider": "guest"})


@router.post("/refresh")
def refresh(request: Request):
    """A still-valid session gets a fresh token; the open tab calls this before expiry."""
    claims = verify_token(bearer_token(request.headers.get("authorization")))
    if not claims or (claims.get("provider") == "guest" and not get_settings().allow_guest):
        raise HTTPException(401, "Sign in required")
    return _session(claims)
