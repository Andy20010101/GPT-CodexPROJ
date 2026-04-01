import { randomUUID } from 'node:crypto';

import type {
  MarkdownExportRequest,
  MessageConversationRequest,
  OpenSessionRequest,
  SelectProjectRequest,
  StartConversationRequest,
  StructuredReviewExtractRequest,
  WaitConversationRequest,
} from '@review-then-codex/shared-contracts/chatgpt';
import type {
  ConversationSnapshot,
  SessionSummary,
} from '@review-then-codex/shared-contracts/chatgpt';
import type { Logger } from 'pino';

import { Conversation } from '../domain/conversation';
import { Project } from '../domain/project';
import { AppError } from '../types/error';
import type { ChatGPTAdapter, ConversationRecord } from '../types/runtime';
import { ExportService } from './export-service';
import { SessionLease } from '../browser/session-lease';

export class ConversationService {
  private readonly sessions = new Map<string, SessionSummary>();
  private readonly conversations = new Map<string, ConversationRecord>();

  public constructor(
    private readonly adapter: ChatGPTAdapter,
    private readonly sessionLease: SessionLease,
    private readonly exportService: ExportService,
    private readonly logger: Pick<Logger, 'info'>,
  ) {}

  public async openSession(input: OpenSessionRequest): Promise<SessionSummary> {
    const sessionId = randomUUID();
    const session = await this.adapter.openSession({
      sessionId,
      browserUrl: input.browserUrl,
      startupUrl: input.startupUrl,
    });
    this.sessions.set(sessionId, session);
    this.logger.info({ sessionId }, 'Opened ChatGPT bridge session');
    return session;
  }

  public async selectProject(input: SelectProjectRequest): Promise<SessionSummary> {
    const session = this.requireSession(input.sessionId);
    const ownerId = `project:${input.projectName}`;
    const updatedSession = await this.sessionLease.withLease(
      session.sessionId,
      ownerId,
      async () => {
        const project = new Project(session, this.adapter);
        return project.select(input.projectName, input.model);
      },
    );

    this.sessions.set(updatedSession.sessionId, updatedSession);
    return updatedSession;
  }

  public async startConversation(input: StartConversationRequest): Promise<ConversationSnapshot> {
    const session = this.requireSession(input.sessionId);
    const projectName = input.projectName ?? session.projectName;
    if (!projectName) {
      throw new AppError(
        'PROJECT_NOT_FOUND',
        'No ChatGPT project is selected for the session',
        404,
        {
          sessionId: session.sessionId,
        },
      );
    }

    const conversationId = randomUUID();
    const ownerId = `conversation:${conversationId}:start`;
    const snapshot = await this.sessionLease.withLease(session.sessionId, ownerId, async () => {
      const project = new Project(session, this.adapter);
      return project.startConversation({
        conversationId,
        projectName,
        prompt: input.prompt,
        model: input.model ?? session.model,
        inputFiles: input.inputFiles,
      });
    });

    const updatedSnapshot = this.enrichSnapshot(snapshot, input.inputFiles);
    const updatedSession = {
      ...session,
      projectName,
      model: input.model ?? session.model,
      pageUrl: updatedSnapshot.pageUrl,
    };
    this.sessions.set(updatedSession.sessionId, updatedSession);
    this.conversations.set(updatedSnapshot.conversationId, {
      snapshot: updatedSnapshot,
      inputFiles: [...input.inputFiles],
    });

    return updatedSnapshot;
  }

  public async sendMessage(
    conversationId: string,
    input: MessageConversationRequest,
  ): Promise<ConversationSnapshot> {
    const record = this.requireConversation(conversationId);
    const session = this.requireSession(record.snapshot.sessionId);
    const ownerId = `conversation:${conversationId}:message`;

    const snapshot = await this.sessionLease.withLease(session.sessionId, ownerId, async () => {
      const conversation = new Conversation(session, conversationId, this.adapter);
      return conversation.send(input.message, input.inputFiles);
    });

    const updatedInputFiles = [...new Set([...record.inputFiles, ...input.inputFiles])];
    const updatedSnapshot = this.enrichSnapshot(snapshot, input.inputFiles);
    this.conversations.set(conversationId, {
      snapshot: updatedSnapshot,
      inputFiles: updatedInputFiles,
    });

    return updatedSnapshot;
  }

  public async waitForConversation(
    conversationId: string,
    input: WaitConversationRequest,
  ): Promise<ConversationSnapshot> {
    const record = this.requireConversation(conversationId);
    const session = this.requireSession(record.snapshot.sessionId);
    const ownerId = `conversation:${conversationId}:wait`;

    const snapshot = await this.sessionLease.withLease(session.sessionId, ownerId, async () => {
      const conversation = new Conversation(session, conversationId, this.adapter);
      return conversation.wait(input.maxWaitMs, input.pollIntervalMs);
    });

    this.conversations.set(conversationId, {
      snapshot,
      inputFiles: record.inputFiles,
    });

    return snapshot;
  }

  public async getSnapshot(conversationId: string): Promise<ConversationSnapshot> {
    const record = this.requireConversation(conversationId);
    const session = this.requireSession(record.snapshot.sessionId);
    const ownerId = `conversation:${conversationId}:snapshot`;

    const snapshot = await this.sessionLease.withLease(session.sessionId, ownerId, async () => {
      const conversation = new Conversation(session, conversationId, this.adapter);
      return conversation.getSnapshot();
    });

    this.conversations.set(conversationId, {
      snapshot,
      inputFiles: record.inputFiles,
    });

    return snapshot;
  }

  public async exportMarkdown(
    conversationId: string,
    input: MarkdownExportRequest,
  ): Promise<{
    artifactPath: string;
    manifestPath: string;
    markdown: string;
  }> {
    const record = this.requireConversation(conversationId);
    return this.exportService.exportMarkdown(record.snapshot, {
      inputFiles: record.inputFiles,
      fileName: input.fileName,
    });
  }

  public async extractStructuredReview(
    conversationId: string,
    input: StructuredReviewExtractRequest,
  ): Promise<{
    artifactPath: string;
    manifestPath: string;
    payload: Record<string, unknown>;
  }> {
    const record = this.requireConversation(conversationId);
    return this.exportService.extractStructuredReview(record.snapshot, {
      inputFiles: record.inputFiles,
      fileName: input.fileName,
    });
  }

  private requireSession(sessionId: string): SessionSummary {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new AppError('SESSION_NOT_FOUND', 'ChatGPT session was not found', 404, {
        sessionId,
      });
    }

    return session;
  }

  private requireConversation(conversationId: string): ConversationRecord {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new AppError('CONVERSATION_NOT_FOUND', 'Conversation was not found', 404, {
        conversationId,
      });
    }

    return conversation;
  }

  private enrichSnapshot(
    snapshot: ConversationSnapshot,
    inputFiles: readonly string[],
  ): ConversationSnapshot {
    if (inputFiles.length === 0 || snapshot.messages.length === 0) {
      return {
        ...snapshot,
        updatedAt: new Date().toISOString(),
      };
    }

    const messages = snapshot.messages.map((message, index) => {
      if (message.role !== 'user' || index !== snapshot.messages.length - 1) {
        return message;
      }

      return {
        ...message,
        inputFiles: [...new Set([...message.inputFiles, ...inputFiles])],
      };
    });

    return {
      ...snapshot,
      messages,
      updatedAt: new Date().toISOString(),
    };
  }
}
