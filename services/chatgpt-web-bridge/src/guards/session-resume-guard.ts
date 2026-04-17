import type { ConversationSnapshot } from '@gpt-codexproj/shared-contracts/chatgpt';

import { AppError } from '../types/error';
import type { ChatGPTAdapter, ConversationRecord, SessionRecord } from '../types/runtime';
import { BridgeHealthService } from '../services/bridge-health-service';

export class SessionResumeGuard {
  public constructor(
    private readonly adapter: ChatGPTAdapter,
    private readonly bridgeHealthService: BridgeHealthService,
  ) {}

  public async resumeSession(session: SessionRecord): Promise<{
    session: SessionRecord;
    health: {
      status: 'ready' | 'degraded';
    };
  }> {
    try {
      const reopened = await this.adapter.openSession({
        sessionId: session.sessionId,
        browserEndpoint: session.browserUrl,
        startupUrl: session.startupUrl,
      });
      const selected = session.projectName
        ? await this.adapter.selectProject({
            session: reopened,
            projectName: session.projectName,
            ...(session.model ? { model: session.model } : {}),
          })
        : reopened;
      await this.bridgeHealthService.recordHealth({
        status: 'ready',
        checkedAt: new Date().toISOString(),
        activeSessions: 1,
        activeConversations: 0,
        issues: [],
        metadata: {
          sessionId: session.sessionId,
          resumed: true,
        },
      });
      return {
        session: {
          ...selected,
          startupUrl: session.startupUrl,
        },
        health: {
          status: 'ready',
        },
      };
    } catch (error) {
      throw new AppError(
        'SESSION_RESUME_FAILED',
        error instanceof Error ? error.message : 'Bridge session resume failed',
        503,
        {
          sessionId: session.sessionId,
        },
      );
    }
  }

  public async recoverConversation(input: {
    session: SessionRecord;
    conversation: ConversationRecord;
  }): Promise<ConversationSnapshot> {
    try {
      return await this.adapter.getConversationSnapshot({
        session: input.session,
        conversationId: input.conversation.snapshot.conversationId,
      });
    } catch {
      try {
        if (input.session.projectName) {
          await this.adapter.selectProject({
            session: input.session,
            projectName: input.session.projectName,
            ...(input.session.model ? { model: input.session.model } : {}),
          });
        }
        return await this.adapter.getConversationSnapshot({
          session: input.session,
          conversationId: input.conversation.snapshot.conversationId,
        });
      } catch (error) {
        throw new AppError(
          'BRIDGE_RECOVERY_FAILED',
          error instanceof Error ? error.message : 'Conversation recovery failed',
          503,
          {
            conversationId: input.conversation.snapshot.conversationId,
          },
        );
      }
    }
  }
}
