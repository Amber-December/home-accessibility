"""Download every product image in src/ha/assets/catalog.yaml once and check it decodes (no Lux3D calls).

Lux3D img-to-3d needs an image URL or upload it can fetch; this confirms the inputs exist before paying.
Output: $HA_OUTPUTS/assets/catalog-images-<date>/{<sku>_<tag>.<ext>, check.json} ($HA_OUTPUTS defaults to outputs/).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import urllib.request

import cv2
import numpy as np
import yaml

from ha.runlog import REPO, outputs_root

EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def fetch(url: str) -> tuple[bytes, str, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read(), r.headers.get("Content-Type") or "", r.geturl()


def main():
    cat = yaml.safe_load((REPO / "src/ha/assets/catalog.yaml").read_text())
    out = outputs_root() / f"assets/catalog-images-{dt.date.today():%Y%m%d}"
    out.mkdir(parents=True, exist_ok=True)
    res = {}
    for s in cat["skus"]:
        urls = [("main", s["reference"].get("image"))]
        urls += [(f"alt{i}", a.get("image")) for i, a in enumerate(s.get("alternatives", []))]
        for tag, url in urls:
            if not url or url == "none":
                continue
            key = f"{s['id']}_{tag}"
            try:
                b, ct, final = fetch(url)
                im = cv2.imdecode(np.frombuffer(b, np.uint8), cv2.IMREAD_COLOR)
                (out / (key + EXT.get(ct.split(";")[0], ".bin"))).write_bytes(b)
                res[key] = {"ok": im is not None, "content_type": ct, "bytes": len(b),
                            "shape": None if im is None else list(im.shape), "sha256": hashlib.sha256(b).hexdigest(),
                            "url": url, "final_url": final}
            except Exception as e:  # noqa: BLE001 - record and continue
                res[key] = {"ok": False, "error": repr(e)[:200], "url": url}
            print(key, {k: res[key].get(k) for k in ("ok", "content_type", "bytes", "shape", "error")}, flush=True)
    (out / "check.json").write_text(json.dumps(res, indent=1))
    print("ok", sum(r["ok"] for r in res.values()), "/", len(res), "->", out)


if __name__ == "__main__":
    main()
