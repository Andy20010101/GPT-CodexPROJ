## ChatGPTCLI 代理说明

### Beta v3 工作流

对于 GhostVM beta v3 的迭代轮次，严格按以下流程执行：

当前 ChatGPT 项目 URL：

`https://chatgpt.com/g/g-p-69a4014b9f5881919b68c81a6bbeda3d-ghostvm/project`

1. 将 `/Users/gaoxiaodiao/Documents/GitHub/GhostVMPriv` 压缩为 `GhostVMPriv_Beta_v3_{turn}.zip`。
   需要排除本地产物和无关大文件，例如 `.git/`、`.artifacts/`、`src/GhostVMCore/.build/`、`src/GhostVMCore/build/`，保证上传体积稳定可控。
2. 在 ChatGPT 的 `GhostVM` 项目中，删除上一轮 zip，再上传 `GhostVMPriv_Beta_v3_{turn}.zip`。
3. 在 `GhostVM` 项目中新建对话，模型设置为 `Pro 5.4`，发送以下提示词：

```text
接下来，开始beta v3的第{turn+1}轮迭代，请你深度分析GhostVMPriv_Beta_v3_{turn}.zip，从系统收敛机来看以下设计是否还有优化的地方，并给出详细修改建议
```

4. 对话创建后，立即保存该轮对话链接。
   将第 `{turn+1}` 轮的 conversation URL 单独写入 `src/GhostVMCore/docs/beta/beta_v3/conversation_links.md`，格式保持为可追加、可更新的轮次到链接映射；如果该轮已有记录，则更新为最新链接。
   不允许把对话链接写进 `turn_{turn+1}.md`，以免污染最终 assistant 原始消息。
5. 等待该对话真正完成，过程大概需要30-50分钟，请耐心等待。
   不允许抓取 `running` 状态下的中间输出。
   只有在对话完成后，才能获取最终 assistant 原始消息，并写入 `src/GhostVMCore/docs/beta/beta_v3/turn_{turn+1}.md`。
6. 在 `src/GhostVMCore` 目录执行：

```bash
codex --dangerously-bypass-approvals-and-sandbox exec "请你使用主控模式，开始第{turn+1}轮修改，详细方案如下:$(cat docs/beta/beta_v3/turn_{turn+1}.md)"
```

7. 等待任务执行完成，然后提交全部改动。

### 工作流约束

- `turn_{n}.md` 必须写入最终 assistant 的原始消息，不能改写成摘要。
- 每一轮的 conversation URL 必须单独保存到 `src/GhostVMCore/docs/beta/beta_v3/conversation_links.md`，不能混入 `turn_{n}.md`。
- 对话仍在流式生成或仍处于 `running` 状态时，不能提前开始下一轮修改。
- 如果 ChatGPT 对话长时间卡在 `running`，应继续等待或明确报告阻塞，不能把中间态当成最终方案。
