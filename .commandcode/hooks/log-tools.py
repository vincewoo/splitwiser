#!/usr/bin/env python3
"""PreToolUse audit hook: append every mutating tool call to .adw/tool_log.jsonl.

Observe-only: writes nothing to stdout (no opinion, allow), never blocks,
never raises. The orch reviews the log as data instead of scraping panes.
"""
import datetime
import json
import os
import sys

try:
    payload = json.load(sys.stdin)
    record = {
        "ts": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "session": payload.get("session_id"),
        "mode": payload.get("permission_mode"),
        "tool": payload.get("tool_name"),
        "input": payload.get("tool_input"),
    }
    project = os.environ.get("COMMANDCODE_PROJECT_DIR") or payload.get("cwd") or "."
    adw_dir = os.path.join(project, ".adw")
    os.makedirs(adw_dir, exist_ok=True)
    with open(os.path.join(adw_dir, "tool_log.jsonl"), "a") as log:
        log.write(json.dumps(record) + "\n")
except Exception:
    pass

sys.exit(0)
