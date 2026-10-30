"""Minimal Anthropic Messages client with an on-disk cache.

Credentials come from HA_LLM_BASE_URL / HA_LLM_TOKEN, falling back to the `env` block of
/root/.claude/settings.json (container only; pods have no such file). The inherited
ANTHROPIC_* variables are deliberately ignored: inside the IDE agent they point at the
agent's own session endpoint, which differs from the user's terminal.
The token is never logged or written to the cache.
"""
from __future__ import annotations

import hashlib
import json
import os
import urllib.request
from pathlib import Path

DEFAULT_MODEL = "claude-haiku-4-5-20251001"  # the only model the relay allows for raw API calls (E0, 2026-10-30)
SETTINGS = Path("/root/.claude/settings.json")


def _credentials() -> tuple[str, str]:
    base, token = os.environ.get("HA_LLM_BASE_URL"), os.environ.get("HA_LLM_TOKEN")
    if not (base and token) and SETTINGS.exists():
        env = json.loads(SETTINGS.read_text()).get("env", {})
        base, token = base or env.get("ANTHROPIC_BASE_URL"), token or env.get("ANTHROPIC_AUTH_TOKEN")
    if not (base and token):
        raise RuntimeError("LLM endpoint not configured")
    return base.rstrip("/"), token


def cache_key(model: str, system: str, prompt: str) -> str:
    return hashlib.sha256(json.dumps([model, system, prompt], ensure_ascii=False).encode()).hexdigest()


def complete(prompt: str, *, system: str = "", model: str = DEFAULT_MODEL, max_tokens: int = 512,
             cache_dir: Path | None = None, timeout: float = 60.0) -> dict:
    """Return {"text", "model", "cached", "usage"}; temperature is fixed at 0."""
    key = cache_key(model, system, prompt)
    path = cache_dir / f"{key}.json" if cache_dir else None
    if path and path.exists():
        return {**json.loads(path.read_text()), "cached": True}
    base, token = _credentials()
    body = {"model": model, "max_tokens": max_tokens, "temperature": 0,
            "messages": [{"role": "user", "content": prompt}]}
    if system:
        body["system"] = system
    req = urllib.request.Request(
        f"{base}/v1/messages", data=json.dumps(body).encode(),
        headers={"x-api-key": token, "Authorization": f"Bearer {token}",
                 "anthropic-version": "2023-06-01", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.load(resp)
    out = {"text": "".join(b.get("text", "") for b in data["content"]), "model": data.get("model", model),
           "usage": {k: data["usage"].get(k) for k in ("input_tokens", "output_tokens")}}
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, ensure_ascii=False))
    return {**out, "cached": False}
