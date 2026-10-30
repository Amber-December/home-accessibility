# 先住 LiveFirst · Aholo / Lux3D 接口与接入

代码通过 Python SDK 调用 Aholo，包是 `manycore-aholo-sdk-{core,asset,lux3d,world}`，版本锁在 `env/requirements-lock-20261030.txt`。上游源码：[manycoretech/aholo-spatial-sdk](https://github.com/manycoretech/aholo-spatial-sdk)（MIT）。

API key 放在本地 `.env` 的 `AHOLO_API_KEY`（中国区），不进 Git。检查 key 和连通性用两个只读接口：`GET /lux3d/v1/generate/task/list`、`GET /asset/v1/token`。

## 1. 接口面（中国区 `https://api.aholo3d.cn`）

- 鉴权：`Authorization: <key>`，不加 `Bearer`。
- 异步流程：create 返回 `taskId`，再 `GET /lux3d/v1/generate/task/get` 查询。状态码：0 初始化，1 运行中，3 成功，4 失败，6 取消。
- **结果 URL 只有 2 小时有效**，必须立刻下载到 `$HA_OUTPUTS/assets/`。
- 本地文件先走 Asset 上传（`GET /asset/v1/token` + OUS 上传）拿到 URL。图片也可以直接用 data URL。

| 接口（`/lux3d/v1/...`） | 作用 | 对本项目的用处 |
|---|---|---|
| `generate/img-to-3d` | 1 张（`img`）或 1–32 张（`imgs`）图生成 3D，版本 `G1` / `G1-Turbo` | **主用**：商品图转家具资产 |
| 参数 `faceCount` | 10k–300k，默认 200k | 仿真用 10k–30k |
| 参数 `outputFormat` | zip / glb / ply | 取 glb |
| 参数 `enablePbr` | 只对 G1-Turbo 生效；false 时出白模 | 只要碰撞体时用白模，更快 |
| 参数 `aiPredictSize` | 默认开，AI 估尺寸并缩放 | 我们用商品库的真实尺寸重缩放，这里关掉，避免两次缩放 |
| `generate/image-to-four-view` | 单图或文字生成四视图（前 3/4、反 3/4、侧、背） | 商品只有一张图时，先补成多视图再走 `imgs` |
| `generate/text-to-3d` | 文字（加可选参考图）生成 3D | 商品库缺图时兜底，或生成"换品"候选的占位资产 |
| `part-split` | GLB 拆部件 | 拆出柜门、抽屉 |
| `articulation-animation` | GLB 加 prompt，生成可动部件和动画 | 柜门、抽屉的开启范围，影响通行和够取 |
| `humanoid-auto-rig`、`humanoid-animation-retarget` | 人形绑骨、套动作（Walk_Loop、Sitting_Enter、PickUp_Table、Interact 等） | 数字住户的**可视化**；没有轮椅动作，能力建模不靠它 |
| `generate/material-transfer` | 换材质，可指定目标高度（mm） | 同款不同色，次要 |
| `multi-format-export` | 导出 usdz / obj_zip / fbx_zip / stl / 3mf | USD 给 Isaac Sim，OBJ 给 PyBullet / MuJoCo |
| `generate/multimodal-to-image` | 文生图或图改图 | 次要 |
| `/world/v1/reconstructions`、`/world/v1/generations` | 视频或 ≥20 张图重建 3DGS，产物是 PLY / SPZ / SOG，没有 mesh | 可选：把真实住宅拍成 3DGS 做展示底图。不能直接当碰撞几何 |

并发上限各处文档说法不一（免费账户 1–5），资产工厂默认 1 个并发，可配置，首次冒烟时实测（§4）。
各接口的积分价格见 [simulation §5](simulation.md)。查余额用 MCP 的 `getlux3daccountbalance` 工具。

## 2. 两种接入方式

| | SDK | MCP |
|---|---|---|
| 是什么 | Python 包，同步和异步都有，还有 TS、Java 版 | 远程工具服务（streamable-http），`https://api.aholo3d.cn/lux3d-mcp/mcp` |
| 谁来调 | 我们的流水线代码，命令行批量跑 | 任何支持 MCP 的 Agent，包括我们的 LLM Agent |
| 优点 | 可批量、可复现、可缓存，参数全（G1 / G1-Turbo、part-split、articulation） | Agent 运行时按需调用；带账户余额、询价（quote）、报告工具 |
| 缺点 | 要自己写重试、缓存、限流 | 流程较重（plan、quote、create、report）；官方标注公开 MCP 的鉴权还没验证完，成熟度待确认 |
| 本项目定位 | **主路径**：资产工厂 | 第二阶段：交互式演示时，让 Agent 现场给"换品"生成资产 |

官方另有 Agent skill 套件 [manycore-research/Aholo-Lux3D](https://github.com/manycore-research/Aholo-Lux3D)，适合在对话里手动试单件商品。项目代码不依赖它。

## 3. 在"先住"工作流里怎么用

```text
商品库（SKU、类目、W×D×H、图片）
  └─ 资产工厂（SDK，批量）
       1. 查缓存：key = sha256(SKU + 图片 + 版本 + 参数)，命中就跳过
       2. 图片数 ≥ 2 → img-to-3d(imgs, G1-Turbo, faceCount=20k, aiPredictSize=false, glb)
          只有 1 张 → 先 image-to-four-view，再走多图；没有图 → text-to-3d 兜底，并标记"非真实商品"
       3. 轮询到状态 3 后立即下载 glb 到 `$HA_OUTPUTS/assets/`，记录 taskId 和 bizId
       4. 规范化：轴向朝上、原点落地，按 SKU 的 W×D×H 缩放
          QA 门：各轴缩放比之间差异超过 15% 就判为生成形状不可信，转人工或换图重试
       5. 有门或抽屉的类目（柜、衣柜、橱柜）→ part-split → articulation-animation
          → 得到开启扫掠范围
       6. 物理化 Agent：凸分解碰撞体（CoACD），质量和摩擦按类目模板设置，
          交互区按类目模板设置（床侧转移区、马桶侧方空间、柜前操作区）
       7. multi-format-export → usdz（给 Isaac）和 obj（给 PyBullet / MuJoCo）
  └─ 资产库：Scene IR 只引用 asset_id，不直接引用 Lux3D URL
```

原则：

- 评估和优化循环里**不现场调用** Lux3D。一次生成要几分钟而且扣积分。优化 Agent 只从已经入库的资产里挑。
- "换品"需要新资产时，进资产工厂的队列。先用 SKU 尺寸的包围盒代替，跑完仿真再补模型。
- 无障碍判断用的是**商品库标称尺寸**，不用生成模型的尺寸。生成模型只负责外形细节和可视化。
- 每次 create 都写入 `$HA_OUTPUTS/assets/<run_id>/ledger.jsonl`，记录 taskId、参数、状态和下载结果。失败的也要留。

## 4. 首次冒烟时确认

用 G1-Turbo 白模生成 1 个 SKU 时，顺带确认以下行为，结论写进资产工厂代码的注释和 ledger：

- `aiPredictSize=false` 时输出模型的单位和朝向。
- part-split 和 articulation 对柜类商品的成功率。
- 实际并发上限。
