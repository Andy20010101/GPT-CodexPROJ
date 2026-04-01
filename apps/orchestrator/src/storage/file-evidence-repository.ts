import path from 'node:path';

import {
  EvidenceManifestSchema,
  GateResultSchema,
  type EvidenceManifest,
  type GateResult,
  type GateType,
} from '../contracts';
import { readJsonFilesInDirectory, writeJsonFile } from '../utils/file-store';
import { getRunRoot } from '../utils/run-paths';

export class FileEvidenceRepository {
  public constructor(private readonly artifactDir: string) {}

  public async appendEvidence(evidence: EvidenceManifest): Promise<string> {
    const outputPath = path.join(
      getRunRoot(this.artifactDir, evidence.runId),
      'evidence',
      `${evidence.evidenceId}.json`,
    );
    await writeJsonFile(outputPath, EvidenceManifestSchema.parse(evidence));
    return outputPath;
  }

  public async listEvidenceForRun(runId: string): Promise<EvidenceManifest[]> {
    const directoryPath = path.join(getRunRoot(this.artifactDir, runId), 'evidence');
    const raw = await readJsonFilesInDirectory<EvidenceManifest>(directoryPath);
    return raw.map((value) => EvidenceManifestSchema.parse(value));
  }

  public async listEvidenceForTask(runId: string, taskId: string): Promise<EvidenceManifest[]> {
    const evidence = await this.listEvidenceForRun(runId);
    return evidence.filter((entry) => entry.taskId === taskId);
  }

  public async appendGateResult(result: GateResult): Promise<string> {
    const outputPath = path.join(
      getRunRoot(this.artifactDir, result.runId),
      'gate-results',
      `${result.gateId}.json`,
    );
    await writeJsonFile(outputPath, GateResultSchema.parse(result));
    return outputPath;
  }

  public async listGateResultsForRun(runId: string): Promise<GateResult[]> {
    const directoryPath = path.join(getRunRoot(this.artifactDir, runId), 'gate-results');
    const raw = await readJsonFilesInDirectory<GateResult>(directoryPath);
    return raw.map((value) => GateResultSchema.parse(value));
  }

  public async listGateResultsForTask(runId: string, taskId: string): Promise<GateResult[]> {
    const results = await this.listGateResultsForRun(runId);
    return results.filter((entry) => entry.taskId === taskId);
  }

  public async findLatestGateResult(
    runId: string,
    gateType: GateType,
    taskId?: string | undefined,
  ): Promise<GateResult | null> {
    const results = await this.listGateResultsForRun(runId);
    return (
      results
        .filter((entry) => entry.gateType === gateType && (taskId ? entry.taskId === taskId : true))
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
        .at(-1) ?? null
    );
  }
}
