"""Run a prompt through the Antigravity CLI (Gemini) with read-only tools.

Usage: python scripts/agy-readonly.py <model> <prompt-file> <out-file>
e.g.   python scripts/agy-readonly.py gemini-4-hydrogen-high /tmp/review.md /tmp/review.out

Needs the local `agy` CLI and the `agy_headless_bridge` package (pty wrapper;
plain `agy -p` prints nothing without a TTY). Headless agy auto-denies every
tool that would prompt, so this passes a session-only allow-list of read-only
tools: file reading inside the repo, listing/searching, and web search. No file
edits and no shell commands. Callers apply any changes themselves.
"""
import json
import sys
from pathlib import Path

from agy_headless_bridge.bridge import run

REPO = str(Path(__file__).resolve().parent.parent)
SETTINGS = {
    "permissions": {
        "allow": [
            f"read_file({REPO}/**)", "read_file", "view_file", "view_file_outline",
            "list_dir", "list_directory", "find_by_name", "grep_search", "codebase_search",
            "search_web", "web_search", "read_url_content", "web_fetch", "read_browser_page",
        ]
    }
}

model, prompt_file, out = sys.argv[1:4]
try:
    text = run(
        Path(prompt_file).read_text(), timeout=3500, idle_timeout=1200, add_dirs=[REPO], model=model,
        extra_args=["--settings", json.dumps(SETTINGS)],
    )
except Exception as e:  # keep partial output for debugging
    text = f"[agy-readonly] ERROR {type(e).__name__}: {e}\n{getattr(e, 'output', '') or getattr(e, 'partial', '')}"
Path(out).write_text(text)
