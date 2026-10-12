"""Owner-only Sign in with Apple / Google: verify an OIDC ID token against the provider JWKS."""
from __future__ import annotations

import logging
import os

import jwt
from fastapi import HTTPException
from jwt import PyJWKClient

PROVIDERS = {
    "apple": {
        "issuers": ("https://appleid.apple.com",),
        "jwks": "https://appleid.apple.com/auth/keys",
    },
    "google": {
        "issuers": ("https://accounts.google.com", "accounts.google.com"),
        "jwks": "https://www.googleapis.com/oauth2/v3/certs",
    },
}

DEFAULT_EMAIL = "alex.isayenko@gmail.com"

log = logging.getLogger(__name__)

_clients: dict[str, PyJWKClient] = {}


def _jwks(provider: str) -> PyJWKClient:
    if provider not in _clients:
        _clients[provider] = PyJWKClient(PROVIDERS[provider]["jwks"], cache_keys=True, lifespan=3600)
    return _clients[provider]


def _csv(name: str) -> set[str]:
    return {v.strip().lower() for v in os.environ.get(name, "").split(",") if v.strip()}


def _verify(token: str, provider: str, audience: str) -> dict:
    key = _jwks(provider).get_signing_key_from_jwt(token).key
    return jwt.decode(
        token,
        key,
        algorithms=["RS256"],
        audience=audience,
        issuer=list(PROVIDERS[provider]["issuers"]),
        options={"require": ["exp", "iss", "aud", "sub"]},
        leeway=30,
    )


def verify_owner(token: str) -> None:
    """Raise 401 unless `token` is a valid ID token of a configured owner identity."""
    try:
        provider = jwt.decode(token, options={"verify_signature": False}).get("iss", "")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="bad token")
    name = "apple" if provider.startswith("https://appleid.apple.com") else (
        "google" if "accounts.google.com" in provider else "")
    audience = os.environ.get("APPLE_AUDIENCE" if name == "apple" else "GOOGLE_CLIENT_ID", "")
    if not name or not audience:
        raise HTTPException(status_code=401, detail="bad token")
    try:
        claims = _verify(token, name, audience)
    except Exception:
        raise HTTPException(status_code=401, detail="bad token")
    email = str(claims.get("email", "")).lower()
    verified = claims.get("email_verified") in (True, "true")
    allowed = _csv("ALLOWED_EMAIL") or {DEFAULT_EMAIL}
    ok = verified and email in allowed
    if name == "apple" and claims["sub"].lower() in _csv("ALLOWED_APPLE_SUB"):
        ok = True
    if not ok:
        log.warning("rejected %s sign-in: sub=%s", name, claims["sub"])
        raise HTTPException(status_code=403, detail="not the owner")
