import type {
  ConversationSnapshot,
  SessionSummary,
} from '@gpt-codexproj/shared-contracts/chatgpt';

import type { ChatGPTAdapter } from '../types/runtime';

export class Project {
  public constructor(
    private readonly session: SessionSummary,
    private readonly adapter: ChatGPTAdapter,
  ) {}

  public async select(projectName: string, model?: string): Promise<SessionSummary> {
    return this.adapter.selectProject({
      session: this.session,
      projectName,
      model,
    });
  }

  public async startConversation(input: {
    conversationId: string;
    projectName: string;
    prompt: string;
    model?: string | undefined;
    inputFiles: readonly string[];
  }): Promise<ConversationSnapshot> {
    return this.adapter.startConversation({
      session: this.session,
      conversationId: input.conversationId,
      projectName: input.projectName,
      model: input.model,
      prompt: input.prompt,
      inputFiles: input.inputFiles,
    });
  }
}
