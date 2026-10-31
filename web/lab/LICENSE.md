# 实验室户型数据的许可

每个 `scene*/` 目录里的 `scene_ir.json`、`occupancy.npz` 和 `preview.jpg` 由 WorldSimReady-Home 数据集的同名场景改编而来，按原数据集的许可 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 发布：只能用于非商业用途，改编后的作品使用同一许可。

- 原作：WorldSimReady-Home，Yootta，2026，<https://huggingface.co/datasets/Yootta/World-SimReady-Home>
- 改动：用 `src/ha` 的导入流程把 USD 场景转成 Scene IR 和分层占据栅格；俯视预览图缩到最长边 360 px。`sim_result.json` 由 `web/tools/make_mock.py` 在这些数据上生成（`web/tools/make_lab.py` 批量调用），同样按本许可发布。

本仓库其余文件不受这份许可约束。
