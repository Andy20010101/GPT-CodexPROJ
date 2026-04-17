import http from 'node:http';
import https from 'node:https';
import {
  ApiFailureSchema,
  BridgeHealthResponseSchema,
  DriftIncidentsResponseSchema,
  GetConversationStatusResponseSchema,
  MarkdownExportResponseSchema,
  MessageConversationResponseSchema,
  OpenSessionResponseSchema,
  RecoverConversationResponseSchema,
  ResumeSessionResponseSchema,
  SelectProjectResponseSchema,
  StartConversationResponseSchema,
  StructuredReviewExtractResponseSchema,
  WaitConversationResponseSchema,
  GetSnapshotResponseSchema,
  type BridgeDriftIncident,
  type BridgeHealthSummary,
  type ConversationStatus,
  type MarkdownExportRequest,
  type MessageConversationRequest,
  type OpenSessionRequest,
  type RecoverConversationRequest,
  type ResumeSessionRequest,
  type SelectProjectRequest,
  type StartConversationRequest,
  type StructuredReviewExtractRequest,
  type WaitConversationRequest,
} from '@gpt-codexproj/shared-contracts/chatgpt';
import type {
  ConversationSnapshot,
  SessionSummary,
} from '@gpt-codexproj/shared-contracts/chatgpt';
import { type ZodTypeAny, z } from 'zod';

type BridgeFetch = typeof fetch;
type BridgeHttpResponse = {
  ok: boolean;
  status: number;
  payload: unknown;
};

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function hasReplyStarted(status: ConversationStatus): boolean {
  return (
    status.status === 'running' ||
    status.assistantMessageCount > 0 ||
    status.lastMessageRole === 'assistant'
  );
}

function hasAssistantReply(status: ConversationStatus): boolean {
  return (
    status.assistantMessageCount > 0 ||
    status.lastMessageRole === 'assistant' ||
    (typeof status.lastAssistantMessage === 'string' && status.lastAssistantMessage.length > 0)
  );
}

const RETRY_VISIBLE_STALL_POLLS = 3;
const RETRY_VISIBLE_COMPLETION_GRACE_MS = 90_000;

function resolveStatusObservedAtMs(updatedAt: string | undefined): number {
  const parsed = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return Date.now();
  }

  return Math.min(parsed, Date.now());
}

export class BridgeClientError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  public constructor(code: string, message: string, statusCode: number, details?: unknown) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export interface BridgeClient {
  getBridgeHealth(): Promise<BridgeHealthSummary>;
  listDriftIncidents(): Promise<BridgeDriftIncident[]>;
  openSession(input: OpenSessionRequest, options?: { timeoutMs?: number }): Promise<SessionSummary>;
  resumeSession(
    sessionId: string,
    input: ResumeSessionRequest,
  ): Promise<{ session: SessionSummary; health: BridgeHealthSummary }>;
  selectProject(
    input: SelectProjectRequest,
    options?: { timeoutMs?: number },
  ): Promise<SessionSummary>;
  startConversation(
    input: StartConversationRequest,
    options?: { timeoutMs?: number },
  ): Promise<ConversationSnapshot>;
  sendMessage(
    conversationId: string,
    input: MessageConversationRequest,
  ): Promise<ConversationSnapshot>;
  recoverConversation(
    conversationId: string,
    input: RecoverConversationRequest,
  ): Promise<{ snapshot: ConversationSnapshot; health: BridgeHealthSummary }>;
  getSnapshot(conversationId: string): Promise<ConversationSnapshot>;
  getConversationStatus?(conversationId: string): Promise<ConversationStatus>;
  waitForCompletion(
    conversationId: string,
    input: WaitConversationRequest,
  ): Promise<ConversationSnapshot>;
  exportMarkdown(
    conversationId: string,
    input: MarkdownExportRequest,
  ): Promise<{ artifactPath: string; manifestPath: string; markdown: string }>;
  extractStructuredReview(
    conversationId: string,
    input: StructuredReviewExtractRequest,
  ): Promise<{ artifactPath: string; manifestPath: string; payload: Record<string, unknown> }>;
}

export class HttpBridgeClient implements BridgeClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly fetchImplementation: BridgeFetch = fetch,
  ) {}

  public async getBridgeHealth(): Promise<BridgeHealthSummary> {
    return this.requestData('/api/health/bridge', {
      method: 'GET',
      responseSchema: BridgeHealthResponseSchema,
    });
  }

  public async listDriftIncidents(): Promise<BridgeDriftIncident[]> {
    const data = await this.requestData('/api/drift/incidents', {
      method: 'GET',
      responseSchema: DriftIncidentsResponseSchema,
    });
    return data.incidents;
  }

  public async openSession(
    input: OpenSessionRequest,
    options?: { timeoutMs?: number },
  ): Promise<SessionSummary> {
    return this.requestData('/api/sessions/open', {
      method: 'POST',
      body: input,
      responseSchema: OpenSessionResponseSchema,
      ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  public async resumeSession(
    sessionId: string,
    input: ResumeSessionRequest,
  ): Promise<{ session: SessionSummary; health: BridgeHealthSummary }> {
    return this.requestData(`/api/sessions/${sessionId}/resume`, {
      method: 'POST',
      body: input,
      responseSchema: ResumeSessionResponseSchema,
    });
  }

  public async selectProject(
    input: SelectProjectRequest,
    options?: { timeoutMs?: number },
  ): Promise<SessionSummary> {
    return this.requestData('/api/projects/select', {
      method: 'POST',
      body: input,
      responseSchema: SelectProjectResponseSchema,
      ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  public async startConversation(
    input: StartConversationRequest,
    options?: { timeoutMs?: number },
  ): Promise<ConversationSnapshot> {
    return this.requestData('/api/conversations/start', {
      method: 'POST',
      body: input,
      responseSchema: StartConversationResponseSchema,
      ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  public async sendMessage(
    conversationId: string,
    input: MessageConversationRequest,
  ): Promise<ConversationSnapshot> {
    return this.requestData(`/api/conversations/${conversationId}/message`, {
      method: 'POST',
      body: input,
      responseSchema: MessageConversationResponseSchema,
    });
  }

  public async recoverConversation(
    conversationId: string,
    input: RecoverConversationRequest,
  ): Promise<{ snapshot: ConversationSnapshot; health: BridgeHealthSummary }> {
    return this.requestData(`/api/conversations/${conversationId}/recover`, {
      method: 'POST',
      body: input,
      responseSchema: RecoverConversationResponseSchema,
    });
  }

  public async getSnapshot(conversationId: string): Promise<ConversationSnapshot> {
    return this.requestData(`/api/conversations/${conversationId}/snapshot`, {
      method: 'GET',
      responseSchema: GetSnapshotResponseSchema,
    });
  }

  public async getConversationStatus(conversationId: string): Promise<ConversationStatus> {
    return this.requestData(`/api/conversations/${conversationId}/status`, {
      method: 'GET',
      responseSchema: GetConversationStatusResponseSchema,
    });
  }

  public async waitForCompletion(
    conversationId: string,
    input: WaitConversationRequest,
  ): Promise<ConversationSnapshot> {
    const deadline = Date.now() + (input.maxWaitMs ?? 120_000);
    const interval = input.pollIntervalMs ?? 1_000;
    const stablePolls = input.stablePolls ?? 2;

    let lastCompletionSignature = '';
    let stableReads = 0;
    let replyStarted = false;
    let lastRunningSignature = '';
    let stalledRunningReads = 0;
    let lastStableAssistantRunningSignature = '';
    let stalledStableAssistantRunningReads = 0;
    let stableAssistantRunningObservedAtMs = 0;
    let lastRetryVisibleCompletionSignature = '';
    let stalledRetryVisibleCompletionReads = 0;
    let retryVisibleCompletionObservedAtMs = 0;

    while (Date.now() <= deadline) {
      const status = await this.getConversationStatus(conversationId);
      if (status.status === 'failed') {
        throw new BridgeClientError(
          'CONVERSATION_UNAVAILABLE',
          'Conversation generation failed and requires retry.',
          503,
          {
            conversationId,
            pageUrl: status.pageUrl,
            lastAssistantMessage: status.lastAssistantMessage,
          },
        );
      }
      replyStarted ||= hasReplyStarted(status);

      if (replyStarted && status.status === 'running' && status.retryVisible) {
        const runningSignature = JSON.stringify({
          status: status.status,
          assistantMessageCount: status.assistantMessageCount,
          lastAssistantMessage: status.lastAssistantMessage ?? '',
          lastMessageRole: status.lastMessageRole,
          retryVisible: true,
        });

        if (runningSignature === lastRunningSignature) {
          stalledRunningReads += 1;
        } else {
          lastRunningSignature = runningSignature;
          stalledRunningReads = 1;
        }

        if (stalledRunningReads >= RETRY_VISIBLE_STALL_POLLS) {
          throw new BridgeClientError(
            'CONVERSATION_UNAVAILABLE',
            'Conversation appears stalled while ChatGPT is offering a retry action.',
            503,
            {
              conversationId,
              pageUrl: status.pageUrl,
              lastAssistantMessage: status.lastAssistantMessage,
              retryVisible: true,
            },
          );
        }
      } else {
        lastRunningSignature = '';
        stalledRunningReads = 0;
      }

      if (replyStarted && status.status === 'running' && !status.retryVisible && hasAssistantReply(status)) {
        const stableAssistantRunningSignature = JSON.stringify({
          status: status.status,
          assistantMessageCount: status.assistantMessageCount,
          lastAssistantMessage: status.lastAssistantMessage ?? '',
          lastMessageRole: status.lastMessageRole,
          retryVisible: false,
        });

        if (stableAssistantRunningSignature === lastStableAssistantRunningSignature) {
          stalledStableAssistantRunningReads += 1;
        } else {
          lastStableAssistantRunningSignature = stableAssistantRunningSignature;
          stalledStableAssistantRunningReads = 1;
          stableAssistantRunningObservedAtMs = resolveStatusObservedAtMs(status.updatedAt);
        }

        if (
          stalledStableAssistantRunningReads >= RETRY_VISIBLE_STALL_POLLS &&
          Date.now() - stableAssistantRunningObservedAtMs >= RETRY_VISIBLE_COMPLETION_GRACE_MS
        ) {
          return this.getSnapshot(conversationId);
        }
      } else {
        lastStableAssistantRunningSignature = '';
        stalledStableAssistantRunningReads = 0;
        stableAssistantRunningObservedAtMs = 0;
      }

      if (status.status === 'completed' && status.retryVisible && !hasAssistantReply(status)) {
        const retryVisibleCompletionSignature = JSON.stringify({
          status: status.status,
          assistantMessageCount: status.assistantMessageCount,
          lastAssistantMessage: status.lastAssistantMessage ?? '',
          lastMessageRole: status.lastMessageRole,
          retryVisible: true,
        });

        if (retryVisibleCompletionSignature === lastRetryVisibleCompletionSignature) {
          stalledRetryVisibleCompletionReads += 1;
        } else {
          lastRetryVisibleCompletionSignature = retryVisibleCompletionSignature;
          stalledRetryVisibleCompletionReads = 1;
          retryVisibleCompletionObservedAtMs = resolveStatusObservedAtMs(status.updatedAt);
        }

        if (
          stalledRetryVisibleCompletionReads >= RETRY_VISIBLE_STALL_POLLS &&
          Date.now() - retryVisibleCompletionObservedAtMs >= RETRY_VISIBLE_COMPLETION_GRACE_MS
        ) {
          throw new BridgeClientError(
            'CONVERSATION_UNAVAILABLE',
            'Conversation completed without an assistant reply while ChatGPT is offering a retry action.',
            503,
            {
              conversationId,
              pageUrl: status.pageUrl,
              lastAssistantMessage: status.lastAssistantMessage,
              retryVisible: true,
            },
          );
        }
      } else {
        lastRetryVisibleCompletionSignature = '';
        stalledRetryVisibleCompletionReads = 0;
        retryVisibleCompletionObservedAtMs = 0;
      }

      if (replyStarted && status.status === 'completed') {
        const completionSignature = JSON.stringify({
          status: status.status,
          assistantMessageCount: status.assistantMessageCount,
          lastAssistantMessage: status.lastAssistantMessage ?? '',
          lastMessageRole: status.lastMessageRole,
        });

        if (completionSignature === lastCompletionSignature) {
          stableReads += 1;
        } else {
          lastCompletionSignature = completionSignature;
          stableReads = 1;
        }

        if (stableReads >= stablePolls) {
          return this.getSnapshot(conversationId);
        }
      } else {
        lastCompletionSignature = '';
        stableReads = 0;
      }

      await sleep(interval);
    }

    return this.requestData(`/api/conversations/${conversationId}/wait`, {
      method: 'POST',
      body: input,
      responseSchema: WaitConversationResponseSchema,
      timeoutMs: (input.maxWaitMs ?? 120_000) + 30_000,
    });
  }

  public async exportMarkdown(
    conversationId: string,
    input: MarkdownExportRequest,
  ): Promise<{ artifactPath: string; manifestPath: string; markdown: string }> {
    return this.requestData(`/api/conversations/${conversationId}/export/markdown`, {
      method: 'POST',
      body: input,
      responseSchema: MarkdownExportResponseSchema,
    });
  }

  public async extractStructuredReview(
    conversationId: string,
    input: StructuredReviewExtractRequest,
  ): Promise<{ artifactPath: string; manifestPath: string; payload: Record<string, unknown> }> {
    return this.requestData(`/api/conversations/${conversationId}/extract/structured-review`, {
      method: 'POST',
      body: input,
      responseSchema: StructuredReviewExtractResponseSchema,
    });
  }

  private async request<T>(
    pathname: string,
    options: {
      method: 'GET' | 'POST';
      body?: unknown;
      responseSchema: ZodTypeAny;
      timeoutMs?: number;
    },
  ): Promise<T> {
    const response =
      this.fetchImplementation === fetch
        ? await this.requestViaNode(pathname, options)
        : await this.requestViaFetch(pathname, options);

    if (!response.ok) {
      const failure = ApiFailureSchema.safeParse(response.payload);
      if (failure.success) {
        throw new BridgeClientError(
          failure.data.error.code,
          failure.data.error.message,
          response.status,
          failure.data.error.details,
        );
      }

      throw new BridgeClientError(
        'BRIDGE_HTTP_ERROR',
        'Bridge request failed with an unparseable error response',
        response.status,
        response.payload,
      );
    }

    const parsed = options.responseSchema.safeParse(response.payload);
    if (!parsed.success) {
      throw new BridgeClientError(
        'BRIDGE_VALIDATION_ERROR',
        'Bridge response did not match the expected schema',
        response.status,
        parsed.error.flatten(),
      );
    }

    return (parsed.data as { data: T }).data;
  }

  private async requestViaFetch(
    pathname: string,
    options: {
      method: 'GET' | 'POST';
      body?: unknown;
      responseSchema: ZodTypeAny;
      timeoutMs?: number;
    },
  ): Promise<BridgeHttpResponse> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${pathname}`, {
        method: options.method,
        headers: {
          'content-type': 'application/json',
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch (error) {
      throw new BridgeClientError(
        'BRIDGE_FETCH_FAILED',
        error instanceof Error ? error.message : 'Bridge fetch failed',
        0,
        error,
      );
    }

    return {
      ok: response.ok,
      status: response.status,
      payload: (await response.json()) as unknown,
    };
  }

  private async requestViaNode(
    pathname: string,
    options: {
      method: 'GET' | 'POST';
      body?: unknown;
      responseSchema: ZodTypeAny;
      timeoutMs?: number;
    },
  ): Promise<BridgeHttpResponse> {
    const target = new URL(pathname, this.baseUrl);
    const body = options.body ? JSON.stringify(options.body) : undefined;
    const timeoutMs = resolveTimeoutMs(options.body, options.timeoutMs);

    return new Promise<BridgeHttpResponse>((resolve, reject) => {
      const transport = target.protocol === 'https:' ? https : http;
      const request = transport.request(
        target,
        {
          method: options.method,
          headers: {
            'content-type': 'application/json',
            ...(body ? { 'content-length': Buffer.byteLength(body).toString() } : {}),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer | string) => {
            const normalizedChunk = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
            chunks.push(normalizedChunk);
          });
          response.on('end', () => {
            const rawPayload = Buffer.concat(chunks).toString('utf8');
            try {
              const payload = rawPayload.length > 0 ? parseJsonPayload(rawPayload) : null;
              resolve({
                ok: (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300,
                status: response.statusCode ?? 500,
                payload,
              });
            } catch (error) {
              reject(
                new BridgeClientError(
                  'BRIDGE_HTTP_ERROR',
                  'Bridge returned a non-JSON response',
                  response.statusCode ?? 500,
                  {
                    error: error instanceof Error ? error.message : String(error),
                    rawPayload,
                  },
                ),
              );
            }
          });
        },
      );

      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error(`Bridge request timed out after ${timeoutMs}ms`));
      });
      request.on('error', (error) => {
        reject(
          new BridgeClientError(
            'BRIDGE_FETCH_FAILED',
            error instanceof Error ? error.message : 'Bridge fetch failed',
            0,
            error,
          ),
        );
      });

      if (body) {
        request.write(body);
      }

      request.end();
    });
  }

  private async requestData<ResponseSchema extends ZodTypeAny>(
    pathname: string,
    options: {
      method: 'GET' | 'POST';
      body?: unknown;
      responseSchema: ResponseSchema;
      timeoutMs?: number;
    },
  ): Promise<z.output<ResponseSchema>['data']> {
    return this.request<z.output<ResponseSchema>['data']>(pathname, options);
  }
}

function resolveTimeoutMs(body: unknown, explicitTimeoutMs?: number): number {
  if (
    typeof explicitTimeoutMs === 'number' &&
    Number.isFinite(explicitTimeoutMs) &&
    explicitTimeoutMs > 0
  ) {
    return explicitTimeoutMs;
  }

  if (body && typeof body === 'object' && 'maxWaitMs' in body) {
    const maxWaitMs = (body as { maxWaitMs?: unknown }).maxWaitMs;
    if (typeof maxWaitMs === 'number' && Number.isFinite(maxWaitMs) && maxWaitMs > 0) {
      return maxWaitMs + 30_000;
    }
  }

  return 60_000;
}

function parseJsonPayload(rawPayload: string): unknown {
  return JSON.parse(rawPayload) as unknown;
}
