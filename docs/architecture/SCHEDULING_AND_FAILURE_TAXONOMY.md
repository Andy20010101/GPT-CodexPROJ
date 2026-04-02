# Scheduling And Failure Taxonomy

runtime hardening 之后，job 不再只是“排队然后失败”，而是先经过 scheduling，再经过 taxonomy/disposition。

## Priority / quota / fairness 基本策略

当前 scheduler 是非抢占式的，核心约束包括：

- priority aware dequeue
- per-run quota
- per-kind quota
- exclusive key conflict protection
- baseline fairness

Priority 当前有：

- `urgent`
- `high`
- `normal`
- `low`

当前顺序规则是：

- `urgent > high > normal > low`
- 同优先级下优先考虑当前 active load 更低的 run
- `release_review` 等待过久后会被 boost，避免被普通 task execution 长期饿死

同时仍会应用：

- global concurrency
- per-run concurrency
- `task:*` exclusive key
- `workspace:*` exclusive key

## Quota policy

`QuotaPolicy` 当前支持：

- `maxConcurrentJobsGlobal`
- `maxConcurrentJobsPerRun`
- `maxConcurrentJobsPerKind`
- `reservedSlots`

这允许表达：

- 单个 run 不能占满全部 worker
- `release_review` 不能抢满 worker
- 同类 job 可以独立限流

当前 fairness 仍然是 baseline，不是复杂的抢占式调度器。系统不会强行抢占已经运行的 job。

## Failure taxonomy

当前 failure taxonomy 至少分为：

- `transient`
- `timeout`
- `cancellation`
- `drift`
- `policy`
- `dependency`
- `environment`
- `runner`
- `review`
- `execution`
- `unknown`

这些 taxonomy 来自统一的 `FailureClassificationService`。它会把 runner error、bridge error、queue error、cleanup error、reclaim error 归一化成机器可读 failure record。

## Disposition 与 retry/manual attention 的关系

`JobDispositionService` 会把 failure taxonomy、attempt 和 job kind 映射成：

- `succeeded`
- `retriable`
- `failed`
- `blocked`
- `cancelled`
- `manual_attention_required`

当前边界大致是：

- timeout / transient 且还有 attempt：`retriable`
- review `changes_requested`：`blocked`
- cancellation：`cancelled`
- 缺 runner、环境缺失、drift 耗尽重试：`manual_attention_required`
- 其他不可恢复失败：`failed`

这样 API 和 evidence 都能直接读到“下一步应自动重试，还是必须人工介入”，而不是只给一段自由文本错误。
