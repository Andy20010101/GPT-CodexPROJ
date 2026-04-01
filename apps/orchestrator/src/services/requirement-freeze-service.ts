import { RequirementFreezeSchema, type RequirementFreeze } from '../contracts';
import { assertRunStageTransition } from '../domain/stage';
import type { RunRecord } from '../domain/run';
import { FileRunRepository } from '../storage/file-run-repository';
import { EvidenceLedgerService } from './evidence-ledger-service';

export class RequirementFreezeService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public async freeze(runId: string, freeze: RequirementFreeze): Promise<RunRecord> {
    const parsedFreeze = RequirementFreezeSchema.parse(freeze);
    const run = await this.runRepository.getRun(runId);
    assertRunStageTransition(run.stage, 'requirement_frozen');

    const requirementFreezePath = await this.runRepository.saveRequirementFreeze(parsedFreeze);
    await this.evidenceLedgerService.appendEvidence({
      runId,
      stage: 'requirement_frozen',
      kind: 'requirement_freeze',
      timestamp: parsedFreeze.frozenAt,
      producer: parsedFreeze.frozenBy,
      artifactPaths: [requirementFreezePath],
      summary: parsedFreeze.summary,
      metadata: {
        objectives: parsedFreeze.objectives.length,
        acceptanceCriteria: parsedFreeze.acceptanceCriteria.length,
      },
    });

    const updatedRun: RunRecord = {
      ...run,
      stage: 'requirement_frozen',
      updatedAt: parsedFreeze.frozenAt,
      requirementFreezePath,
    };
    await this.runRepository.saveRun(updatedRun);
    return updatedRun;
  }
}
