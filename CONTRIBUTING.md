# 协作规则

三人只通过 GitHub 协作（私有仓库 `Amber-December/home-accessibility`，分支 `main`）。每个人在自己电脑上下载数据、跑代码，彼此看不到对方的机器。角色分工和检查点见 [plans/hackathon-plan.md §8](plans/hackathon-plan.md)，本文只写日常操作。

## 代码目录

全仓库只维护这一棵目录树。右侧是对应模块和负责人（A 后端、B 仿真、C 前端与产品）。目录还不存在时按这棵树新建。

```text
src/ha/
  ir/         schema.py  wsr_import.py  doors.py  doors_kin.py  usd_mesh.py      M1          B
              occupancy.py  export_glb.py  preview.py  versions.py               M1、IR 版本  B
              floorplan.py  structure_mesh.py                                    F1 户型识别  A
  enrich/     templates.yaml  enrich.py                                          M2          B
  assets/     catalog.yaml  lux3d_factory.py  normalize.py                       M3          A
  catalog/    crawl.py  parse_sites.py  store.py                                 F2 商品库    A
  layout/     solver.py  rules.py                                                F3 布局      A
  resident/   personas.yaml  motion.py  decision_llm.py  decision_rule.py        M4、M5      B
  evaluator/  result_schema.py  l0_disc.py  l1_se2.py  l2_local.py  metrics.py   M6          B
              lighting.py  smoke.py  mujoco_replay.py
  repair/     edits.py  search.py  evolve.py                                     M7、方案演化 B
  viz/        topdown.py  report.py  render_views.py                             M8          B
  agents/     orchestrator.py  intake.py  floorplan_agent.py  catalog_agent.py   A0–A9       A
              layout_agent.py  repair_agent.py  narrator.py
  tools/      mcp_scene.py  mcp_catalog.py  mcp_layout.py  mcp_sim.py            MCP 工具     A
              mcp_render.py  mcp_asset.py
  llm.py  runlog.py                                                              公共        A
server/       app.py  sessions.py  events.py                                     REST、SSE   A
web/          index.html  js/  css/                                              前端        C
scripts/      run_import.py  finalize_import.py  select_heroes.py  download_*.py              B
              run_eval.py  run_repair.py  run_crawl.py  pw_smoke.py                          A
tests/        单元测试、缺陷注入、确定性测试；fixtures/H1/ 是一套 WSR 户型（scene000064）的 IR    各自
docs/         product/、report/                                                            C
              tech/simulation.md、tech/data.md、standards/                                  B
              tech/agent-backend.md、tech/aholo-lux3d.md                                    A
              research/；papers/ 不进 Git
plans/        比赛计划（冻结后只追加进度）                                                共享
env/          Python 依赖锁定文件                                                          B
prototypes/   浏览器端交互原型（Three.js r128，无构建），只做演示参考                       C
media/        视频素材清单（原件不进 Git）                                                 C
.github/      CI：每个 PR 和 main 上跑 pytest                                              共享
```

- 每个人（和自己的 Agent）只改自己负责的目录和文档。要改别人的，提 issue 或在 PR 里请负责人改。
- 接口由产出方维护定义：Scene IR 和评估结果结构在 [simulation](docs/tech/simulation.md) §3.1、§8.2（代码 `src/ha/ir/schema.py`、`src/ha/evaluator/result_schema.py`），REST 和 SSE 事件协议在 [agent-backend](docs/tech/agent-backend.md) §10.1、§11。
- 共享契约改动前在群里说一声，PR 要另一人 Approve：上面两类接口、`plans/`、`personas.yaml` 和 `templates.yaml` 里的阈值。
- 文档按主题放：产品 `docs/product/`，技术 `docs/tech/`，调研 `docs/research/`，规范 `docs/standards/`，比赛计划 `plans/`。不新建带日期后缀的同主题文档，直接改原文件。

## 分支和 PR

```bash
git fetch origin && git rebase origin/main      # 开始工作前、发 PR 前各一次
git switch -c sim/evaluator-l0                   # be/* sim/* fe/*，一个分支一般不超过半天
pytest -q tests/                                 # 发 PR 前
```

- `main` 随时可运行，不直接提交。
- CI（`.github/workflows/test.yml`）在每个 PR 和 `main` 上跑 `pytest -q tests/`，没过不合。
- 用 squash merge。只动自己目录且自测通过的 PR 可以自己合。
- 已推送且别人在用的分支不 rebase，改用 merge。
- C 的网页改动在 PR 里附截图。
- 检查点打 tag：`cp2`、`offline-freeze`、`offline-submit-20261101`、`online-submit-20261118`。视频和报告书里的数字以对应 tag 下的运行为准。

## 不进 Git 的东西

- 数据（WSR、SAGE-10k）、运行产物、GLB、USDZ、mp4、PPT 原件。`.gitignore` 已排除。
- 需要互相传的大文件（减面 GLB、视频素材）：发 GitHub Release 附件，或者用团队网盘，在 PR 或群里贴链接。
- 凭证放 `.env`（模板 `.env.example`），不提交、不贴进 issue 和日志。HF token 每人用自己的。
- Lux3D 付费 create 先在群里确认，每次都写 ledger。

## 结果怎么算数

- 分数只来自 `src/ha/evaluator`。原型 `prototypes/` 里的判定只做演示参考。
- 每次运行写 `$HA_OUTPUTS/runs/<实验>/<run_id>/manifest.json`（`src/ha/runlog.py`），记录 Git commit。
- 门没过就记 REJECTED 或降级，不改阈值、不换种子、不删失败的 run。
- 进度记在 [plans/hackathon-plan.md §11.1](plans/hackathon-plan.md)，每人只追加自己的条目。
