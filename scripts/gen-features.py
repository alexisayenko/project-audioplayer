#!/usr/bin/env python3
"""Write the Features payload (releases and planned tasks) of a checkout as JSON, for local runs; the server serves the same data at GET /features/data."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from app import features  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=str(ROOT))
    ap.add_argument("--out", help="output file; stdout when omitted")
    ap.add_argument("--deploys", help="deploys.json state file to use; none by default")
    a = ap.parse_args(argv)
    repo = Path(a.repo)
    data = features.build(repo, features.load_json(a.deploys, []) if a.deploys else [], features.load_json(repo / "docs" / "releases-map.json", {}))
    text = json.dumps(data, indent=1) + "\n"
    if a.out:
        Path(a.out).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
