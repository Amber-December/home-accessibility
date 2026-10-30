"""M3 Lux3D asset factory (simulation §5; integration doc §3). Dry run unless --create is given.

  python -m ha.assets.lux3d_factory --sku S1                  # plan, cost, cache and ledger check; no paid call
  python -m ha.assets.lux3d_factory --sku S1 --create         # paid: runs the SKU's route end to end
  python -m ha.assets.lux3d_factory --sku S1 --from-glb x.glb # local post-processing only (normalize + CoACD)

Rules enforced here (plan §4): every create is appended to $HA_OUTPUTS/assets/<run_id>/ledger.jsonl before
polling, failures included; a SKU whose cache key already has a successful generation is not created again; a
created-but-unfinished task is resumed instead of re-created; remote tasks missing from every ledger stop the run;
the cumulative estimated spend across all ledgers may not pass BUDGET. Result URLs expire after 2 h, so every
output is downloaded as soon as its task succeeds.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

import cv2
import numpy as np
import yaml

from ha.assets import normalize
from ha.runlog import outputs_root

CATALOG = Path(__file__).with_name("catalog.yaml")
BUDGET = 600
# Quote 2026-10-30, BEFORE_ACCOUNT_BENEFITS ($HA_OUTPUTS/assets/quote-20261030/quote.json).
PRICE = {"four_view": 24, "img_to_3d": 1, "text_to_3d": 13, "articulation": 28, "export": 1}
GEN = {"version": "G1-Turbo", "face_count": 20000, "output_format": ["glb"], "enable_pbr": True,
       "ai_predict_size": False}
EXPORT_FORMATS = ["usdz", "obj_zip"]
MAX_IMG_PX = 1600
POLL = {"interval_ms": 5000, "timeout_ms": 30 * 60 * 1000}


def load_catalog() -> dict:
    return {s["id"]: s for s in yaml.safe_load(CATALOG.read_text())["skus"]}


def steps(sku: dict) -> list[str]:
    first = ["four_view", "img_to_3d"] if sku["route"] == "multiview_g1turbo" else ["text_to_3d"]
    return first + (["articulation"] if sku.get("articulate") else []) + ["export"]


def assets_root() -> Path:
    return outputs_root() / "assets"


def ledger_records() -> list[dict]:
    out = []
    for p in sorted(assets_root().glob("*/ledger.jsonl")):
        out += [json.loads(line) | {"_ledger": str(p)} for line in p.read_text().splitlines() if line.strip()]
    return out


def spent(records: list[dict]) -> int:
    return sum(r.get("credits_est", 0) for r in records if r.get("event") == "create")


def fetch(url: str, timeout: int = 120) -> tuple[bytes, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers.get("Content-Type") or ""


def product_image(sku: dict) -> bytes | None:
    """Reference image as JPEG bytes, longest side <= MAX_IMG_PX. These bytes are what Lux3D receives."""
    url = sku["reference"].get("image")
    if not url or url == "none":
        return None
    raw, _ = fetch(url, timeout=30)
    im = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if im is None:
        raise ValueError(f"{sku['id']}: image does not decode")
    k = MAX_IMG_PX / max(im.shape[:2])
    if k < 1:
        im = cv2.resize(im, (round(im.shape[1] * k), round(im.shape[0] * k)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", im, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return buf.tobytes()


def cache_key(sku: dict, img: bytes | None) -> str:
    spec = {"id": sku["id"], "nominal_m": sku["nominal_m"], "route": sku["route"],
            "articulate": bool(sku.get("articulate")), "prompt": sku.get("prompt"), "gen": GEN,
            "export": EXPORT_FORMATS, "image_sha256": hashlib.sha256(img).hexdigest() if img else None}
    return hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()


def cached(records: list[dict], key: str) -> dict | None:
    """Last finished generation for this key whose GLB is still on disk."""
    hits = [r for r in records if r.get("key") == key and r.get("event") == "done" and r.get("step") in
            ("img_to_3d", "text_to_3d") and r.get("files") and all(Path(f).exists() for f in r["files"])]
    return hits[-1] if hits else None


def pending(records: list[dict], key: str, step: str) -> int | None:
    """task_id of a create for (key, step) that has no done/failed record yet."""
    ended = {r["task_id"] for r in records if r.get("event") in ("done", "failed")}
    open_ = [r["task_id"] for r in records if r.get("key") == key and r.get("step") == step
             and r.get("event") == "create" and r["task_id"] not in ended]
    return open_[-1] if open_ else None
ART_PROMPT = {"refrigerator": "open the refrigerator doors and freezer drawers"}
URL_EXT = (".glb", ".zip", ".usdz", ".png", ".jpg", ".jpeg", ".webp", ".json")


def _now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def _urls(result: dict) -> list[str]:
    return [o["content"] for o in result.get("outputs", []) if str(o.get("content", "")).startswith("http")]


class Factory:
    """One run directory, one ledger. Only create() spends credits; everything else is read-only."""

    def __init__(self, run_dir: Path):
        from manycore.aholo_sdk_core import AholoClientConfig
        from manycore.aholo_sdk_lux3d import create_lux3d_client

        self.c = create_lux3d_client(AholoClientConfig(region="cn"))
        self.run_dir = run_dir
        self.ledger = run_dir / "ledger.jsonl"

    def log(self, **rec) -> None:
        with open(self.ledger, "a") as f:
            f.write(json.dumps({"ts": _now(), **rec}, ensure_ascii=False) + "\n")

    def unknown_remote_tasks(self, records: list[dict]) -> list[int]:
        known = {r.get("task_id") for r in records}
        items = self.c.tasks.list(page=1, page_size=100).get("items") or []
        return [it["taskId"] for it in items if it["taskId"] not in known]

    def download(self, urls: list[str], out: Path) -> list[str]:
        out.mkdir(parents=True, exist_ok=True)
        files = []
        for k, u in enumerate(urls):
            name = Path(urlsplit(u).path).name or f"out{k}"
            if not name.lower().endswith(URL_EXT):
                name += ".bin"
            p = out / f"{k:02d}_{name}"
            p.write_bytes(fetch(u)[0])
            files.append(str(p))
        return files

    def task(self, sku: dict, key: str, step: str, create, params: dict, out: Path) -> tuple[list[str], list[str]]:
        base = {"sku": sku["id"], "key": key, "step": step}
        tid = pending(ledger_records(), key, step)
        if tid is None:
            tid = create()
            self.log(event="create", task_id=tid, params=params, credits_est=PRICE[step], **base)
        else:
            self.log(event="resume", task_id=tid, **base)
        print(sku["id"], step, "task", tid, flush=True)
        try:
            res = self.c.tasks.wait_for(tid, **POLL)
        except Exception as e:  # noqa: BLE001 - a poll timeout leaves the task open so the next run resumes it
            status = None
            try:
                status = self.c.tasks.retrieve(tid).get("status")
            except Exception:  # noqa: BLE001
                pass
            self.log(event="failed" if status in (4, 6) else "poll_error", task_id=tid, status=status,
                     error=repr(e)[:300], **base)
            raise
        urls = _urls(res)
        files = self.download(urls, out / step)
        self.log(event="done", task_id=tid, biz_id=res.get("bizId"), urls=urls, files=files, **base)
        return urls, files

    def run(self, sku: dict, allow_unknown: bool = False) -> dict:
        img = product_image(sku) if sku["route"] == "multiview_g1turbo" else None
        key = cache_key(sku, img)
        records = ledger_records()
        if (hit := cached(records, key)) is not None:
            raise SystemExit(f"{sku['id']}: cache hit {hit['files'][0]}; not creating again")
        if sum(r.get("event") == "qa" and r.get("sku") == sku["id"] and not r.get("qa_pass") for r in records) >= 2:
            raise SystemExit(f"{sku['id']}: QA failed twice; use the bounding box stand-in (plan §4)")
        if (unk := self.unknown_remote_tasks(records)) and not allow_unknown:
            raise SystemExit(f"remote tasks missing from every ledger: {unk}; reconcile before creating")
        cost = sum(PRICE[s] for s in steps(sku))
        if spent(records) + cost > BUDGET:
            raise SystemExit(f"budget: spent {spent(records)} + {cost} > {BUDGET}")
        d = self.run_dir / sku["id"]
        d.mkdir(parents=True, exist_ok=True)
        if img is not None:
            (d / "input.jpg").write_bytes(img)
            data_url = "data:image/jpeg;base64," + base64.b64encode(img).decode("ascii")
            sha = hashlib.sha256(img).hexdigest()
            views, _ = self.task(sku, key, "four_view", lambda: self.c.image_to_four_view.create(img=data_url),
                                 {"img_sha256": sha}, d)
            gen_step = "img_to_3d"
            urls, files = self.task(sku, key, gen_step, lambda: self.c.img_to_3d.create(imgs=views, **GEN),
                                    {"imgs": views, **GEN}, d)
        else:
            gen_step = "text_to_3d"
            urls, files = self.task(sku, key, gen_step,
                                    lambda: self.c.text_to_3d.create(prompt=sku["prompt"], **GEN),
                                    {"prompt": sku["prompt"], **GEN}, d)
        glb = next(i for i, u in enumerate(urls) if urlsplit(u).path.lower().endswith(".glb"))
        glb_url, glb_file = urls[glb], files[glb]
        if sku.get("articulate"):
            prompt = ART_PROMPT.get(sku["category"], "open all doors and drawers")
            self.task(sku, key, "articulation",
                      lambda: self.c.articulation_animation.create(glb_url=glb_url, prompt=prompt),
                      {"glb_url": glb_url, "prompt": prompt}, d)
        self.task(sku, key, "export",
                  lambda: self.c.multi_format_export.create(model_url=glb_url, output_format=EXPORT_FORMATS),
                  {"model_url": glb_url, "output_format": EXPORT_FORMATS}, d)
        qa = normalize.process(glb_file, sku["nominal_m"], d / "normalized")
        self.log(event="qa", sku=sku["id"], key=key, step=gen_step, qa_pass=qa["qa_pass"], spread=qa["spread"])
        return qa


def main(argv=None) -> None:
    from ha import runlog

    ap = argparse.ArgumentParser()
    ap.add_argument("--sku", nargs="+", required=True)
    ap.add_argument("--create", action="store_true", help="spend credits (needs user approval per plan §4)")
    ap.add_argument("--from-glb", help="local post-processing of an existing GLB; no network")
    ap.add_argument("--up", default="y", choices=["y", "z"])
    ap.add_argument("--allow-unknown", action="store_true")
    a = ap.parse_args(argv)
    cat = load_catalog()
    skus = [cat[s] for s in a.sku]
    if a.from_glb:
        run_dir = runlog.new_run("M3", tag=f"normalize-{'-'.join(a.sku)}")
        for s in skus:
            print(s["id"], json.dumps(normalize.process(a.from_glb, s["nominal_m"], run_dir / s["id"], up=a.up)))
        runlog.write_manifest(run_dir, experiment="M3", params={"from_glb": a.from_glb, "up": a.up, "skus": a.sku},
                              inputs={"glb_sha256": runlog.sha256_file(Path(a.from_glb))})
        return
    records = ledger_records()
    for s in skus:
        img = product_image(s) if s["route"] == "multiview_g1turbo" else None
        key = cache_key(s, img)
        print(s["id"], "steps", steps(s), "credits", sum(PRICE[x] for x in steps(s)), "key", key[:12],
              "cache", bool(cached(records, key)), "image_bytes", len(img) if img else None)
    print("spent_est", spent(records), "budget", BUDGET)
    if not a.create:
        print("dry run: no create call made")
        return
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = assets_root() / f"lux3d-{stamp}"
    run_dir.mkdir(parents=True)
    f = Factory(run_dir)
    res = {}
    for s in skus:
        try:
            res[s["id"]] = f.run(s, a.allow_unknown)
        except (SystemExit, Exception) as e:  # noqa: BLE001 - record per SKU, keep the manifest
            res[s["id"]] = {"stopped": str(e)}
            print(e, file=sys.stderr)
    runlog.write_manifest(run_dir, experiment="E7", params={"skus": a.sku, "gen": GEN, "price": PRICE,
                          "budget": BUDGET}, notes=json.dumps(res, ensure_ascii=False)[:2000])


if __name__ == "__main__":
    main()
