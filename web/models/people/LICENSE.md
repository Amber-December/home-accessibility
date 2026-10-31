# 住户角色模型

`person_01.glb`…`person_26.glb` 是团队内部制作的 26 位住户角色，只用于本项目的比赛演示。人物由 AI 生成，是虚构的中国人形象，不对应真实个人。

- 原件：`$HA_DATA/people-rig/person_XX/model_rigged.glb`（带人体骨骼和用具骨骼，另有 `.blend` 可编辑源，不进仓库）。
- 改动：用 `web/tools/make_people.mjs` 去掉骨骼、蒙皮和演示动画；网格减面到约 12%；只留基础色贴图，缩到 512 px 并压成 JPEG；顶点量化（KHR_mesh_quantization）。
- `manifest.json` 按引擎住户类型列出默认角色，`people` 列出全部 26 位的类型、名称、身高和是否坐姿。

骨骼原本就只用于快速验证，不是临床级的人体或器具模型。网页里角色只随引擎轨迹整体移动，判定只用画像的几何外形和参数，与角色模型无关。
