"""下载 SAGE-10k 的元数据（README、assets、kits）和固定种子抽样的若干场景 zip 到 $HA_DATA/SAGE-10k/raw。

需要环境变量 HA_DATA；HF_TOKEN 可选（见 .env.example）。
用法：python scripts/download_sage10k_sample.py --n 20 --seed 20261029
文件清单 manifests/hf-file-list.json 不存在时，先用 HfApi.list_repo_tree 列出仓库全部文件和大小写进去；
之后复用这份清单。抽样顺序写到 manifests/sample-seed<seed>-order.json，之后扩大样本时复用同一顺序。
"""
import argparse
import json
import os
import random
import time

from huggingface_hub import HfApi, hf_hub_download
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20261029)
    args = ap.parse_args()

    root = os.path.join(os.environ["HA_DATA"], "SAGE-10k")
    raw = os.path.join(root, "raw")
    file_list = load_file_list(root)

    meta = [r["path"] for r in file_list if not r["path"].startswith("scenes/") and r["path"] != ".gitattributes"]
    scenes = sorted(r["path"] for r in file_list if r["path"].startswith("scenes/"))
    order = scenes[:]
    random.Random(args.seed).shuffle(order)
    picked = order[: args.n]

    manifest = os.path.join(root, "manifests", f"sample-seed{args.seed}-order.json")
    if not os.path.exists(manifest):
        with open(manifest, "w") as fh:
            json.dump({"seed": args.seed, "order": order}, fh, indent=1)

    for path in meta + picked:
        t0 = time.time()
        local = hf_hub_download(REPO, path, repo_type="dataset", local_dir=raw)
        print(f"{path}\t{os.path.getsize(local)}\t{time.time() - t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
