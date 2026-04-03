import fs from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { createRunRecord } from '../../src/domain/run';
import { FileEvidenceRepository } from '../../src/storage/file-evidence-repository';
import { FilePlanningRepository } from '../../src/storage/file-planning-repository';
import { EvidenceLedgerService } from '../../src/services/evidence-ledger-service';
import { PlanningModelRoutingService } from '../../src/services/planning-model-routing-service';
import { PlanningService } from '../../src/services/planning-service';
import {
  buildArchitectureFreeze,
  buildRequirementFreeze,
  createArtifactDir,
  createBridgeClient,
  missingStructuredOutputError,
} from '../helpers/runtime-fixtures';

describe('PlanningService', () => {
  it.each([
    ['requirement_freeze', 'intake'],
    ['architecture_freeze', 'requirement_frozen'],
    ['task_graph_generation', 'architecture_frozen'],
  ] as const)(
    'persists conversation metadata immediately for %s requests',
    async (phase, stage) => {
      const artifactDir = await createArtifactDir(`planning-request-${phase}-`);
      const service = createService(artifactDir);
      const run = createRunRecord({
        title: 'Planning run',
        createdBy: 'tester',
        summary: 'Fresh planning prompt',
        stage,
      });
      const dispatch = await service.requestPhase({
        run,
        phase,
        prompt: 'Fresh planning prompt',
        sourcePrompt: 'Fresh planning prompt',
        requestedBy: 'tester',
        producer: 'tester',
        requirementFreeze:
          phase !== 'requirement_freeze' ? buildRequirementFreeze(run.runId) : undefined,
        architectureFreeze:
          phase === 'task_graph_generation' ? buildArchitectureFreeze(run.runId) : undefined,
      });

      expect(dispatch.requestRuntimeState.conversationId).toBeTruthy();
      await expect(fs.stat(dispatch.requestRuntimeStatePath)).resolves.toBeTruthy();
      await expect(
        fs.stat(
          artifactDir +
            `/runs/${run.runId}/${phase === 'requirement_freeze' ? 'requirement' : phase === 'architecture_freeze' ? 'architecture' : 'task-graph'}/conversation-link.json`,
        ),
      ).resolves.toBeTruthy();
    },
  );

  it('recovers finalization from the same conversation when wait fails once', async () => {
    const artifactDir = await createArtifactDir('planning-finalize-recover-');
    let waitCalls = 0;
    const bridgeClient = createBridgeClient({
      requirementExtractError: missingStructuredOutputError(),
    });
    const service = createService(artifactDir, {
      ...bridgeClient,
      async waitForCompletion(conversationId, input) {
        waitCalls += 1;
        if (waitCalls === 1) {
          throw new Error('temporary wait failure');
        }
        return bridgeClient.waitForCompletion(conversationId, input);
      },
      async extractStructuredReview(conversationId, input) {
        if (waitCalls === 2) {
          return {
            artifactPath: '/bridge/requirement.json',
            manifestPath: '/bridge/requirement-manifest.json',
            payload: {
              title: 'Recovered requirement freeze',
              summary: 'Recovered from same conversation.',
              objectives: ['Recover planning materialization.'],
              nonGoals: ['Do not open a new conversation.'],
              constraints: [],
              risks: [],
              acceptanceCriteria: [
                {
                  description: 'Conversation recovery reuses the same conversation.',
                  verificationMethod: 'review',
                  requiredEvidenceKinds: [],
                },
              ],
            },
          };
        }
        return bridgeClient.extractStructuredReview(conversationId, input);
      },
    });
    const run = createRunRecord({
      title: 'Planning run',
      createdBy: 'tester',
      summary: 'Fresh planning prompt',
      stage: 'intake',
    });
    const requested = await service.requestPhase({
      run,
      phase: 'requirement_freeze',
      prompt: 'Fresh planning prompt',
      sourcePrompt: 'Fresh planning prompt',
      requestedBy: 'tester',
      producer: 'tester',
    });

    const finalized = await service.finalizePhase({
      run,
      phase: 'requirement_freeze',
      producer: 'tester',
    });

    expect(finalized.status).toBe('completed');
    if (finalized.status === 'completed') {
      expect(finalized.requestRuntimeState.conversationId).toBe(
        requested.requestRuntimeState.conversationId,
      );
      expect(finalized.finalizeRuntimeState.metadata.recoveryOutcome).toBe(
        'PLANNING_RECOVERED_FROM_CONVERSATION',
      );
    }
  });
});

function createService(
  artifactDir: string,
  bridgeClient = createBridgeClient(),
): PlanningService {
  return new PlanningService(
    bridgeClient,
    new FilePlanningRepository(artifactDir),
    new EvidenceLedgerService(new FileEvidenceRepository(artifactDir)),
    new PlanningModelRoutingService({
      defaultModel: 'pro',
      maxWaitMs: 3_000_000,
      pollIntervalMs: 5000,
      stablePolls: 3,
    }),
    undefined,
    {
      browserUrl: 'https://chatgpt.com/',
      projectName: 'Planning Proof',
    },
  );
}
