import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from fetti_memory_utils import load_brain, load_last_errors

PLAN_PATH = Path("fetti_feature_plan.md")


def get_first_open_task() -> Optional[str]:
    """
    Returns the first open (non-[x]) bullet line from fetti_feature_plan.md,
    or None if no tasks are open.
    """
    if not PLAN_PATH.exists():
        return None

    lines = PLAN_PATH.read_text().splitlines()
    for line in lines:
        stripped = line.strip()
        # Open task: "- something"
        if stripped.startswith("- ") and not stripped.startswith("- [x]"):
            return stripped[2:].strip()
    return None


def summarize_last_errors(errors: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Return a lightweight summary of the last few errors.
    """
    steps = errors.get("steps", [])
    summaries: List[Dict[str, Any]] = []
    for step in steps:
        summaries.append(
            {
                "step": step.get("step"),
                "file": step.get("file"),
                "summary": step.get("summary"),
            }
        )
    return summaries


def build_context() -> Dict[str, Any]:
    """
    Build a context object that your real feature agent can later feed to the model.
    This does NOT call any API or modify files. Safe to run anytime.
    """
    brain = load_brain()
    errors = load_last_errors()
    task = get_first_open_task()

    repo_laws = brain.get("repo_laws", [])
    file_laws = brain.get("file_laws", {})
    error_patterns = brain.get("error_patterns", [])

    context: Dict[str, Any] = {
        "task": task,
        "repo_laws": repo_laws,
        "file_laws": file_laws,
        "error_patterns": error_patterns,
        "last_errors": summarize_last_errors(errors),
    }

    return context


def main() -> None:
    print("============================================================")
    print("   <0001brain>  Fetti Smart Feature Agent – Dry Run")
    print("============================================================")

    ctx = build_context()

    if not ctx["task"]:
        print("No open tasks found in fetti_feature_plan.md.")
    else:
        print(f"Next open task:")
        print(f"  • {ctx['task']}")

    print("\nRepo laws (high-level rules):")
    if ctx["repo_laws"]:
        for law in ctx["repo_laws"]:
            print(f"  - {law}")
    else:
        print("  (none defined yet)")

    print("\nFile-specific laws:")
    if ctx["file_laws"]:
        for path, laws in ctx["file_laws"].items():
            print(f"  {path}:")
            for law in laws:
                print(f"    - {law}")
    else:
        print("  (none defined yet)")

    print("\nLast error summaries:")
    last_errors = ctx["last_errors"]
    if last_errors:
        for e in last_errors:
            print(
                f"  - step={e.get('step')} file={e.get('file')} "
                f"summary={e.get('summary')}"
            )
    else:
        print("  (no logged errors yet or empty fetti_last_errors.json)")

    print("\n---------------------------------------------")
    print("JSON context (for future model prompt wiring):")
    print("---------------------------------------------")
    print(json.dumps(ctx, indent=2))
    print("\n[SMART] This was a DRY RUN – no files were modified.")


if __name__ == "__main__":
    main()
