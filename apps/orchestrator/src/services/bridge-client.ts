import {
  ApiFailureSchema,
  MarkdownExportResponseSchema,
  MessageConversationResponseSchema,
  OpenSessionResponseSchema,
  SelectProjectResponseSchema,
  StartConversationResponseSchema,
  StructuredReviewExtractResponseSchema,
  WaitConversationResponseSchema,
  type MarkdownExportRequest,
  type MessageConversationRequest,
  type OpenSessionRequest,
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
  openSession(input: OpenSessionRequest): Promise<SessionSummary>;
  selectProject(input: SelectProjectRequest): Promise<SessionSummary>;
  startConversation(input: StartConversationRequest): Promise<ConversationSnapshot>;
  sendMessage(
    conversationId: string,
    input: MessageConversationRequest,
  ): Promise<ConversationSnapshot>;
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

  public async openSession(input: OpenSessionRequest): Promise<SessionSummary> {
    return this.requestData('/api/sessions/open', {
      method: 'POST',
      body: input,
      responseSchema: OpenSessionResponseSchema,
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
    const response = await this.fetchImplementation(`${this.baseUrl}${pathname}`, {
      method: options.method,
      headers: {
        'content-type': 'application/json',
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });

    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      const failure = ApiFailureSchema.safeParse(payload);
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
        payload,
      );
    }

    const parsed = options.responseSchema.safeParse(payload);
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
