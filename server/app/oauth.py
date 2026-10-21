"""Sign in with Apple / Google: verify an OIDC ID token against the provider JWKS."""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import time

import jwt
from jwt import PyJWKClient

from .problems import Problem

_BAD_TOKEN = "bad token"

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

PROVIDER_ORDER = ("google", "apple")

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


def _short(value: object) -> str:
    return hashlib.sha256(str(value).encode()).hexdigest()[:8]


def _unverified(token: str) -> dict:
    """Payload of a JWT read without verification, for failure logs only."""
    try:
        part = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    except Exception:
        return {}


def _log_failure(token: str, provider: str, error: Exception) -> None:
    claims = _unverified(token)
    exp = claims.get("exp")
    expiry = "?"
    if isinstance(exp, (int, float)):
        expiry = f"{int(exp - time.time())}s from now"
    env = "APPLE_AUDIENCE+APPLE_WEB_CLIENT_ID" if provider == "apple" else "GOOGLE_CLIENT_ID+GOOGLE_WEB_CLIENT_ID"
    log.warning(
        "auth: %s token rejected: %s: %s; token aud=%r iss=%r exp=%s; accepted aud (%s)=%s",
        provider, type(error).__name__, error, claims.get("aud"), claims.get("iss"), expiry, env,
        audiences(provider),
    )


def verify_identity(token: str) -> dict:
    """Verify an ID token; return {provider, email, sub} (email is "" when Apple sends none).

    Raises 401 for an invalid token and 403 `unverified_email` when an email is present but not verified."""
    claims = name = None
    for candidate in PROVIDER_ORDER:
        audience = audiences(candidate)
        if not audience:
            continue
        try:
            claims = _verify(token, candidate, audience)
        except Exception as e:
            _log_failure(token, candidate, e)
            continue
        name = candidate
        break
    if claims is None or name is None:
        log.warning("auth: sign-in refused: no provider accepted the token (providers with no audience configured are skipped)")
        raise Problem(401, "bad_token", _BAD_TOKEN)
    email = str(claims.get("email", "")).strip().lower()
    verified = claims.get("email_verified") in (True, "true")
    if email and not verified:
        log.warning("rejected %s sign-in: unverified email, user=%s", name, _short(claims["sub"]))
        raise Problem(403, "unverified_email", "email is not verified")
    if not email and name != "apple":
        raise Problem(403, "no_email", "the account has no email")
    log.info("auth: %s sign-in verified, user=%s", name, _short(claims["sub"]))
    return {"provider": name, "email": email, "sub": str(claims["sub"])}
