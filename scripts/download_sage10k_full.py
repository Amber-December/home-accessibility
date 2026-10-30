"""下载 SAGE-10k 全量（约 870 GB，HF 标称）到 $HA_DATA/SAGE-10k/raw，可中断后重跑续传。

需要环境变量 HA_DATA；HF_TOKEN 可选（见 .env.example）。
用法：python scripts/download_sage10k_full.py [--workers 16]
已下载且大小正确的文件会跳过（huggingface_hub 在 raw/.cache 里记录元数据）。
文件清单 manifests/hf-file-list.json 不存在时，先用 HfApi.list_repo_tree 列出仓库全部文件和大小写进去；
之后复用这份清单，删掉它重跑即可刷新。结束后按清单核对每个文件的大小，结果写到 manifests/full-download-check.json。
"""
import argparse
import json
import os
import time

from huggingface_hub import HfApi, snapshot_download
from huggingface_hub.hf_api import RepoFile

REPO = "nvidia/SAGE-10k"


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


def check_sizes(file_list, raw):
    missing, wrong = [], []
    for r in file_list:
        p = os.path.join(raw, r["path"])
        if not os.path.exists(p):
            missing.append(r["path"])
        elif os.path.getsize(p) != r["size"]:
            wrong.append(r["path"])
    return len(file_list), missing, wrong


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()

    root = os.path.join(os.environ["HA_DATA"], "SAGE-10k")
    raw = os.path.join(root, "raw")
    file_list = load_file_list(root)
    t0 = time.time()
    snapshot_download(REPO, repo_type="dataset", local_dir=raw, max_workers=args.workers)
    print(f"snapshot_download done in {(time.time() - t0) / 3600:.2f} h", flush=True)

    total, missing, wrong = check_sizes(file_list, raw)
    report = {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "total": total,
              "missing": missing, "size_mismatch": wrong}
    with open(os.path.join(root, "manifests", "full-download-check.json"), "w") as fh:
        json.dump(report, fh, indent=1)
    print(f"files={total} missing={len(missing)} size_mismatch={len(wrong)}", flush=True)


if __name__ == "__main__":
    main()
