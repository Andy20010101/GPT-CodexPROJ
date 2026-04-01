import type {
  ConversationSnapshot,
  SessionSummary,
} from '@review-then-codex/shared-contracts/chatgpt';

import type { ChatGPTAdapter } from '../types/runtime';

export class Conversation {
  public constructor(
    private readonly session: SessionSummary,
    private readonly conversationId: string,
    private readonly adapter: ChatGPTAdapter,
  ) {}

  public async send(message: string, inputFiles: readonly string[]): Promise<ConversationSnapshot> {
    return this.adapter.sendMessage({
      session: this.session,
      conversationId: this.conversationId,
      message,
      inputFiles,
    });
  }

  public async wait(maxWaitMs?: number, pollIntervalMs?: number): Promise<ConversationSnapshot> {
    return this.adapter.waitForConversation({
      session: this.session,
      conversationId: this.conversationId,
      maxWaitMs,
      pollIntervalMs,
    });
  }

  public async getSnapshot(): Promise<ConversationSnapshot> {
    return this.adapter.getConversationSnapshot({
      session: this.session,
      conversationId: this.conversationId,
    });
  }
}
