# Workspace Retention And GC

workspace isolation 现在不只是 prepare/cleanup，而是正式 lifecycle。

## Lifecycle 状态

`WorkspaceLifecycle` 当前使用这些状态：

- `prepared`
- `active`
- `cleanup_pending`
- `cleaned`
- `retained`
- `cleanup_failed`

run 级 lifecycle 记录写在：

`apps/orchestrator/artifacts/runs/<runId>/workspaces/<workspaceId>.json`

workspace runtime descriptor 仍保留，用于描述 base repo、worktree mode、workspace path 和 executor context：

`apps/orchestrator/artifacts/runs/<runId>/workspace-runtime/<workspaceId>.json`

## Retain / cleanup 策略

`CleanupPolicy` 当前支持：

- `ttlMs`
- `retainOnFailure`
- `retainOnRejectedReview`
- `retainOnDebug`
- `maxRetainedPerRun`
- `cleanupMode`

当前语义大致是：

- execution 成功后先进入 `cleanup_pending`，等待 review/gate 收尾
- review approved 后优先 cleanup
- execution failure / cancellation 可按策略 retain
- review changes requested / rejected 可按策略 retain
- delayed/manual 模式下，workspace 可等待后续 GC

## Debug / failure 现场保留原则

如果 execution 或 review 失败后立刻删除 workspace，后续会失去：

- 实际 patch 状态
- runner 落地文件
- 本地 debug 现场
- 手工比对失败原因的上下文

所以系统优先保留失败/调试现场，再用 TTL + GC 避免无限堆积。`retainOnDebug` 和 `retainOnFailure` 的目的就是给人工排障留窗口，而不是无限保留。

## GC

`WorkspaceGcService` 会周期性扫描 workspace lifecycle：

- 过期的 `cleanup_pending` workspace 会被清理
- retained workspace 会根据 TTL 和策略进入后续 cleanup
- cleanup 失败会转成 `cleanup_failed`
- 超过 `maxRetainedPerRun` 的 retained workspace 会优先回收更旧的记录

GC summary 写在：

`apps/orchestrator/artifacts/runtime/gc/<gcRunId>.json`

cleanup record 写在：

`apps/orchestrator/artifacts/runtime/cleanup/<cleanupId>.json`

## 后续扩展方向

当前 cleanup/GC 只处理 workspace 目录或 worktree 生命周期，本身不承担 patch rollback。

后续如果要扩展成更强的恢复模型，合理方向是：

- patch lifecycle tracking
- rollback plan
- retained workspace 再利用策略
- 更细粒度的 manual cleanup 和 debug snapshot
