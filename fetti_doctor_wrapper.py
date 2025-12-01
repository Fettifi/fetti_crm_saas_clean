from __future__ import annotations
import subprocess
import sys
from typing import List
from fetti_error_logger import record_error

def main(argv: List[str]) -> None:
    # Run the real Fetti Doctor in a subprocess
    cmd = ["python3", "fetti_doctor.py"] + argv
    proc = subprocess.run(
        cmd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    # Stream Doctor output back to the terminal
    sys.stdout.write(proc.stdout)

    # On failure, log to fetti_last_errors.json
    if proc.returncode != 0:
        step = " ".join(argv) or "--auto"
        record_error(source="fetti_doctor", step=step, details=proc.stdout)

    # Exit with the same code so npm / nodemon behave as before
    sys.exit(proc.returncode)

if __name__ == "__main__":
    main(sys.argv[1:])
