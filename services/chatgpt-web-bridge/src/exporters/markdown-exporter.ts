import type { ConversationSnapshot } from '@review-then-codex/shared-contracts/chatgpt';

export class MarkdownExporter {
  public render(snapshot: ConversationSnapshot): string {
    const lines: string[] = [
      `# Conversation ${snapshot.conversationId}`,
      '',
      `- Session: ${snapshot.sessionId}`,
      `- Project: ${snapshot.projectName}`,
      `- Model: ${snapshot.model ?? 'unknown'}`,
      `- Status: ${snapshot.status}`,
      '',
    ];

    for (const message of snapshot.messages) {
      lines.push(`## ${message.role}`);
      lines.push('');
      lines.push(message.text.trim() || '_empty_');
      lines.push('');
      if (message.inputFiles.length > 0) {
        lines.push(`Attached files: ${message.inputFiles.join(', ')}`);
        lines.push('');
      }
    }

    return `${lines.join('\n').trim()}\n`;
  }
}
