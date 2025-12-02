import os
from fetti_brain_loader import build_brain_context
import json
import textwrap
import datetime as _dt
import subprocess
from pathlib import Path
from typing import List

import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()  # Load environment variables from .env file

PROJECT_ROOT = Path(__file__).resolve().parent
PLAN_PATH = PROJECT_ROOT / "fetti_feature_plan.md"


SAFE_ROOTS = (
    "app/",
    "components/",
    "lib/",
    "src/",
    "prisma/",
    "db/",
    "supabase/",
)
IGNORE_ROOTS = (
    "node_modules/",
    ".next/",
    ".turbo/",
    "dist/",
    "build/",
    "logs/",
)


def banner():
    print("\n" + "=" * 60)
    print("   <0001plan>  Fetti Wizard – Feature Agent")
    print("=" * 60)
    print(
        textwrap.dedent(
            """
            Mode: Feature roadmap autopilot (SAFE + repo-aware)

            - Reads tasks from fetti_feature_plan.md at the repo root.
            - For each task:
                • Scans SAFE roots to build a repo map
                • Sends the task + repo map + rules to OpenAI
                • Gets JSON edits (file/before/after)
                • Only edits SAFE roots (app/, components/, lib/, src/, prisma/, db/, supabase/)
                • Runs npm run lint + npm run build to validate
            - Never touches node_modules/.next/dist/build/.turbo.
            - Stops on the first task that fails or has no usable edits.
            """
        ).strip()
    )
    print("\n")


def read_plan() -> List[str]:
    """
    Read fetti_feature_plan.md and return *open* tasks.

    Rules:
    - Lines starting with '- [x]' or '- [X]' are treated as DONE and skipped.
    - Lines starting with '- [ ]' are OPEN tasks.
    - Bare bullet lines starting with '-' or '*' are treated as OPEN tasks.
    - '#' lines and empty lines are ignored.
    """
    if not PLAN_PATH.exists():
        PLAN_PATH.write_text(
            textwrap.dedent(
                """\
                # Fetti Feature Plan

                - [ ] Define lead status enum (NEW, CONTACTED, ENGAGED, DEAD, NOT_QUALIFIED) and make Lead.status required with default NEW.
                - [ ] Define application status enum (STARTED, IN_PROGRESS, SUBMITTED, INCOMPLETE, WITHDRAWN) and make Application.status required with default STARTED.
                """
            )
        )
        print(f"[PLAN] Created template plan file at {PLAN_PATH}")

    text = PLAN_PATH.read_text()
    tasks: List[str] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        # DONE tasks: skip entirely
        if line.startswith(("- [x]", "- [X]")):
            continue

        # OPEN checkbox
        if line.startswith("- [ ]"):
            task = line.split("]", 1)[-1].strip()
            if task:
                tasks.append(task)
            continue

        # Bare bullet
        if line.startswith(("-", "*")):
            task = line[1:].strip()
            if task:
                tasks.append(task)
            continue

        # Fallback: treat as a raw task line
        tasks.append(line)

    return tasks


def mark_task_done(task: str) -> None:
    """
    Mark the given task as DONE in fetti_feature_plan.md by rewriting
    the matching line to '- [x] {task}'.

    Matching is done on the normalized task text (after stripping bullet / checkbox).
    """
    if not PLAN_PATH.exists():
        return

    lines = PLAN_PATH.read_text().splitlines()
    new_lines: List[str] = []

    for raw_line in lines:
        line = raw_line.rstrip("\n")
        stripped = line.strip()

        if not stripped or stripped.startswith("#"):
            new_lines.append(line)
            continue

        # Normalize the core task text for comparison
        core = stripped
        if stripped.startswith(("- [ ]", "- [x]", "- [X]")):
            core = stripped.split("]", 1)[-1].strip()
        elif stripped[0] in "-*":
            core = stripped[1:].strip()

        if core == task:
            new_lines.append(f"- [x] {task}")
        else:
            new_lines.append(line)

    PLAN_PATH.write_text("\n".join(new_lines) + "\n")


def run_cmd(label: str, cmd: List[str]) -> (bool, str):
    now = _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print("\n" + "=" * 60)
    print(f"[{now}] {label}")
    print("=" * 60)
    print(f"[CMD] {' '.join(cmd)}\n")

    proc = subprocess.run(cmd, cwd=PROJECT_ROOT, capture_output=True, text=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    print(out)
    ok = proc.returncode == 0
    if ok:
        print(f"[RESULT] ✅ SUCCESS (code {proc.returncode})")
    else:
        print(f"[RESULT] ❌ FAILED (code {proc.returncode})")
    return ok, out


def build_repo_hint() -> str:
    """
    Build a short text description of existing files under SAFE roots.
    This is given to the model so it knows what actually exists.
    """
    lines: List[str] = []
    for root in SAFE_ROOTS:
        root_path = PROJECT_ROOT / root
        if not root_path.exists():
            lines.append(f"- {root} (missing)")
            continue

        lines.append(f"- {root}")
        count = 0
        for p in root_path.rglob("*"):
            if p.is_file():
                rel = p.relative_to(PROJECT_ROOT)
                lines.append(f"  • {rel}")
                count += 1
                if count >= 200:
                    lines.append("  • ...")
                    break
    return "\n".join(lines)


def get_git_history(max_commits: int = 10) -> str:
    """
    Get recent git commit history for context.
    """
    try:
        result = subprocess.run(
            ["git", "log", f"-{max_commits}", "--oneline", "--no-decorate"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0 and result.stdout:
            lines = ["Recent commits:"]
            for line in result.stdout.strip().split("\n"):
                lines.append(f"  • {line}")
            return "\n".join(lines)
    except Exception:
        pass
    return "Git history unavailable"


def get_file_preview(file_path: Path, max_lines: int = 50) -> str:
    """
    Get preview of file content (first max_lines).
    """
    try:
        if file_path.exists() and file_path.is_file():
            content = file_path.read_text()
            all_lines = content.split("\n")
            lines = all_lines[:max_lines]
            preview = "\n".join(lines)
            if len(all_lines) > max_lines:
                remaining = len(all_lines) - max_lines
                preview += f"\n... ({remaining} more lines)"
            return preview
    except Exception:
        pass
    return ""


def search_code(pattern: str, file_extensions: List[str] = None) -> str:
    """
    Search for code patterns using grep.
    """
    if not file_extensions:
        file_extensions = [".ts", ".tsx", ".js", ".jsx"]
    
    try:
        # Build grep command
        cmd = ["grep", "-r", "-n", "--include=*.ts", "--include=*.tsx", 
               "--include=*.js", "--include=*.jsx", pattern, "app/", "components/", "lib/"]
        
        result = subprocess.run(
            cmd,
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if result.returncode == 0 and result.stdout:
            lines = result.stdout.strip().split("\n")[:20]  # Limit to 20 results
            return "\n".join(lines)
    except Exception:
        pass
    return ""


def apply_json_edits(edits: List[dict]) -> bool:
    """
    Apply JSON edits: {file, before, after}.

    Behaviors:
    - If before is a non-empty string and exists in file: replace first occurrence.
    - If before is an empty string: APPEND `after` to the end of the file.
    - If before is non-empty but not found:
        • For TSX/JSX files: skip the edit for safety (do NOT append raw JSX).
        • For other files: append `after` as a fallback, with a log message.
    """
    applied_any = False

    for edit in edits:
        file_rel = edit.get("file")
        before = edit.get("before")
        after = edit.get("after")

        if not file_rel or before is None or after is None:
            print(f"[AI] Skipping malformed edit entry: {edit}")
            continue

        if file_rel.startswith(IGNORE_ROOTS):
            print(f"[AI] Skipping edit in ignored path: {file_rel}")
            continue

        if not file_rel.startswith(SAFE_ROOTS):
            print(f"[AI] Skipping edit outside SAFE roots: {file_rel}")
            continue

        path = PROJECT_ROOT / file_rel
        if not path.exists():
            print(f"[AI] File not found, skipping: {file_rel}")
            continue

        text = path.read_text()

        # Case 1: APPEND mode when 'before' is empty
        if before == "":
            new_text = text + ("\n" if not text.endswith("\n") else "") + after + "\n"
            path.write_text(new_text)
            print(f"[AI] ✅ APPENDED edit to {file_rel}")
            applied_any = True
            continue

        # Case 2: normal replace when 'before' is found
        if before in text:
            new_text = text.replace(before, after, 1)
            path.write_text(new_text)
            print(f"[AI] ✅ Replaced first occurrence of 'before' snippet in {file_rel}")
            applied_any = True
            continue

        # Case 3: 'before' not found
        if file_rel.endswith((".tsx", ".jsx")):
            # Safety: do NOT append raw JSX/TSX outside components
            print(
                f"[AI] 'before' snippet not found in {file_rel}; "
                f"SKIPPING edit for safety (no raw JSX append)."
            )
            continue

        print(
            f"[AI] 'before' snippet not found in {file_rel}, "
            f"APPENDING edit as fallback."
        )
        new_text = text + ("\n" if not text.endswith("\n") else "") + after + "\n"
        path.write_text(new_text)
        applied_any = True

    return applied_any

MODEL_NAME = os.environ.get("FETTI_WIZARD_MODEL", "gemini-2.0-flash-thinking-exp")
API_KEY = os.environ.get("GEMINI_API_KEY")

try:
    if not API_KEY:
        print("[WARNING] GEMINI_API_KEY not set. Agent will fail to generate content.")
    else:
        genai.configure(api_key=API_KEY)
except Exception as e:
    print(f"[ERROR] Failed to configure Gemini client: {e}")

def ai_apply_task(task: str) -> bool:
    print(f"\n[AI] Asking Gemini to implement task:\n      {task}\n")

    repo_hint = build_repo_hint()
    git_history = get_git_history(10)
    brain_context = ""
    
    try:
        brain_ctx = build_brain_context()
        if brain_ctx:
            brain_context = f"\n\n**BRAIN CONTEXT (Previous Learnings)**:\n{brain_ctx}\n"
    except Exception as e:
        print(f"[AI] Could not load brain context: {e}")
    
    # Add git history to context
    if git_history and git_history != "Git history unavailable":
        brain_context += f"\n**GIT HISTORY**:\n{git_history}\n"
    
    # Add previews of key files if they exist
    key_files = ["package.json", "tsconfig.json", "next.config.mjs"]
    file_previews = []
    for key_file in key_files:
        file_path = PROJECT_ROOT / key_file
        if file_path.exists():
            preview = get_file_preview(file_path, 30)
            if preview:
                file_previews.append(f"\n**{key_file} (preview)**:\n```\n{preview}\n```")
    
    if file_previews:
        brain_context += "\n**KEY FILE PREVIEWS**:" + "".join(file_previews) + "\n"
    
    # Add few-shot examples from brain
    try:
        brain_data = json.loads((PROJECT_ROOT / "fetti_brain.json").read_text())
        examples = brain_data.get("successful_examples", [])
        if examples:
            example_text = "\n**SUCCESSFUL EDIT EXAMPLES** (for reference):\n"
            for ex in examples[:3]:  # Limit to 3 examples
                example_text += f"- {ex.get('description', 'Example')}\n"
                example_text += f"  File: {ex.get('file', 'N/A')}\n"
                example_text += f"  Pattern: Replace specific code with improved version\n"
            brain_context += example_text
    except Exception:
        pass

    system_instruction = (
        "You are the Fetti Feature Agent running inside the Fetti CRM repo. "
        "Before proposing ANY edits, carefully read the brain context and past "
        "errors that have been loaded for you (recent build failures, lint "
        "errors, and plan notes). Your primary goal is to avoid repeating "
        "known mistakes. Prefer minimal, surgical edits that keep the app "
        "building successfully. If something in the brain suggests a risk, "
        "adjust your edits to stay on the safe path.\n\n"
        "You have access to extended thinking capabilities - use them for complex "
        "architectural decisions or when considering multiple approaches.\n\n"
        "**REASONING APPROACH**:\n"
        "1. First, critique the current state and identify the minimal change needed\n"
        "2. Consider edge cases and potential breaking changes\n"
        "3. Then generate the most effective, safe edit\n\n"
        "You only output strict JSON edits (file/before/after), no explanations."
    )

    user_prompt = f"""
You are the feature builder AI for the "Fetti CRM" project (Next.js / TypeScript / Supabase / Prisma or other DB).

Your job: Implement ONE feature task in the safest, smallest way possible.

Current task:
{task}

Current SAFE repo structure (only SAFE roots shown):
{repo_hint}
{brain_context}
Constraints:
- Repository root is the current working directory.
- You CANNOT run shell commands.
- You MUST only touch files under these SAFE roots (if they exist):
  * app/
  * components/
  * lib/
  * src/
  * prisma/
  * db/
  * supabase/
- NEVER edit files under:
  * node_modules/
  * .next/
  * dist/
  * build/
  * .turbo/
  * logs/

If you do not see prisma/schema.prisma in the repo structure above, do NOT invent it.
Instead, make changes in the appropriate existing files (e.g., db schema, TypeScript models, or API handlers) that match the task.

Output format (strict):
- DO NOT explain or comment.
- Only return JSON with this exact shape (no backticks, no extra keys):

{{
  "edits": [
    {{
      "file": "relative/path/from/repo/root.tsx",
      "before": "EXACT snippet of existing code you expect to find, or \"\" to append",
      "after": "replacement code snippet or block to append"
    }}
  ]
}}

Rules:
- "file" must be a relative path under the repo root, and SHOULD start with a SAFE root (app/, components/, lib/, src/, prisma/, db/, supabase/).
- If you want to APPEND new code to an existing file (without replacing anything), set "before" to an empty string "" and "after" to the exact text to append.
- If you want to REPLACE existing code, "before" MUST match text that already exists in the file; we will try to replace the first occurrence, but if it does not match, our system may append as a fallback.
- "after" is the new text that will replace "before" (or be appended when before == "" or when before is not found).
- Use as FEW edits as possible to implement the task.
- You MUST return valid JSON, nothing else.
"""

    try:
        model = genai.GenerativeModel(
            model_name=MODEL_NAME,
            system_instruction=system_instruction,
            generation_config={"response_mime_type": "application/json"}
        )
        
        response = model.generate_content(user_prompt)
        raw = response.text
        print("\n[AI] Raw model output:")
        print(raw)

        data = json.loads(raw)
    except Exception as e:
        print(f"[AI] ❌ Model generation or parsing failed: {e}")
        return False

    edits = data.get("edits") or []
    if not isinstance(edits, list) or not edits:
        print("[AI] No usable edits found in JSON.")
        return False

    return apply_json_edits(edits)


def run_plan():
    banner()
    tasks = read_plan()
    if not tasks:
        print("[PLAN] No open tasks found in fetti_feature_plan.md.")
        return

    print(f"[PLAN] Loaded {len(tasks)} task(s) from fetti_feature_plan.md.")

    total = len(tasks)
    for idx, task in enumerate(tasks, start=1):
        print("\n" + "-" * 60)
        print(f"[TASK {idx}/{total}] {task}")
        print("-" * 60)

        applied = ai_apply_task(task)
        if not applied:
            print(f"[TASK {idx}] AI did not apply any edits. Stopping so you can adjust the task or plan.")
            break

        ok_lint, _ = run_cmd(f"Lint after task {idx}", ["npm", "run", "lint"])
        ok_build, _ = run_cmd(f"Build after task {idx}", ["npm", "run", "build"])

        if not (ok_lint and ok_build):
            print(f"[TASK {idx}] Validation failed (lint/build). Stopping so you can inspect and commit/rollback.")
            break

        # Mark the task as completed in the plan file
        mark_task_done(task)
        print(f"[PLAN] Marked task as done in fetti_feature_plan.md.")
        print(f"[TASK {idx}] ✅ Completed and validated.")

    print("\n[PLAN] Done processing tasks (or stopped due to an issue).")


def main():
    run_plan()


if __name__ == "__main__":
    main()