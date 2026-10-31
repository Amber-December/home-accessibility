# H1 住宅模型的许可

`scene000064.glb` 和 `scene000064.nodes.json` 由 WorldSimReady-Home 数据集的 `scene000064` 改编而来，按原数据集的许可 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 发布：只能用于非商业用途，改编后的作品使用同一许可。

- 原作：WorldSimReady-Home，Yootta，2026，<https://huggingface.co/datasets/Yootta/World-SimReady-Home>
- 改动：用 `src/ha/ir/export_glb.py` 把 USD 转成 GLB；坐标转为 Y 朝上；网格按 1 cm 顶点聚类减面；材质换成贴图的平均色；节点按 Scene IR 的物体 id 重新分组和命名；不含天花板。

本仓库其余文件不受这份许可约束。

```bibtex
@misc{world_simready_home,
  author       = {{Yootta}},
  title        = {{WorldSimReady-Home}},
  year         = {2026},
  howpublished = {\url{https://huggingface.co/datasets/Yootta/World-SimReady-Home}}
}
```
