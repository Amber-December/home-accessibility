"""Run directories and manifest.json for every experiment run."""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import platform
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def outputs_root() -> Path:
    return Path(os.environ.get("HA_OUTPUTS") or REPO / "outputs")


def git_state() -> dict:
    def run(*args):
        return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True).stdout.strip()
    return {"commit": run("rev-parse", "HEAD"), "dirty": bool(run("status", "--porcelain", "--", "src", "scripts"))}


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


def new_run(experiment: str, tag: str = "") -> Path:
    stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = outputs_root() / "runs" / experiment / (f"{stamp}-{tag}" if tag else stamp)
    run_dir.mkdir(parents=True, exist_ok=False)
    return run_dir


def write_manifest(run_dir: Path, *, experiment: str, params: dict, inputs: dict | None = None,
                   models: dict | None = None, status: str = "COMPLETED", notes: str = "") -> Path:
    manifest = {
        "experiment": experiment, "run_id": run_dir.name, "status": status,
        "created": _dt.datetime.now().isoformat(timespec="seconds"),
        "git": git_state(), "python": platform.python_version(), "host": platform.node(),
        "params": params, "inputs": inputs or {}, "models": models or {}, "notes": notes,
    }
    path = run_dir / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    return path
