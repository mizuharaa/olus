"""Load the server-only copilot key without putting it in SSM command logs."""

import json
import os
import re
import subprocess
import sys
from pathlib import Path


def load(region: str, target: Path) -> None:
    result = subprocess.run(
        [
            "aws",
            "ssm",
            "get-parameter",
            "--region",
            region,
            "--name",
            "/olus/production/gemini-api-key",
            "--with-decryption",
            "--output",
            "json",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode:
        if "ParameterNotFound" in result.stderr:
            print("Copilot key not provisioned; existing runtime configuration retained.")
            return
        raise RuntimeError("Could not load copilot configuration from Parameter Store")
    key = json.loads(result.stdout)["Parameter"]["Value"]
    if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", key):
        raise ValueError("Copilot key has an invalid format")
    temporary = target.with_suffix(".next")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write("GEMINI_API_KEY=" + key + "\n")
    os.chmod(temporary, 0o600)
    temporary.replace(target)
    print("Copilot runtime configuration loaded.")


if __name__ == "__main__":
    load(sys.argv[1], Path(sys.argv[2]))
