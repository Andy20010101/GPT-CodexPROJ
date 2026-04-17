/**
 * wait-conversation.js
 *
 * 用途：
 *   连接已登录的远程 Chrome，读取某个 ChatGPT 对话的当前状态，
 *   如仍在生成则等待其完成，然后输出最终状态与对话摘要。
 *
 * 用法：
 *   node wait-conversation.js
 *   node wait-conversation.js <conversation_url>
 *   node wait-conversation.js <conversation_url> <browser_url> [timeout_ms] [output_md_path]
 */

const fs = require('fs');
const path = require('path');
const { ChatGPTClient, Conversation } = require('./index');
const adapter = require('./adapter');

const DEFAULT_CONVERSATION_URL =
  'https://chatgpt.com/g/g-p-69a4014b9f5881919b68c81a6bbeda3d/c/69b2afa9-8be0-83a7-aa71-ab603cc9c29c';
const DEFAULT_BROWSER_URL =
  process.env.CHATGPT_BROWSER_URL || 'http://192.168.1.62:9224';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function extractProjectPathFromConversationUrl(rawUrl) {
  const pathname = new URL(rawUrl).pathname;
  const match = pathname.match(/(\/g\/g-p-[a-z0-9-]+)/i);
  return match ? `${match[1]}/project` : null;
}

function pickLastAssistantMessage(snapshot) {
  const assistantMessages = (snapshot.messages || []).filter(
    (message) => message.role === 'assistant'
  );
  return assistantMessages[assistantMessages.length - 1] || null;
}

function formatReplyMessage(message) {
  if (!message) return null;

  return {
    id: message.id || null,
    role: message.role || 'assistant',
    text: message.text || '',
    files: (message.files || []).map((file) => ({
      id: file.id || null,
      name: file.name || null,
      mimeType: file.mimeType || null,
      size: file.size ?? null,
      url: file.url || null,
      content: file.content || null,
    })),
  };
}

function defaultOutputPath(conversationId) {
  return path.resolve(process.cwd(), `conversation-${conversationId}.md`);
}

function renderAttachmentMarkdown(file) {
  const lines = [`### ${file.name || 'Unnamed Attachment'}`];

  if (file.mimeType) lines.push(`- MIME Type: ${file.mimeType}`);
  if (file.size != null) lines.push(`- Size: ${file.size}`);
  if (file.url) lines.push(`- URL: ${file.url}`);
  lines.push('');

  if (file.content) {
    lines.push('#### Content');
    lines.push('');
    lines.push('```text');
    lines.push(file.content);
    lines.push('```');
  } else {
    lines.push('_No attachment content available._');
  }

  lines.push('');
  return lines.join('\n');
}

function renderReplyMarkdown({ conversationUrl, status, snapshot, reply }) {
  const lines = [reply?.text || '', ''];

  if (reply?.files?.length) {
    lines.push('## Attachments');
    lines.push('');
    for (const file of reply.files) {
      lines.push(renderAttachmentMarkdown(file));
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

async function main() {
  const conversationUrl = process.argv[2] || DEFAULT_CONVERSATION_URL;
  const browserUrl = process.argv[3] || DEFAULT_BROWSER_URL;
  const timeoutMs = Number(process.argv[4] || DEFAULT_TIMEOUT_MS);
  const requestedOutputPath = process.argv[5] || null;

  const conversationId = adapter.extractConversationId(conversationUrl);
  const projectId = adapter.extractProjectId(conversationUrl);
  const projectPath = extractProjectPathFromConversationUrl(conversationUrl);
  const outputPath = path.resolve(
    requestedOutputPath || defaultOutputPath(conversationId)
  );

  let client = null;
  try {
    client = await ChatGPTClient.create(browserUrl);
    const conversation = new Conversation(
      client._page,
      conversationId,
      projectId,
      projectPath
    );

    const initialStatus = await conversation.getStatus();
    console.log(
      JSON.stringify(
        {
          phase: 'initial',
          status: initialStatus,
        },
        null,
        2
      )
    );

    const finalStatus =
      initialStatus.state === 'completed'
        ? initialStatus
        : await conversation.waitUntilComplete({ timeout: timeoutMs });

    const snapshot = await conversation.getSnapshot();
    const lastAssistant = pickLastAssistantMessage(snapshot);
    const reply = formatReplyMessage(lastAssistant);
    const markdown = renderReplyMarkdown({
      conversationUrl,
      status: finalStatus,
      snapshot,
      reply,
    });
    fs.writeFileSync(outputPath, markdown, 'utf8');

    console.log(
      JSON.stringify(
        {
          phase: 'final',
          status: finalStatus,
          reply,
          outputMarkdownPath: outputPath,
          snapshot: {
            id: snapshot.id,
            title: snapshot.title,
            source: snapshot.source,
            messageCount: snapshot.messages.length,
            fileCount: snapshot.files.length,
          },
        },
        null,
        2
      )
    );
  } finally {
    await client?.disconnect?.().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[ERROR]', err && err.stack ? err.stack : String(err));
  process.exit(1);
});
