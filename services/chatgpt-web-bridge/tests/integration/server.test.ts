import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MarkdownExportResponseSchema,
  OpenSessionResponseSchema,
  SelectProjectResponseSchema,
  StartConversationResponseSchema,
  StructuredReviewExtractResponseSchema,
  type ConversationSnapshot,
  type SessionSummary,
} from '@review-then-codex/shared-contracts/chatgpt';

import { SessionLease } from '../../src/browser/session-lease';
import { MarkdownExporter } from '../../src/exporters/markdown-exporter';
import { StructuredOutputExtractor } from '../../src/exporters/structured-output-extractor';
import { ArtifactManifestWriter } from '../../src/guards/artifact-manifest';
import { buildServer } from '../../src/server';
import { ConversationService } from '../../src/services/conversation-service';
import { ExportService } from '../../src/services/export-service';
import type {
  AdapterMessageInput,
  AdapterSelectProjectInput,
  AdapterSessionOpenInput,
  AdapterSnapshotInput,
  AdapterStartConversationInput,
  AdapterWaitInput,
  ChatGPTAdapter,
} from '../../src/types/runtime';

class FakeAdapter implements ChatGPTAdapter {
  private readonly snapshots = new Map<string, ConversationSnapshot>();
  private readonly sessions = new Map<string, SessionSummary>();

  public openSession(input: AdapterSessionOpenInput): Promise<SessionSummary> {
    const session: SessionSummary = {
      sessionId: input.sessionId,
      browserUrl: input.browserUrl,
      pageUrl: input.startupUrl ?? 'https://chatgpt.com/',
      connectedAt: '2026-04-01T12:00:00.000Z',
    };
    this.sessions.set(input.sessionId, session);
    return Promise.resolve(session);
  }

  public selectProject(input: AdapterSelectProjectInput): Promise<SessionSummary> {
    const session: SessionSummary = {
      ...input.session,
      projectName: input.projectName,
      model: input.model ?? input.session.model,
      pageUrl: `https://chatgpt.com/g/${encodeURIComponent(input.projectName)}`,
    };
    this.sessions.set(session.sessionId, session);
    return Promise.resolve(session);
  }

  public startConversation(input: AdapterStartConversationInput): Promise<ConversationSnapshot> {
    const snapshot = this.createSnapshot({
      conversationId: input.conversationId,
      sessionId: input.session.sessionId,
      projectName: input.projectName,
      model: input.model,
      prompt: input.prompt,
      inputFiles: input.inputFiles,
    });
    this.snapshots.set(input.conversationId, snapshot);
    return Promise.resolve(snapshot);
  }

  public sendMessage(input: AdapterMessageInput): Promise<ConversationSnapshot> {
    const existing = this.snapshots.get(input.conversationId);
    const snapshot = this.createSnapshot({
      conversationId: input.conversationId,
      sessionId: input.session.sessionId,
      projectName: input.session.projectName ?? 'ReviewSystem',
      model: input.session.model,
      prompt: input.message,
      inputFiles: input.inputFiles,
      existingMessages: existing?.messages,
    });
    this.snapshots.set(input.conversationId, snapshot);
    return Promise.resolve(snapshot);
  }

  public waitForConversation(input: AdapterWaitInput): Promise<ConversationSnapshot> {
    const snapshot = this.snapshots.get(input.conversationId);
    if (!snapshot) {
      return Promise.reject(new Error('missing snapshot'));
    }

    const completed: ConversationSnapshot = {
      ...snapshot,
      status: 'completed',
      updatedAt: '2026-04-01T12:01:00.000Z',
    };
    this.snapshots.set(input.conversationId, completed);
    return Promise.resolve(completed);
  }

  public getConversationSnapshot(input: AdapterSnapshotInput): Promise<ConversationSnapshot> {
    const snapshot = this.snapshots.get(input.conversationId);
    if (!snapshot) {
      return Promise.reject(new Error('missing snapshot'));
    }
    return Promise.resolve(snapshot);
  }

  private createSnapshot(input: {
    conversationId: string;
    sessionId: string;
    projectName: string;
    model?: string | undefined;
    prompt: string;
    inputFiles: readonly string[];
    existingMessages?: ConversationSnapshot['messages'] | undefined;
  }): ConversationSnapshot {
    const now = '2026-04-01T12:00:00.000Z';
    const assistantText = input.prompt.includes('no-structured')
      ? 'review completed without json block'
      : '```json\n{"decision":"approve","issues":[]}\n```';
    const existingMessages = input.existingMessages ?? [];

    return {
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      projectName: input.projectName,
      model: input.model,
      status: 'completed',
      source: 'adapter',
      pageUrl: `https://chatgpt.com/c/${input.conversationId}`,
      startedAt: now,
      updatedAt: now,
      messages: [
        ...existingMessages,
        {
          id: randomUUID(),
          role: 'user',
          text: input.prompt,
          createdAt: now,
          inputFiles: [...input.inputFiles],
        },
        {
          id: randomUUID(),
          role: 'assistant',
          text: assistantText,
          createdAt: now,
          inputFiles: [],
        },
      ],
      lastAssistantMessage: assistantText,
    };
  }
}

describe('chatgpt-web-bridge routes', () => {
  let artifactDir: string;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-server-'));
    const adapter = new FakeAdapter();
    const exportService = new ExportService(
      artifactDir,
      new MarkdownExporter(),
      new StructuredOutputExtractor(),
      new ArtifactManifestWriter(artifactDir),
    );
    const conversationService = new ConversationService(
      adapter,
      new SessionLease(),
      exportService,
      { info: () => undefined },
    );
    app = buildServer({ conversationService });
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves health and conversation workflow routes', async () => {
    const health = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(health.statusCode).toBe(200);

    const openSession = await app.inject({
      method: 'POST',
      url: '/api/sessions/open',
      payload: {
        browserUrl: 'http://127.0.0.1:9222',
      },
    });
    expect(openSession.statusCode).toBe(200);
    const openBody = OpenSessionResponseSchema.parse(openSession.json());
    const sessionId = openBody.data.sessionId;

    const selectProject = await app.inject({
      method: 'POST',
      url: '/api/projects/select',
      payload: {
        sessionId,
        projectName: 'ReviewSystem',
        model: 'GPT-5',
      },
    });
    expect(selectProject.statusCode).toBe(200);
    SelectProjectResponseSchema.parse(selectProject.json());

    const startConversation = await app.inject({
      method: 'POST',
      url: '/api/conversations/start',
      payload: {
        sessionId,
        prompt: 'Create a review',
        inputFiles: ['/tmp/spec.md'],
      },
    });
    expect(startConversation.statusCode).toBe(200);
    const startBody = StartConversationResponseSchema.parse(startConversation.json());
    const conversationId = startBody.data.conversationId;

    const waitResponse = await app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/wait`,
      payload: {},
    });
    expect(waitResponse.statusCode).toBe(200);

    const snapshotResponse = await app.inject({
      method: 'GET',
      url: `/api/conversations/${conversationId}/snapshot`,
    });
    expect(snapshotResponse.statusCode).toBe(200);

    const exportResponse = await app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/export/markdown`,
      payload: {
        fileName: 'review.md',
      },
    });
    expect(exportResponse.statusCode).toBe(200);
    const exportBody = MarkdownExportResponseSchema.parse(exportResponse.json());
    await expect(fs.stat(exportBody.data.artifactPath)).resolves.toBeTruthy();

    const extractResponse = await app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/extract/structured-review`,
      payload: {
        fileName: 'review.json',
      },
    });
    expect(extractResponse.statusCode).toBe(200);
    const extracted = StructuredReviewExtractResponseSchema.parse(extractResponse.json());
    expect(extracted.data.payload).toEqual({
      decision: 'approve',
      issues: [],
    });
  });

  it('returns a clear structured output error when the assistant reply has no json block', async () => {
    const openSession = await app.inject({
      method: 'POST',
      url: '/api/sessions/open',
      payload: {
        browserUrl: 'http://127.0.0.1:9222',
      },
    });
    const sessionId = OpenSessionResponseSchema.parse(openSession.json()).data.sessionId;

    await app.inject({
      method: 'POST',
      url: '/api/projects/select',
      payload: {
        sessionId,
        projectName: 'ReviewSystem',
      },
    });

    const startConversation = await app.inject({
      method: 'POST',
      url: '/api/conversations/start',
      payload: {
        sessionId,
        prompt: 'no-structured',
      },
    });
    const conversationId = StartConversationResponseSchema.parse(startConversation.json()).data
      .conversationId;

    const extractResponse = await app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/extract/structured-review`,
      payload: {},
    });

    expect(extractResponse.statusCode).toBe(404);
    expect(extractResponse.json()).toMatchObject({
      ok: false,
      error: {
        code: 'STRUCTURED_OUTPUT_NOT_FOUND',
      },
    });
  });
});
