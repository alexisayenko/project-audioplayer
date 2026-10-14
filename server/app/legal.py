"""Copyright note, optional removal contact (LEGAL_CONTACT) and the no-index policy."""

from __future__ import annotations

import logging
import os
import re

log = logging.getLogger(__name__)

NOTE = (
    "A private personal library. All music and artwork belong to their authors and rights holders, "
    "who are credited on each song. Audio is streamed for private listening and cannot be downloaded. "
    "To have a song removed, contact the owner."
)
ROBOTS_TAG = "noindex, nofollow, noarchive"
ROBOTS_TXT = "User-agent: *\nDisallow: /\n"

_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")
_URL = re.compile(r"^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:\d{1,5})?(/[^\s<>\"']*)?$")


def valid_contact(value: str) -> str:
    """The value when it is a plain email address or an https URL, else ''."""
    value = value.strip()
    return value if len(value) <= 200 and (_EMAIL.match(value) or _URL.match(value)) else ""


def contact() -> str | None:
    raw = os.environ.get("LEGAL_CONTACT", "").strip()
    if not raw:
        return None
    ok = valid_contact(raw)
    if not ok:
        log.warning("LEGAL_CONTACT ignored: it must be an email address or an https URL")
    return ok or None


def check_startup() -> None:
    contact()
