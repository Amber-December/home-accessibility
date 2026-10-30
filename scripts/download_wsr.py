"""下载 World-SimReady-Home（gated）到 $HA_DATA/World-SimReady-Home/raw/full。

需要环境变量 HA_DATA 和 HF_TOKEN（见 .env.example）；HF 账号要先在数据集页面申请访问。
用法：python scripts/download_wsr.py --include "scene/*" "README.md" "assets/*" [--workers 16]
文件清单 manifests/hf-file-list.json 不存在时，先用 HfApi.list_repo_tree 列出仓库全部文件和大小写进去；
之后复用这份清单，删掉它重跑即可刷新。可中断后重跑续传。结束后按清单核对所选文件的大小，
结果写到 manifests/download-check-<tag>.json。
"""
import argparse
import fnmatch
import json
import os
import time

from huggingface_hub import HfApi, snapshot_download
from huggingface_hub.hf_api import RepoFile

REPO = "Yootta/World-SimReady-Home"


def load_file_list(root):
    """Return [{"path", "size"}] from manifests/hf-file-list.json, building it with HfApi when missing."""
    path = os.path.join(root, "manifests", "hf-file-list.json")
    if not os.path.exists(path):
        api = HfApi(token=os.environ.get("HF_TOKEN") or None)
        files = [{"path": f.path, "size": f.size}
                 for f in api.list_repo_tree(REPO, repo_type="dataset", recursive=True)
                 if isinstance(f, RepoFile)]
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            json.dump(files, fh, indent=1)
        print(f"wrote {path}: {len(files)} files", flush=True)
    with open(path) as fh:
        return json.load(fh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--include", nargs="+", required=True)
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()

    root = os.path.join(os.environ["HA_DATA"], "World-SimReady-Home")
    raw = os.path.join(root, "raw", "full")
    file_list = load_file_list(root)
    t0 = time.time()
    snapshot_download(REPO, repo_type="dataset", local_dir=raw, allow_patterns=args.include, max_workers=args.workers)
    print(f"snapshot_download done in {(time.time() - t0) / 3600:.2f} h", flush=True)

    wanted = [r for r in file_list if any(fnmatch.fnmatch(r["path"], p) for p in args.include)]
    missing = [r["path"] for r in wanted if not os.path.exists(os.path.join(raw, r["path"]))]
    wrong = [r["path"] for r in wanted if r["path"] not in missing and os.path.getsize(os.path.join(raw, r["path"])) != r["size"]]
    tag = "-".join(p.split("/")[0].strip("*") or "root" for p in args.include)
    report = {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "include": args.include,
              "total": len(wanted), "missing": missing, "size_mismatch": wrong}
    with open(os.path.join(root, "manifests", f"download-check-{tag}.json"), "w") as fh:
        json.dump(report, fh, indent=1)
    print(f"files={len(wanted)} missing={len(missing)} size_mismatch={len(wrong)}", flush=True)


if __name__ == "__main__":
    main()
