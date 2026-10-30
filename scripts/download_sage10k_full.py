"""下载 SAGE-10k 全量（约 870 GB）到 datasets/SAGE-10k/raw，可中断后重跑续传。

用法：python scripts/download_sage10k_full.py [--workers 16]
已下载且大小正确的文件会跳过（huggingface_hub 在 raw/.cache 里记录元数据）。
结束后按 manifests/hf-file-list-20261029.json 核对每个文件的大小，结果写到 manifests/。
"""
import argparse
import json
import os
import time

from huggingface_hub import snapshot_download

REPO = "nvidia/SAGE-10k"


def check_sizes(root, raw):
    file_list = json.load(open(os.path.join(root, "manifests", "hf-file-list-20261029.json")))
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
    t0 = time.time()
    snapshot_download(REPO, repo_type="dataset", local_dir=raw, max_workers=args.workers)
    print(f"snapshot_download done in {(time.time() - t0) / 3600:.2f} h", flush=True)

    total, missing, wrong = check_sizes(root, raw)
    report = {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "total": total,
              "missing": missing, "size_mismatch": wrong}
    json.dump(report, open(os.path.join(root, "manifests", "full-download-check.json"), "w"), indent=1)
    print(f"files={total} missing={len(missing)} size_mismatch={len(wrong)}", flush=True)


if __name__ == "__main__":
    main()
