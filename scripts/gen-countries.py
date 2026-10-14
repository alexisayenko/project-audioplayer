#!/usr/bin/env python3
"""Regenerate web/js/countries-data.js from server/app/countrycodes.py.

Run after editing the country table:  python3 scripts/gen-countries.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

from app import countrycodes as cc  # noqa: E402

OUT = ROOT / "web" / "js" / "countries-data.js"


def dump(value) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True)


def main() -> None:
    historical = sorted(code for code, flag in cc.HISTORICAL.items() if flag)
    text = (
        "// Generated from server/app/countrycodes.py (ISO 3166-1 alpha-2 table): code -> English name, normalised alias -> code.\n"
        f"export const COUNTRY_NAMES = {dump(cc.NAMES)};\n"
        f"export const COUNTRY_ALIASES = {dump(cc._LOOKUP)};\n"
        f"export const HISTORICAL_COUNTRIES = {dump(historical)};\n"
    )
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
