# 清先住 LiveFirst · home-accessibility

住进去之前，先替你住一遍。“清”取清华谐音。手动轮椅、电动轮椅、陪护推轮椅、助行器、上肢受限、视障六类数字住户（加步行对照），在 3D 户型里完成入户、去卫生间、取用冰箱、上下床、夜间起夜等日常任务。系统找出过不去、够不着的地方，把每个问题归到具体物体和规范条文，给出改造方案，再重新仿真验证。

产品有两种模式：住户模式输入自己家的户型，布置家具后试住，解决这套房的具体问题；Lab 模式批量跑大量住宅（数据集或批量生成），做规模化验证，面向科研和家具厂评测自家系列（[prd §2.3](docs/product/prd.md)）。

参赛项目：群核 Aholo 全球 3D AI 黑客松（北京站）。

## 文档

| 主题 | 文档 | 负责人 | 内容 |
|---|---|---|---|
| 产品与前端交互 | [docs/product/prd.md](docs/product/prd.md) | C | 住户模式和 Lab 模式、用户、住户画像、情景、主流程、交互设计、前端实现、功能 F1–F8、视频分镜、产品化、边界声明、降级方案、核心参考项目和产品 |
| 仿真 | [docs/tech/simulation.md](docs/tech/simulation.md) | B | Scene IR、模块 M1–M9、住户画像、运动层、评估器 L0–L3、修复搜索、自检与防作弊、物理引擎、核心参考工具和论文 |
| Agent 与后端 | [docs/tech/agent-backend.md](docs/tech/agent-backend.md) | A | Agent A0–A9、MCP 工具、户型识别、商品抓取、布局求解、FastAPI 后端、REST 和 SSE 协议、安全、核心参考工具和论文 |
| 数据 | [docs/tech/data.md](docs/tech/data.md) | B | 数据集、目录约定、**队友本地准备数据**、SAGE 上游事实 |
| Lux3D | [docs/tech/aholo-lux3d.md](docs/tech/aholo-lux3d.md) | A | Aholo Lux3D / World 接口与资产工厂 |
| 竞品调研 | [docs/research/competitive-research.md](docs/research/competitive-research.md) | — | 8 个方向、74 条调研，空白点和可借用做法 |
| 标准 | [docs/standards/standards-check.md](docs/standards/standards-check.md) | B | GB 55019 / GB 50763 / ADA 2010 阈值逐条核对 |
| 比赛计划 | [plans/hackathon-plan.md](plans/hackathon-plan.md) | 共享 | 赛事规则和评分拆解、提交物、按赛程排的三人分工、待团队决定的事项 |
| 协作 | [CONTRIBUTING.md](CONTRIBUTING.md) | 共享 | 代码目录和归属、共享文件规则、fork 和 PR、CI、大文件和凭证 |
| Agent 协作协议 | [AGENTS.md](AGENTS.md) | 共享 | 给编码 Agent 读：先确认角色，只改本角色文件，共享契约和进度怎么改，禁止事项 |

`docs/papers/`（论文、学员手册 PDF）只在本地，不进 Git。

## 系统总览

### 设计原则

1. **Agent 提方案，评估器下结论。** 所有 LLM Agent 的输出都是候选。分数、尺寸、成败只来自确定性的运动层和评估器（simulation M5/M6）。
2. **层与层之间只交换文件或结构化 JSON**：Scene IR、轨迹、事件、违规报告。任何一步都能单独重跑、单独检查。
3. **每个结论都能追溯来源。** IR 里每个数值带 `source`：`floorplan`（识别）、`user`（用户修正）、`catalog`（商品页）、`template`（模板补全）、`wsr`（数据集原值）、`lux3d`（生成模型：外形，以及商品页没写、通过验证门的细节尺寸，见 [prd §2.4](docs/product/prd.md)）。
4. **修改必须对所有住户重新评估。** 修好一个住户的问题，不能让其他住户变差。
5. **LLM 不可用时演示不中断。** 每个用到 LLM 的 Agent 都有规则版兜底，接口相同。
6. **花钱和不可逆的操作先问用户。** Lux3D create、爬虫新站点、应用改造方案都要确认。

### 总体架构

每一层由哪份文档定义：前端看 [prd §5.6](docs/product/prd.md)，后端、Agent 层和工具层看 [agent-backend](docs/tech/agent-backend.md)，确定性内核看 [simulation](docs/tech/simulation.md)。

```text
┌──────────────────────── 前端（浏览器，three.js，无构建）────────────────────────┐
│ 对话面板        3D 视图（GLB + 住户 + 轨迹 + 图层）        详情面板 / 时间线   │
└───────────────▲───────────────────────────────┬────────────────────────────────┘
                │ SSE 事件流（进度、仿真事件、卡片）   │ REST（上传、确认、编辑、导出）
┌───────────────┴───────────────────────────────▼────────────────────────────────┐
│ 后端 API（Python，FastAPI + uvicorn）                                           │
│   会话管理 · 任务队列 · 文件服务（GLB、IR、报告）· 事件总线                       │
└───────────────┬────────────────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────── Agent 层 ───────────────────────────────────────────┐
│ A0 编排 Agent（状态机 + LLM 路由）                                                │
│   ├─ A1 需求理解    ├─ A2 户型识别    ├─ A3 商品库    ├─ A4 资产生成（Lux3D）     │
│   ├─ A5 布局        ├─ A6 住户决策    ├─ A8 修复      └─ A9 报告与讲解            │
│ A7 评估器是确定性服务，不调用 LLM，所有 Agent 通过工具调用它                       │
└───────────────┬────────────────────────────────────────────────────────────────┘
                │ MCP 工具调用（进程内或 stdio）
┌───────────────▼──────────── 工具层（MCP servers）───────────────────────────────┐
│ scene  · catalog · layout · sim · render · asset                                │
└───────────────┬────────────────────────────────────────────────────────────────┘
                │ 函数调用
┌───────────────▼──────────── 确定性内核（src/ha/*）──────────────────────────────┐
│ ir（IR、占用栅格、GLB 导出）· enrich（模板）· resident（画像、运动层）           │
│ evaluator（L0–L3、照明、烟气）· repair（编辑原语、搜索）· viz（俯视动画、报告）   │
└───────────────┬────────────────────────────────────────────────────────────────┘
                ▼
存储：$HA_OUTPUTS/runs/<实验>/<run_id>/（manifest.json、IR、轨迹、事件、报告）
      $HA_OUTPUTS/catalog/（抓取记录）  $HA_OUTPUTS/assets/（Lux3D 资产和 ledger）
```

### 一次体检的数据流

```text
户型图 ──A2──► parse.json ──用户确认──► IR v0（结构）
                                           │ A5 / 或 WSR 家具
                                           ▼
                                   IR v1（结构 + 家具 + 模板补全）
                                           │ sim.evaluate（A6 决策 + 运动层 + A7）
                                           ▼
                    runs/E3/<run_id>/{metrics.json, events.jsonl, traj/*.npz, violations.json}
                                           │ A9
                                           ▼
                                   结论卡、报告 HTML/PDF
```

各 Agent 的分工和状态机见 [agent-backend §2–§3](docs/tech/agent-backend.md)，run 目录和 manifest 的字段由 [src/ha/runlog.py](src/ha/runlog.py) 定义，数据流见 [simulation §2](docs/tech/simulation.md)。

## 本地环境

需要 Python 3.12 和 Git。不需要 GPU。

```bash
git clone https://github.com/<你的账号>/home-accessibility.git && cd home-accessibility   # 先 fork
git remote add upstream https://github.com/Amber-December/home-accessibility.git
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r env/requirements-lock.txt pytest==9.2.0 playwright==1.55.0
cp .env.example .env        # 填 HA_DATA、HA_REPO、HF_TOKEN 等
set -a; . ./.env; set +a
pytest -q tests/
```

- 数据下载见 [data.md §3](docs/tech/data.md)，按需下载几套户型即可。演示用哪几套户型由团队一起定，见[比赛计划](plans/hackathon-plan.md)。
- 不下数据也能开发前端和评估器：用 `tests/fixtures/H1/`（一套 WSR 户型 scene000064 的 IR，只作开发样例）。
- 导入户型：`python scripts/run_import.py <scene_id>`，结果写到 `$HA_OUTPUTS/runs/E1/<run_id>/`。导出 GLB：`python -m ha.ir.export_glb <scene_id> --ir-run <run_id>`。
- 浏览器录屏和截图要另装 Chromium：`playwright install chromium`。

## 参与开发

1. fork 本仓库，按[本地环境](#本地环境)装好依赖，`pytest` 通过。
2. 认领角色 A 或 B（C 由仓库所有者担任，见[比赛计划 §8.1、§10](plans/hackathon-plan.md)），只改本角色负责的文件。
3. 每个任务开短分支，向本仓库 `main` 发 PR；改共享契约和共享文档前先在群里说。规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。
4. 用 Codex、Claude Code 等 Agent 写代码时，它会读仓库根目录的 [AGENTS.md](AGENTS.md)（Claude Code 经 `CLAUDE.md` 引入）。开始前告诉它你的角色。

## 交互原型

`prototypes/indoor-space-interaction/` 是浏览器端交互原型，前端开发时参考。需要 Node.js 18 以上：

```bash
node prototypes/indoor-space-interaction/server.cjs --no-open
# 打开 http://127.0.0.1:8910/indoor-space-interaction/index.html
```

## 数据来源

- World-SimReady-Home：户型和场景，只用于比赛演示。
- SAGE（代码和 SAGE-10k）：借鉴设计，不复制代码。
