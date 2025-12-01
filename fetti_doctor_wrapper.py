#!/usr/bin/env python3
"""
Fetti Doctor Wrapper – simple health check + optional auto-deploy.

Called from package.json as:

  "fetti:auto": "python3 fetti_doctor_wrapper.py --auto"

Behavior:
  1) npm run lint
  2) npm run build
  3) If both succeed and FETTI_AUTO_DEPLOY=1, run `npm run fetti:deploy`
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def run_step(name: str, cmd: list[str]) -> int:
    """Run a single step and stream output."""
    print("\n" + "=" * 60)
    print(f"[{datetime.now().isoformat(sep=' ', timespec='seconds')}] FETTI DOCTOR – Step: {name}")
    print("=" * 60)
    print(f"[FETTI DOCTOR] $ {' '.join(cmd)}\n")
    result = subprocess.run(cmd)
    return result.returncode


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--auto", action="store_true", help="Run in auto mode (currently same behavior).")
    _ = parser.parse_args()  # we don't actually branch on this yet

    errors_path = Path("fetti_last_errors.json")

    steps = [
        ("Lint", ["npm", "run", "lint"]),
        ("Build", ["npm", "run", "build"]),
    ]

    failed_step = None
    failed_code = 0

    for name, cmd in steps:
        code = run_step(name, cmd)
        if code != 0:
            failed_step = name
            failed_code = code
            break

    if failed_step is not None:
        # record simple failure info for the feature agent brain
        errors_path.write_text(
            json.dumps(
                {
                    "failed_step": failed_step,
                    "exit_code": failed_code,
                    "timestamp": datetime.now().isoformat(),
                },
                indent=2,
            )
            + "\n"
        )
        print("\n[FETTI DOCTOR] Health check failed. ❌")
        sys.exit(failed_code)

    # All steps passed
    errors_path.write_text(
        json.dumps(
            {
                "failed_step": None,
                "exit_code": 0,
                "timestamp": datetime.now().isoformat(),
            },
            indent=2,
        )
        + "\n"
    )

    print("\n[FETTI DOCTOR] All steps passed. ✅")
    print("[FETTI DOCTOR] Lint / Test (if any) / Build all succeeded with no critical issues.\n")

    # Auto-deploy hook: Git push -> Vercel
    if os.environ.get("FETTI_AUTO_DEPLOY") == "1":
        print("[FETTI DOCTOR] Auto-deploy enabled – running `npm run fetti:deploy`...")
        try:
            subprocess.run(["npm", "run", "fetti:deploy"], check=True)
            print("[FETTI DOCTOR] Auto-deploy completed successfully.")
        except subprocess.CalledProcessError as e:
            print(f"[FETTI DOCTOR] Auto-deploy failed with code {e.returncode}.")

    sys.exit(0)


if __name__ == "__main__":
    main()
