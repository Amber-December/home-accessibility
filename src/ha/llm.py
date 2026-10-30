"""Minimal LLM client with an on-disk cache.

Configuration comes from environment variables (see .env.example):
  HA_LLM_BASE_URL   endpoint root, e.g. https://api.deepseek.com/v1 or https://api.anthropic.com
  HA_LLM_TOKEN      API key
  HA_LLM_MODEL      model name
  HA_LLM_PROTOCOL   "openai" (Chat Completions, default) or "anthropic" (Messages)
When the endpoint is not configured, complete() raises RuntimeError and callers use the rule-based fallback.
The token is never logged or written to the cache.
"""
from __future__ import annotations

import hashlib
import json
import os
import urllib.request
from pathlib import Path


def _config() -> tuple[str, str, str]:
    base, token = os.environ.get("HA_LLM_BASE_URL"), os.environ.get("HA_LLM_TOKEN")
    if not (base and token):
        raise RuntimeError("LLM endpoint not configured (HA_LLM_BASE_URL / HA_LLM_TOKEN)")
    protocol = os.environ.get("HA_LLM_PROTOCOL", "openai").lower()
    if protocol not in ("openai", "anthropic"):
        raise RuntimeError(f"HA_LLM_PROTOCOL must be openai or anthropic, got {protocol!r}")
    return base.rstrip("/"), token, protocol


def default_model() -> str:
    return os.environ.get("HA_LLM_MODEL", "")


def cache_key(model: str, system: str, prompt: str) -> str:
    return hashlib.sha256(json.dumps([model, system, prompt], ensure_ascii=False).encode()).hexdigest()


def _build_request(base: str, token: str, protocol: str, model: str, system: str, prompt: str,
                   max_tokens: int) -> urllib.request.Request:
    if protocol == "anthropic":
        url = f"{base}/v1/messages"
        body = {"model": model, "max_tokens": max_tokens, "temperature": 0,
                "messages": [{"role": "user", "content": prompt}]}
        if system:
            body["system"] = system
        headers = {"x-api-key": token, "anthropic-version": "2023-06-01"}
    else:
        url = base if base.endswith("/chat/completions") else f"{base}/chat/completions"
        messages = [{"role": "system", "content": system}] if system else []
        messages.append({"role": "user", "content": prompt})
        body = {"model": model, "max_tokens": max_tokens, "temperature": 0, "messages": messages}
        headers = {"Authorization": f"Bearer {token}"}
    return urllib.request.Request(url, data=json.dumps(body).encode(),
                                  headers={**headers, "content-type": "application/json"})


def _parse(protocol: str, data: dict) -> tuple[str, dict]:
    if protocol == "anthropic":
        text = "".join(b.get("text", "") for b in data["content"])
        u = data.get("usage") or {}
        return text, {"input_tokens": u.get("input_tokens"), "output_tokens": u.get("output_tokens")}
    text = data["choices"][0]["message"].get("content") or ""
    u = data.get("usage") or {}
    return text, {"input_tokens": u.get("prompt_tokens"), "output_tokens": u.get("completion_tokens")}


def complete(prompt: str, *, system: str = "", model: str | None = None, max_tokens: int = 512,
             cache_dir: Path | None = None, timeout: float = 60.0) -> dict:
    """Return {"text", "model", "cached", "usage"}; temperature is fixed at 0."""
    model = model or default_model()
    key = cache_key(model, system, prompt)
    path = cache_dir / f"{key}.json" if cache_dir else None
    if path and path.exists():
        return {**json.loads(path.read_text()), "cached": True}
    base, token, protocol = _config()
    if not model:
        raise RuntimeError("LLM model not configured (HA_LLM_MODEL)")
    req = _build_request(base, token, protocol, model, system, prompt, max_tokens)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.load(resp)
    text, usage = _parse(protocol, data)
    out = {"text": text, "model": data.get("model", model), "usage": usage}
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, ensure_ascii=False))
    return {**out, "cached": False}
