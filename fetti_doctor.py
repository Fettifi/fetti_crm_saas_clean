import subprocess
import textwrap
import datetime as _dt
from pathlib import Path
import sys
import json

PROJECT_ROOT = Path(__file__).resolve().parent


def header():
    print("\n" + "=" * 40)
    print("   <0001doc>  Fetti Doctor – CRM Helper")
    print("=" * 40)
    print(
        textwrap.dedent(
            """
            - Runs a multi-step health check for this repo:
                1) npm run lint
                2) npm test (only if defined in package.json)
                3) npm run build
            - Designed to be called with --auto by Fetti Wizard / Wrapper.
            """
        ).strip()
    )
    print("\n")


def run_step(name, cmd):
    now = _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print("\n" + "=" * 60)
    print(f"[{now}] FETTI DOCTOR – Step: {name}")
    print("=" * 60)
    print(f"[FETTI DOCTOR] $ {' '.join(cmd)}\n")

    proc = subprocess.run(cmd, cwd=PROJECT_ROOT, text=True)
    code = proc.returncode
    if code == 0:
        print(f"\n[FETTI DOCTOR] Step '{name}' ✅ (exit code 0)")
    else:
        print(f"\n[FETTI DOCTOR] Step '{name}' ❌ (exit code {code})")
    return code


def get_steps():
    steps = [("Lint", ["npm", "run", "lint"])]

    pkg_path = PROJECT_ROOT / "package.json"
    try:
        pkg = json.loads(pkg_path.read_text())
        scripts = pkg.get("scripts", {})
        if "test" in scripts:
            steps.append(("Test", ["npm", "test"]))
    except Exception:
        pass

    steps.append(("Build", ["npm", "run", "build"]))
    return steps


def main():
    header()

    steps = get_steps()
    failed_step = None
    failed_code = 0

    for name, cmd in steps:
        code = run_step(name, cmd)
        if code != 0:
            failed_step = name
            failed_code = code
            break

    if failed_step is None:
        print("\n[FETTI DOCTOR] All steps passed. ✅")
        print("[FETTI DOCTOR] Lint / Test (if any) / Build all succeeded with no critical issues.\n")
        sys.exit(0)
    else:
        print(
            f"\n[FETTI DOCTOR] Health check failed at step '{failed_step}' "
            f"with exit code {failed_code}. ❌"
        )
        sys.exit(failed_code)


if __name__ == "__main__":
    main()
