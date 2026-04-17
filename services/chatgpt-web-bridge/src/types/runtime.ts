import type {
  ConversationStatus,
  ConversationSnapshot,
  SessionSummary,
} from '@gpt-codexproj/shared-contracts/chatgpt';

export type AdapterSessionOpenInput = {
  readonly sessionId: string;
  readonly browserEndpoint: string;
  readonly startupUrl?: string | undefined;
};

export type AdapterSelectProjectInput = {
  readonly session: SessionSummary;
  readonly projectName: string;
  readonly model?: string | undefined;
};

export type AdapterStartConversationInput = {
  readonly session: SessionSummary;
  readonly conversationId: string;
  readonly projectName: string;
  readonly model?: string | undefined;
  readonly prompt: string;
  readonly inputFiles: readonly string[];
};

export type AdapterMessageInput = {
  readonly session: SessionSummary;
  readonly conversationId: string;
  readonly message: string;
  readonly inputFiles: readonly string[];
};

export type AdapterWaitInput = {
  readonly session: SessionSummary;
  readonly conversationId: string;
  readonly maxWaitMs?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
  readonly stablePolls?: number | undefined;
};

export type AdapterSnapshotInput = {
  readonly session: SessionSummary;
  readonly conversationId: string;
};

export type AdapterConversationStatusInput = AdapterSnapshotInput;

export type SessionRecord = SessionSummary & {
  readonly startupUrl?: string | undefined;
};

export type ConversationRecord = {
  readonly snapshot: ConversationSnapshot;
  readonly inputFiles: readonly string[];
};

export interface ChatGPTAdapter {
  openSession(input: AdapterSessionOpenInput): Promise<SessionSummary>;
  selectProject(input: AdapterSelectProjectInput): Promise<SessionSummary>;
  startConversation(input: AdapterStartConversationInput): Promise<ConversationSnapshot>;
  sendMessage(input: AdapterMessageInput): Promise<ConversationSnapshot>;
  waitForConversation(input: AdapterWaitInput): Promise<ConversationSnapshot>;
  getConversationStatus(input: AdapterConversationStatusInput): Promise<ConversationStatus>;
  getConversationSnapshot(input: AdapterSnapshotInput): Promise<ConversationSnapshot>;
}
