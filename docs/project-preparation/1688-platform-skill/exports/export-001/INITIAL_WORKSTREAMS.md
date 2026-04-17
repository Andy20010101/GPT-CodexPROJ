# Initial Workstreams

Use medium granularity. Do not explode this into microtasks.

## Workstream 1

- Name: Contract And Preconditions Freeze
- Goal: 定义第一版 skill 的输入格式、供应商观察项、质量信号、输出字段和两项必须确认的前置条件。
- In Scope: 研究 brief 模板、供应商与产品观察字段、事实/判断/未知的区分方式、Markdown 输出结构、宿主能力前置条件、1688 访问前置条件。
- Dependencies: 对目标用户、单次研究范围和浏览器优先路线的保守判断。
- Acceptance Signal: 有一份稳定的输入约定、输出样例和前置条件定义，后续 skill 编写时不需要再重新争论 MVP 边界。

## Workstream 2

- Name: OpenClaw Skill Bundle
- Goal: 把 1688 研究方法沉淀成一个可放入工作区 `skills/` 目录的 skill bundle。
- In Scope: `SKILL.md` frontmatter、执行步骤、工具使用规则、失败回退规则、参考文档。
- Dependencies: Workstream 1 已经定义好研究 rubric 和输出 contract。
- Acceptance Signal: skill bundle 可以被独立阅读和安装，新的对话线程能理解如何用它完成一轮研究。

## Workstream 3

- Name: Operator Validation And Evidence
- Goal: 用一个真实商品方向验证 skill，补齐 happy-path、failure-path 和操作者可读证据。
- In Scope: 一次真实演示、一次失败或受限场景、示例输出、限制说明。
- Dependencies: skill bundle 已可运行；操作者至少能访问目标 1688 页面。
- Acceptance Signal: 有实际输出样本，能证明 skill 在现实限制下仍然能给出有用结果或明确失败说明。

## Optional Additional Workstreams

- 如果第一版 skill 稳定后，再评估是否需要发布到 ClawHub、增加导出格式或引入更强的辅助脚本。
