import os
import json
import subprocess
import textwrap
import datetime as _dt
from pathlib import Path
import re
from typing import Optional, List, Any

from openai import OpenAI

PROJECT_ROOT = Path(__file__).resolve().parent
MODEL = os.environ.get("FETTI_WIZARD_MODEL", "gpt-4.1-mini")
client = OpenAI()  # uses OPENAI_API_KEY from env


def banner():
    print("\n" + "=" * 60)
    print("   <0001wrap>  Fetti Doctor – AI Upgrade Wrapper")
    print("=" * 60)
    print(
        textwrap.dedent(
            """
            - Runs `python3 fetti_doctor.py --auto` as usual.
            - If it fails:
                • detects which step failed (Lint/Test/Build) from the log
                • sends the failing log to OpenAI with that context
                • gets JSON edits (file/before/after)
                • applies edits inside this repo (skips node_modules/.next/etc.)
                • logs the AI session to logs/fetti_ai_fixes.log
                • runs Fetti Doctor again once.
            - If it still fails, exits with error so your pipeline sees the failure.
            """
        ).strip()
    )
    print("\n")


def run_doctor():
    """Run fetti_doctor.py --auto and return (exit_code, combined_output)."""
    print("\n" + "-" * 60)
    print(f"[WRAPPER] Running Fetti Doctor at {_dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("-" * 60)

    proc = subprocess.run(
        ["python3", "fetti_doctor.py", "--auto"],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
    )

    out = (proc.stdout or "") + (proc.stderr or "")
    # Echo the doctor's output so behavior looks the same from the outside
    if proc.stdout:
        print(proc.stdout, end="")
    if proc.stderr:
        print(proc.stderr, end="")

    print(f"\n[WRAPPER] Fetti Doctor exited with code {proc.returncode}")
    return proc.returncode, out


def apply_json_edits(edits: List[dict]) -> bool:
    """
    Apply JSON edits: {file, before, after}.
    Returns True if at least one edit was applied.
    """
    applied_any = False
    ignore_roots = ("node_modules/", ".next/", ".turbo/", "dist/", "build/")

    for edit in edits:
        file_rel = edit.get("file")
        before = edit.get("before")
        after = edit.get("after")

        if not file_rel or before is None or after is None:
            print(f"[AI] Skipping malformed edit entry: {edit}")
            continue

        if file_rel.startswith(ignore_roots):
            print(f"[AI] Skipping edit in ignored path: {file_rel}")
            continue

        target_path = PROJECT_ROOT / file_rel
        if not target_path.exists():
            print(f"[AI] File not found, skipping: {file_rel}")
            continue

        try:
            src = target_path.read_text()
        except Exception as e:
            print(f"[AI] Could not read {file_rel}: {e}")
            continue

        if before not in src:
            print(f"[AI] 'before' snippet not found in {file_rel}, skipping.")
            continue

        new_src = src.replace(before, after, 1)

        backup = target_path.with_suffix(target_path.suffix + ".fetti_backup")
        if not backup.exists():
            try:
                backup.write_text(src)
                print(f"[AI] Created backup: {backup.relative_to(PROJECT_ROOT)}")
            except Exception as e:
                print(f"[AI] Could not create backup for {file_rel}: {e}")

        try:
            target_path.write_text(new_src)
            print(f"[AI] ✅ Applied edit to {file_rel}")
            applied_any = True
        except Exception as e:
            print(f"[AI] Failed to write updated file {file_rel}: {e}")

    if not applied_any:
        print("[AI] No edits were actually applied.")
    return applied_any


def extract_failed_step(log_text: str) -> Optional[str]:
    """
    Look for the line from fetti_doctor:
      [FETTI DOCTOR] Health check failed at step 'Lint' with exit code ...
    and return the step name (Lint/Test/Build/etc.).
    """
    pattern = r"Health check failed at step '(.+?)'"
    match = re.search(pattern, log_text)
    if match:
        return match.group(1)
    return None


def log_ai_session(failed_step: Optional[str], raw_output: str, edits: List[dict]) -> None:
    """Append an audit log entry for this AI fix attempt."""
    logs_dir = PROJECT_ROOT / "logs"
    logs_dir.mkdir(exist_ok=True)
    log_path = logs_dir / "fetti_ai_fixes.log"

    entry = {
        "timestamp": _dt.datetime.now().isoformat(),
        "failed_step": failed_step,
        "raw_model_output": raw_output,
        "edits": edits,
    }

    try:
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
        print(f"[WRAPPER] Logged AI session to {log_path.relative_to(PROJECT_ROOT)}")
    except Exception as e:
        print(f"[WRAPPER] Could not write AI log: {e}")


def ai_fix_with_openai(full_log: str) -> bool:
    """
    Send the failing log to OpenAI and apply returned JSON edits.
    Returns True if at least one edit was applied.
    """
    print("\n[WRAPPER] Calling OpenAI to suggest fixes...")

    failed_step = extract_failed_step(full_log)
    step_label = failed_step or "Unknown"

    trimmed_log = full_log[-16000:]  # keep prompt size sane

    user_prompt = f"""
You are the AI brain for the "Fetti Doctor" build wizard in a Next.js / TypeScript / Supabase / Prisma project called "Fetti CRM".

Fetti Doctor just ran a multi-step health check and FAILED.

The steps are:
- Lint (npm run lint)
- Test (npm test)  [only if defined in package.json]
- Build (npm run build)

The failing step reported by the doctor is: {step_label}

You will receive the combined stdout + stderr of the entire Fetti Doctor run.
Your job is to propose precise code edits to FIX the failure, focusing first on the failing step.

Important constraints:
- The repository root is the current working directory.
- You CANNOT run commands; that is done outside of you.
- You MUST only touch files under these roots (if they exist):
  * app/
  * pages/
  * src/
  * lib/
  * prisma/
  * db/
  * supabase/
- NEVER edit files under:
  * node_modules/
  * .next/
  * dist/
  * build/
  * .turbo/

Fetti Doctor log (tail):
-----------------
{trimmed_log}
-----------------

Output format (strict):
- DO NOT explain or comment.
- Only return JSON with this exact shape (no backticks, no extra keys):

{{
  "edits": [
    {{
      "file": "relative/path/from/repo/root.tsx",
      "before": "EXACT snippet of existing code you expect to find",
      "after": "replacement code snippet"
    }}
  ]
}}

Rules:
- "file" must be a relative path under the repo root, and SHOULD start with app/, src/, lib/, prisma/, db/, or supabase/.
- "before" MUST match text that already exists in the file; we will replace the first occurrence.
- "after" is the new text that will replace "before".
- Use as FEW edits as possible to fix the failure.
- You MUST return valid JSON, nothing else.
"""

    response = client.responses.create(
        model=MODEL,
        instructions=(
            "You are a senior engineer for Fetti CRM. "
            "You only output strict JSON edits (file/before/after), no explanations."
        ),
        input=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": user_prompt,
                    }
                ],
            }
        ],
    )

    raw = response.output_text
    print("\n[AI] Raw model output:")
    print(raw)

    edits: List[dict] = []
    try:
        data: Any = json.loads(raw)
        edits = data.get("edits") or []
        if not isinstance(edits, list):
            edits = []
    except Exception as e:
        print(f"[AI] ❌ Could not parse model output as JSON: {e}")
        return False

    if not edits:
        print("[AI] No usable edits found in JSON.")
        log_ai_session(failed_step, raw, edits)
        return False

    # Log before applying
    log_ai_session(failed_step, raw, edits)

    return apply_json_edits(edits)


def main():
    banner()

    # 1st run: let Fetti Doctor do its thing
    code, log = run_doctor()

    if code == 0:
        print("[WRAPPER] Doctor succeeded. No AI fix needed.")
        return

    print("[WRAPPER] Doctor failed. Attempting AI fix...")

    fixed = ai_fix_with_openai(log)
    if not fixed:
        print("[WRAPPER] AI did not apply any fixes. Exiting with original failure.")
        raise SystemExit(code or 1)

    print("\n[WRAPPER] Re-running Fetti Doctor after AI fixes...")
    code2, log2 = run_doctor()

    if code2 == 0:
        print("[WRAPPER] ✅ Doctor succeeded after AI fix.")
        return

    print("[WRAPPER] ❌ Doctor still failing after AI fix. Exiting with error.")
    raise SystemExit(code2 or 1)


if __name__ == "__main__":
    main()
