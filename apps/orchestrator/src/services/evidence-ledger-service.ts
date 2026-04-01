import { randomUUID } from 'node:crypto';

import { EvidenceManifestSchema, type EvidenceKind, type EvidenceManifest } from '../contracts';
import { FileEvidenceRepository } from '../storage/file-evidence-repository';

export class EvidenceLedgerService {
  public constructor(private readonly evidenceRepository: FileEvidenceRepository) {}

  public async appendEvidence(
    input: Omit<EvidenceManifest, 'evidenceId'> & { evidenceId?: string | undefined },
  ): Promise<EvidenceManifest> {
    const evidence = EvidenceManifestSchema.parse({
      ...input,
      evidenceId: input.evidenceId ?? randomUUID(),
    });
    await this.evidenceRepository.appendEvidence(evidence);
    return evidence;
  }

  public async listEvidenceForTask(runId: string, taskId: string): Promise<EvidenceManifest[]> {
    return this.evidenceRepository.listEvidenceForTask(runId, taskId);
  }

  public async listEvidenceForRun(runId: string): Promise<EvidenceManifest[]> {
    return this.evidenceRepository.listEvidenceForRun(runId);
  }

  public async summarizeRunEvidence(runId: string): Promise<{
    total: number;
    byKind: Partial<Record<EvidenceKind, number>>;
    taskCounts: Record<string, number>;
  }> {
    const evidence = await this.evidenceRepository.listEvidenceForRun(runId);
    const byKind = evidence.reduce<Partial<Record<EvidenceKind, number>>>((accumulator, entry) => {
      accumulator[entry.kind] = (accumulator[entry.kind] ?? 0) + 1;
      return accumulator;
    }, {});
    const taskCounts = evidence.reduce<Record<string, number>>((accumulator, entry) => {
      if (!entry.taskId) {
        return accumulator;
      }
      accumulator[entry.taskId] = (accumulator[entry.taskId] ?? 0) + 1;
      return accumulator;
    }, {});

    return {
      total: evidence.length,
      byKind,
      taskCounts,
    };
  }
}
