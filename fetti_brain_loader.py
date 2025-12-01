from __future__ import annotations
from pathlib import Path
import json
from typing import Any, Dict, List

BRAIN_PATH = Path("fetti_brain.json")
ERRORS_PATH = Path("fetti_last_errors.json")

def load_fetti_brain() -> Dict[str, Any]:
    if not BRAIN_PATH.exists():
        return {"repo_laws": [], "file_laws": {}, "error_patterns": []}
    try:
        data = json.loads(BRAIN_PATH.read_text() or "{}")
    except Exception:
        return {"repo_laws": [], "file_laws": {}, "error_patterns": []}
    return {
        "repo_laws": data.get("repo_laws", []),
        "file_laws": data.get("file_laws", {}),
        "error_patterns": data.get("error_patterns", []),
    }

def load_last_errors() -> List[str]:
    if not ERRORS_PATH.exists():
        return []
    try:
        data = json.loads(ERRORS_PATH.read_text() or "[]")
        if isinstance(data, list):
            return [str(e) for e in data]
        if isinstance(data, dict) and "errors" in data:
            return [str(e) for e in data["errors"]]
        return []
    except Exception:
        return []

def build_brain_context() -> str:
    brain = load_fetti_brain()
    last_errors = load_last_errors()

    lines: List[str] = []
    lines.append("FETTI_BRAIN_LAWS_START")
    lines.append("")
    lines.append("Repo-wide laws:")
    for law in brain.get("repo_laws", []):
        lines.append(f"- {law}")

    lines.append("")
    lines.append("File-specific laws:")
    file_laws = brain.get("file_laws", {}) or {}
    for path, laws in file_laws.items():
        lines.append(f"- {path}:")
        for law in laws:
            lines.append(f"    • {law}")

    lines.append("")
    lines.append("Recent error patterns / stack traces (these should NOT repeat):")
    for err in last_errors:
        lines.append(f"- {err}")

    lines.append("")
    lines.append("FETTI_BRAIN_LAWS_END")

    return "\n".join(lines)
