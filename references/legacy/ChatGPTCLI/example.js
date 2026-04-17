/**
 * example.js — 使用示例
 *
 * 运行前提：
 *   远程 Chrome 以 --remote-debugging-port=9224 启动，并已登录 ChatGPT
 */

const { ChatGPTClient } = require('./index');

const BROWSER_URL = 'http://192.168.1.62:9224';
const PROJECT_NAME = 'GhostVM';
const MODEL_NAME = 'GPT-5';

async function main() {
  // ── 连接浏览器 ─────────────────────────────────────────────────────────────
  const client = await ChatGPTClient.create(BROWSER_URL);
  console.log('[OK] 已连接远程浏览器');

  // ── 选中项目 ───────────────────────────────────────────────────────────────
  const project = await client.selectProject(PROJECT_NAME);
  console.log(`[OK] 已进入项目: ${project.name}`);

  // ── 场景 1：选择模型 ───────────────────────────────────────────────────────
  const model = await project.selectModel(MODEL_NAME);
  console.log(`[MODEL] ${model}`);

  // ── 场景 2：上传到项目文件区 ───────────────────────────────────────────────
  const projectFile = await project.uploadProjectFile('./test-upload.txt');
  console.log(`[PROJECT FILE] ${projectFile.fileName}`);

  // ── 场景 3：仅上传为对话附件 ───────────────────────────────────────────────
  const attachment = await project.uploadConversationAttachment('./test-upload.txt');
  console.log(`[ATTACHMENT] ${attachment.fileName}`);

  // ── 场景 4：携带文件开启新对话，并拿完整快照 ───────────────────────────────
  const { conversation, reply: firstReply, snapshot: firstSnapshot } =
    await project.newConversationWithFiles(
      '请告诉我这个文件叫什么名字，里面写了什么内容。',
      ['./test-upload.txt']
    );
  console.log(`\n[NEW] 对话 ID: ${conversation.id}`);
  console.log(`[REPLY] ${firstReply}\n`);
  console.log(`[SNAPSHOT] messages=${firstSnapshot.messages.length}, files=${firstSnapshot.files.length}`);

  // 单独读取消息与文件
  const messages = await conversation.getMessages();
  const files = await conversation.getFiles();
  console.log(`[MESSAGES] ${messages.length}`);
  console.log(
    '[FILES]',
    files.map((file) => ({
      name: file.name,
      hasContent: Boolean(file.content),
    }))
  );

  const savedId = conversation.id;

  // ── 场景 5：打开已有对话、继续发送，并再次拿快照 ───────────────────────────
  const openedConversation = await project.openConversation(savedId);
  const { reply: secondReply, snapshot: secondSnapshot } =
    await openedConversation.sendAndGetSnapshot(
      '你刚才说了什么？请复述一遍。'
    );
  console.log(`[CONTINUE] ${secondReply}\n`);
  console.log(
    `[SNAPSHOT AFTER CONTINUE] messages=${secondSnapshot.messages.length}, files=${secondSnapshot.files.length}`
  );

  console.log('[OK] 全部完成');
}

main().catch((err) => {
  console.error('[ERROR]', err.message);
  process.exit(1);
});
