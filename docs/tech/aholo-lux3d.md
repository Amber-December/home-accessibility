# 清先住 LiveFirst · Aholo / Lux3D 接口与接入

代码通过 Python SDK 调用 Aholo，包是 `manycore-aholo-sdk-{core,asset,lux3d,world}`，版本锁在 `env/requirements-lock.txt`。上游源码：[manycoretech/aholo-spatial-sdk](https://github.com/manycoretech/aholo-spatial-sdk)（MIT）。

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
| 参数 `enablePbr` | 只对 G1-Turbo 生效；false 时出白模 | 资产工厂取 true，生成的模型要进网页展示 |
| 参数 `aiPredictSize` | 默认开，AI 估尺寸并缩放 | 我们用商品库的真实尺寸重缩放，这里关掉，避免两次缩放 |
| `generate/image-to-four-view` | 单图或文字生成四视图（前 3/4、反 3/4、侧、背） | 商品只有一张图时，先补成四视图再走 `imgs` |
| `generate/text-to-3d` | 文字（加可选参考图）生成 3D | 商品没有可用图片时按 prompt 生成外形，或生成"换品"候选的占位资产 |
| `part-split` | GLB 拆部件 | 资产工厂不调用；铰接直接作用在整件 GLB 上 |
| `articulation-animation` | GLB 加 prompt，生成可动部件和动画 | 冰箱门的开启范围，影响通行和够取 |
| `animations/rig`（auto-rig） | 人形角色 GLB 自动绑骨，输出带骨骼和蒙皮的 GLB | 数字住户的人体模型：所有画像共用一个，陪护也用它 |
| `animations/retarget`（animation-retarget） | 给已绑骨的 GLB 套公开动作库里的动作，一次 1–10 个，输出 GLB 或 FBX | 住户动作，一次 retarget 套 10 个：`Sitting_Idle_Loop`（坐在轮椅上）、`Driving_Loop`（电动轮椅）、`Push_Loop`（推助行器、陪护推轮椅）、`Walk_Loop`（行走）、`Interact`（开门、开冰箱）、`PickUp_Table`（够取）、`Sitting_Exit` 和 `Sitting_Enter`（床椅转移）、`Idle_No_Loop`（放弃）、`Idle_TalkingPhone_Loop`（求助）。和运动层动作的对应见 prd §5.6。只用于**可视化**，能力判定按画像外形 |
| `generate/material-transfer` | 换材质，可指定目标高度（mm） | 同款不同色，次要 |
| `multi-format-export` | 导出 usdz / obj_zip / fbx_zip / stl / 3mf | USD 给 Isaac Sim，OBJ 给 PyBullet / MuJoCo |
| `generate/multimodal-to-image` | 文生图或图改图 | 次要 |
| `/world/v1/reconstructions`、`/world/v1/generations` | 视频或 ≥20 张图重建 3DGS，产物是 PLY / SPZ / SOG，没有 mesh | 不用：比赛聚焦资产生成，3DGS 没有网格，不能当碰撞几何 |

并发上限以接口实测为准（§4）。资产工厂按 SKU 逐个串行提交，同一时刻只有 1 个任务。
各接口的积分价格见 §3 的价格表。查余额用 MCP 的 `getlux3daccountbalance` 工具。

## 2. 两种接入方式

| | SDK | MCP |
|---|---|---|
| 是什么 | Python 包，同步和异步都有，还有 TS、Java 版 | 远程工具服务（streamable-http），`https://api.aholo3d.cn/lux3d-mcp/mcp` |
| 谁来调 | 我们的流水线代码，命令行批量跑 | 任何支持 MCP 的 Agent，包括我们的 LLM Agent |
| 优点 | 可批量、可复现、可缓存，参数全（G1 / G1-Turbo、articulation、rig、retarget） | Agent 运行时按需调用；带账户余额、询价（quote）、报告工具 |
| 缺点 | 要自己写重试、缓存、限流 | 流程较重（plan、quote、create、report）；公开 MCP 的鉴权以实测为准，结果记入 ledger |
| 本项目定位 | **主路径**：资产工厂 | 第二阶段：交互式演示时，让 Agent 现场给"换品"生成资产 |

官方另有 Agent skill 套件 [manycore-research/Aholo-Lux3D](https://github.com/manycore-research/Aholo-Lux3D)，适合在对话里手动试单件商品。项目代码不依赖它。

## 3. 在"清先住"工作流里怎么用

```text
商品库 src/ha/assets/catalog.yaml（SKU、类目、W×D×H、图片、route、articulate）
  └─ 资产工厂 src/ha/assets/lux3d_factory.py（SDK，按 SKU 串行）
       1. 前置检查，任一不满足就停在这个 SKU：
          缓存 key = sha256(SKU、标称尺寸、route、articulate、prompt、生成参数、导出格式、图片 sha256)，
            已有成功生成且文件在盘上就跳过；
          已 create 但没结束的任务续查，不重复 create；
          远端任务列表里有不在任何 ledger 中的任务，先对账；
          同一 SKU 的 QA 已失败 2 次，改用包围盒替身；
          所有 ledger 的累计预估花费加上本 SKU 的花费不超过 BUDGET
       2. 生成：
          route = multiview_g1turbo（有商品图）：image-to-four-view 把单张商品图补成四视图
            → img-to-3d(imgs=四视图, G1-Turbo, faceCount=20k, enablePbr=true, aiPredictSize=false, glb)
          route = text_to_3d（没有可用图）：text-to-3d(prompt, 同一组生成参数)，模型只代表品类外形
       3. 每个任务轮询到状态 3 后立即下载产物到运行目录，ledger 记录 taskId、bizId、URL 和本地文件
       4. articulate = true 的 SKU（冰箱 S1、S2）→ articulation-animation(整件 GLB, prompt)
          → 门和抽屉的开启扫掠范围
       5. multi-format-export → usdz（给 Isaac）和 obj_zip（给 PyBullet / MuJoCo）
       6. 本地规范化（src/ha/assets/normalize.py）：转 Z 朝上、原点落在底面中心，按 SKU 的 W×D×H 逐轴缩放，
          偏航 0° 和 90° 都试。QA 门：max(缩放比) / min(缩放比) − 1 > 15% 判为形状不可信，换图重试；
          QA 结果写入 ledger
       7. 细节尺寸量取（src/ha/assets/measure.py）：在规范化后的网格上量台下净空（高度、深度）、
          把手和操作面板高度、离地高度、桌腿间距；铰接结果给出门扇半径和开启角度。
          验证门：商品页或规格书写了该项尺寸的 SKU 上，量取值与标称值误差 ≤ 2 cm（自定），
          每个量取项至少核对 2 件才放开；结果和误差写入 ledger 和商品库，标 source: lux3d
       8. 碰撞体：CoACD 凸分解（同在 normalize.py）
       9. 质量、摩擦和交互区（床侧转移区、马桶侧方空间、柜前操作区）按类目模板 src/ha/enrich/templates.yaml 设置
  └─ 资产库：Scene IR 只引用 asset_id，不直接引用 Lux3D URL
```

原则：

- 评估和优化循环里**不现场调用** Lux3D。一次生成要几分钟而且扣积分。优化 Agent 只从已经入库的资产里挑。
- "换品"需要新资产时，进资产工厂的队列。先用 SKU 尺寸的包围盒代替，跑完仿真再补模型。
- 尺寸取用顺序（prd §2.4）：商品页或规格书写了的用**商品库标称尺寸**；没写的细节尺寸用通过验证门的模型量取值（`source: lux3d`）；量取项没过验证门时用类目模板。外包尺寸永远以商品页为准，模型按它校准。
- 每次 create 都在轮询前写入 `$HA_OUTPUTS/assets/<run_id>/ledger.jsonl`，记录 taskId、参数和预估积分；任务结束时再追加状态和下载结果。失败的也要留。
- 付费 create 需要用户在当次对话里同意；dry run（不带 `--create`）只算步骤、花费和缓存，不调用接口。

### 3.1 价格与预算

单价来自 Lux3D quote 接口（未计账户权益），代码里的 `PRICE` 与下表一致：

| 步骤 | 积分/次 |
|---|---|
| image-to-four-view | 24 |
| img-to-3d，G1-Turbo | 1 |
| img-to-3d，G1（资产工厂不用） | 20 |
| text-to-3d | 13 |
| articulation-animation | 28 |
| multi-format-export | 1 |

auto-rig 和 animation-retarget 不经过资产工厂，单价在 create 前现场 quote。

单件 SKU 的花费按 route 累加：

| route | 不铰接 | 铰接 |
|---|---|---|
| multiview_g1turbo（四视图 + G1-Turbo + 导出） | 26 | 54 |
| text_to_3d（文生 3D + 导出） | 14 | 42 |

`catalog.yaml` 的 S1–S10 合计 268 积分：S1 54，S2 42，S3、S6、S8 各 14，S4、S5、S7、S9、S10 各 26。

团队积分 3000（比赛计划 §3.2）还要覆盖交互式演示、换图重试和住户的 rig、retarget。资产工厂的 `BUDGET = 600` 是它自己的硬上限：每次 create 前，把所有 ledger 里 create 记录的预估花费加起来，再加上本 SKU 的花费，超过 600 就停。这个上限够 S1–S10 全量跑一遍（268），再给每件留一次重试（合计 536）。

## 4. 首次冒烟时确认

E7 冒烟用 S1（四视图 + G1-Turbo PBR + 铰接 + 导出，54 积分），顺带确认以下行为，结论写进资产工厂代码的注释和 ledger。各项待 E7 实测：

- `aiPredictSize=false` 时输出模型的单位和朝向。
- articulation 对冰箱整件 GLB 的成功率，以及产物里开启范围的格式。
- 实际扣费与 §3.1 预估是否一致。
- 实际并发上限。
