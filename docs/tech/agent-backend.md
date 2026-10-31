# 清先住 LiveFirst · Agent 与后端

| 项 | 内容 |
|---|---|
| 负责人 | A 后端 |
| 范围 | 多 Agent 编排、MCP 工具、户型图识别、商品抓取、布局求解、后端服务、REST 和 SSE 协议、安全 |
| 配套 | 系统总览和设计原则 [../../README.md](../../README.md#系统总览)；产品与前端 [../product/prd.md](../product/prd.md)；仿真 [simulation.md](simulation.md)；代码目录 [../../CONTRIBUTING.md](../../CONTRIBUTING.md#代码目录) |
| 接口归属 | 本文维护 REST（§10.1）和 SSE 事件协议（§11），前端只消费。Scene IR 和评估结果的结构由 simulation 维护，本文只引用 |

## 1. 和 SAGE 的关系

SAGE 的做法：一个 LLM Agent 作为 MCP 客户端，循环调用一组 MCP 工具（`server/layout.py`）完成"生成房间 → 放物体 → 检查 → 修正"。主要工具：

| SAGE MCP 工具 | 作用 |
|---|---|
| `generate_room_layout` | LLM 给房间尺寸和功能，生成墙、门、窗和地面材质 |
| `place_objects_in_room` | 文本生成 3D（TRELLIS），VLM 估计尺寸、质量、材质，DFS 求无碰撞摆放（`room_solver.py`） |
| `move_one_object_with_condition_in_room` | 按条件移动或删除物体 |
| `visualize_current_layout` | 俯视图加四角渲染，给 VLM 做视觉检查 |
| `physics_simulation_scene` | Isaac Sim 稳定性检查（120 步内位移 > 0.2 m 或转角 > 8° 判不稳定） |
| `robot_task_feasibility_correction_for_room` | 检查机器人能否完成任务：机械臂能否够到物体，移动底盘有没有无碰撞路径；不行就挪或删物体 |
| `get_room_details` / `list_rooms` / `get_current_layout` | 查询状态 |

论文报告的碰撞率 1.9%、稳定率 99.9%（对比 Holodeck 22.0% / 63.8%、SceneWeaver 32.8% / 67.7%）。

我们借鉴和改动的地方：

| 方面 | SAGE | 清先住 |
|---|---|---|
| 编排 | 单个 LLM Agent 调全部工具 | 一个编排 Agent 加若干专职 Agent，每个 Agent 只看到自己的工具（§3）。工具数量少，提示更短，也更容易兜底 |
| 场景入口 | LLM 从文字描述生成房间 | 户型图识别（§7）；WSR 导入（simulation M1）作为真值和兜底 |
| 物体来源 | TRELLIS 文本生成 3D，VLM 估尺寸 | 真实商品参数（§8），外包尺寸用商品页标称值；Lux3D 生成外形，并量取商品页没写的细节尺寸（台下净空、把手高度、门扇扫掠），过验证门后进判定 |
| 摆放求解 | DFS 无碰撞摆放 | 同样的思路：LLM 给约束（靠哪面墙、挨着谁），求解器在栅格上找可行位置。多一组约束：不压门扫掠、不占交互区（§9） |
| 物理检查 | Isaac Sim 稳定性（需要 RTX GPU） | 主检查是人体可达性；接触回放用 MuJoCo（CPU），见 simulation §16 |
| 可行性检查 | 机器人（机械臂、移动底盘）的够取和路径 | 人体画像（轮椅、助行器、上肢受限、步行对照）的 SE(2) 路径、转身、停留、够取、转移，按 GB 55019 / GB 50763 / ADA 判定 |
| 修正 | 挪或删物体，让机器人任务可行 | 按代价搜索编辑（挪、转、删、换款、加扶手、改门），或者整屋重新布局；每个候选都重跑全部住户 |
| 结果 | 训练机器人用的场景数据 | 给人看的体检报告、改造方案和前后对比 |

我们不运行 SAGE 的代码，只借鉴它的 MCP 工具划分、"生成 → 检查 → 修正"循环和 DFS 摆放思路。工具接口用同一个 `mcp` Python 包。

## 2. 编排

编排用**显式状态机**，不让 LLM 自由决定下一步调哪个 Agent。状态：`intake → floorplan → confirm_structure → furnish → simulate → report → repair → compare → export`。

LLM 只在两处做路由：把用户的自由输入分类成意图（A1），以及在 `repair` 状态里选"小改"还是"重新布局"（用户没说时）。这样流程可预测，演示时不会跑偏。

## 3. Agent 列表

| Agent | 职责 | 输入 → 输出 | 可用工具 | 用 LLM 做什么 | LLM 不可用时 |
|---|---|---|---|---|---|
| A0 编排 | 推进状态机，转发用户输入，汇总进度 | 用户消息、各 Agent 结果 → 下一步动作、卡片 | 全部 Agent | 意图路由（经 A1） | 按钮驱动，固定流程 |
| A1 需求理解 | 把一句话变成结构化请求（PRD §5.2） | 文本、当前选中物体 → `{residents, focus, budget, forbid, edit, what_if, explain}` | `scene.get_summary` | 抽取和指代消解，输出受 JSON schema 约束 | 关键词规则 + 画像选择按钮 |
| A2 户型识别 | 户型图 → 结构 IR | 图片、可选的已知尺寸 → 房间、墙、门、窗（带置信度） | `scene.floorplan_parse`、`scene.floorplan_to_ir`、`render.overlay` | VLM 认房间名、核对门的开向；几何由 CV 算法出 | 纯 CV 结果 + 用户点选修正；保底取 WSR 导入 |
| A3 商品库 | 抓取、规范化、检索商品 | 品类、尺寸约束 → 候选商品列表 | `catalog.search`、`catalog.crawl`（需确认）、`catalog.get` | 从商品页文字里抽尺寸字段（结构化数据缺失时） | 只用 JSON-LD / 表格解析和手工 SKU |
| A4 资产生成 | 商品 → 3D 外形 | SKU → GLB（标称尺寸校准，QA 门）和细节尺寸量取（验证门） | `asset.lux3d_create`（付费，需确认）、`asset.normalize` | 不用 | 包围盒 + 主图贴片 |
| A5 布局 | 选款和摆放，整屋重新布局 | 结构 IR、住户、预算、约束 → 1–3 个布局候选 | `catalog.search`、`layout.*`、`render.views`、`sim.evaluate` | 列家具清单、给摆放约束、看渲染图做视觉检查 | 规则清单 + 靠墙启发式摆放 |
| A6 住户决策 | 数字住户的决策层 | 运动层给的候选动作 → `{choice, reason, monologue}` | 只能从候选里选 | 选动作、写独白（数字须与事件一致） | 规则策略 + 模板句（simulation §7.3） |
| A7 评估器 | 确定性仿真和判定 | IR、住户、任务 → 指标、事件、违规 | — | 不用 | — |
| A8 修复 | 按代价搜索编辑，或调 A5 重新布局；可选调方案演化模块一次给出多套方案（simulation §9.3） | 违规报告、约束 → 方案（编辑清单、前后指标、花费） | `layout.apply_edit`、`catalog.search`、`sim.evaluate` | 给候选编辑排序（启发），写建议文字 | 规则排序（simulation §9.2） |
| A9 报告与讲解 | 生成结论卡、方案卡、报告 | 指标、违规、方案 → 卡片文字、HTML/PDF | `render.report` | 把结构化结果写成人话 | 模板文字 |

- A7 是 simulation 提供的确定性服务，不调用 LLM。其他 Agent 通过 `sim.*` 工具调用它。
- A6 每个住户每个任务一个实例，最多 20 步，互相独立，可以并行。
- A5 和 A8 内部的每个候选都调用 A7，调用次数有上限（§6.2）。

## 4. MCP 工具

按服务分组。所有工具的参数和返回都是 JSON；改动场景的工具返回新的 IR 版本号，不原地改。

| 服务 | 工具 | 作用 | 底层实现 |
|---|---|---|---|
| scene | `floorplan_parse(image, known_dim?)` | 户型图 → 墙线、门、窗、房间候选（带置信度） | `ir/floorplan.py`（§7） |
| | `floorplan_to_ir(parse, corrections)` | 合并用户修正，生成结构 IR | `ir/floorplan.py` |
| | `floorplan_generate(distribution, n, seed)` | 按户型分布批量生成结构 IR（实验室模式） | `layout/floorplan_gen.py`（§9.1） |
| | `import_wsr(scene_id)` | WSR 导入（真值和兜底） | `ir/wsr_import.py` |
| | `get_summary(ir_ver)` / `get_object(id)` | 查询房间、门、物体 | `ir/schema.py` |
| | `export_glb(ir_ver)` | 展示用 GLB | `ir/export_glb.py`；结构 IR 的墙和门由 `ir/structure_mesh.py` 挤出 |
| catalog | `search(category, constraints, budget)` | 按尺寸、净空、价格筛选 | `catalog/store.py` |
| | `get(sku)` | 商品详情和来源 | 同上 |
| | `crawl(site, category, limit)` | 抓取，需用户确认站点 | `catalog/crawl.py`（§8） |
| layout | `required_items(room_type, residents)` | 房间必需和可选家具 | `layout/rules.py` |
| | `place(ir_ver, room, sku, constraints)` | 求一个可行位置（§9） | `layout/solver.py` |
| | `apply_edit(ir_ver, edit)` | 平移、旋转、删除、换款、加扶手、改门 | `repair/edits.py` |
| | `check_geometry(ir_ver, room?)` | 穿墙、重叠、挡门窗、压门扫掠、占交互区 | `ir/occupancy.py`、`layout/solver.py` |
| sim | `evaluate(ir_ver, residents, tasks, policy)` | 跑 simulation M5/M6，返回指标、事件、违规 | `evaluator/*`、`resident/motion.py` |
| | `evaluate_quick(ir_ver, residents, tasks)` | 只跑 L0–L2，用于拖动后快速反馈和布局候选筛选 | 同上 |
| | `replay_l3(run_id, task)` | MuJoCo 回放（镜头和临界样本） | `evaluator/mujoco_replay.py` |
| render | `views(ir_ver, room?)` | 俯视加四角渲染（headless Chromium + three.js，CPU 上用 SwiftShader） | `viz/render_views.py` |
| | `overlay(image, parse)` | 识别结果叠加在原图上 | `viz/render_views.py` |
| | `report(run_id, plan_ids)` | HTML 和 PDF 报告 | `viz/report.py`；HTML 转 PDF 用 pandoc 或 LibreOffice（`soffice --headless --convert-to pdf`） |
| asset | `lux3d_create(sku, route)` | Lux3D 生成，付费，需确认，写 ledger | `assets/lux3d_factory.py` |
| | `normalize(glb, nominal_m)` | 定向、落地、按标称尺寸缩放，QA 门 | `assets/normalize.py` |

每个 Agent 只注册自己在 §3"可用工具"列里的工具。例如 A6 住户决策没有任何工具，只能在给定候选里选。`sim.*` 和 `layout.apply_edit` 是对 simulation 函数的薄封装，不重写算法。

## 5. IR 版本与系统层字段

### 5.1 IR 版本

- IR 是 JSON（`ir/schema.py` 的 `validate` 校验），外加分层占用栅格（npz）。结构定义见 simulation §3.1。
- 每次编辑生成新版本：`ir_ver = sha256(父版本 + edit)[:12]`，存 `parent`、`edit`、`author`（哪个 Agent 或用户）。版本形成一棵树，方案 A / B / C 是树上的不同分支。
- 前后对比就是两个版本各自的评估结果对比；"勾掉改造清单的一项"就是在树上换一条路径重新评估。

### 5.2 系统层字段（在 simulation §3.1 的 IR 之上）

| 字段 | 说明 |
|---|---|
| `source` | 每个房间、墙、门、物体、数值的来源：floorplan / generated / user / catalog / template / wsr / lux3d |
| `confidence` | 户型识别的置信度，< 0.7 的元素在前端标黄 |
| `sku` | 物体对应的商品，指向 catalog 记录 |
| `nominal_m` | 商品标称尺寸。评估器用它，不用网格 |
| `price_cny` | 用于方案花费汇总 |

## 6. 关键流程

### 6.1 首次体检

1. A0 收到图片和文字 → A1 解析需求 → 前端显示意图卡，用户确认。
2. A2 识别户型 → 前端叠加显示 → 用户修正 → `floorplan_to_ir` 得到 IR v0。
3. 用户选"按现有家具"（WSR 户型）或"帮我布置"（调 A5，走 §6.2 的单轮版）。
4. `sim.evaluate`：每个（住户，任务）并行；A6 每步收到运动层的候选动作并选择；事件实时推到前端时间线。
5. A9 生成结论卡；报告写入 run 目录。

### 6.2 整屋重新布局（参考 SAGE 的生成 → 检查 → 修正循环）

```text
for room in 按优先级排序的房间（卫生间、主卧、厨房、客厅、其他）:
    items = A5.LLM 列清单(room_type, residents, budget)  ∪  layout.required_items
    for item in items（大件优先）:
        cands = catalog.search(item.category, 尺寸约束, 剩余预算)
        A5.LLM 给摆放约束（靠哪面墙、朝向、挨着谁）
        pos = layout.place(...)            # 栅格上 DFS，失败就换下一款或放宽约束
    layout.check_geometry(room)           # 不过就回退最后一件
    render.views(room) → A5.VLM 视觉检查  # 只提建议，不改分数
    sim.evaluate_quick(本房间相关任务)      # L0–L2
    不达标 → A8 在本房间内做小改（最多 3 个编辑）
最后 sim.evaluate（全部住户、全部任务，含 L3 的临界样本）
```

- 一次重新布局生成 K 个候选（K=3），用不同的随机种子和 LLM 约束组合。
- 选择目标按字典序：失败任务数 → 红色违规数 → 黄色违规数 → 总价 → 和原布局的改动量。
- 预算：每个候选最多 40 次 `evaluate_quick` 和 1 次完整 `evaluate`。
- 每个候选的完整记录都保留，包括被淘汰的，前端可以展示"试了几种、为什么选这个"。

### 6.3 追问（what-if）

1. A1 把"如果门改成推拉门呢"解析成 `{what_if: {edit: door_to_sliding, door: D3}}`。
2. `layout.apply_edit` 在当前版本上开一个分支，标"假设"。
3. `sim.evaluate` 只跑受影响的任务（经过 D3 的任务），再补跑其他住户的同一批任务。
4. A9 回答"T2 从失败变成成功，门净宽 0.72 → 0.84 m；需要门侧有 0.9 m 墙面放门扇，这里有 1.1 m"。用户可以把分支设为当前方案。

## 7. 户型图识别（A2）

演示户型要识别准确。做法是 CV 出几何、VLM 出语义、用户修正，不训练模型。

| 步骤 | 做法 | 备注 |
|---|---|---|
| 预处理 | 灰度、二值化、去文字（OCR 区域掩掉） | 线稿和彩图分两套阈值 |
| 墙 | 形态学开运算保留粗线；骨架化后用 Hough 拟合直线段，合并共线段，按厚度区分外墙和内墙 | OpenCV |
| 门 | 检测墙上的缺口加 1/4 圆弧（平开门），或缺口加平行双线（推拉门）；缺口宽度即门宽，圆弧方向即开向 | 缺口宽度减门框给净宽，标 `confidence` |
| 窗 | 外墙上的三线或细双线段 | — |
| 房间 | 墙线围成的闭合区域（shapely polygonize） | — |
| 房间名 | OCR 读文字，按位置落到房间；没有文字时 VLM 按面积和设施推断 | — |
| 比例尺 | 优先读图上的尺寸标注；没有时用户给一个已知尺寸 | 必须有比例尺才能进仿真 |

**WSR 俯视图作为输入时**：WSR 的 png 是彩色俯视渲染，没有黑白墙线。识别算法换成"按颜色和边缘分割地面区域 + 墙体暗色带"，并且可以和 WSR 导入的真值逐项比较（房间 IoU、门位置和宽度误差），这是演示里"识别准不准"的证据。

降级：识别失败的元素由用户在前端点选或拖拽补上；仍不行时结构 IR 取自 WSR 导入（PRD §11 降级 2）。

## 8. 商品参数抓取（A3）

```text
站点清单（人工确认）──► 合规检查 ──► 抓取 ──► 解析 ──► 规范化 ──► catalog 存储 ──► 检索
                         robots.txt     限速     JSON-LD 优先   单位、品类   jsonl + 索引
                         使用条款       缓存     表格 / 文本    映射
```

| 环节 | 做法 |
|---|---|
| 合规检查 | 每个站点抓取前读 robots.txt，记录检查时间和结论；人工读使用条款，禁止自动抓取的站点不抓。结论写进 `$HA_OUTPUTS/catalog/sites.yaml` |
| 抓取 | httpx 拿静态页；页面靠脚本渲染时用 headless Chromium（playwright）。单站每秒不超过 1 次请求，带 User-Agent 说明用途；按 URL 哈希缓存原始 HTML，不重复抓 |
| 解析 | 先读 schema.org `Product` 的 JSON-LD（名称、品牌、价格、图片）；尺寸通常在规格表或描述文字里，用每站一个的解析规则读取；规则读不出时交给 A3 的 LLM 抽取，抽出的值标 `source_quality: llm_extract`，并保留原文片段供核对 |
| 规范化 | mm / cm 转成 m；W×D×H 的顺序按站点规则统一；"可调""约"保留原文；品类映射到 `templates.yaml` 的 groups |
| 存储 | `$HA_OUTPUTS/catalog/<run_id>/items.jsonl`，每条有 `sku, site, url, fetched_at, category, nominal_m, clearances, price_cny, image_url, source_quality, raw_snippet` |
| 检索 | `catalog.search` 按品类、尺寸上下限、净空（例如台下净空 ≥ 0.68 m）、价格过滤，按"满足约束后的余量"排序 |
| 质检 | 每个品类随机抽 5 条人工核对尺寸；不合格率高于 20% 的解析规则停用 |

演示前的最小目标：1 个站点、2–3 个品类、≥ 50 条记录（PRD §8.1）。`src/ha/assets/catalog.yaml` 的 10 个人工核对 SKU（S1–S10）合并进同一存储，`source_quality` 沿用 catalog 里每条的值（page、pdf 或 search_snippet）。

## 9. 布局求解（A5 的 `layout.place`）

思路和 SAGE 的 `room_solver.py` 一样：LLM 给出离散约束，求解器在栅格上找满足约束的位置。

1. **候选位置**：房间多边形内 0.05 m 栅格；朝向取 0°/90°/180°/270°。约束"靠墙"时只取贴墙的位置，背面朝墙。
2. **硬约束**：不穿墙；和已有物体不重叠（body 层）；不挡门、窗；不压门扫掠扇形；不占已放物体的交互区（床的转移区、马桶净空、冰箱停留区，来自 `templates.yaml` 的 zones）。
3. **软约束**（打分）：LLM 给的相对关系（床头柜在床边、沙发对电视）；离门的距离；留给通道的最小宽度。
4. **搜索**：按软约束分数从高到低试，第一个满足硬约束的位置被采用（DFS，最多回溯 2 件）。
5. **无障碍预留**：放大件前，先给住户需要的空间占位（例如床的长边一侧 1.20 m、卫生间 1.50 m 转身圆），其他家具不能占。这是"按住户布置"和普通 AI 布局的主要区别。

求解器只用几何和规则，结果确定；LLM 改变的只是约束和清单。

### 9.1 户型生成（实验室模式）

实验室模式批量生成住宅：生成平面 → 转三维 → 摆家具（prd §2.3）。批处理不调 LLM，结果只由实验配置和种子决定。

1. **统计分布**：从 WSR 500 套统计几室几厅、总面积段、各房间面积占比、房间邻接关系，写成分布文件。实验配置可以固定其中几项，例如只要两室一厅、60–90 m²。
2. **采样和切分**：按分布和种子采样一张房间邻接图，在矩形或 L 形外轮廓里递归切分出房间多边形。按邻接关系在公共墙上开门，入户门开在玄关外墙。门净宽、走廊宽按实验配置取值。输出和户型图识别（§7）同格式的结构 IR，元素标 `source: generated`。
3. **几何检查**：房间连通，每个房间能从入户门走到，面积在分布范围内，门和门的扫掠不冲突。没过的按固定的种子序列重采，每套最多 5 次，失败记录写进 manifest。
4. **转三维**：`export_glb` 用 `ir/structure_mesh.py` 挤出墙和门，墙高 2.7 m、门高 2.1 m、窗台 0.9 m。
5. **摆家具**：用 §9 的求解器摆必需家具，清单和约束用规则版。默认不做第 5 步的无障碍预留，按普通家庭的布置摆；预留作为实验变量。家具系列评测时，同一套平面分别摆基线商品和待测系列，其余家具位置不变。

## 10. 后端

| 项 | 做法 |
|---|---|
| 框架 | Python ASGI：FastAPI + uvicorn |
| 进程 | 一个 API 进程（浏览器直接访问）；仿真在进程池里跑（演示用 ≤ 8 个 worker）；实验室模式（prd §2.3、F8）的批量体检和家具系列评测用命令行脚本按户型分片跑（simulation §11），不经过 API 进程，看板只读结果目录 |
| 会话 | `$HA_OUTPUTS/sessions/<session_id>/`：消息记录、IR 版本树、各 run 的指针、`trace.jsonl`。会话只追加，不改写 |
| 文件服务 | GLB、IR、轨迹、报告按路径白名单提供，只读 |
| LLM | `src/ha/llm.py`：协议默认 OpenAI 兼容的 Chat Completions，`HA_LLM_PROTOCOL=anthropic` 时走 Anthropic Messages；端点、密钥、模型分别读 `HA_LLM_BASE_URL`、`HA_LLM_TOKEN`、`HA_LLM_MODEL`。temperature 0，磁盘缓存键是 JSON 数组 `[模型名, system, prompt]` 的 sha256（simulation §7.3）。凭证只从环境变量读（`.env` 加载进环境），不写日志、不进缓存；端点没配置时调用方切规则版 |

### 10.1 REST 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/api/sessions` | 新建会话 |
| POST | `/api/sessions/{id}/messages` | 用户消息（文字，或附带户型图） |
| POST | `/api/sessions/{id}/confirm` | 确认卡片：`{card_id, accept, corrections?}` |
| POST | `/api/sessions/{id}/edits` | 前端直接编辑（拖动家具、改门宽）：`{ir_ver, edit}` |
| POST | `/api/sessions/{id}/simulate` | `{ir_ver, residents, tasks, mode}`，mode 取 quick 或 full |
| POST | `/api/sessions/{id}/repair` | `{ir_ver, mode, budget, forbid}`，mode 取 edit 或 relayout |
| GET | `/api/sessions/{id}/events` | SSE 事件流（§11） |
| GET | `/api/runs/{run_id}/{file}` | 读 run 目录里的文件 |
| POST | `/api/runs/{run_id}/export` | 生成 PDF |
| POST | `/api/jobs/{job_id}/cancel` | 取消长任务 |
| POST | `/api/models/usdz` | 上传 USDZ，用 OpenUSD 转成 Y 向上、米制的 GLB 后返回（prd §5.6、F1）。做法同交互原型的 `scripts/convert_usdz.py`：上限 180 MB、600 万三角面、180 秒，结果按文件内容的 sha256 缓存，只接受同源请求 |
| GET | `/api/lab/{experiment}` | 实验室看板数据：实验配置、汇总表、失败场景清单（只读，来自 `$HA_OUTPUTS/runs/<实验>/`） |

## 11. 事件协议（SSE）

每条事件一行 JSON：`{seq, ts, session_id, type, payload}`。`seq` 单调递增，前端断线重连时带上最后的 `seq` 补发。

| type | payload | 前端动作 |
|---|---|---|
| `agent_message` | `{agent, text, card?}` | 对话面板加一条消息 |
| `card` | `{card_id, kind, data, actions[]}`，kind 取 intent / structure / furnish / verdict / plan | 渲染卡片和按钮 |
| `progress` | `{job_id, stage, done, total}` | 进度条（"重跑仿真 12/24"） |
| `ir_updated` | `{ir_ver, parent, glb_url, diff[]}` | 重新加载场景，变化的物体做过渡动画 |
| `sim_event` | `{run_id, resident, task, t, kind, object_id, measured, required, standard, location}` | 时间线加标记，3D 里闪点 |
| `run_done` | `{run_id, metrics_url, score}` | 刷新详情面板 |
| `plan_ready` | `{plan_id, ir_ver, score_before, score_after, cost_cny, others_worse: bool}` | 方案卡 |
| `error` | `{stage, message, fallback}` | 提示，并说明改用了哪个兜底 |

示例：

```json
{"seq": 41, "type": "sim_event", "payload": {"run_id": "<run_id>", "resident": "wheelchair",
 "task": "T2", "t": 12.4, "kind": "BLOCKED", "object_id": "door_bathroom_1",
 "measured": 0.72, "required": 0.80, "standard": "GB55019 2.5.4", "location": [3.21, 1.05]}}
```

`sim_event` 由两类评估器输出生成：simulation §8.2 的 `violations[]` 每条一个事件，`object_id`、`measured`、`required`、`standard`、`location` 原样带过来，字段名与 `violations[]` 一致（位置统一叫 `location`，世界坐标 x、y，单位 m）；L1 软碰撞每次一个 COLLISION 事件，`measured` 是穿透深度，`location` 是穿透点。`kind` 取 PRD §6 F4 的事件类型，按违规编码和颜色（红：任务失败；黄：任务完成但余量低于规范）映射：

| 违规编码 `code` | 红 | 黄 |
|---|---|---|
| DOOR_WIDTH、DOOR_PULL_CLEARANCE、THRESHOLD、CORRIDOR_WIDTH、PARK_SPACE、TRANSFER_ZONE、STRETCHER_BLOCK、CLUTTER_MARGIN、EVAC_MARGIN | BLOCKED | LOW_MARGIN |
| TURN_SPACE | TURN_FAIL | LOW_MARGIN |
| REACH_HEIGHT、REACH_DIST、SWITCH_REACH | REACH_FAIL | LOW_MARGIN |
| SWITCH_HEIGHT（高于 1.10 m 合规线、在够取范围内，只出黄） | — | LOW_MARGIN |
| DOOR_SWING_BLOCK | DOOR_SWING | DOOR_SWING |
| LIGHT_DARK | DARK_SEGMENT | DARK_SEGMENT |
| SLIP_HINT（提示类，不计分） | — | HINT |
| 软碰撞（不在 `violations[]` 里） | COLLISION | — |

## 12. 可复现

评估器的确定性和冻结规则见 simulation §15 的"确定性"和"防作弊"两部分，LLM 调用的缓存规则见 simulation §7.3。Agent 层补充三条：

- 布局候选和 T8 放箱子的随机种子写进 run 的 `manifest.json`。
- LLM 缓存未命中且端点不可用时切规则版，manifest 里记 `policy: rule`。
- 每个 Agent 的输入、输出、工具调用都写进会话目录的 `trace.jsonl`。视频、报告、字幕都从同一个 run 目录生成。

## 13. 安全与合规

| 项 | 做法 |
|---|---|
| 凭证 | 每人放在仓库根目录的 `.env`（不进 Git，模板见 `.env.example`）。LLM token、Lux3D key 只从环境变量读（`.env` 加载进环境），不进日志、不进 IR、不进前端 |
| 付费调用 | `asset.lux3d_create` 每次都要用户确认，写 ledger（失败也记） |
| 爬虫 | 只抓 `sites.yaml` 里确认过的站点；限速、缓存、记录 robots 检查结果；数据只用于内部演示 |
| 用户上传 | 户型图只存会话目录；文件类型和大小在 API 入口校验（只收 png / jpg，≤ 20 MB） |
| 文件服务 | 路径白名单，拒绝 `..` 和绝对路径 |
| LLM 输出 | 结构化输出按 JSON schema 校验，不合格重试 1 次后切规则版；LLM 输出不直接拼进 shell 命令或文件路径 |
| 许可 | WSR（CC BY-NC-SA）只用于内部非商用演示；SAGE 是 Apache-2.0，借鉴设计不复制代码 |

## 14. 风险

产品层面的降级见 PRD §11。技术层面：

| 风险 | 办法 |
|---|---|
| 识别出的结构 IR 和 WSR 家具坐标对不上（比例、原点） | 用 WSR 俯视图的已知像素尺寸定比例；演示户型人工核对一次对齐 |
| 结构 IR 没有门的铰链信息（WSR 有） | 开向从门弧方向推断；推不出时默认向内开，标 `confidence` 低并让用户确认 |
| 布局候选的 `evaluate_quick` 太慢 | 只跑和本房间相关的任务；L1 降档；候选数 K 从 3 降到 2 |
| SSE 连接中断（代理超时、网络抖动） | 前端按 `seq` 重连补发；关键结果同时写文件，可直接刷新加载 |
| 多 Agent 调用链长，出错难查 | 查会话目录的 `trace.jsonl` |

## 15. 核心参考工具和论文

| 参考 | 是什么 | 用在哪里 |
|---|---|---|
| SAGE（arXiv 2602.10116；代码 `NVlabs/sage`） | LLM Agent + MCP 工具的场景生成，带视觉和物理 critic | MCP 工具划分、生成 → 检查 → 修正循环、DFS 摆放（§1、§6.2、§9） |
| Holodeck（CVPR 2024） | LLM 写空间关系约束，求解器摆放 | 布局约束的表达方式（§9） |
| Infinigen Indoors（CVPR 2024） | 程序化室内生成，约束 DSL 加求解器 | 硬约束和软约束分开写（§9） |
| Function2Scene（2026） | 把"谁住、做什么"的需求拆成约束和检查 | A1 需求解析、A5 按住户列清单 |
| CubiCasa5K、Raster2Seq | 户型图栅格 → 墙、门窗、房间多边形 | 户型识别的对照和测试集（§7） |
| Model Context Protocol（`mcp` Python 包） | Agent 调工具的协议 | §4 全部工具 |
| FastAPI、uvicorn | Python ASGI 框架 | §10 后端 |
| OpenCV、shapely | Hough 直线、形态学、多边形化 | §7 户型识别 |
| httpx、playwright | 静态页和脚本渲染页抓取 | §8 商品抓取 |
| schema.org `Product` JSON-LD | 商品页的结构化数据 | §8 解析 |

产品层面的参考见 PRD §2.1，调研全表见 [competitive-research.md](../research/competitive-research.md)。
