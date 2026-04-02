# Process And Cancellation

runner lifecycle 现在明确分成两层：

1. `ProcessControlService`
   负责真实子进程的启动、pid 跟踪、stdout/stderr 采集、exit code / signal 记录、graceful terminate 和 force kill。
2. `RunnerLifecycleService`
   负责把进程控制包装成 execution runtime 语义，并把 timeout / cancellation / normal exit 统一归一化回 executor。

## Runner 子进程生命周期

对本地 `Codex CLI` 和 `CommandExecutor`，当前流程是：

1. worker 创建 `ExecutionRequest`
2. executor 构造 runner payload 或 command invocation
3. `RunnerLifecycleService` 调 `ProcessControlService.runProcess(...)`
4. 进程句柄写入 `apps/orchestrator/artifacts/runtime/processes/<processHandleId>.json`
5. 进程退出后写 `process_handle` 和 `runner_lifecycle` evidence
6. executor 根据 exit code / signal / timeout / cancellation 生成结构化 `ExecutionResult`

## 协作式取消 + 强制终止

running job 的取消现在不是只有 metadata 标记，而是两阶段：

1. `CancellationService` 记录 cancellation request
2. 如果 job 绑定了本地 runner 子进程，则 `RunnerLifecycleService.requestCancellation(...)` 会执行：
   - 先发 graceful terminate
   - 超过 `RUNNER_TERMINATE_GRACE_MS` 仍未退出时，再按 `RUNNER_KILL_SIGNAL` 强制终止
   - 最多等待 `RUNNER_FORCE_KILL_AFTER_MS`

然后 worker 在安全边界把 job 最终收敛成 `cancelled`、`failed` 或 `manual_attention_required`。

## Timeout / kill / evidence 关系

- timeout 会变成 `RUNNER_TIMEOUT`
- cancellation 会变成 `RUNNER_CANCELLED`
- process start 失败会保留 `PROCESS_START_FAILED`
- process 级终止会留下：
  - process handle artifact
  - runner lifecycle artifact
  - cancellation result artifact

这样 retry、manual attention 和 failure taxonomy 都有机器可读输入，而不是只能靠日志猜。

## 当前边界

当前只保证本机子进程：

- 可 terminate
- 可 force kill
- 可记录 pid / exit signal / exit code / duration
- 可把 timeout 和 cancel 写成结构化 evidence

当前不保证：

- 跨容器 kill
- 跨主机 cancel
- 远端 Codex cloud session 级中断
- 任意外部进程树的完整级联清理
