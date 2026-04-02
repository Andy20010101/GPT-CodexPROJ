import { randomUUID } from 'node:crypto';

import { ReleaseAcceptanceSchema, type ReleaseAcceptance, type GateResult } from '../contracts';
import { assertRunStageTransition } from '../domain/stage';
import type { RunRecord } from '../domain/run';
import { FileEvidenceRepository } from '../storage/file-evidence-repository';
import { FileReleaseRepository } from '../storage/file-release-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileTaskRepository } from '../storage/file-task-repository';
import { OrchestratorError } from '../utils/error';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { GateEvaluator } from './gate-evaluator';

export class RunAcceptanceService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly taskRepository: FileTaskRepository,
    private readonly evidenceRepository: FileEvidenceRepository,
    private readonly releaseRepository: FileReleaseRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly gateEvaluator: GateEvaluator,
  ) {}

  public async acceptRun(input: { runId: string; acceptedBy: string }): Promise<{
    acceptance: ReleaseAcceptance;
    gateResult: GateResult;
    run: RunRecord;
  }> {
    const run = await this.runRepository.getRun(input.runId);
    if (run.stage !== 'release_review') {
      throw new OrchestratorError(
        'RUN_ACCEPTANCE_BLOCKED',
        'Run must be in release_review before final acceptance.',
        {
          runId: input.runId,
          stage: run.stage,
        },
      );
    }

    const latestReleaseGate = await this.evidenceRepository.findLatestGateResult(
      input.runId,
      'release_gate',
    );
    const releaseGatePassed =
      latestReleaseGate?.passed === true &&
      latestReleaseGate.metadata.source === 'release-gate-service';
    if (!releaseGatePassed) {
      throw new OrchestratorError(
        'RUN_ACCEPTANCE_BLOCKED',
        'Run acceptance requires a passing release gate from release-gate-service.',
        {
          runId: input.runId,
          latestReleaseGate,
        },
      );
    }

    const tasks = await this.taskRepository.listTasks(input.runId);
    if (tasks.some((task) => task.status !== 'accepted')) {
      throw new OrchestratorError(
        'RUN_ACCEPTANCE_BLOCKED',
        'All tasks must be accepted before the run can be accepted.',
        {
          runId: input.runId,
        },
      );
    }

    const evidence = await this.evidenceRepository.listEvidenceForRun(input.runId);
    const gateResult = this.gateEvaluator.evaluate({
      run,
      gateType: 'acceptance_gate',
      evaluator: input.acceptedBy,
      evidence,
      requirementFreeze: await this.runRepository.getRequirementFreeze(input.runId),
      architectureFreeze: await this.runRepository.getArchitectureFreeze(input.runId),
      tasks,
      metadata: {
        source: 'run-acceptance-service',
      },
    });
    if (!gateResult.passed) {
      throw new OrchestratorError('RUN_ACCEPTANCE_BLOCKED', 'Run acceptance gate did not pass.', {
        runId: input.runId,
        reasons: gateResult.reasons,
      });
    }

    const gateArtifactPath = await this.evidenceRepository.appendGateResult(gateResult);
    await this.evidenceLedgerService.appendEvidence({
      runId: input.runId,
      stage: run.stage,
      kind: 'gate_result',
      timestamp: gateResult.timestamp,
      producer: input.acceptedBy,
      artifactPaths: [gateArtifactPath],
      summary: 'acceptance_gate passed for run acceptance',
      metadata: {
        gateId: gateResult.gateId,
      },
    });

    assertRunStageTransition(run.stage, 'accepted');
    const updatedRun = await this.runRepository.saveRun({
      ...run,
      stage: 'accepted',
      updatedAt: gateResult.timestamp,
    });

    const latestReleaseResult = await this.releaseRepository.getLatestResult(input.runId);
    if (!latestReleaseResult) {
      throw new OrchestratorError(
        'RUN_ACCEPTANCE_BLOCKED',
        'Run acceptance requires a persisted release review result.',
        {
          runId: input.runId,
        },
      );
    }

    const acceptance = ReleaseAcceptanceSchema.parse({
      acceptanceId: randomUUID(),
      runId: input.runId,
      releaseReviewId: latestReleaseResult.releaseReviewId,
      gateId: gateResult.gateId,
      acceptedAt: gateResult.timestamp,
      acceptedBy: input.acceptedBy,
      summary: `Run ${input.runId} accepted after release review ${latestReleaseResult.releaseReviewId}.`,
    });
    const acceptancePath = await this.releaseRepository.saveAcceptance(acceptance);
    await this.evidenceLedgerService.appendEvidence({
      runId: input.runId,
      stage: 'accepted',
      kind: 'run_acceptance',
      timestamp: acceptance.acceptedAt,
      producer: input.acceptedBy,
      artifactPaths: [acceptancePath],
      summary: acceptance.summary,
      metadata: {
        acceptanceId: acceptance.acceptanceId,
        releaseReviewId: acceptance.releaseReviewId,
      },
    });

    return {
      acceptance,
      gateResult,
      run: updatedRun,
    };
  }
}
