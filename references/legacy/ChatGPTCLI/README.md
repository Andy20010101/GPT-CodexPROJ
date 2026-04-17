# ChatGPTCLI

`ChatGPTCLI` 是一个通过 `puppeteer-core` 驱动已登录 `chatgpt.com` 浏览器标签页的 Node.js SDK。它不是 OpenAI 官方 API，也不直接调用公开接口；它复用真实网页会话，把常用能力收敛成 `ChatGPTClient -> Project -> Conversation` 三层对象。

当前实现重点覆盖的是 ChatGPT 项目内的自动化工作流：

- 连接远程 Chrome 调试会话
- 按项目名进入 ChatGPT Project
- 在项目页或对话页切换模型
- 上传和删除项目级文件
- 上传对话附件，并在发送消息时挂载附件
- 创建新对话、打开已有对话、继续发送消息
- 轮询对话状态，等待真正完成
- 读取完整对话快照，包括消息、附件、可提取的文本内容
- 使用独立脚本等待对话完成并导出最终 assistant Markdown

## 运行前提

1. Chrome 必须以 remote debugging 模式启动，并且该 profile 已登录 ChatGPT。
2. 要操作的项目必须已经出现在 ChatGPT 左侧导航里，因为 `selectProject()` 依赖侧边栏链接文本定位项目。
3. 这是网页自动化，不是稳定的服务端契约。ChatGPT UI 或内部请求结构变动后，通常需要更新 `selectors.js`，偶尔还要补 `adapter.js`。
4. 长思考模型可能运行数分钟。当前实现对模型回复和 Chrome 协议都设置了长超时。

示例启动方式：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9224 \
  --user-data-dir=/tmp/chrome-debug
```

## 安装

```bash
npm install
```

## 快速开始

```js
const { ChatGPTClient } = require('./index');

async function main() {
  const browserURL = process.env.CHATGPT_BROWSER_URL || 'http://127.0.0.1:9224';
  const client = await ChatGPTClient.create(browserURL);

  try {
    const project = await client.selectProject('GhostVM');
    await project.selectModel('GPT-5');

    const { conversation, reply, snapshot } =
      await project.newConversationWithFiles(
        '请先阅读附件，再总结其中的关键约束。',
        ['./path/to/spec.md']
      );

    console.log('conversationId =', conversation.id);
    console.log('reply =', reply);
    console.log('snapshot.source =', snapshot.source);
    console.log(
      'files =',
      snapshot.files.map((file) => ({
        name: file.name,
        hasContent: Boolean(file.content),
      }))
    );
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## 公开 API

### `ChatGPTClient`

```js
const { ChatGPTClient } = require('./index');
```

| 方法 | 说明 |
|---|---|
| `ChatGPTClient.create(browserURL)` | 连接远程 Chrome，返回 `ChatGPTClient` |
| `client.selectProject(projectName)` | 通过侧边栏项目名进入项目，返回 `Project` |
| `client.disconnect()` | 断开 Puppeteer 与远程浏览器的连接，不关闭实际 Chrome |

### `Project`

`Project` 代表一个 ChatGPT 项目主页上下文，负责文件和对话工厂能力。

| 方法 | 返回值 | 说明 |
|---|---|---|
| `project.selectModel(modelName)` | `string` | 切换当前项目页模型，返回最终选中的文案 |
| `project.uploadProjectFile(filePath)` | `file` | 上传到项目文件区，并尽量补齐文本 `content` |
| `project.deleteProjectFile(fileRef)` | `file[]` | 按 `file_id` 或文件名删除项目文件 |
| `project.uploadConversationAttachment(filePath)` | `file` | 只上传为后续对话附件，不发送消息 |
| `project.newConversation(firstMessage)` | `{ conversation, reply, snapshot }` | 在项目中创建新对话并发送首条消息 |
| `project.newConversationWithFiles(firstMessage, filePaths)` | `{ conversation, reply, snapshot }` | 创建新对话、携带附件并等待完整回复 |
| `project.openConversation(conversationId)` | `Conversation` | 打开已有项目对话，不发送消息 |
| `project.continueConversation(conversationId, message)` | `{ conversation, reply, snapshot }` | 恢复已有对话并继续发送 |

### `Conversation`

`Conversation` 代表一个具体对话，负责继续发送、轮询状态和拉取快照。

| 方法 | 返回值 | 说明 |
|---|---|---|
| `conversation.selectModel(modelName)` | `string` | 在当前对话页切换模型 |
| `conversation.send(message)` | `string` | 发送消息并等待完整回复 |
| `conversation.sendWithFiles(message, filePaths)` | `string` | 发送消息并附带文件 |
| `conversation.sendAndGetSnapshot(message)` | `{ reply, snapshot }` | 发送消息后立即取完整快照 |
| `conversation.sendWithFilesAndGetSnapshot(message, filePaths)` | `{ reply, snapshot }` | 带文件发送并取完整快照 |
| `conversation.getStatus()` | `status` | 获取当前对话状态 |
| `conversation.waitUntilComplete(options)` | `status` | 轮询直到对话真正完成 |
| `conversation.getSnapshot()` | `snapshot` | 获取完整对话快照 |
| `conversation.getMessages()` | `message[]` | 快照中的消息列表 |
| `conversation.getFiles()` | `file[]` | 快照中的文件列表 |

## 返回数据结构

### `status`

```js
{
  conversationId: '69b2...',
  url: 'https://chatgpt.com/g/.../c/69b2...',
  state: 'running' | 'completed',
  isResponding: true | false,
  messageCount: 4,
  assistantMessageCount: 2,
  lastMessageRole: 'assistant',
  lastAssistantText: '...',
  checkedAt: '2026-03-14T08:00:00.000Z'
}
```

### `snapshot`

```js
{
  id: '69b2...',
  title: 'Conversation title',
  source: 'api' | 'dom' | 'api+dom' | 'empty',
  messages: [
    {
      id: '...',
      role: 'user' | 'assistant' | 'unknown',
      text: '...',
      createTime: 1741939200,
      files: [file]
    }
  ],
  files: [file]
}
```

### `file`

```js
{
  id: 'file-...',
  name: 'spec.md',
  mimeType: 'text/markdown',
  size: 1234,
  url: 'https://...',
  content: '# text-like files are backfilled when possible'
}
```

`content` 不是总能拿到，它来自三种来源：

1. 本地刚上传的文本类文件，`client.js` 会直接从磁盘读取并缓存。
2. ChatGPT 会话 API 或 DOM 已经暴露出来的附件文本。
3. 快照里存在可直接 `fetch()` 的文本类文件 URL 时，`adapter.js` 会尝试回填内容。

为避免超大文本污染结果，文本内容会截断到 100_000 字符。

## 关键工作流

### 1. 项目文件上传

项目文件不是走 DOM 点击上传，而是走一条后端链路：

1. `POST /backend-api/files` 创建文件条目
2. `PUT upload_url` 上传到 Blob
3. `POST /backend-api/files/process_upload_stream` 让项目库处理文件
4. `POST /backend-api/gizmos/snorlax/upsert` 把文件挂回项目配置

这意味着项目文件上传比“对话附件上传”更接近项目配置管理，而不是单纯的会话附件。

### 2. 对话附件发送

对话附件上传本身也是 API 流程，但真正“把附件带进消息里”依赖 CDP 拦截：

1. 先用 `apiUploadConversationAttachment()` 完成三步上传
2. `sendMessageWithFiles()` 打开 `Fetch.enable`
3. 拦截 `/backend-api/f/conversation`
4. 把 `metadata.attachments` 注入首条 message payload
5. 放行原请求

这个设计的好处是附件绑定和消息发送被强行收敛到一次真实会话请求里；坏处是如果 ChatGPT 改了请求地址或 payload 结构，这条链路会最先失效。

### 3. 对话完成检测

回复完成检测有两层：

1. 主路径：等待 `stop-button` 出现，再等待它消失。
2. 降级路径：等待 assistant 消息数量增长，再观察最后一条 assistant 文本是否稳定。

`Conversation.waitUntilComplete()` 又在此基础上增加了稳定轮询，只有连续若干次都处于 `completed` 才返回，避免短暂抖动。

### 4. 快照构建

快照不是单纯依赖 DOM，也不是单纯依赖 ChatGPT 内部会话 API，而是合并两者：

- API 适合还原 message mapping、角色、时间和隐藏附件元数据
- DOM 适合兜底真实页面上已经渲染出来但 API 未完整暴露的内容
- 合并后再对文本类附件做二次 hydration

这让 `snapshot.source` 可能是 `api`、`dom` 或 `api+dom`。这是当前实现里最重要的抗漂移策略之一。

## 架构分层

```text
example.js / wait-conversation.js
          |
          v
client.js   -> 公开语义 API，只暴露 ChatGPTClient / Project / Conversation
          |
          v
adapter.js  -> 唯一允许直接操作 page 和 backend-api 的地方
      /         \
     v           v
browser.js   selectors.js
```

| 文件 | 职责 | 不应该做的事 |
|---|---|---|
| `browser.js` | 连接和断开远程 Chrome | 知道项目、对话、文件语义 |
| `selectors.js` | 所有 DOM 选择器真相来源 | 写逻辑 |
| `adapter.js` | DOM 操作、网络请求、等待逻辑 | 持有业务状态、设计公开 API |
| `client.js` | 公开对象模型、缓存已知文件、组装返回值 | 直接写 `page.evaluate()` |
| `wait-conversation.js` | 命令行脚本封装 | 成为新的底层抽象层 |

### 这套结构为什么相对稳定

- 扩展方向被强制限制在 `Project` 或 `Conversation` 上，避免顶层 API 无序膨胀。
- `page` 只在 `browser.js -> client.js -> adapter.js` 这一条路径上传递，不向调用方泄漏。
- 选择器变更优先收敛到 `selectors.js`，页面流程差异再由 `adapter.js` 消化。
- 文件信息缓存放在 `client.js`，这样即使 ChatGPT 后端没有回传完整附件元数据，调用方仍能在快照里拿到可用的 `mimeType`、`size` 和文本 `content`。

## 命令行脚本

### `example.js`

演示完整 happy path：

- 连接浏览器
- 进入项目
- 切模型
- 上传项目文件
- 上传对话附件
- 携带附件创建新对话
- 再次打开对话并继续发送

运行：

```bash
node example.js
```

### `wait-conversation.js`

用途：连接远程浏览器，等待某个 conversation 真正结束，然后把最后一条 assistant 原始消息导出为 Markdown。

```bash
node wait-conversation.js
node wait-conversation.js <conversation_url>
node wait-conversation.js <conversation_url> <browser_url> [timeout_ms] [output_md_path]
```

脚本会输出两次 JSON：

- `phase: "initial"`：当前状态
- `phase: "final"`：完成后的状态、最终 reply 对象和输出 Markdown 路径

## 已知限制

- 当前公开 API 以“项目内工作流”为中心，`ChatGPTClient` 只暴露 `selectProject()`，不提供全局会话枚举或非项目入口。
- `selectProject()` 依赖侧边栏当前可见项目链接，如果项目未展开、未渲染或命名重复，会选不到或选错。
- 模型选择使用 `data-testid` 加文本启发式匹配，ChatGPT 改名或改弹层结构时容易受影响。
- 带附件发送依赖拦截 `/backend-api/f/conversation`。如果请求路径、字段名或附件挂载位置变化，这一能力需要同步调整。
- 文本 `content` 只会为文本类文件补齐；二进制文件通常只能拿到元数据。
- 仓库目前没有自动化测试，真实验证仍依赖 `node --check` 和远程 Chrome smoke test。

## 调试建议

- 连接不上 Chrome：先检查 `browser.js` 使用的 `browserURL`，确认 Chrome 是用 `--remote-debugging-port` 启动的。
- 页面结构变了：先看 `selectors.js`，再看 `adapter.js` 中对应工作流。
- 对话或项目导航错乱：先检查 `extractProjectPath()`、`navigateToProjectHome()`、`navigateToConversation()`。
- 脚本执行完不退出：通常是没有调用 `client.disconnect()`。

## 开发校验

至少执行语法检查：

```bash
node --check browser.js
node --check selectors.js
node --check adapter.js
node --check client.js
node --check wait-conversation.js
node --check example.js
```

如果修改了选择器、上传链路、导航、模型选择、发送消息或完成等待逻辑，还应连接真实浏览器做一次 smoke test。
