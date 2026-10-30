"""下载 SAGE-10k 的元数据（README、assets、kits）和固定种子抽样的若干场景 zip。

用法：python scripts/download_sage10k_sample.py --n 20 --seed 20261029
抽样清单写到 datasets/SAGE-10k/manifests/，便于之后扩大样本时复用同一顺序。
"""
import argparse
import json
import os
import random
import time

from huggingface_hub import hf_hub_download

REPO = "nvidia/SAGE-10k"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20261029)
    args = ap.parse_args()

    root = os.path.join(os.environ["HA_DATA"], "SAGE-10k")
    raw = os.path.join(root, "raw")
    file_list = json.load(open(os.path.join(root, "manifests", "hf-file-list-20261029.json")))

    meta = [r["path"] for r in file_list if not r["path"].startswith("scenes/") and r["path"] != ".gitattributes"]
    scenes = sorted(r["path"] for r in file_list if r["path"].startswith("scenes/"))
    order = scenes[:]
    random.Random(args.seed).shuffle(order)
    picked = order[: args.n]

    manifest = os.path.join(root, "manifests", f"sample-seed{args.seed}-order.json")
    if not os.path.exists(manifest):
        json.dump({"seed": args.seed, "order": order}, open(manifest, "w"), indent=1)

    for path in meta + picked:
        t0 = time.time()
        local = hf_hub_download(REPO, path, repo_type="dataset", local_dir=raw)
        print(f"{path}\t{os.path.getsize(local)}\t{time.time() - t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
