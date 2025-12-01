from __future__ import annotations
from pathlib import Path
import json
from typing import Any, Dict, List
from datetime import datetime

ERRORS_PATH = Path("fetti_last_errors.json")

def _read_errors() -> List[Dict[str, Any]]:
    if not ERRORS_PATH.exists():
        return []
    try:
        data = json.loads(ERRORS_PATH.read_text() or "[]")
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "errors" in data:
            return data["errors"]  # backwards-compat
        return []
    except Exception:
        return []

def _write_errors(errors: List[Dict[str, Any]]) -> None:
    ERRORS_PATH.write_text(json.dumps(errors, indent=2) + "\n")

def record_error(source: str, step: str, details: str) -> None:
    """
    Append a new error entry to fetti_last_errors.json, keeping only
    the last ~30 errors. Details are truncated to avoid huge files.
    """
    errors = _read_errors()
    errors.append({
        "ts": datetime.utcnow().isoformat() + "Z",
        "source": source,
        "step": step,
        "details": details[-8000:],  # last 8k chars
    })
    # keep only last 30
    errors = errors[-30:]
    _write_errors(errors)

if __name__ == "__main__":
    # tiny self-test
    record_error("self_test", "demo", "This is a test error from fetti_error_logger.")
    print("Wrote test error to", ERRORS_PATH)
