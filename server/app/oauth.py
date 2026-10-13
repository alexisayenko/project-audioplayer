"""Sign in with Apple / Google: verify an OIDC ID token against the provider JWKS."""
from __future__ import annotations

import logging
import os

import jwt
from jwt import PyJWKClient

from .problems import Problem

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

log = logging.getLogger(__name__)

_clients: dict[str, PyJWKClient] = {}


def _jwks(provider: str) -> PyJWKClient:
    if provider not in _clients:
        _clients[provider] = PyJWKClient(PROVIDERS[provider]["jwks"], cache_keys=True, lifespan=3600)
    return _clients[provider]


def _list(name: str) -> list[str]:
    return [v.strip() for v in os.environ.get(name, "").split(",") if v.strip()]


def audiences(provider: str) -> list[str]:
    """Accepted `aud` values: the comma list plus the web client id (case-sensitive, not secret)."""
    if provider == "apple":
        return _list("APPLE_AUDIENCE") + _list("APPLE_WEB_CLIENT_ID")
    return _list("GOOGLE_CLIENT_ID") + _list("GOOGLE_WEB_CLIENT_ID")


def _verify(token: str, provider: str, audience: list[str]) -> dict:
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


def verify_identity(token: str) -> dict:
    """Verify an ID token; return {provider, email, sub} (email is "" when Apple sends none).

    Raises 401 for an invalid token and 403 `unverified_email` when an email is present but not verified."""
    try:
        provider = jwt.decode(token, options={"verify_signature": False}).get("iss", "")
    except jwt.PyJWTError:
        raise Problem(401, "bad_token", "bad token")
    name = "apple" if provider.startswith("https://appleid.apple.com") else (
        "google" if "accounts.google.com" in provider else "")
    audience = audiences(name) if name else []
    if not name or not audience:
        raise Problem(401, "bad_token", "bad token")
    try:
        claims = _verify(token, name, audience)
    except Exception:
        raise Problem(401, "bad_token", "bad token")
    email = str(claims.get("email", "")).strip().lower()
    verified = claims.get("email_verified") in (True, "true")
    if email and not verified:
        log.warning("rejected %s sign-in: unverified email, sub=%s", name, claims["sub"])
        raise Problem(403, "unverified_email", "email is not verified")
    if not email and name != "apple":
        raise Problem(403, "no_email", "the account has no email")
    return {"provider": name, "email": email, "sub": str(claims["sub"])}
