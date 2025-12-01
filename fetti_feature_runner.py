from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def run(cmd, check: bool = False) -> int:
  """Run a command, echo it, and optionally require success."""
  print(f"[RUN] {' '.join(cmd)}")
  result = subprocess.run(cmd)
  if check and result.returncode != 0:
    raise SystemExit(result.returncode)
  return result.returncode


def git_status_porcelain() -> str:
  """Return git status --porcelain output, or empty string if git not available."""
  try:
    return subprocess.check_output(
      ["git", "status", "--porcelain"], text=True
    )
  except Exception:
    return ""


def mark_next_task_done(plan_path: Path) -> None:
  """Mark the first unchecked '-' task in fetti_feature_plan.md as '- [x]'."""
  text = plan_path.read_text()
  lines = text.splitlines()
  changed = False

  for i, line in enumerate(lines):
    stripped = line.lstrip()

    # Already done
    if stripped.startswith("- [x]"):
      continue

    # First unchecked bullet
    if stripped.startswith("- "):
      indent_len = len(line) - len(line.lstrip())
      indent = line[:indent_len]
      rest = stripped[2:]  # after "- "
      lines[i] = f"{indent}- [x] {rest}"
      changed = True
      break

  if not changed:
    print(f"[PLAN] No unchecked tasks found in {plan_path}; nothing to mark.")
    return

  plan_path.write_text("\n".join(lines))
  print(f"[PLAN] Marked first unchecked task as [x] in {plan_path}")


def main() -> None:
  repo_root = Path(__file__).resolve().parent
  plan_path = repo_root / "fetti_feature_plan.md"

  print("============================================================")
  print("   <0001run>  Fetti Feature Runner – Sanity + Plan Auto")
  print("============================================================")

  before_status = git_status_porcelain()
  if before_status.strip():
    print("[RUNNER] Warning: git working tree is not clean.")
    print("[RUNNER] Plan auto-advance will still run, but diffs may include prior changes.")

  # 1) Run the existing feature agent
  print("\n[RUNNER] Step 1 – running fetti_feature_agent.py\n")
  agent_code = run([sys.executable, "fetti_feature_agent.py"])
  if agent_code != 0:
    print(f"[RUNNER] fetti_feature_agent.py exited with code {agent_code}.")
    print("[RUNNER] Skipping sanity check and plan update.")
    raise SystemExit(agent_code)

  # 2) Sanity check: lint + build
  print("\n[RUNNER] Step 2 – sanity check (npm run lint && npm run build)\n")
  lint_code = run(["npm", "run", "lint"])
  build_code = run(["npm", "run", "build"])

  if lint_code != 0 or build_code != 0:
    print("[RUNNER] Sanity check failed (lint and/or build).")
    print("[RUNNER] Plan not updated. Fix errors, commit if needed, then rerun.")
    raise SystemExit(1)

  after_status = git_status_porcelain()

  # 3) Only mark a task done if something actually changed on disk
  if before_status == after_status:
    print("[RUNNER] No new git changes detected after feature agent.")
    print("[RUNNER] Not marking any plan tasks as completed.")
    return

  if not plan_path.exists():
    print("[RUNNER] fetti_feature_plan.md not found; skipping plan update.")
    return

  print("\n[RUNNER] Step 3 – updating fetti_feature_plan.md\n")
  mark_next_task_done(plan_path)

  print("\n[RUNNER] All good – sanity check passed and plan advanced.")
  print("[RUNNER] Next fetti:watch cycle will move to the next unchecked task.\n")


if __name__ == "__main__":
  main()
