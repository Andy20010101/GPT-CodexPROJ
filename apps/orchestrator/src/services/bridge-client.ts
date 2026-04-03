import http from 'node:http';
import https from 'node:https';
import {
  ApiFailureSchema,
  BridgeHealthResponseSchema,
  DriftIncidentsResponseSchema,
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
  type MarkdownExportRequest,
  type MessageConversationRequest,
  type OpenSessionRequest,
  type RecoverConversationRequest,
  type ResumeSessionRequest,
  type SelectProjectRequest,
  type StartConversationRequest,
  type StructuredReviewExtractRequest,
  type WaitConversationRequest,
} from '@review-then-codex/shared-contracts/chatgpt';
import type {
  ConversationSnapshot,
  SessionSummary,
} from '@review-then-codex/shared-contracts/chatgpt';
import { type ZodTypeAny, z } from 'zod';

type BridgeFetch = typeof fetch;
type BridgeHttpResponse = {
  ok: boolean;
  status: number;
  payload: unknown;
};

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
  openSession(input: OpenSessionRequest): Promise<SessionSummary>;
  resumeSession(
    sessionId: string,
    input: ResumeSessionRequest,
  ): Promise<{ session: SessionSummary; health: BridgeHealthSummary }>;
  selectProject(input: SelectProjectRequest): Promise<SessionSummary>;
  startConversation(input: StartConversationRequest): Promise<ConversationSnapshot>;
  sendMessage(
    conversationId: string,
    input: MessageConversationRequest,
  ): Promise<ConversationSnapshot>;
  recoverConversation(
    conversationId: string,
    input: RecoverConversationRequest,
  ): Promise<{ snapshot: ConversationSnapshot; health: BridgeHealthSummary }>;
  getSnapshot(conversationId: string): Promise<ConversationSnapshot>;
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

  public async openSession(input: OpenSessionRequest): Promise<SessionSummary> {
    return this.requestData('/api/sessions/open', {
      method: 'POST',
      body: input,
      responseSchema: OpenSessionResponseSchema,
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

  public async selectProject(input: SelectProjectRequest): Promise<SessionSummary> {
    return this.requestData('/api/projects/select', {
      method: 'POST',
      body: input,
      responseSchema: SelectProjectResponseSchema,
    });
  }

  public async startConversation(input: StartConversationRequest): Promise<ConversationSnapshot> {
    return this.requestData('/api/conversations/start', {
      method: 'POST',
      body: input,
      responseSchema: StartConversationResponseSchema,
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

  public async getConversationStatus(conversationId: string): Promise<ConversationSnapshot> {
    return this.requestData(`/api/conversations/${conversationId}/status`, {
      method: 'GET',
      responseSchema: GetSnapshotResponseSchema,
    });
  }

  public async waitForCompletion(
    conversationId: string,
    input: WaitConversationRequest,
  ): Promise<ConversationSnapshot> {
    return this.requestData(`/api/conversations/${conversationId}/wait`, {
      method: 'POST',
      body: input,
      responseSchema: WaitConversationResponseSchema,
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
    },
  ): Promise<BridgeHttpResponse> {
    const target = new URL(pathname, this.baseUrl);
    const body = options.body ? JSON.stringify(options.body) : undefined;
    const timeoutMs = resolveTimeoutMs(options.body);

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
          response.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on('end', () => {
            const rawPayload = Buffer.concat(chunks).toString('utf8');
            try {
              const payload = rawPayload.length > 0 ? JSON.parse(rawPayload) : null;
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
    },
  ): Promise<z.output<ResponseSchema>['data']> {
    return this.request<z.output<ResponseSchema>['data']>(pathname, options);
  }
}

function resolveTimeoutMs(body: unknown): number {
  if (body && typeof body === 'object' && 'maxWaitMs' in body) {
    const maxWaitMs = (body as { maxWaitMs?: unknown }).maxWaitMs;
    if (typeof maxWaitMs === 'number' && Number.isFinite(maxWaitMs) && maxWaitMs > 0) {
      return maxWaitMs + 30_000;
    }
  }

  return 60_000;
}
