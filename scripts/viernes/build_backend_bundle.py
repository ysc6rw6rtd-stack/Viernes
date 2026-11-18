"""Assemble the self-contained Python backend that ships inside the Viernes
desktop installer.

The bundle lets the desktop app start without Git, Rust or Visual Studio
Build Tools on the user's machine:

* the backend source is copied from the git checkout (no clone at runtime);
* the native ``openjarvis_rust`` extension is a prebuilt wheel, and
  ``pyproject.toml`` is rewritten to install that wheel instead of compiling
  the Rust crate;
* ``.python-version`` pins the interpreter the wheel was built for, and
  ``uv.lock`` is regenerated so ``uv sync`` resolves the same way at runtime;
* a ``.viernes-prebuilt`` marker tells the desktop app not to look for Cargo.

Usage::

    python scripts/viernes/build_backend_bundle.py OUT_DIR WHEEL PYTHON_VERSION [UV]
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

import tomllib

REPO = Path(__file__).resolve().parents[2]

# Paths the backend needs: package source plus everything hatch's
# force-include section references at build time.
INCLUDE = [
    "pyproject.toml",
    "uv.lock",
    "README.md",
    "LICENSE",
    "src",
    "configs",
    "scripts/install",
    "deploy/windows",
]

RUST_SOURCE = 'openjarvis-rust = { path = "rust/crates/openjarvis-python" }'
REQUIRES_PYTHON = 'requires-python = ">=3.11,<3.14"'

# uv resolves for every platform by default; the bundle only ever runs where
# the prebuilt wheel does, so limit resolution to that platform.
PLATFORM_MARKERS = {
    "win_amd64": "sys_platform == 'win32' and platform_machine == 'AMD64'",
    "x86_64": "sys_platform == 'linux' and platform_machine == 'x86_64'",
}


def platform_marker(wheel_name: str) -> str:
    platform_tag = wheel_name.removesuffix(".whl").split("-")[-1]
    for suffix, marker in PLATFORM_MARKERS.items():
        if platform_tag.endswith(suffix):
            return marker
    raise SystemExit(f"Unsupported wheel platform: {platform_tag}")


MARKER = ".viernes-prebuilt"

# Extras the desktop app installs (see DESKTOP_UV_SYNC_COMMAND in the Tauri
# app). Every other extra is dropped from the bundle: several (vLLM, MLX,
# training stacks) cannot resolve on Windows and would block `uv lock`.
DESKTOP_EXTRAS = ("desktop", "inference-cloud", "inference-google")


def required_extras(extras: dict[str, list[str]], roots: tuple[str, ...]) -> list[str]:
    """Return ``roots`` plus every extra they pull in via ``openjarvis[...]``."""
    needed: list[str] = []
    stack = list(roots)
    while stack:
        name = stack.pop()
        if name in needed:
            continue
        needed.append(name)
        for req in extras[name]:
            match = re.match(r"\s*openjarvis\[([^\]]+)\]", req)
            if match:
                stack.extend(e.strip() for e in match.group(1).split(","))
    return sorted(needed)


def prune_extras(text: str) -> str:
    """Rewrite [project.optional-dependencies] to keep only the desktop extras."""
    extras = tomllib.loads(text)["project"]["optional-dependencies"]
    keep = required_extras(extras, DESKTOP_EXTRAS)
    header = "[project.optional-dependencies]\n"
    start = text.index(header) + len(header)
    end_match = re.compile(r"^\[", re.MULTILINE).search(text, start)
    end = end_match.start() if end_match else len(text)
    body = "".join(
        f"{name} = [{', '.join(json.dumps(req) for req in extras[name])}]\n"
        for name in keep
    )
    return text[:start] + body + "\n" + text[end:]


def export_tree(out: Path) -> None:
    """Copy tracked files under INCLUDE (git archive keeps the tree clean)."""
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "src.tar"
        subprocess.run(
            [
                "git",
                "-C",
                str(REPO),
                "archive",
                "--format=tar",
                "-o",
                str(archive),
                "HEAD",
                "--",
                *INCLUDE,
            ],
            check=True,
        )
        with tarfile.open(archive) as tar:
            tar.extractall(out, filter="data")


def main(argv: list[str]) -> int:
    if len(argv) not in (4, 5):
        print(__doc__)
        return 2
    out = Path(argv[1]).resolve()
    wheel = Path(argv[2]).resolve()
    python_version = argv[3]
    uv = argv[4] if len(argv) == 5 else "uv"

    if not re.fullmatch(r"openjarvis_rust-.+\.whl", wheel.name):
        raise SystemExit(f"Not an openjarvis_rust wheel: {wheel}")

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    export_tree(out)

    wheels = out / "wheels"
    wheels.mkdir()
    shutil.copy2(wheel, wheels / wheel.name)

    pyproject = out / "pyproject.toml"
    text = pyproject.read_text(encoding="utf-8")
    if text.count(RUST_SOURCE) != 1:
        raise SystemExit("pyproject.toml no longer has the expected Rust source line")
    text = text.replace(
        RUST_SOURCE,
        f'openjarvis-rust = {{ path = "wheels/{wheel.name}" }}',
    )
    if text.count(REQUIRES_PYTHON) != 1:
        raise SystemExit("pyproject.toml no longer has the expected requires-python")
    text = text.replace(REQUIRES_PYTHON, f'requires-python = "=={python_version}.*"')
    text = prune_extras(text)
    # Report the Viernes release as the backend version (no .git in the bundle).
    viernes_version = os.environ.get("VIERNES_VERSION", "")
    fallback = 'fallback_version = "0.0.0+unknown"'
    if viernes_version and fallback in text:
        text = text.replace(fallback, f'fallback_version = "{viernes_version}"')
    text += f'\n[tool.uv]\nenvironments = ["{platform_marker(wheel.name)}"]\n'
    pyproject.write_text(text, encoding="utf-8")

    (out / ".python-version").write_text(f"{python_version}\n", encoding="utf-8")
    (out / MARKER).write_text("openjarvis_rust is a prebuilt wheel\n", encoding="utf-8")

    subprocess.run([uv, "lock", "--python", python_version], cwd=out, check=True)
    print(f"Backend bundle ready at {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
