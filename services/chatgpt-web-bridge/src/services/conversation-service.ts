import { randomUUID } from 'node:crypto';

import type {
  BridgeDriftIncident,
  BridgeHealthSummary,
  MarkdownExportRequest,
  MessageConversationRequest,
  OpenSessionRequest,
  RecoverConversationRequest,
  ResumeSessionRequest,
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
import type { ChatGPTAdapter, ConversationRecord, SessionRecord } from '../types/runtime';
import { ExportService } from './export-service';
import { SessionLease } from '../browser/session-lease';
import { BridgeHealthService } from './bridge-health-service';
import { SessionResumeGuard } from '../guards/session-resume-guard';

export class ConversationService {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly conversations = new Map<string, ConversationRecord>();

  public constructor(
    private readonly adapter: ChatGPTAdapter,
    private readonly sessionLease: SessionLease,
    private readonly exportService: ExportService,
    private readonly logger: Pick<Logger, 'info'>,
    private readonly bridgeHealthService?: BridgeHealthService,
    private readonly sessionResumeGuard?: SessionResumeGuard,
  ) {}

  public async openSession(input: OpenSessionRequest): Promise<SessionSummary> {
    const sessionId = randomUUID();
    const openedSession = await this.adapter.openSession({
      sessionId,
      browserUrl: input.browserUrl,
      startupUrl: input.startupUrl,
    });
    const session: SessionRecord = {
      ...openedSession,
      startupUrl: input.startupUrl,
    };
    this.sessions.set(sessionId, session);
    await this.recordReadyHealth(session);
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
    await this.recordReadyHealth(updatedSession);
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
    await this.recordReadyHealth(updatedSession, updatedSnapshot.conversationId);

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
    await this.recordReadyHealth(session, conversationId);

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
      return conversation.wait(input.maxWaitMs, input.pollIntervalMs, input.stablePolls);
    });

    this.conversations.set(conversationId, {
      snapshot,
      inputFiles: record.inputFiles,
    });
    await this.recordReadyHealth(session, conversationId);

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
    await this.recordReadyHealth(session, conversationId);

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

  public async getBridgeHealth(): Promise<BridgeHealthSummary> {
    const latest = await this.bridgeHealthService?.getLatestHealth();
    if (latest) {
      return latest;
    }

    const summary: BridgeHealthSummary = {
      status: 'ready',
      checkedAt: new Date().toISOString(),
      activeSessions: this.sessions.size,
      activeConversations: this.conversations.size,
      issues: [],
      metadata: {},
    };
    await this.bridgeHealthService?.recordHealth(summary);
    return summary;
  }

  public async listDriftIncidents(): Promise<BridgeDriftIncident[]> {
    return (await this.bridgeHealthService?.listIncidents()) ?? [];
  }

  public async resumeSession(
    sessionId: string,
    input: ResumeSessionRequest,
  ): Promise<{
    session: SessionSummary;
    health: BridgeHealthSummary;
  }> {
    void input;
    const session = this.requireSession(sessionId);
    if (!this.sessionResumeGuard) {
      const health = await this.getBridgeHealth();
      return { session, health };
    }

    const result = await this.sessionResumeGuard.resumeSession(session);
    this.sessions.set(sessionId, result.session);
    const health = await this.getBridgeHealth();
    return {
      session: result.session,
      health: {
        ...health,
        status: result.health.status === 'ready' ? 'ready' : health.status,
      },
    };
  }

  public async recoverConversation(
    conversationId: string,
    input: RecoverConversationRequest,
  ): Promise<{
    snapshot: ConversationSnapshot;
    health: BridgeHealthSummary;
  }> {
    void input;
    const record = this.requireConversation(conversationId);
    const session = this.requireSession(record.snapshot.sessionId);
    if (!this.sessionResumeGuard) {
      const snapshot = await this.getSnapshot(conversationId);
      const health = await this.getBridgeHealth();
      return { snapshot, health };
    }

    try {
      const snapshot = await this.sessionResumeGuard.recoverConversation({
        session,
        conversation: record,
      });
      this.conversations.set(conversationId, {
        snapshot,
        inputFiles: record.inputFiles,
      });
      await this.recordReadyHealth(session, conversationId);
      const health = await this.getBridgeHealth();
      return { snapshot, health };
    } catch (error) {
      await this.recordRecoveryFailure({
        sessionId: session.sessionId,
        conversationId,
        pageUrl: record.snapshot.pageUrl ?? session.pageUrl,
        summary:
          error instanceof Error ? error.message : 'Conversation recovery failed without details.',
      });
      throw error;
    }
  }

  private requireSession(sessionId: string): SessionRecord {
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

  private async recordReadyHealth(
    session: SessionRecord,
    conversationId?: string | undefined,
  ): Promise<void> {
    await this.bridgeHealthService?.recordHealth({
      status: 'ready',
      checkedAt: new Date().toISOString(),
      activeSessions: this.sessions.size,
      activeConversations: this.conversations.size,
      issues: [],
      metadata: {
        sessionId: session.sessionId,
        ...(conversationId ? { conversationId } : {}),
      },
    });
  }

  private async recordRecoveryFailure(input: {
    sessionId: string;
    conversationId: string;
    pageUrl?: string | undefined;
    summary: string;
  }): Promise<void> {
    if (!this.bridgeHealthService) {
      return;
    }

    await this.bridgeHealthService.recordIncident({
      incidentId: randomUUID(),
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      category: 'conversation_recovery',
      status: 'failed',
      summary: input.summary,
      attempts: [],
      ...(input.pageUrl ? { pageUrl: input.pageUrl } : {}),
      occurredAt: new Date().toISOString(),
      metadata: {},
    });
    await this.bridgeHealthService.recordHealth({
      status: 'degraded',
      checkedAt: new Date().toISOString(),
      activeSessions: this.sessions.size,
      activeConversations: this.conversations.size,
      issues: [input.summary],
      metadata: {
        sessionId: input.sessionId,
        conversationId: input.conversationId,
      },
    });
  }
}
