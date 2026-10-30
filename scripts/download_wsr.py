"""下载 World-SimReady-Home（gated，需 private/hf.env 里的 HF_TOKEN）到 datasets/World-SimReady-Home/raw/full。

用法：python scripts/download_wsr.py --include "scene/*" "README.md" "assets/*" [--workers 16]
可中断后重跑续传。结束后按 manifests/hf-file-list-20261030.json 核对所选文件的大小。
"""
import argparse
import fnmatch
import json
import os
import time

from huggingface_hub import snapshot_download

REPO = "Yootta/World-SimReady-Home"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--include", nargs="+", required=True)
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()

    root = os.path.join(os.environ["HA_DATA"], "World-SimReady-Home")
    raw = os.path.join(root, "raw", "full")
    t0 = time.time()
    snapshot_download(REPO, repo_type="dataset", local_dir=raw, allow_patterns=args.include, max_workers=args.workers)
    print(f"snapshot_download done in {(time.time() - t0) / 3600:.2f} h", flush=True)

    file_list = json.load(open(os.path.join(root, "manifests", "hf-file-list-20261030.json")))
    wanted = [r for r in file_list if any(fnmatch.fnmatch(r["path"], p) for p in args.include)]
    missing = [r["path"] for r in wanted if not os.path.exists(os.path.join(raw, r["path"]))]
    wrong = [r["path"] for r in wanted if r["path"] not in missing and os.path.getsize(os.path.join(raw, r["path"])) != r["size"]]
    tag = "-".join(p.split("/")[0].strip("*") or "root" for p in args.include)
    report = {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "include": args.include,
              "total": len(wanted), "missing": missing, "size_mismatch": wrong}
    json.dump(report, open(os.path.join(root, "manifests", f"download-check-{tag}.json"), "w"), indent=1)
    print(f"files={len(wanted)} missing={len(missing)} size_mismatch={len(wrong)}", flush=True)


if __name__ == "__main__":
    main()
