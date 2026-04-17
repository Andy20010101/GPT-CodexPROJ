# Architecture Boundary

## Owned Write Surface

- `skills/1688_supplier_discovery/**`
- `docs/project-preparation/1688-platform-skill/**`

## Preferred First Slice

- 先交付一个浏览器优先的 skill bundle，核心只解决单个商品方向的 1688 供应商研究与结构化输出。
- 把复杂逻辑尽量放在 `SKILL.md` 和参考文档中，只有在提示词难以稳定表达时才考虑极小的辅助脚本。

## Allowed Dependencies

- OpenClaw 的 skill 目录约定，包括 `SKILL.md` 和同目录下的辅助文本文件。
- 宿主应用已经具备的浏览器导航、页面读取、网页搜索、文件读写等工具能力。
- 操作者已经拥有的 1688 浏览权限或现有登录会话，如果该会话是合法且可复用的。

## Restricted Or Forbidden Areas

- 不要修改 orchestrator、bridge、review/runtime 状态机。
- 不要引入新的服务端、数据库、队列、代理池或站点级抓取基础设施。
- 不要把第一版做成插件平台、浏览器自动化框架或通用供应链中台。
- 不要承诺或实现绕过验证码、绕过访问限制或对抗平台防护的能力。

## Boundary Notes

- 第一版边界必须窄，因为我们要先验证“skill 能否稳定完成一轮供应商研究”，而不是验证“平台级抓取架构”。
- 如果实现开始要求新增后端、长期存储、批处理队列或复杂脚本链，通常说明范围已经越过第一版边界。
- 如果目标宿主没有“浏览器导航 + 页面读取 + 文件输出”这组最小能力，应先停止并报告 blocker，而不是把项目扩展成宿主平台改造。
