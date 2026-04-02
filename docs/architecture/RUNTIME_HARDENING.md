# Runtime Hardening

第七阶段不是重写 orchestrator，而是在已有的单实例 daemon runtime 上补一层更接近生产基线的 runtime hardening。

## 范围

这轮 hardening 主要覆盖四件事：

1. runner lifecycle
   让本地 `Codex CLI` / command runner 具备子进程跟踪、超时、协作式取消、强制终止和结构化 evidence。
2. workspace lifecycle
   让隔离工作区具备 prepare 之外的 retain、cleanup、TTL 和 GC，而不是执行完就只剩一个路径。
3. scheduling policy
   让 queue 支持 priority、quota、per-kind 限流和 baseline fairness，而不是只有先来先服务。
4. failure semantics
   让失败可以被统一归类成 taxonomy，再决定 retry、blocked、cancelled 或 manual attention。

## 新增组件

当前实现新增了这些核心组件：

- `ProcessControlService`
- `RunnerLifecycleService`
- `WorkspaceCleanupService`
- `WorkspaceGcService`
- `PriorityQueueService`
- `QuotaControlService`
- `SchedulingPolicyService`
- `FailureClassificationService`
- `JobDispositionService`
- `scripts/run-orchestrator-daemon.ts`

这些组件都落在现有的 orchestrator runtime 边界内，通过 file-backed repository 写盘，并把关键事件写进 evidence ledger。

## 为什么先做这层 hardening

到第六阶段为止，系统已经有：

- control plane contract
- execution plane adapter
- review plane 回流
- workflow runtime
- daemon shell

继续往前推进时，最容易出问题的不是 schema，而是 runtime 的副作用管理：

- 子进程退出不干净，导致 running job 僵死
- workspace 无限堆积，导致磁盘和 debug 现场失控
- 调度顺序无法解释，导致 run 之间互相挤压
- 错误只能靠日志猜，无法自动判断 retry 还是人工介入

所以这轮 hardening 的目标是让 daemon shell 变成一个更正式的本地长期运行外壳：可恢复、可观测、可限流、可追溯。

## 当前实现到什么程度

当前已经具备：

- 本机 runner 子进程的 process handle 持久化
- timeout、cancel、kill 的结构化结果
- workspace retention policy 和 TTL-based GC
- 非抢占式 priority + quota 调度
- failure taxonomy 和 job disposition
- daemon 脚本入口、启动恢复、GC/reclaim 周期任务和优雅退出

## 当前仍然不是

当前仍然不是生产级分布式 runtime：

- 没有 Redis / DB / 外部队列
- 没有多实例 leader election
- 没有跨机 cancellation
- 没有分布式 lease
- 没有完整 patch rollback
- 没有强幂等的跨重启执行协议

系统仍然明确定位为：

- 单实例
- 单进程 daemon
- 文件持久化
- 可恢复、可测试、可扩展
