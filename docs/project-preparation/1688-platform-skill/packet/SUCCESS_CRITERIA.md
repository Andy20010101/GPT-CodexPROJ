# Success Criteria

## Product Outcomes

- [ ] 操作者可以用自然语言给出一个明确的商品研究请求，并触发 skill 执行一轮 1688 供应商研究。
- [ ] skill 输出至少 3 到 8 个候选供应商，每个候选供应商附带代表产品、直接页面链接和简短判断依据。
- [ ] 输出中明确区分页面可见事实、启发式判断和未知项，不把不确定信息伪装成确定结论。

## Technical Outcomes

- [ ] 交付物是一个 OpenClaw 兼容的 skill 目录，包含有效的 `SKILL.md` frontmatter 和必要的辅助文档。
- [ ] skill 说明中明确写出输入格式、执行步骤、质量信号 rubric、输出格式和失败时的回退行为。
- [ ] skill 可以放在工作区的 `skills/` 目录下作为一个独立 bundle 管理，而不是依赖修改宿主运行时核心代码。
- [ ] 第一版默认输出是固定结构的 Markdown 报告；不要求额外交付 JSON、CSV 或数据库落盘能力。

## Validation Expectations

- [ ] 至少有一个操作者现有访问方式可达的 happy-path 示例，证明 skill 能完成一次真实研究。
- [ ] 至少有一个 failure-path 示例，覆盖无结果、页面结构异常、验证码或登录限制等情况，并给出降级策略。
- [ ] 至少保留一个操作者可读的示例输出，作为后续 review 和 skill 迭代的证据。

## Exclusions From Success

- 第一版不要求高吞吐量抓取能力。
- 第一版不要求覆盖所有类目或所有供应商信息字段。
- 第一版不要求采购级准确率，也不要求替代人工最终判断。
