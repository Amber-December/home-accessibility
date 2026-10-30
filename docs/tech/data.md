# 先住 LiveFirst · 数据与上游参考

本文记录数据集、上游 SAGE 的事实，以及队友在自己电脑上准备数据的方法。未核实的地方标“未核实”。

## 1. 数据集一览

| 数据 | 许可 | 用途 | 规模 | 队友是否需要 |
|---|---|---|---|---|
| World-SimReady-Home（WSR）`scene/` | CC BY-NC-SA 4.0，gated | 主评估集：500 套整屋 USD，带铰接门和物理属性 | 全量：1521 个文件，约 75 GB，500 套 | 需要。至少下演示户型那几套 |
| WSR `task/` | 同上 | 机器人任务轨迹，2929 GB | 不下载，本项目用不上 | 不需要 |
| WSR mini（`Yootta/World-SimReady-Home-mini`） | 同上，公开 | 只有 scene000430 一套，249 MB | 有 | 可选，不用申请，适合先跑通 |
| SAGE-10k（`nvidia/SAGE-10k`） | Apache-2.0 | 单房间生成场景；布局生成的参考 | 全量：10018 个文件，约 813 GB；解压了 20 个样本 | 不需要。想看样例时下 20 个抽样 |

WSR 用于比赛演示，对外展示时注明出处（BY），衍生数据按同协议（SA）。

## 2. 目录约定

代码通过环境变量找数据，不写死路径：

| 变量 | 含义 | 示例 |
|---|---|---|
| `HA_DATA` | 数据根目录 | `~/ha-data` |
| `HA_OUTPUTS` | 产物根目录（runs、assets、deliveries） | `~/ha-outputs`；未设置时退回仓库内 `outputs/`（已 gitignore） |

`HA_DATA` 下的结构：

```text
World-SimReady-Home/
  manifests/hf-file-list-20261030.json      HF 文件清单（下载脚本自动生成）
  raw/full/scene/sceneNNNNNN/
    sceneNNNNNN.usdz  sceneNNNNNN_metadata.json  sceneNNNNNN.png
  raw/mini/                                  mini 版
SAGE-10k/
  manifests/                                 文件清单、抽样顺序、统计
  raw/scenes/*.zip                           全量 zip
  extracted/<scene>/                         解压的样本
```

## 3. 队友本地准备数据

1. 在 Hugging Face 打开 `Yootta/World-SimReady-Home`，登录后填表申请（`gated=auto`，提交后自动通过）。每个人用自己的账号申请，不共享 token。
2. 在仓库根目录复制 `.env.example` 为 `.env`，填 `HA_DATA`、`HF_TOKEN`，然后 `set -a; . ./.env; set +a`。
3. 下载：
   - 只下几套：`python scripts/download_wsr.py --include "scene/<scene_id>/*" "README.md"`，多套就多写几个 `"scene/<scene_id>/*"`。演示户型由团队定，见[比赛计划 §10](../../plans/hackathon-plan.md)。
   - 全量 `scene/`（约 75 GB）：`python scripts/download_wsr.py --include "scene/*" "README.md" "assets/*"`。
   - 中断后重跑同一命令即可续传。脚本结束时按文件清单核对大小，结果写到 `manifests/download-check-*.json`。
4. SAGE-10k 抽样（可选，约 1.7 GB）：`python scripts/download_sage10k_sample.py --n 20`。
5. 不下数据也能开发前端和评估器：`tests/fixtures/H1/` 里有一套 WSR 户型（scene000064）导入后的 `scene_ir.json`、`occupancy.npz` 和预览图。

## 4. WSR 结构（用 usd-core 读取）

- Z 轴向上，单位米（`upAxis=Z`、`metersPerUnit=1.0`）。`/root` 下按房间分组（masterBedroom、livingRoom、corridor、kitchen、bathroom、studyRoom、balcony 等），另有 wall、ground、ceiling、door、windows。
- 门对象按 `<房间A>_<房间B>_door_*` 命名，可以直接得到房间连通图。门扇有关节：平开门 RevoluteJoint，推拉门 PrismaticJoint。门的外包围盒含门框（scene000430 约 0.93 m），净宽要从网格另算。
- scene000430（mini 版）：817 个碰撞体、501 个刚体、75 个旋转关节、21 个滑动关节；碰撞近似混用 boundingCube、convexDecomposition、meshSimplification、sdf、convexHull。
- scene000000：`pxr` 打开 0.7 s，10219 个 prim、1180 个 mesh、332 个刚体、102 个关节。缺一个子 USD 引用（`SubUSDs/1581295.usd`，柜内的锅），USD 只告警不报错。导入器把缺失物体按 metadata 包围盒补，并记入报告。
- metadata 里 `mass_kg` 为 null；质量是否在 USD 的 MassAPI 上，未核实。质量缺失时按 `src/ha/enrich/templates.yaml` 估算。
- 全量导入结果（E1）：500/500 成功，门 3687 扇（平开 3009、推拉 657、门洞 21），其中净宽 < 0.80 m 的 3168 扇。

## 5. 数据划分

按 home id 固定种子把 500 套切为 dev 300 / val 100 / holdout 100，演示户型固定放进 dev。缺陷注入和方案演化只用 dev 打分、val 选程序，holdout 只在最终结论时用一次（见 [simulation §15](simulation.md)）。

## 6. SAGE 论文与代码

- 论文：SAGE: Scalable Agentic 3D Scene Generation for Embodied AI，arXiv 2602.10116，CVPR 2026。项目页 https://nvlabs.github.io/sage 。PDF 在 `docs/papers/`（不进 Git）。
- 代码：https://github.com/NVlabs/sage ，Apache-2.0，`main@fe39660`（只有一次提交）。只读参考，不改。
- 流程：LLM agent 作为 MCP client，循环调用 MCP 工具修改场景：
  - 房间初始化：LLM 估房间尺寸，MatFuse 生成墙地贴图，多房间时先生成平面图。
  - 物体放置：TRELLIS 文字生成 3D，VLM 估高度、质量、材质，DFS 搜索无碰撞位置。
  - 移动、删除物体。
  - 视觉检查器（俯视加四角渲染）和物理检查器（Isaac Sim 仿真，120 步内位移 > 0.2 m 或旋转 > 8° 判为不稳定）。
- 论文结果（表 2，3 类房间各 10 个场景）：碰撞率 1.9%，稳定率 99.9%；Holodeck 为 22.0% / 63.8%，SceneWeaver 为 32.8% / 67.7%。
- 场景数据结构（`server/models.py`）：`FloorPlan → Room → {Wall, Door, Window, Object}`。Door 有 `width`、`height`、`opens_inward`、`opening`；Object 有 `position`、`rotation`（欧拉角，度）、`dimensions`、`place_id`、`mass`。
- 代码里没有人体代理、navmesh 或可达性分析。机器人导航用占据栅格加 RRT。人体行走和无障碍判断要我们自己做。

完整复现需要的服务（来自 server、client README）：

| 服务 | 模型 | 官方配置 |
|---|---|---|
| agent LLM | gpt-oss-120b（vLLM） | TP=4 |
| 工具内 VLM | Qwen3-VL-30B-A3B-Instruct（vLLM） | 单卡 |
| client VLM | Qwen3-VL-32B-Thinking（vLLM） | TP=8 |
| 3D 生成 | TRELLIS（docker） | 需 HF_TOKEN 下权重 |
| 材质 | MatFuse（或 FLUX） | — |
| 仿真 | Isaac Sim 4.2.0（client README；论文参考文献写 5.0.0，不一致） | — |

Isaac Sim 要求 RTX 显卡（A100、A800 这类数据中心卡没有 RT 核）。评分走 CPU；Isaac Sim 只是可选的展示镜头，没有 RTX 时用 Blender 渲染兜底（见 [simulation §16](simulation.md)）。

## 7. SAGE-10k 样本统计

- 共 10,000 个场景 zip，869.8 GB（HF 标称），平均 87 MB。每个场景：`layout_<id>.json`、`objects/*.ply`（每个物体一份网格和贴图）、`materials/`、`preview/`。
- 种子 20261029 抽 20 个：全部是单房间，每个只有 1 扇门，门宽 0.83–1.00 m（中位数 0.95）；每个场景 19–161 个物体。房间多为非住宅（病房、理发店、面包店、酒吧、办公室等），住宅类只有客厅 3 个、厨房、餐厅、步入式衣柜。生成质量参差，物体密集。
- 导出 USD 要启动 Isaac Sim；做可达性分析可以直接读 JSON 加 ply。
- 结论：SAGE-10k 不适合做住宅主评估集，只作布局生成的参考和备用。
