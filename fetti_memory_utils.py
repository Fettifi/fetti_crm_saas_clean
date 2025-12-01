import json
from pathlib import Path
from typing import Any, Dict

BRAIN_PATH = Path("fetti_brain.json")
ERRORS_PATH = Path("fetti_last_errors.json")


def load_brain() -> Dict[str, Any]:
  if not BRAIN_PATH.exists():
    return {"repo_laws": [], "file_laws": {}, "error_patterns": []}
  try:
    return json.loads(BRAIN_PATH.read_text())
  except Exception:
    # If brain file corrupt, fail soft
    return {"repo_laws": [], "file_laws": {}, "error_patterns": []}


def load_last_errors() -> Dict[str, Any]:
  if not ERRORS_PATH.exists():
    return {"timestamp": None, "steps": []}
  try:
    return json.loads(ERRORS_PATH.read_text())
  except Exception:
    # If invalid, overwrite with empty structure
    data = {"timestamp": None, "steps": []}
    ERRORS_PATH.write_text(json.dumps(data, indent=2) + "\\n")
    return data


def save_last_errors(data: Dict[str, Any]) -> None:
  ERRORS_PATH.write_text(json.dumps(data, indent=2) + "\\n")
