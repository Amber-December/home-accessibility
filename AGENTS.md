# 给 Agent 的协作协议

本文件给在本仓库里工作的编码 Agent（Codex、Claude Code、Cursor 等）读。人看的完整规则在 [CONTRIBUTING.md](CONTRIBUTING.md)，两者冲突时以 CONTRIBUTING 为准。

## 开始前

1. 问清用户是 A、B、C 中的哪个角色（A 后端与 Agent，B 仿真与评估，C 前端与产品），之后只按这个角色改文件。用户没说就先问，不要猜。
2. 读 [README.md](README.md) 的系统总览，再读本角色负责的文档：A 读 `docs/tech/agent-backend.md`、`docs/tech/aholo-lux3d.md`；B 读 `docs/tech/simulation.md`、`docs/tech/data.md`；C 读 `docs/product/prd.md`。
3. 同步上游：`git fetch upstream && git rebase upstream/main`（fork 的配置见 CONTRIBUTING）。

## 能改什么

文件归属以 [CONTRIBUTING.md 的目录树](CONTRIBUTING.md#代码目录) 为准。

| 类别 | 例子 | 规则 |
|---|---|---|
| 本角色的文件 | 目录树里标了本角色的代码和文档 | 直接改 |
| 别人的文件 | 其他角色的目录和文档 | 不改。在 PR 描述或 issue 里写清楚要对方改什么 |
| 共享契约 | `src/ha/ir/schema.py`、`src/ha/evaluator/result_schema.py`、`tests/fixtures/H1/`、agent-backend §10.1 和 §11 的 REST/SSE 协议、`personas.yaml` 和 `templates.yaml` 里的阈值 | 先提醒用户到群里说一声；单独开 PR，不和其他改动混在一起；PR 标题以 `[契约]` 开头，要另一人 Approve |
| 共享文档 | `README.md`、`CONTRIBUTING.md`、`AGENTS.md`、`plans/hackathon-plan.md` | 只改和本次任务直接相关的段落，不顺手重写别的段落 |
| 进度 | `plans/hackathon-plan.md` §11.1 | 只在本角色的小节（A、B、C）末尾追加，不改别人的条目 |

## 怎么改

- 每个任务开一个短分支：`be/*`（A）、`sim/*`（B）、`fe/*`（C）。不直接提交到 `main`。
- 发 PR 前跑 `pytest -q tests/`，失败不发。
- 一个 PR 只做一件事。PR 描述写：改了什么、为什么、怎么验证的、是否动了共享契约。
- 文档写最终状态：不写日期、修改过程和"之前是 X 现在是 Y"。不新建带日期后缀的同主题文档，直接改原文件。

## 不能做

- 不提交凭证、`.env`、数据、运行产物和大文件（见 `.gitignore`）。
- 不写本机路径和个人环境：绝对路径、用户名、内部集群、个人云盘。路径一律用 `$HA_DATA`、`$HA_OUTPUTS` 或仓库内相对路径。
- 不调用 Lux3D 付费 create，除非用户在本次对话里明确同意；每次 create 写 ledger（`docs/tech/aholo-lux3d.md` §3）。
- 不靠改阈值、换种子、删失败的 run 来让验收门通过（[比赛计划 §7](plans/hackathon-plan.md)）。分数只来自 `src/ha/evaluator`。
- 冻结 tag（`onsite-freeze`、`online-freeze`）之后，`src/ha/{evaluator,resident,enrich}` 和阈值只修 bug。
- 不 force push 别人在用的分支，不改写 `main` 的历史。
