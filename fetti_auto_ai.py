import os
import json
import subprocess
import textwrap
import time
import datetime as _dt
from pathlib import Path

from openai import OpenAI

PROJECT_ROOT = Path(__file__).resolve().parent
MODEL = os.environ.get("FETTI_WIZARD_MODEL", "gpt-4.1-mini")
client = OpenAI()  # uses OPENAI_API_KEY from env

PLAN = [
    ("Run lint",   ["npm", "run", "lint"]),
    ("Run tests",  ["npm", "test"]),
    ("Run build",  ["npm", "run", "build"]),
]

def header():
    print("\n" + "=" * 60)
    print("   <0001agent>  Fetti Wizard – AI Auto Builder")
    print("=" * 60)
    print(
        textwrap.dedent(
            '''
            Mode: AI-driven autopilot

            - Runs a fixed plan of steps (lint, test, build, etc.)
            - If a step fails:
                • sends the error log to OpenAI
                • asks for very specific code edits (JSON)
                • applies those edits to your repo
                • re-runs the failed step once
            - If it still fails, it STOPS and shows logs.

            No prompts. No "keep building?". You control it with Ctrl+C.
            '''
        ).strip()
    )
    print("\n")

def run_cmd(title, cmd):
    print("\n" + "=" * 60)
    print(f"[{_dt.datetime.now().strftime('%H:%M:%S')}] {title}")
    print("=" * 60)
    print(f"[CMD] {' '.join(cmd)}\n")

    proc = subprocess.run(
        cmd,
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True
    )

    out = (proc.stdout or "") + "\n" + (proc.stderr or "")
    print(out.strip())

    ok = proc.returncode == 0
    print(f"\n[RESULT] {'✅ SUCCESS' if ok else '❌ FAILED'} (code {proc.returncode})")
    return ok, out

def ai_fix_project(step_title, cmd, log: str) -> bool:
    print("\n[AI] Asking OpenAI for an automatic fix...")

    trimmed_log = log[-16000:]

    user_prompt = f"""
    You are an autonomous build agent working on a Next.js / TypeScript / Supabase / Prisma project called "Fetti CRM".

    Your environment:
    - You CANNOT actually run commands; that is handled outside.
    - You CAN propose precise code edits, and those edits will be applied exactly as you specify.
    - The repository root is the current working directory.
    - Paths you mention must be relative to the repo root (e.g. "src/app/page.tsx").

    A build step failed.

    Last step title: {step_title}
    Command: {" ".join(cmd)}

    Build output (tail):
    --------------------
    {trimmed_log}
    --------------------

    Your job:
    - Infer the likely root cause of this failure.
    - Propose the smallest number of changes that will fix it.
    - DO NOT explain. DO NOT comment.
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
    - "file" must be a real path under the repo root.
    - "before" MUST match text that already exists in the file; we will replace the first occurrence.
    - "after" is the new text that will replace "before".
    - Use as FEW edits as possible.
    - You MUST return valid JSON, nothing else.
    """

    response = client.responses.create(
        model=MODEL,
        instructions="You are a senior TypeScript/Next.js engineer for Fetti CRM. You only output strict JSON edits, no explanations.",
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

    try:
        data = json.loads(raw)
    except Exception as e:
        print(f"\n[AI] ❌ Could not parse model output as JSON: {e}")
        return False

    edits = data.get("edits") or []
    if not isinstance(edits, list) or not edits:
        print("\n[AI] No usable edits found in JSON.")
        return False

    applied_any = False

    for edit in edits:
        file_rel = edit.get("file")
        before = edit.get("before")
        after = edit.get("after")

        if not file_rel or before is None or after is None:
            print(f"[AI] Skipping malformed edit entry: {edit}")
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
                print(f"[AI] Created backup: {backup.name}")
            except Exception as e:
                print(f"[AI] Could not create backup for {file_rel}: {e}")

        try:
            target_path.write_text(new_src)
            print(f"[AI] ✅ Applied edit to {file_rel}")
            applied_any = True
        except Exception as e:
            print(f"[AI] Failed to write updated file {file_rel}: {e}")

    if not applied_any:
        print("\n[AI] No edits were actually applied.")
    return applied_any

def run_plan_once() -> bool:
    for title, cmd in PLAN:
        ok, log = run_cmd(title, cmd)
        if ok:
            continue

        print(f"\n[PLAN] Step failed: {title}")
        print("[PLAN] Sending to AI for auto-fix...")

        fixed = ai_fix_project(title, cmd, log)

        if not fixed:
            print("[PLAN] AI could not provide/apply a fix. Stopping.")
            return False

        print("\n[PLAN] Re-running failed step after AI fix...\n")
        ok2, log2 = run_cmd(title, cmd)
        if not ok2:
            print("[PLAN] Still failing even after AI fix. Stopping.")
            return False

    return True

def main():
    header()
    loop_delay = 15

    while True:
        print("\n" + "-" * 60)
        print(f"[LOOP] New run at {_dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("-" * 60)

        success = run_plan_once()

        if not success:
            print(
                textwrap.dedent(
                    '''
                    [LOOP] Plan did not complete successfully, even after AI attempt.
                           Wizard is stopping so you can inspect and commit/rollback.

                    Tip:
                    - Check git diff, review AI changes.
                    - Fix anything manually as needed.
                    - Then re-run: python3 fetti_auto_ai.py
                    '''
                ).strip()
            )
            break

        print(
            textwrap.dedent(
                f'''
                [LOOP] ✅ Plan completed successfully.

                Sleeping {loop_delay} seconds before running again.
                Press Ctrl+C at any time to stop the wizard.
                '''
            ).strip()
        )

        try:
            time.sleep(loop_delay)
        except KeyboardInterrupt:
            print("\n[LOOP] Stopped by user (Ctrl+C). Bye.")
            break

if __name__ == "__main__":
    main()
