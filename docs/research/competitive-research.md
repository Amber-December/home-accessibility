# 先住 LiveFirst · 竞品与技术调研

| 项 | 内容 |
|---|---|
| 目的 | 弄清先住每个环节在学术界、开源社区和商业产品里做到了哪一步，哪些可以直接借用，先住的差异在哪里 |
| 范围 | 8 个方向，每个方向 5–10 条；时间以 2023–2026 为主，少数更早的基础工作单独注明 |
| 配套 | 产品 [../product/prd.md](../product/prd.md)；仿真 [../tech/simulation.md](../tech/simulation.md)；Agent 与后端 [../tech/agent-backend.md](../tech/agent-backend.md) |
| 编号 | F1–F8（产品功能）、M1–M9（仿真模块）、A0–A9（Agent）的定义见 [PRD 文首](../product/prd.md) |
| 核对日 | 2026-10。文中“截至文首核对日”指这个时间；用户数、价格等数字以链接页面在核对日的说法为准，未独立核实的标“未核实” |

## 1. 方法

**8 个方向**按先住的流程排列：

| 编号 | 方向 | 对应先住环节 |
|---|---|---|
| 1 | 室内场景生成与布局 | F3 布置、整屋重新布局 |
| 2 | 户型图识别与转 3D | F1 户型图转 3D |
| 3 | 具身、人体仿真与人因 | F4 数字住户、运动层 |
| 4 | 无障碍与建筑规范自动检查 | M6 评估器、规范判定 |
| 5 | 适老化改造与居家评估 | 目标客群 |
| 6 | 家装设计与 AR 产品 | 前端形态、F2 商品库 |
| 7 | 3D 资产生成与可仿真资产 | M3 Lux3D 资产工厂 |
| 8 | LLM 驱动的人物行为仿真 | A6 住户决策层 |

**列定义**：

| 列 | 含义 |
|---|---|
| 类型 | 论文 / 开源 / 商业产品 / 数据集 / 政策 |
| 名称 | 项目或产品名 |
| 时间 | 首次发表或发布时间（年-月） |
| 单位 | 发布企业或机构 |
| 形态 | 算法、库、SaaS、App、插件、硬件服务等 |
| 输入 → 输出 | 用户给什么，得到什么 |
| 客群 | 研究者、设计师、C 端、B 端平台、政府等 |
| 核心逻辑 | 论文和开源写技术逻辑；商业产品写商业逻辑 |
| 与先住 | 借用 / 对标 / 互补 / 无关，一句话说明 |
| 链接 | 论文、仓库或产品页 |

**证据规则**：

- 每条至少有一个可访问的一手链接（论文、仓库、官网或官方新闻稿）。
- 只出现在二手文章里、或页面打不开的信息标“未核实”。
- 开源项目注明许可证；没有许可证的标“无许可证”，只能参考思路，不能复制代码。

## 2. 方向 1：室内场景生成与布局

| 类型 | 名称 | 时间 | 单位 | 形态 | 输入 → 输出 | 客群 | 核心逻辑 | 与先住 | 链接 |
|---|---|---|---|---|---|---|---|---|---|
| 论文 / 开源 / 数据集 | SAGE | 2026-02 | NVIDIA | LLM/VLM Agent + MCP 工具 + critic | 具身任务文本 → 可进 Isaac Sim 的单房间或多房间场景 | 具身 AI、机器人训练 | 生成器与语义、视觉、物理稳定性三类 critic 循环修改；资产由 TRELLIS 生成；有机器人可行性检查（机械臂够取、底盘路径） | **主参考**。借它的工具划分和“生成 → 检查 → 修正”循环，把机器人可行性换成人体画像加规范判定。Apache-2.0，需 GPU 和 Isaac Sim，我们不直接运行 | [arXiv](https://arxiv.org/abs/2602.10116) / [GitHub](https://github.com/NVlabs/sage) / [SAGE-10k](https://huggingface.co/datasets/nvidia/SAGE-10k) |
| 论文 / 开源 | SceneSmith | 2026-02 | MIT CSAIL、Toyota Research Institute | 分层 VLM 多 Agent（designer、critic、orchestrator） | 文本 → 建筑、家具、小物件三级场景 | 机器人仿真 | 静态件文生 3D，铰接件从数据集检索，并估计物理属性；报告 96% 物体稳定、碰撞低于 2% | 借鉴“铰接件检索 + 静态件生成”的分工。MIT | [arXiv](https://arxiv.org/abs/2602.09153) / [GitHub](https://github.com/nepfaff/scenesmith) |
| 论文 / 开源 | SceneWeaver | 2025-09 | BIGAI、清华 | LLM 规划器 + 工具库 + 自反思 | 文本 → 3D 场景（可导出 USD） | 场景合成研究 | 规划器从数据驱动模型、VLM、Infinigen 等工具里选择调用，自评后迭代。NeurIPS 2025 | 借鉴统一工具接口。BSD-3 | [arXiv](https://arxiv.org/abs/2509.20414) / [GitHub](https://github.com/Scene-Weaver/SceneWeaver) |
| 论文 / 开源 | Holodeck | 2023-12 | UPenn、Stanford、AI2、UW | LLM + 空间约束求解 | 文本 → AI2-THOR 可交互场景 | 具身 AI | GPT-4 写物体间空间关系约束，求解器摆放，资产从 Objaverse 检索。CVPR 2024 | 先住 `layout.place` 的“LLM 给约束、求解器找位置”即来自这一路线。Apache-2.0 | [arXiv](https://arxiv.org/abs/2312.09067) / [GitHub](https://github.com/allenai/Holodeck) |
| 论文 / 开源 | LayoutVLM | 2024-12 | Stanford、Google Research | VLM + 可微优化 | 文本 + 3D 资产 → 物体位姿 | 场景生成研究 | VLM 给初始位姿和关系目标，可微优化消除碰撞、出界。CVPR 2025 | 可把净宽、回转圆写成可微损失。仓库无许可证，只能参考思路 | [arXiv](https://arxiv.org/abs/2412.02193) / [GitHub](https://github.com/sunfanyunn/LayoutVLM) |
| 论文 | RoboLayout | 2026-02 | 未核实（单作者 Ali Shamsaddinlou） | 可微布局优化 + 可达性约束 | 文本 + 资产 + 代理参数 → 可通行、可操作的布局 | 机器人、服务场景 | 在 LayoutVLM 上加显式可达性约束；代理可配置为机器人、不同年龄的人或动物；局部细化只重排放错的物体 | 目标最接近先住：把“能到达”写进优化目标，但没有引用任何无障碍规范。CC BY-NC-ND，无代码 | [arXiv](https://arxiv.org/abs/2603.05522) |
| 论文 | Function2Scene | 2026-05 | Simon Fraser、Brown、ShanghaiTech | LLM 拆需求为约束 + 工具化检查 | 功能需求书（谁住、做什么）→ 3D 布局 | 室内设计研究 | 17 项准则覆盖空间、人体工学、活动、环境，阈值按“活动 × 人群画像”设定，示例含行动不便用户。通行检查用寻路求最窄净宽并返回瓶颈位置；够取和体态由 LLM 判断 | **唯一以人群画像驱动的布局工作**。借它的画像 → 阈值映射和瓶颈定位。它没有轮椅数值阈值、回转圆和规范引用，先住用 GB 55019 补上。未见代码 | [arXiv](https://arxiv.org/abs/2605.30819) / [项目页](https://function2scene.github.io/) |
| 论文 / 开源 | PhyScene | 2024-04 | BIGAI | 条件扩散 + 物理和交互引导 | 房间条件 → 含铰接物体的可交互布局 | 具身 AI | 采样时用碰撞、房间边界、物体可达性三种引导函数修正布局。CVPR 2024 Highlight | 可达性作为生成引导项的先例，对象是机器人。无许可证，需 GPU | [arXiv](https://arxiv.org/abs/2404.09465) / [GitHub](https://github.com/PhyScene/PhyScene) |
| 论文 / 开源 | Infinigen Indoors | 2024-06 | Princeton VL | 程序化生成 + 约束 DSL + 求解器 | 参数和约束 → Blender 室内场景（可导出 USD） | CV、具身数据生成 | 家具全程序化生成，用领域专用语言写摆放约束，求解器排布。CVPR 2024，主仓约 7.4k star | 约束 DSL 适合写“轮椅通道净宽 ≥ 900 mm”这类硬规则，也可批量造测试户型。BSD-3，CPU 可跑 | [arXiv](https://arxiv.org/abs/2406.11824) / [GitHub](https://github.com/princeton-vl/infinigen) |
| 商业产品 | Planner 5D（AI 户型识别 + Smart Wizard） | AI 功能上线时间未核实 | Planner 5D | SaaS 网页、App | 户型图片 → 识别成户型并自动布置多套家具 | C 端业主、设计师 | 视觉模型识别户型，按房型和尺寸规则生成多套布置供挑选；订阅制，识别功能只在付费档 | 对标：“户型图 → 带家具 3D”的 C 端入口已有人做，但不做任何无障碍仿真。闭源 | [AI 户型识别](https://planner5d.com/use/ai-floor-plan-generator) / [自动布置](https://planner5d.com/afa) |

**方向 1 要点**

1. 前沿已是“Agent + 工具 + critic”闭环（SAGE、SceneSmith、SceneWeaver），能批量产出直接进 Isaac Sim 或 Drake 的场景，物理稳定性也有量化（SceneSmith 96% 稳定）。生成场景已有成熟方案，待解决的是场景对哪类住户合理。
2. 把可达性放进布局的工作有三条：RoboLayout（可微优化）、PhyScene（扩散引导）、Function2Scene（画像阈值 + 瓶颈定位）。三者都没有以 GB 55019 或 ADA 条文作硬约束，也没有让轮椅或助行器身体在物理仿真里真的走一遍、做一次转移。
3. 没有工作输出“哪个物体挡住、差多少厘米”后再生成改造方案并重新仿真。先住 F4 → F5 → F6 补的就是这个缺口：按物体归因差值、生成改造方案、重新仿真验证。
4. 输入侧多数系统自己生成户型或只接受文本。能吃用户真实户型图的主要是商业 SaaS（Planner 5D）和 Architect-Ant（2606.10953，无代码）这类新研究，见方向 2。
5. 技术路线：SAGE 式 Agent 框架负责生成；Holodeck 式约束或 Infinigen 式 DSL 承载规范条文；Function2Scene 式画像映射接住“我爸坐轮椅”这类一句话需求。

## 3. 方向 2：户型图识别与转 3D

| 类型 | 名称 | 时间 | 单位 | 形态 | 输入 → 输出 | 客群 | 核心逻辑 | 与先住 | 链接 |
|---|---|---|---|---|---|---|---|---|---|
| 数据集 / 开源（基础，早于 2023） | CubiCasa5K | 2019-04 | CubiCasa（芬兰）、奥卢大学 | 数据集 + 多任务 CNN | 户型图栅格图 → 墙、门窗、房间多边形 | 户型识别研究 | 5000 张芬兰户型图，带 80 多类多边形标注；网络同时预测热力图和语义分割，再后处理成矢量 | 户型识别最常用的基准。图面风格与国内商品房户型图差别大，只能做预训练或参考。许可未核实 | [arXiv](https://arxiv.org/abs/1904.01920) / [GitHub](https://github.com/CubiCasa/CubiCasa5k) |
| 论文 / 开源 | RoomFormer | 2022-11（CVPR 2023） | ETH Zurich 等（单位未逐一核实） | Transformer 单阶段重建 | 点云投影的俯视密度图 → 多房间多边形 | 户型重建研究 | 两级 query（房间、角点）并行输出所有房间多边形，不需要手工中间步骤 | 可作户型矢量化基线。MIT，约 340 star | [arXiv](https://arxiv.org/abs/2211.15658) / [GitHub](https://github.com/ywyue/RoomFormer) |
| 论文 / 开源 | Raster2Seq | 2026-02（SIGGRAPH 2026） | 推测 Cornell（项目页在 cornell-vailab） | 自回归多边形序列生成 | 户型图栅格图 → 带语义的房间、门、窗多边形序列 | 户型重建研究 | 把房间、门、窗表示成带标签的多边形序列，解码器逐个预测角点；在 Structure3D、CubiCasa5K、Raster2Graph 上报告最优，并在 WAFFLE 上测泛化 | 截至文首核对日最新的户型图矢量化方法，门窗作为对象直接输出，适合接 Scene IR。MIT，约 81 star；页面未给数值指标 | [arXiv](https://arxiv.org/abs/2602.09016) / [GitHub](https://github.com/Cornell-VAILab/Raster2Seq) |
| 数据集 | ResPlan | 2025-08 | 未核实 | 矢量图数据集 | — → 1.7 万套住宅户型的矢量几何和房间连接图 | 户型生成、图学习研究 | 每套户型同时给几何和房间图 | 可作批量测试户型和门洞宽度统计的来源。许可 NOASSERTION，用前需核实 | [arXiv](https://arxiv.org/abs/2508.14006) / [GitHub](https://github.com/m-agour/ResPlan) |
| 论文 / 开源 | SpatialLM | 2025-06 | 群核科技（Manycore） | 点云 LLM | 点云（可由手机视频重建）→ 墙、门、窗和带朝向的物体框，输出结构化脚本 | 具身 AI、室内重建 | 用 LLM 直接读点云编码并生成结构化场景描述，不走传统分割 + 拟合 | 互补：走“扫描自家现状”路线时可用，输出直接对得上先住 Scene IR 的墙、门、家具框。输入是点云，不接受户型图。NeurIPS 2025，约 5.1k star，许可显示 NOASSERTION，需读仓库说明 | [arXiv](https://arxiv.org/abs/2506.07491) / [GitHub](https://github.com/manycore-research/SpatialLM) |
| 商业 SDK | Apple RoomPlan | 2022-06（WWDC22，早于 2023） | Apple | iOS API（需 LiDAR 机型） | 手机环扫房间 → 参数化房间模型（墙、门、窗、开口、家具类别框，USDZ） | App 开发者 | 设备端 LiDAR + 视觉融合，实时输出带真实尺度的参数化结构 | 互补：真实尺度、带家具框，是“现状评估”最省事的入口。家具只到类别框，门的开启方向、门槛高差未输出（据官方说明未见） | [Apple Developer](https://developer.apple.com/augmented-reality/roomplan/) |
| 商业产品 | RoomSketcher AI Convert | 上线日期未核实（官方新闻稿已发布） | RoomSketcher（挪威） | SaaS + App | 电脑绘制的户型图 + 用户设定比例 → 可编辑的 2D/3D 户型（墙、门、窗） | 业主、地产经纪、设计师 | 上传后先设比例再识别；导入功能在 Pro/Team 订阅档 | 对标 F1：识别已产品化，但要用户手动给比例。没有家具级仿真 | [新闻稿](https://www.roomsketcher.com/news/roomsketcher-launches-ai-convert/) / [帮助页](https://help.roomsketcher.com/hc/en-us/articles/31885247016605-Can-AI-Create-My-Floor-Plan-Use-RoomSketcher-s-AI-Convert-Feature) |
| 商业产品 | Planner 5D 户型图上传识别 | 帮助页更新于 2026-09-04；首发时间未核实 | Planner 5D | 网页、iOS、Android、桌面 | 18 种格式（图片、DWG/DXF、PDF）→ 可编辑 3D 项目 | C 端业主 | 每层一张平面图；不支持透视照片和手绘；处理 10 分钟到 24 小时；只自动放床、卫浴、桌、门等基础件；图上必须有尺寸标注，否则无法还原比例；仅付费档可用 | 对标 F1：说明“上传即出 3D”的商业体验是异步、小时级、需人工修正。先住的 confirm_structure 人工确认步骤是必要的 | [帮助页](https://support.planner5d.com/en/articles/14434484-how-to-upload-a-floor-plan) |
| 论文 | Architect-Ant | 2026-06 | 未核实（作者含 Wonka） | RL 训练的布置模型 | 真实专业户型图 → 自动布置家具 | 室内设计研究 | 用 GRPO 训练，奖励是布局规则分 | 最接近先住“真实户型图 → 布置”这一段。奖励里没有规范或人体可达项。无代码 | [arXiv](https://arxiv.org/abs/2606.10953) |
| 论文 / 数据集 | HomeWorld | 2026-06 | 港中文 MMLab、Ace Robotics | 户型生成 + 整屋布置 | 文本或条件 → 户型 → 整屋家具场景 | 具身 AI | 宣称开源 30 万户型和 5K 个可仿真场景。ECCV 2026 | 可作批量测试户型的来源。户型是生成的，不接受用户户型图；截至文首核对日代码和数据标为 Coming Soon | [arXiv](https://arxiv.org/abs/2606.06390) / [项目页](https://kairos-homeworld.github.io/) |

**方向 2 要点**

1. 干净的 2D 户型图转可编辑 3D 已经产品化（Planner 5D、RoomSketcher），输出到墙、门、窗为止。比例要靠图上尺寸或用户手动设定，Planner 5D 处理时间是 10 分钟到 24 小时。
2. 公开说明里都没有提到门开启方向、门槛高差、窗台高度这些无障碍判定要用的属性。先住 F1 识别后必须有一步人工确认结构，并让用户补这几项。
3. 扫描路线（RoomPlan、SpatialLM）自带真实尺度和家具框，适合“评估现有的家”；户型图路线适合“新房入住前”。两条路线最终都落到同一份 Scene IR。
4. 学术基准以 CubiCasa5K（芬兰户型）为主。截至文首核对日没有找到面向国内商品房户型图、带门洞净宽标注的公开基准。
5. 建议：演示版用 VLM 做首轮识别加人工确认，不自训识别模型；户型生成类工作（HomeWorld）只用于批量造测试户型。

## 4. 方向 3：具身、人体仿真与人因

| 类型 | 名称 | 时间 | 单位 | 形态 | 输入 → 输出 | 客群 | 核心逻辑 | 与先住 | 链接 |
|---|---|---|---|---|---|---|---|---|---|
| 论文 / 开源 | RCareWorld | 2022-10（早于 2023） | Cornell EmPRISE、上海交大、Columbia | Unity 仿真平台 | 房屋扫描、护理对象档案、机器人 → 护理任务仿真 | 护理机器人研究 | SMPL-X 虚拟人，6 类护理对象（卒中、脊髓损伤、脑瘫、偏瘫等）的关节活动度和肌力取自临床数据；CareHomes 有 16 套房、254 个房间，按作业治疗师意见分 L1–L3 无障碍等级；资产含手动轮椅、移位机、护理床 | 唯一同时内置残障人体、轮椅资产和无障碍分级的平台。等级是人工给房屋打的标签，没有经过仿真计算，服务对象是机器人。Apache-2.0，CPU 上 87–507 FPS | [arXiv](https://arxiv.org/abs/2210.10821) / [GitHub](https://github.com/empriselab/RCareWorld) |
| 论文 / 开源 / 基准 | CHAIC | 2024-11 | UMass（Chuang Gan 组） | TDW 上的人机协作基准 | 受限人体 agent + 家庭场景 → 搬运率等协作指标 | 具身 AI 研究 | 5 类受限 agent（够不到高处、低处、轮椅等），由 helper 推断约束并协助。NeurIPS 2024 D&B | 仓库 README 记录：轮椅 agent 有时因模型外形卡在墙角，于是换成能力相同的跛行人模型来降低结果方差。说明家居仿真里轮椅几何通行没有解决，这正是先住要回答的问题。许可不明 | [arXiv](https://arxiv.org/abs/2411.01796) / [GitHub](https://github.com/UMass-Embodied-AGI/CHAIC) |
| 论文 / 开源 | Habitat 3.0 + PARTNR | 2023-10 / 2024-10 | FAIR Meta | 仿真器 + 任务库 | HSSD 场景 + SMPL-X 人形 → 人机协作导航和重排 | 具身 AI 研究 | 人形是运动学模型，行走播放 AMASS 步态，伸手姿态来自 VPoser；路径规划器给航点 | 人形与路径规划的耦合方式可参考。人始终是健全协作者。MIT；habitat-sim 已归档，不宜长期依赖 | [arXiv](https://arxiv.org/abs/2310.13724) / [PARTNR](https://arxiv.org/abs/2411.00081) |
| 论文 / 开源 | BEHAVIOR-1K / OmniGibson | 2022 首发；arXiv 2024-03 | Stanford SVL | Isaac Sim 上的仿真器 + 1000 项家务 | 场景、物体、BDDL 任务 → 机器人家务仿真 | 机器人学习 | 按人类时间使用调查定义 1000 项家务活动，物理和渲染真实感高 | 活动清单可作先住任务库参照。无人体或残障建模。MIT；要求 RTX 显卡，只有 CPU 时跑不了 | [官网](https://behavior.stanford.edu) / [arXiv](https://arxiv.org/abs/2403.09227) |
| 开源 | MuJoCo + MyoSuite | MuJoCo 3.17.0 发于 2026-10-22 | Google DeepMind；MyoHub | 物理引擎 + 肌骨人体模型库 | MJCF 模型 → 刚体或肌骨动力学 | 机器人、生物力学 | 接触动力学引擎，CPU 上可确定性重放；MyoSuite 提供肌骨上肢和全身模型 | 先住回放层底座。MyoSuite 可作上肢受限的力学补充。都没有内置轮椅使用者。Apache-2.0，CPU 可跑 | [MuJoCo](https://github.com/google-deepmind/mujoco) / [MyoSuite](https://github.com/MyoHub/myosuite) |
| 论文 | Task-Driven Virtual Human Simulation for Performance-Based Accessibility Assessment | 2026-07（Appl. Sci. 16, 7485） | Sidiropoulos、Partarakis、Ioannidis 等；单位未核实 | 方法论文 | 建筑环境 + 任务 → 虚拟人轨迹和关节力矩 | 建筑与无障碍研究 | 步态抽象 + IK 生成确定性轨迹，再用 Newton–Euler 求关节力矩；认为 BIM 规则检查量化不了身体负担 | **最直接的学术对标**。没有自动生成场景、没有批量运行、没有修改后重测。全文未读到 | [MDPI](https://www.mdpi.com/2076-3417/16/15/7485) |
| 论文（经典，早于 2023） | Han, Law, Latombe, Kunz：Performance-based wheelchair accessible route analysis | 约 2002（由 DOI 推断） | 推测 Stanford，未核实 | 方法论文 | 建筑平面 + 轮椅几何 → 可达路线判定 | 建筑合规研究 | 在轮椅位形空间里做机器人运动规划，用“能否走通”代替逐条比对尺寸 | 先住 SE(2) 轮椅规划路线的源头。无代码 | [DOI](https://doi.org/10.1016/S1474-0346(01)00003-9) |
| 商业产品 | Siemens Process Simulate Human（基于 Jack） | 首发时间未核实 | Siemens Digital Industries Software | 桌面软件（Tecnomatix 产品线） | 工位 CAD + 人群体型 → 可达性、姿态、伤害风险 | 制造业人因工程师 | Jack/Jill 参数化人体按人群百分位做可达、空间适配和负荷分析 | 人体测量和可达分析的行业标准，场景是工厂和维修。是否支持轮椅未核实。适合作人体参数参照 | [siemens.com](https://www.siemens.com/en-us/products/tecnomatix/human-centered-design-simulation/) |

**方向 3 要点**

1. 没有平台内置“带非完整约束的轮椅身体 + 针对户型的无障碍判定”。RCareWorld 最接近，它的无障碍等级是人工标签；CHAIC 的轮椅 agent 卡墙角后被换掉，问题被绕开了。
2. 主流具身平台（Habitat 3.0、BEHAVIOR-1K）里的人是给机器人服务的健全化身，充当障碍物或协作者，被评估的始终是机器人。Assistax（[arXiv](https://arxiv.org/abs/2507.21638)）、Assistive Gym（[arXiv](https://arxiv.org/abs/1910.04700) / [GitHub](https://github.com/Healthcare-Robotics/assistive-gym)）引入了残障，评估对象同样是机器人策略。
3. “基于性能的无障碍评估”在建筑学界有一条约 2002 到 2026 年的研究线：从运动规划判定轮椅路线，到虚拟人轨迹加关节力矩。这条线停在论文，没有开源工具、场景生成和批量评估。先住把这条线和场景生成、批量运行接起来。
4. 算力：OmniGibson、Isaac Sim 要 RTX，Virtual Community（[arXiv](https://arxiv.org/abs/2508.14893)）要 CUDA。只有 CPU 时能跑的是 MuJoCo 和 RCareWorld。habitat-sim 已归档。MuJoCo 维护活跃，适合做先住回放底座。
5. 商业人体建模（Jack/PSH、RAMSIS、AnyBody）面向工厂和汽车，授权桌面软件，列为人体测量参数的参照。

## 5. 方向 4：无障碍与建筑规范自动检查

| 类型 | 名称 | 时间 | 单位 | 形态 | 输入 → 输出 | 客群 | 核心逻辑 | 与先住 | 链接 |
|---|---|---|---|---|---|---|---|---|---|
| 商业产品 | UpCodes AI Plan Review | 2026-06 | UpCodes（美国） | SaaS | 上传图纸 → 逐条问题清单并标注条文 | 设计师、审图方、地方政府 | 依据 1100 万条已采纳规范、6000 多部规范的修订版；无障碍和节能是可选专业；自称 80 万 AEC 用户 | 对标先住的条文比对层。没有家具和任务仿真。定价未公开 | [up.codes](https://up.codes/a/ai-native-plan-review) |
| 商业产品 | Solibri Office 规则 #246“无障碍空间” | 2025-06（25.6.0） | Solibri（Nemetschek） | 桌面 BIM 审查 | IFC 模型 → 不满足项 | 设计院、BIM 咨询 | 净空区定义为方块或圆柱，检查能否避开障碍物从门到达该区域，路径宽度可设 | 商业产品里离“可达性”最近的一项，做的是几何判定，原文没提轮椅。先住可导出 IFC 用它交叉验证 | [solibri.com](https://www.solibri.com/de/artikel/solibri-25.6.0-release-highlights) |
| 政府平台 | CORENET X（新加坡） | 2023-09 公布；2025-10 起强制 | 新加坡 BCA、URA 等 | 政府报建平台 | 报建 BIM（IFC-SG）→ 多部门协同审批 | 报建方 | 统一 BIM 提交 + 自动检查；3 万 m² 以上新项目强制 | 说明监管是 BIM 审查的主要买单方。不涉及住宅家具层 | [corenet.gov.sg](https://info.corenet.gov.sg) |
| 商业产品 | Archistar AI PreCheck | 2025-07 与 ICC 合作；2026-03 萨里市上线 | Archistar（澳大利亚） | SaaS，接入政府许可流程 | 申请图纸或模型 → 预审合规报告 | 地方政府、申请人 | 通过 ICC Code Connect API 调用 I-Codes 做规则检查；官网称洛杉矶、奥斯汀在用 | 卖给政府的预审工具。“许可审批时间最多缩短 55%”是厂商说法 | [archistar.ai](https://www.archistar.ai/en-ca/echeck/) |
| 商业产品 | CodeComply.Ai | 2022 成立；2026-03 与 CivicPlus 合作 | CodeComply.Ai（迈阿密） | SaaS，经 CivicPlus 卖给市政 | 图纸 → 违规项 | 市政审图部门 | AI 图纸审查，宣传页称覆盖建筑、无障碍、消防、机电 | 买单方同样是政府。无障碍覆盖范围只见于宣传页 | [codecomply.ai](https://codecomply.ai) |
| 插件 | dodda.ai ADA Compliance Checker | 版本日期未核实 | dodda.ai | Revit 插件 | Revit 模型 → ADA 2010 不合规项 | 小型设计事务所 | 按构件类别和名称关键词识别构件；门只查操作件高度；有扶手才查马桶回转空间 | 每月 5.99 美元：单点条文检查插件价格天花板很低，且依赖建模规范 | [Autodesk App Store](https://marketplace.autodesk.com/apps/e850fa0d-c929-4d6b-af6f-e65254e9afc3) |
| 学术 / 工具 | MABLESim | 2024-05（W4A '24） | Wichita State、Lehigh；NSF 资助 | 多智能体仿真工具 | 平面图 → 数字模型 → 不同行动能力的人在建筑内移动 | 研究者、建筑管理方 | 多 agent 模拟不同行动能力者的室内移动，在 2 栋建筑中演示 | 建筑尺度的移动仿真，不涉及家具、家务任务和中国规范 | [DOI](https://doi.org/10.1145/3677846.3677852) |
| 学术 | LLM 生成 Revit 合规检查脚本（Madireddy 等） | 2025-06 | 单位未逐一核实 | 方法论文 | 规范文本 → LLM 生成 Python → 在 Revit 中执行 | 研究者 | 对比 GPT、Claude、Gemini、Llama 把条文转成可执行规则；两个案例，未涉及无障碍，未给准确率 | 可借鉴来把 GB 55019 条文转成规则库，但要人工复核每条 | [arXiv](https://arxiv.org/abs/2506.20551) |
| 学术 | 面向盲人和低视力人群的平面图 agent 解析与导航 | 2026-04（CVPRW） | UMBC | 多 agent 方法 | 平面图图像 → 路线图 → 导航指令 | 视障用户 | 多 agent 解析平面图并规划路线；短、中、长路线成功率 92.3%、76.9%、61.5% | 可借鉴“平面图 → 可通行图”的解析；长路线成功率说明纯 VLM 解析不够可靠 | [arXiv](https://arxiv.org/abs/2604.23970) |

**方向 4 要点**

1. 主流审查是单维度比对：UpCodes、Archistar、CodeComply、dodda 检查宽度、高度、净空能否对上条文。Solibri #246 多判断一步“从门口能否到达净空区”，这一步同样是几何判断，没有人体和动作。
2. 前沿集中在给政府用的 AI 图纸预审。买单方是审批部门（CORENET X 强制、萨里、洛杉矶、CivicPlus 渠道），对象是新建项目报建，不涉及既有住宅、家具或住户本人。
3. 任务完成仿真只在学术界出现（Appl. Sci. 7485、MABLESim），没有产品化，也都没做到家具级场景、家务任务链和“改完再测”。
4. LLM 把条文转规则已可行，但只针对美国、澳大利亚规范。截至文首核对日没找到 GB 55019 或 GB 50763 的可执行规则库或评测；国内 AI 审图产品（广联达、PKPM 等）没检索到可靠一手来源。
5. 对先住：条文比对做底层校验（可导出 IFC 交叉验证），对外主打“任务能否完成”。

## 6. 方向 5：适老化改造与居家评估

| 类型 | 名称 | 时间 | 单位 | 形态 | 输入 → 输出 | 客群 | 核心逻辑 | 与先住 | 链接 |
|---|---|---|---|---|---|---|---|---|---|
| 商业产品 | AARP HomeFit AR | 2020-01（早于 2023） | AARP | iOS App | 手机拍房间 → 改造待办清单 | 老人家庭 | 图像识别 + AR 叠加建议；配套 HomeFit Guide | 消费端自查的早期样板，没有仿真。免费 | [App Store](https://apps.apple.com/us/app/id1513619492) |
| 学术原型 | UW–Madison AR Home Assessment Tool | 2025 秋（校友杂志报道） | 威斯康星大学麦迪逊分校 | iPad/iPhone App 原型 | 选 14 种功能受限之一（含轮椅）+ LiDAR 扫描 → 障碍标注和改造报告 | 老人、家属、OT | 按受限类型套尺寸规则，在 AR 中标出障碍 | “按受限类型评估”与先住理念最接近，但只做静态标注，不做任务仿真。是否上架未核实 | [On Wisconsin](https://onwisconsin.uwalumni.com/a-better-way-to-age-in-place/) |
| 学术（预印本） | LiDAR 居家评估概念验证（Mansoubi 等） | 2026-02 | 埃克塞特大学等 | 对比研究 | iPhone、iPad、Leica BLK360 扫描 → 尺寸，与人工测量对比 | OT、研究者 | ICC 0.967–1.000；iPhone 平均偏差 3.5–5.5 cm；59 项 OT 优先项里只有 30 项（50.8%）能用 LiDAR 测 | 关键证据：最难测的是转移类项目，转移本质是任务问题，正是仿真能补的部分 | [Research Square](https://www.researchsquare.com/article/rs-8959912/v1) |
| 商业产品 | Home for Life Design Accessibility Ratings | 2026-09（新闻稿）；AJOT 2026-03 | Home for Life Design（美国北卡） | 评分体系 + iOS App | 上门评估 → 安全和无障碍量化评分 → 改造优先级 | OT、CAPS 从业者、老龄机构 | 标准化评分，评分者一致性 0.92；30 多个州使用，客户含纽约市老龄局 | 卖点是“经过验证的评分”。先住要进这类渠道，需要做与 OT 结果的一致性研究。研究作者含公司 CEO，有利益关联 | [AJOT](https://doi.org/10.5014/ajot.2026.051315) |
| 商业产品 | HomniScan | 2026（早期体验） | Homni Health（国别未核实） | Web / App | 房间照片 → 1 分钟内出风险分析、产品匹配、临床审核后的导出和资助建议 | 家庭、临床人员 | 视觉 AI 识别风险，参照加拿大 CSA B651 | 消费端最接近的竞品，已串起“识别 → 产品 → 资助”。没有 3D 场景和重新仿真 | [homniscan.com](https://homniscan.com) |
| 学术工具 | Flinders 数字居家自评工具 | 2023-10（JMIR Aging） | 弗林德斯大学 | Web 问卷 | 13 个区域 89 道是非题 → 风险清单 | 老人自评 | 自评结果与 OT 评估对比，61 人参与 | 自评在卫生间项目上一致率 56%、κ 0.10，说明需要比问卷更强的检查手段 | [JMIR Aging](https://aging.jmir.org/2023/1/e49500) |
| 专业量表 | USC/NCOA Home Assessment Inventory（2026 版） | 2026-06 | USC Leonard Davis 学院、NCOA | 量表 | 专业人员上门填写 → 改造建议 | OT、改造服务商 | 结构化检查清单，持续更新 | 可作先住任务库和检查项的参照。免费 | [homemods.org](https://homemods.org) |
| 地方政策 | 贵州省 2025 年居家适老化改造补贴 | 2025-08 | 贵州省民政厅等 | 线上发券 | 60 岁以上老人领券 → 购买 6 类场景产品 | 老人家庭、商家 | 按单价 30% 补贴，单件最高 3000 元，每人最高 1.5 万元 | 只补产品，不含施工和评估，评估在政策中缺位 | [guizhou.gov.cn](https://www.guizhou.gov.cn/ztzl/dcgzzshm/zxzx/202509/t20250901_88545864.html) |
| 全国政策 | 特殊困难老年人家庭适老化改造 | 2020-07 九部门意见；“十四五”目标 200 万户 | 民政部等 | 政府兜底项目 | 地方摸排 → 政府补助改造 | 特困、失能、高龄老人 | 基础项政府出资；贵州 2024 年摸排 2.42 万户、完成 7801 户 | 体量最大，但评估靠地方人工上门量尺寸。完成 224 万户的数字来自二手报道，原文未重新核对 | [CPPCC](http://en.cppcc.gov.cn/2025-02/19/c_1071511.htm) / [贵州 30 项清单](https://www.guizhou.gov.cn/ztzl/gzltjxxczhjsfltdczdts/sgzxd/202508/t20250804_88375458.html) |

**方向 5 要点**

1. 评估靠上门。美国靠 OT 和 CAPS（HFLD、USC/NCOA），国内靠工作人员和施工师傅摸排、量尺寸（贵州报道）。数字工具只做采集辅助或自查。
2. 数字化有明确边界：LiDAR 只覆盖 50.8% 的 OT 优先项，转移类最难测；自评在卫生间项目上 κ 只有 0.10。“能否完成如厕、洗浴转移”要靠人判断或靠仿真，这是先住最直接的切入点。
3. 前沿形态是“拍照或扫描 → 风险清单 → 产品匹配 → 资助建议”（HomniScan、UW AR 工具、AARP）。输出都是清单，没有可仿真的 3D 场景，也没有“改完再测”。
4. 国内由政策和补贴驱动，评估本身没有单列资金。更现实的付费方是要出方案、报价、配产品的改造服务商和家居平台。
5. 美国买单方是老龄机构、州政府和 HUD 资助项目，看重经过验证的量表。先住要进这类渠道，需要一项与 OT 评估的一致性研究。HUD 数据：基础改造平均每人 5400 美元，辅助生活机构约每月 5900 美元（HFLD 新闻稿引用）。

## 7. 方向 6：家装设计与 AR 产品

| 类型 | 名称 | 时间 | 单位 | 形态 | 输入 → 输出 | 客群 | 核心逻辑 | 与先住 | 链接 |
|---|---|---|---|---|---|---|---|---|---|
| 商业产品 | 酷家乐 / Coohom | 2026-04-17 母公司港交所上市（00068.HK） | 群核科技（杭州） | 云端 3D 设计 SaaS | 户型 + 商品和素材库 → 设计方案、渲染图、清单 | 家装公司、家居品牌、设计师 | B 端订阅。同一集团还有 SpatialLM、SpatialGen、Lux3D 和 Aholo 开发者平台 | 本次比赛的主办方。户型库、商品库、3D 生成和场景编辑都在这一家，先住的 Lux3D 资产就来自这里。无障碍功能未检索到 | [kujiale.com](https://www.kujiale.com/) / [上市新闻稿](https://www.prnewswire.com/news-releases/manycore-tech-debuts-on-hkex-as-the-worlds-first-spatial-intelligence-company-302745593.html) |
| 商业产品 | 三维家（AiHouse） | 2013 成立 | 广东三维家信息科技（广州） | 家居工业软件 SaaS | 户型 + 定制家具方案 → 渲染、拆单和生产数据 | 定制家居厂商、门店 | 打通“设计 → 下单 → 工厂生产”，卖给家具制造企业 | 互补：定制家具（橱柜、台盆柜）的尺寸可以在这里落到生产，适合承接“降低台面、做容膝空间”这类改造。成立时间和业务描述来自二手介绍页；用户规模和 AI 户型识别未核实 | [官网](https://www.3vjia.com/) / [apis.io 介绍页](https://apis.io/providers/3vjia-technology/)（二手来源） |
| 商业产品 | 如视 Realsee | 时间未核实 | 贝壳找房旗下 | VR 空间采集 + 数字孪生 | 扫描设备或手机采集 → VR 看房空间、户型图 | 房产经纪、家装、文旅 | 空间扫描重建，规模化服务房产交易场景 | 互补：存量房源已有大量扫描数据和户型图，是“评估现有的家”的潜在数据入口。是否开放接口未核实 | [realsee.com](https://www.realsee.com/discover) |
| 商业产品 | Planner 5D AI Studio / Copilot | 公司 2012-09 上线 | Planner 5D | 订阅 + AI credits | 文字或户型 → AI 设计方案、3D 项目 | C 端业主 | 免费档有限额；Premium 每月 100 credits，含户型识别和 8000 多件商品；Professional 每月 1000 credits。自称 1 亿用户、5.4 亿个设计 | C 端订阅定价参照。功能都围绕美观和布置 | [AI 设计](https://planner5d.com/use/ai-interior-design) / [Newsroom](https://planner5d.com/newsroom) |
| 商业产品 | Homestyler | 时间未核实（前身为 Autodesk Homestyler，归属变更未核实） | 未核实 | 网页 3D 设计 | 户型 → 3D 方案和渲染 | C 端、设计师 | 免费在线设计 + 渲染，商品素材库 | 与 Planner 5D 同类，不涉及无障碍 | [homestyler.com](https://www.homestyler.com/article/floorplanner/mastering-ai-floor-plan-conversion) |
| 开源 / 商业产品 | RoomGPT | 2023 | 个人开发者 Hassan El Mghari（Nutlope） | Web 应用 | 房间照片 → AI 重新设计的效果图 | C 端 | 扩散模型 + ControlNet 保结构换风格 | 代表“照片改风格”路线：只出图，没有几何和尺寸，不可仿真。许可未核实 | [GitHub](https://github.com/Nutlope/roomGPT) |
| 商业产品 | magicplan | 时间未核实 | magicplan | 手机 App + 订阅 | 相机或 LiDAR 扫描 → 户型图、CAD、估价单 | 装修承包商、保险理赔修复 | 把现场测量、出图和报价放进一个 App，按席位订阅 | 对标改造服务商的现场工具。先住接在它的测量之后，作为“改造方案验证”环节 | [magicplan.app](https://magicplan.app/) / [定价](https://magicplan.app/pricing) |

**方向 6 要点**

1. 国内家装设计平台（酷家乐、三维家）是“户型 → 设计 → 报价 → 生产”的 B 端 SaaS，户型库和商品库最全。群核的酷家乐、SpatialLM 和 Lux3D 覆盖了户型、扫描和资产，先住在这些能力之上加人体仿真和规范判定。
2. C 端 AI 和 AR 产品（Planner 5D AI、RoomGPT、Homestyler）回答“好不好看、放不放得下”。检索范围内的产品里，没有一家回答“住的人能不能用”。
3. 商业模式：B 端按账号订阅；C 端订阅加 AI credits；magicplan 卖给承包商。先住适合嵌进家装平台和改造服务商的方案环节，作为“方案验证”，与方向 5 的结论一致。
4. 前端：3D 漫游和真实商品摆放已是用户默认预期。演示版用 three.js 做轨迹回放和改造前后对比即可，不必做 AR。

## 8. 方向 7：3D 资产生成与可仿真资产

| 类型 | 名称 | 时间 | 单位 | 形态 | 输入 → 输出 | 客群 | 核心逻辑 | 与先住 | 链接 |
|---|---|---|---|---|---|---|---|---|---|
| 论文 / 开源 | TRELLIS / TRELLIS.2 | 2024-12 / 2025-12 | Microsoft | 结构化 3D 潜变量 + flow transformer | 图（或文）→ GLB 网格、3DGS；TRELLIS.2 带 PBR 材质 | 研究、内容生产 | 稀疏体素承载多视角特征再解码成网格；TRELLIS.2 有 4B 参数，H100 上 512³ 约 3 秒 | SAGE 的资产来源。输出归一化尺度，不支持铰接。MIT；需 16–24 GB 显存 | [TRELLIS](https://github.com/microsoft/TRELLIS) / [TRELLIS.2](https://github.com/microsoft/trellis.2) |
| 论文 / 开源 / 商业 API | Hunyuan3D 2.x + Omni + Part | 2025-01 / 2025-09 | 腾讯混元 | 形状扩散 + 纹理生成；多模态条件；部件分割 | 图 → 带 PBR 的网格；Omni 另收包围盒、点云、骨架条件；Part 拆部件 | 游戏、内容生产 | Omni 用包围盒条件控制比例（能否控绝对尺寸未核实）；Part 先分割再补全部件，是做铰接的前置步骤 | 包围盒条件可用来对齐商品长宽高比例。社区许可排除欧盟、英国、韩国，2.1 部分文件为非商用许可 | [arXiv](https://arxiv.org/abs/2501.12202) / [GitHub](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) / [Part](https://github.com/Tencent-Hunyuan/Hunyuan3D-Part) |
| 开源 | SAM 3D Objects | 2025-11 | Meta | 单图 3D 重建基础模型 | 真实照片 + 物体掩码 → 带位姿和布局的 3D 物体 | 研究、AR、机器人 | 在遮挡和杂乱场景里逐物体重建形状、纹理、布局；官方说明不推理接触和穿插 | 可从用户家里的照片重建现有家具。是否公制尺度未核实。SAM License，需 GPU | [博客](https://ai.meta.com/blog/sam-3d/) / [GitHub](https://github.com/facebookresearch/sam-3d-objects) |
| 论文 / 商业 API | Seed3D 1.0 | 2025-10 | 字节跳动 Seed | 图生 3D + VLM 布局 | 单图 → 水密流形网格（PBR）；可组装成场景 | 具身仿真、内容生产 | 水密几何交给 Isaac Sim 自动生成碰撞体；导入前用 VLM 估计真实尺度再缩放；物理参数用默认值 | 明确面向仿真。“VLM 估尺度”这步在先住里换成商品真实尺寸。闭源 API | [arXiv](https://arxiv.org/abs/2510.19944) |
| 商业产品 / 开源工具 | Lux3D（Aholo） | 2026-09（据 36kr 报道） | 群核科技 | 云端 API + Agent skill / MCP | 图或文 → 3D 资产；README 列出材质处理、重拓扑、模型关节化、角色自动绑骨和动作迁移 | 家装设计、内容生产 | 分快速版和标准版，按次计价，每个付费步骤先报价再授权；群核称有 4.8 亿个 3D 模型和 5 亿个结构化场景（36kr 报道口径） | 先住 M3 资产工厂用它生成商品外形、冰箱门铰接和住户角色绑骨；铰接和绑骨在先住资产上的效果待 E7 实测。skill 仓 MIT；README 写明 REPORT 自动把计划、任务输入和结果发给 Lux3D，首次使用也发送 | [GitHub](https://github.com/manycore-research/Aholo-Lux3D) / [36kr](https://eu.36kr.com/en/p/3974171247253377) |
| 商业产品 | Meshy | 2023 | Meshy（硅谷） | SaaS + API | 文或图 → PBR 网格；Resize API 可设真实高度或让 AI 估尺寸 | 游戏、3D 打印、电商 | 生成后单独做尺寸归一，只按高度等比缩放；2026-07 融资近 4 亿美元，估值 15 亿美元（行业媒体报道） | “缩放到真实尺寸”已做成 API，长、宽、深不能分别指定。闭源，按 credit 计费 | [Resize API](https://docs.meshy.ai/en/api/resize) / [融资（3D Printing Industry 报道）](https://3dprintingindustry.com/news/meshy-raises-nearly-400m-at-1-5b-valuation-in-largest-ai-3d-round-to-date-253294/) |
| 论文 / 开源 / 数据集 | PhysX / PhysX-Anything | 2025-07 / 2025-11 | NTU S-Lab、上海 AI Lab | 物理属性 + 几何双分支生成 | 单图 → 带绝对尺度、材质、可供性、运动学的 3D 资产（含铰接） | 机器人、具身 AI | PhysXNet 按 5 个维度标注物理属性（含绝对尺度）；PhysX-Anything 用新几何 token 化把 token 数降到 1/193。CVPR 2026 | 少有的同时管尺度、铰接、物理属性的生成路线。许可 NOASSERTION，需 GPU | [PhysX](https://arxiv.org/abs/2507.12465) / [PhysX-Anything](https://arxiv.org/abs/2511.13648) |
| 论文 / 开源 | Articulate-Anything | 2024-10 | UPenn | VLM 写代码 + 网格检索 + 自评 | 文、图或视频 → 可编译的 URDF 铰接体 | 机器人仿真 | VLM 生成 Python 并编译成 URDF，网格从 3D 库检索；PartNet-Mobility 上成功率从 8.7–12.2% 提到 75%。ICLR 2025 | 冰箱门、柜门、马桶盖可走“检索 + VLM 定关节”。无许可证，只参考思路 | [arXiv](https://arxiv.org/abs/2410.13882) / [GitHub](https://github.com/vlongle/articulate-anything) |
| 论文 / 开源 | URDFormer | 2024-05 | UW WEIRD Lab、NVIDIA | Transformer 预测部件和关节模板 | 真实照片 → 铰接物体或场景的 URDF | 机器人 sim-to-real | 从图预测部件框和运动学结构，套程序化模板拼出铰接体，以柜类和厨房为主。RSS 2024 | 可从照片还原厨房柜体的铰接结构。MIT，需 GPU | [arXiv](https://arxiv.org/abs/2405.11656) / [GitHub](https://github.com/WEIRDLabUW/urdformer) |
| 数据集（基础，早于 2023） | PartNet-Mobility（SAPIEN） | 2020-06 | UCSD、Stanford、SFU 等 | 人工标注铰接物体库 + 仿真器 | — → 带部件和关节的 URDF 资产（46 类） | 机器人、铰接研究 | 多数铰接生成工作的训练集或评测基准 | 先住铰接件的检索库。下载需注册，许可条款未核实 | [论文](https://openaccess.thecvf.com/content_CVPR_2020/papers/Xiang_SAPIEN_A_SimulAted_Part-Based_Interactive_ENvironment_CVPR_2020_paper.pdf) |

**方向 7 要点**

1. 静态几何质量已经很高，TRELLIS.2 和 Hunyuan3D 单卡几秒到一分钟出带 PBR 的网格。先住的瓶颈是尺寸和可动部件，外观质量已够用。
2. 尺寸控制：主流生成器输出归一化尺度；Meshy 按高度等比缩放；Seed3D 用 VLM 估尺度；PhysX 在数据层标注绝对尺度。没有一家能按商品的长、宽、高、座高、台下净空分别约束。先住做法：优先检索真实商品模型，生成只兜底；生成件按包围盒非均匀缩放，再检查关键无障碍尺寸。
3. “sim-ready”多数只是水密网格加仿真器自动生成碰撞体。对轮椅碰撞检测，几何和尺寸准确比质量、摩擦更重要。
4. 铰接：商业生成器基本只出静态网格或部件分割。门、冰箱门、柜门、马桶盖、抽屉走 PartNet-Mobility 检索或 Articulate-Anything 式流程，再按商品尺寸缩放。
5. 没有资产生成工作把门把手高度、开门方向和角度、台下净空、座面高度当作生成条件，这些恰好决定“够不够得着”。

## 9. 方向 8：LLM 驱动的人物行为仿真

| 类型 | 名称 | 时间 | 单位 | 形态 | 输入 → 输出 | 客群 | 核心逻辑 | 与先住 | 链接 |
|---|---|---|---|---|---|---|---|---|---|
| 论文 / 开源 | Generative Agents | 2023-04 | Stanford、Google | 2D 沙盒小镇 + agent 架构 | 人设、环境 → 日程、行为、对话 | HCI、AI 研究 | 记忆流、反思、分层计划驱动 25 个 agent 的日常行为。UIST '23，约 22k star | 独白和日程生成的范式。没有物理可行性约束。Apache-2.0 | [arXiv](https://arxiv.org/abs/2304.03442) / [GitHub](https://github.com/joonspk-research/generative_agents) |
| 论文 / 开源 | Generative Agent Simulations of 1,000 People | 2024-11 | Stanford | agent 库 + 方法 | 2 小时深度访谈 → 能复现个人态度和行为的 agent | 社科、HCI 研究 | 用 1,052 名真人访谈转录构建 agent，预测其问卷答案（约 85% 归一化准确率来自二手报道） | 用真实访谈锚定人设，比凭空写可靠。适合为老年和残障住户建人设。MIT | [arXiv](https://arxiv.org/abs/2411.10109) / [GitHub](https://github.com/StanfordHCI/genagents) |
| 论文 / 开源 | AgentSociety | 2025-02 | 清华 FIB Lab | 大规模社会仿真框架 | 人口画像、城市环境 → 1 万以上 agent 的社会行为 | 社科研究 | 给 LLM agent 加需求、情绪、移动、社交模块，城市尺度仿真 | 尺度太大；需求模块（疲劳、急迫）可借来驱动独白。Apache-2.0 | [arXiv](https://arxiv.org/abs/2502.08691) |
| 论文 / 开源 | UXAgent | 2025-02 | 未核实 | LLM 可用性测试系统 | 网页 + 目标人群 → 模拟用户操作日志、访谈、录像 | UX 研究者 | 人设生成器 + LLM agent + 浏览器连接器，让大量模拟用户试用网页 | 网页领域的“数字用户先试用”，与先住同构，只是没有物理空间。无许可证，代码不能复用 | [arXiv](https://arxiv.org/abs/2502.12561) / [GitHub](https://github.com/neuhai/UXAgent) |
| 论文 | AgentA/B | 2025-04 | 未核实（作者含 Dakuo Wang 等 12 人） | LLM agent 网页 A/B 测试系统 | 网页的两个版本 + 多样人设 → 模拟用户的搜索、点击、筛选、购买行为和 A/B 对比结果 | UX、电商研究 | 部署大量带人设的 LLM agent 在真实网页上做多步交互；对照实验用 1,000 个 agent，并与真人购物行为对比 | 与 UXAgent 同属网页“数字用户先试用”，以方案 A/B 对比为目标，对应先住的改造前后对比；没有物理空间。未见代码 | [arXiv](https://arxiv.org/abs/2504.09723) |
| 论文 | IndoorWorld | 2025-06 | 未核实 | 研究原型 | 建筑空间 + 人员人设 → 使用者行为仿真 | 建筑设计研究 | 用 LLM 仿真建筑使用者，以办公场景做设计评估 | 方向上最接近“让虚拟使用者评估建筑”。办公场景，没有残障人设和运动层可行性 | [arXiv](https://arxiv.org/abs/2506.12331) |
| 论文 / 开源 | AgentSense | 2025-06 | 未核实 | VirtualHome 扩展 + 数据管线 | LLM 人设和作息 → 虚拟家中的传感器数据 | 活动识别研究 | LLM 生成人设和作息，在扩展版 VirtualHome 中执行，产出合成传感器数据。AAAI 2026 | “LLM 作息 → 家居仿真执行”的管线与先住决策层加运动层类似。MIT | [arXiv](https://arxiv.org/abs/2506.11773) |
| 论文 | Simulating the Resident | 2026-07 | 未核实 | 方法论文 | LLM 住户人设 → 智能家居日程 | 智能家居研究 | 用 LLM 人设生成住户日常日程，作为智能家居设计评估输入。AI-HCD 2026 最佳论文 | 可用来生成“起夜”“如厕”等任务序列 | [arXiv](https://arxiv.org/abs/2607.08231) |
| 论文 | Lost in Simulation | 2026-01 | 未核实（Seshadri 等） | 评测论文 | 不同 LLM 扮演的模拟用户 → 可靠性和偏差分析 | 评测研究 | 换一个模拟用户 LLM，成功率最多差 9 个百分点；存在方言和年龄偏差 | 反面证据：支持“打分只来自确定性运动层” | [arXiv](https://arxiv.org/abs/2601.17087) |
| 论文 | Wang, Morgenstern, Dickerson：LLM 替代人类被试会误刻画并扁平化身份群体 | 2024-02（NMI 2025） | Stanford、UW、UMD | 实证研究 | LLM 扮演 16 类身份 → 与真人回答对比 | AI 伦理、HCI | LLM 扮演身份群体时会误刻画、扁平化；16 类含 ADHD、视障，不含行动障碍 | 反面证据：残障人设独白只能当叙事，不能当证据；行动障碍人设保真度没人研究过 | [arXiv](https://arxiv.org/abs/2402.01908) / [NMI](https://www.nature.com/articles/s42256-025-00986-z) |
| 论文（经典，早于 2023） | SayCan；Code as Policies | 2022-04；2022-09 | Google | 方法论文 | 自然语言指令 + 技能库 → 技能序列或策略代码 | 机器人研究 | SayCan 用 LLM 给候选技能打“有用性”分，乘以价值函数给的“可行性”分后选择 | “LLM 只在运动层给出的可行候选里选”的原型，与先住决策层设计一致 | [SayCan](https://arxiv.org/abs/2204.01691) / [CaP](https://arxiv.org/abs/2209.07753) |

**方向 8 要点**

1. 生成式智能体架构（记忆、反思、计划、需求）已成熟并开源，CPU 加 API 就能跑。但这些 agent 都在符号化或 2D 世界里行动，没有身体可行性约束。先住让 LLM 只在运动层给出的候选里选，与 SayCan 同一思路，应保留。
2. 人设保真度是主要风险，证据偏负面：访谈锚定能提高保真度（1,000 People）；LLM 会扁平化身份群体并带年龄偏差（Wang 等、Lost in Simulation）；行动障碍人设没有被验证过。所以独白只做解释和叙事，不进评分。
3. “模拟用户做设计评估”在网页 UX 已产品化（UXAgent、AgentA/B），在建筑和住宅只有少量工作：IndoorWorld 做办公，Simulating the Resident 和 AgentSense 做家居作息但目的是生成数据。没有工作把“老年或残障住户人设 + 物理户型 + 可行性判定”组合起来。
4. 可直接借用：“人设 → 作息 → 任务序列”（Simulating the Resident、AgentSense）；访谈锚定方法（1,000 People）；需求模块（AgentSociety、Humanoid Agents）。

## 10. 总体结论

### 10.1 前沿做到哪一步

| 环节 | 现状 | 代表 |
|---|---|---|
| 场景生成 | Agent + 工具 + critic 闭环，可批量产出直接进仿真器的场景，物理稳定性有量化指标 | SAGE、SceneSmith、SceneWeaver |
| 户型图转 3D | 干净的 2D 图转墙门窗已产品化；扫描路线自带真实尺度 | Planner 5D、RoomSketcher、RoomPlan、SpatialLM |
| 人体仿真 | 人主要是给机器人服务的健全化身；残障人体只出现在护理机器人平台 | Habitat 3.0、RCareWorld、CHAIC |
| 规范检查 | 商业产品做条文比对，买方是政府审图；任务级仿真只在论文里 | UpCodes、Solibri #246、Appl. Sci. 7485 |
| 适老化评估 | 靠 OT 或工作人员上门；数字工具输出清单，不做仿真 | HFLD、HomniScan、贵州摸排 |
| 家装平台 | 户型、商品库、报价最全，回答“好不好看、放不放得下” | 酷家乐、三维家、Planner 5D AI |
| 3D 资产 | 静态几何几秒出图；按真实尺寸约束和铰接是短板；Lux3D 的模型关节化效果待 E7 实测 | TRELLIS.2、Hunyuan3D、Lux3D |
| LLM 住户 | 记忆、计划、需求架构成熟，但没有身体可行性；人设保真度证据偏负面 | Generative Agents、Lost in Simulation |

### 10.2 先住要填的空白

截至文首核对日的检索范围内，以下三件事没有找到已有工作：

1. **用 GB 55019 或 ADA 条文当硬约束。** 布局工作里的可达性指机器人或泛化代理（RoboLayout、PhyScene），Function2Scene 只引用室内设计经验值。规范检查产品比对条文，但不看家具和动作。
2. **让轮椅或助行器使用者的身体在家里实际做一遍任务。** CHAIC 的轮椅 agent 卡墙角后被换掉；RCareWorld 的无障碍等级是人工标签；Appl. Sci. 7485 有虚拟人力矩，但没有家具级场景和批量运行。
3. **诊断到“哪个物体、差几厘米”，再改造并重新仿真验证。** 适老化工具输出清单；Function2Scene 能给通行瓶颈位置，但没有改造和复测。

先住的差异化就是把这三件事串成一个闭环：户型图 → 带真实商品的 3D 家 → 数字住户做任务 → 规范判定加定位 → 改造 → 复测对比。

### 10.3 可直接借用的做法

| 借用什么 | 来源 | 用在先住哪里 |
|---|---|---|
| 生成器 + critic 迭代，加一个可达性 critic | SAGE | A5 布局、整屋重新布局 |
| 空间约束求解；约束 DSL 写硬规则 | Holodeck、Infinigen Indoors | 布局求解器 |
| 无障碍条件写成可微损失 | LayoutVLM、RoboLayout | 整屋重新布局（只借思路，LayoutVLM 无许可证） |
| 人群画像 → 阈值映射；通行瓶颈定位 | Function2Scene | 住户画像、评估器诊断输出 |
| 在轮椅位形空间里做运动规划判定路线 | Han 等（约 2002） | SE(2) 轮椅规划 |
| CPU 上确定性回放 | MuJoCo | 运动层回放 |
| LLM 只在可行候选里选 | SayCan | A6 住户决策层 |
| 人设 → 作息 → 任务序列 | Simulating the Resident、AgentSense | 任务库生成 |
| 铰接件检索 + 按商品尺寸缩放 | PartNet-Mobility、Articulate-Anything | 门、柜门、马桶盖、抽屉 |
| 条文比对作为底层校验、导出 IFC 交叉验证 | Solibri、UpCodes | 评估器自检 |

### 10.4 风险

| 风险 | 依据 | 应对 |
|---|---|---|
| 住户人设不可信 | Wang 等（NMI）、Lost in Simulation；行动障碍人设无人验证 | 独白只做叙事，评分只来自确定性运动层和评估器 |
| C 端家装 AI 产品下沉 | Planner 5D 自称 1 亿用户，已有户型识别和自动布置 | 不拼“好看”，只答“能不能用” |
| 许可证 | LayoutVLM、PhyScene、Articulate-Anything、UXAgent 无许可证；Hunyuan3D 2.1 部分文件非商用；SAM 3D 非标准许可 | 只借思路，不复制代码 |
| 算力 | OmniGibson、Isaac Sim、TRELLIS 需要 GPU | 评分全走 CPU（栅格和 SE(2) 规划，MuJoCo 回放）；Isaac Sim 只拍展示镜头 |
| 户型图识别准确率 | 没有国内商品房户型图的公开基准 | 识别后必须人工确认结构，并补门开启方向、门槛、窗台高 |

### 10.5 谁会用

- 审图类产品卖给政府（CORENET X、Archistar、CodeComply），单点条文插件价格很低（dodda 每月 5.99 美元）。
- 国内适老化改造由补贴驱动，补的是产品和施工，评估本身没有单独付费方。
- 最贴近先住的使用方是要出方案、配商品的改造服务商和家装平台，先住放在它们的方案环节里做“方案验证”。

## 11. 检索过但没入表的条目

| 方向 | 条目 | 原因 |
|---|---|---|
| 1 | ProcTHOR、LayoutGPT、InstructScene、DiffuScene、I-Design | 已被 Holodeck、SAGE 等后续工作取代，或类别封闭 |
| 1 | Co-Layout（AAAI 2026） | 它的 accessibility 指房间连通，没有人体可达；网格整数规划值得参考 |
| 1 | Human-Scene Optimization（2502.06819）、Make it Home（SIGGRAPH 2011） | 放置人体检验布局、通行项进目标函数，思路可引用；不涉及残障 |
| 1 | FuncRoom-Agent、SceneReVis、Holodeck 2.0、FlairGPT、RoomPlanner | 布局变体，摘要里没有可达性内容 |
| 3 | Assistax、Virtual Community | 被评估的是机器人策略或社区尺度；都依赖 GPU。链接见方向 3 要点 |
| 3 | Isaac Sim / Isaac Lab、ManiSkill3、MS-HAB | 通用机器人底座，没有人体或无障碍模块 |
| 3 | AI2-THOR、iGibson、Assistive Gym | 停更，或已被同类平台取代 |
| 3 | RAMSIS、AnyBody | 商业人体建模，面向汽车或需付费授权，轮椅支持未核实 |
| 3 | Maruyama 等、ICOST 2012、WUAD（VR 轮椅） | 与 Han 等同一研究线 |
| 3 | WheelPose、WheelPoser、轮椅导航 RL | 研究姿态估计或机器人控制，不评估住宅 |
| 4 | OmniPath、VLM 街景轮椅评估 | 只做室外 |
| 4 | 广联达、PKPM、深圳、雄安 AI 审图 | 多轮检索没有一手来源 |
| 4 | Autodesk Forma、日本 BIM 図面審査 | 没有无障碍专项功能的证据 |
| 5 | 东易日盛、业之峰、爱空间的适老化业务；国内适老化评估小程序 | 没有可靠来源 |
| 5 | SAFER-HOME v3、HSSAT v3、CAPS 认证 | 量表或资质，只作背景 |
| 5 | 各类市场规模报告 | 口径不明，数字互相矛盾 |
| 6 | IKEA Kreativ | 没有可核实的一手链接 |
| 7 | Rodin、Tripo | 与 Meshy 同类，没找到尺寸控制或铰接的证据 |
| 7 | SpatialGen（群核） | 输出 3DGS 外观，没有物体级可仿真场景 |
| 8 | Humanoid Agents、AgentSims、AI Town、AgentVerse | 与 Generative Agents 同类 |
| 8 | ElderBench（2609.04850）、老年人数字孪生（2604.16343） | 与老年人设直接相关，没打开核实，值得优先补看 |

## 12. 存疑点

- **单位未核实**：RoboLayout、Assistax、UXAgent、AgentA/B、IndoorWorld、AgentSense、Simulating the Resident、Lost in Simulation、Appl. Sci. 7485（全文没读到）。SAGE 的“NVIDIA 主导”从项目页推断。
- **年份未核实**：Han 等从 DOI 的 PII 号推断为 2001–2002；Wang 等发表在 NMI 的月份；Lux3D 发布日期只来自一篇报道；Seed3D 日期从模型 ID 推断；Siemens PSH 首发时间。
- **能力未核实**：Lux3D 模型关节化和角色绑骨在先住资产上的效果（待 E7 实测）；Hunyuan3D-Omni 的包围盒控制比例还是绝对尺寸；SAM 3D 是否为公制尺度；Appl. Sci. 7485 是否建模轮椅；Habitat 3.0 附录是否提到残障；Siemens PSH 是否支持轮椅；UW–Madison AR 工具是否已上架。
- **厂商自述数字**：UpCodes 80 万用户、Archistar“最多缩短 55%”、Planner 5D 用户和项目数、Meshy 用户数（两份新闻稿口径不同）、HFLD 信效度（研究作者之一是 HFLD CEO）。
- **二手数字**：“1,000 People”的 85% 准确率；全国适老化改造 224 万户（原文未重新核对）；Meshy 融资额（行业媒体报道）；三维家成立时间。
- **预印本**：埃克塞特 LiDAR 研究截至文首核对日处于返修。
- **star 数**：都是文首核对日的近似值。

## 13. 来源说明

- 每行的“链接”列就是该行的一手来源，均在核对日访问过；打不开的已在行内或第 12 节注明。UpCodes 页面对脚本请求返回 403，链接按浏览器访问核对。
- 政策类来源：贵州省人民政府网站两篇（2025-08、2025-09）、全国政协英文网（2025-02），分别挂在方向 5 的贵州补贴行和全国政策行。
