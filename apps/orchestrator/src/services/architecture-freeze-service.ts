import { ArchitectureFreezeSchema, type ArchitectureFreeze } from '../contracts';
import { assertRunStageTransition } from '../domain/stage';
import type { RunRecord } from '../domain/run';
import { OrchestratorError } from '../utils/error';
import { FileRunRepository } from '../storage/file-run-repository';
import { EvidenceLedgerService } from './evidence-ledger-service';

export class ArchitectureFreezeService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public async freeze(runId: string, freeze: ArchitectureFreeze): Promise<RunRecord> {
    const parsedFreeze = ArchitectureFreezeSchema.parse(freeze);
    const run = await this.runRepository.getRun(runId);
    const requirementFreeze = await this.runRepository.getRequirementFreeze(runId);
    if (!requirementFreeze) {
      throw new OrchestratorError(
        'REQUIREMENT_FREEZE_REQUIRED',
        'Requirement freeze must exist before architecture freeze',
        { runId },
      );
    }

    assertRunStageTransition(run.stage, 'architecture_frozen');
    const architectureFreezePath = await this.runRepository.saveArchitectureFreeze(parsedFreeze);
    await this.evidenceLedgerService.appendEvidence({
      runId,
      stage: 'architecture_frozen',
      kind: 'architecture_freeze',
      timestamp: parsedFreeze.frozenAt,
      producer: parsedFreeze.frozenBy,
      artifactPaths: [architectureFreezePath],
      summary: parsedFreeze.summary,
      metadata: {
        modules: parsedFreeze.moduleDefinitions.length,
        dependencyRules: parsedFreeze.dependencyRules.length,
      },
    });

    const updatedRun: RunRecord = {
      ...run,
      stage: 'architecture_frozen',
      updatedAt: parsedFreeze.frozenAt,
      architectureFreezePath,
    };
    await this.runRepository.saveRun(updatedRun);
    return updatedRun;
  }
}
