"""`python -m app.gitsync`: push every repo that has unpushed commits (run by audioplayer-gitsync.timer)."""

from __future__ import annotations

import argparse
import json
import logging
import sys

from . import gitstore


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.gitsync")
    parser.add_argument("--clear-rejected", choices=gitstore.REPO_NAMES)
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    try:
        sync = gitstore.from_env()
    except Exception as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 3
    if sync is None:
        print("no git store configured")
        return 0
    try:
        if args.status:
            print(json.dumps(sync.sync_status(owner=True), indent=2))
            return 0
        if args.clear_rejected:
            sync.set_repo_state(args.clear_rejected, rejected=False, failures=0)
            print(f"cleared {args.clear_rejected}")
            return 0
        code = sync.push_pass(strict=True)
    except (gitstore.StateError, OSError) as exc:
        print(f"state error: {exc}", file=sys.stderr)
        return 3
    if code is None:
        print("busy: another push is running")
        return 0
    return code


if __name__ == "__main__":
    sys.exit(main())
