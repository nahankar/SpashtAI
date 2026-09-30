"""Install the reviewed Hush wheel only after verifying its SHA-256.

Run after ``pip install -r requirements.txt`` in every agent environment.
The runtime performs source/model checks too; this protects the package
artifact at installation time so a version-only PyPI resolution is not the
sole supply-chain control.
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
import tempfile
from pathlib import Path


PACKAGE = "livekit-plugins-hush==0.3.3"
WHEEL_SHA256 = "f7e18e96c86f53571cc97420d7d3e133c3830e7b4eddd6ba89dcccfc56a6c5cf"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="spashtai-hush-wheel-") as directory:
        destination = Path(directory)
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "download",
                "--no-deps",
                "--only-binary=:all:",
                "--dest",
                str(destination),
                PACKAGE,
            ],
            check=True,
        )
        wheels = list(destination.glob("livekit_plugins_hush-0.3.3-*.whl"))
        if len(wheels) != 1:
            raise RuntimeError(f"expected one Hush 0.3.3 wheel, found {len(wheels)}")
        wheel = wheels[0]
        actual = sha256(wheel)
        if actual != WHEEL_SHA256:
            raise RuntimeError(
                f"Hush wheel SHA-256 mismatch: expected {WHEEL_SHA256}, got {actual}"
            )
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--no-deps",
                "--force-reinstall",
                str(wheel),
            ],
            check=True,
        )
        print(f"verified + installed {wheel.name} sha256={actual}")


if __name__ == "__main__":
    main()
