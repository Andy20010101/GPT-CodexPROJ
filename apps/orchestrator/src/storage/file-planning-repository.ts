import path from 'node:path';

import {
  PlanningConversationLinkSchema,
  PlanningFinalizeSweepSummarySchema,
  PlanningMaterializedResultSchema,
  PlanningModelRoutingDecisionSchema,
  PlanningPhaseSchema,
  PlanningRequestSchema,
  PlanningRuntimeStateSchema,
  type PlanningConversationLink,
  type PlanningFinalizeSweepSummary,
  type PlanningMaterializedResult,
  type PlanningModelRoutingDecision,
  type PlanningPhase,
  type PlanningRequest,
  type PlanningRuntimeState,
} from '../contracts';
import { readJsonFile, writeJsonFile } from '../utils/file-store';
import {
  getPlanningConversationLinkFile,
  getPlanningFinalizeRuntimeStateFile,
  getPlanningMaterializedResultFile,
  getPlanningModelRoutingDecisionFile,
  getPlanningRecoverySummaryFile,
  getPlanningRequestFile,
  getPlanningRequestRuntimeStateFile,
} from '../utils/run-paths';

export class FilePlanningRepository {
  public constructor(private readonly artifactDir: string) {}

  public getArtifactDir(): string {
    return this.artifactDir;
  }

  public async saveRequest(request: PlanningRequest): Promise<string> {
    const parsed = PlanningRequestSchema.parse(request);
    const outputPath = getPlanningRequestFile(this.artifactDir, parsed.runId, parsed.phase);
    await writeJsonFile(outputPath, parsed);
    return outputPath;
  }

  public async getRequest(runId: string, phase: PlanningPhase): Promise<PlanningRequest | null> {
    const parsedPhase = PlanningPhaseSchema.parse(phase);
    const outputPath = getPlanningRequestFile(this.artifactDir, runId, parsedPhase);
    const raw = await readJsonFile<PlanningRequest>(outputPath);
    return raw ? PlanningRequestSchema.parse(raw) : null;
  }

  public async saveConversationLink(link: PlanningConversationLink): Promise<string> {
    const parsed = PlanningConversationLinkSchema.parse(link);
    const outputPath = getPlanningConversationLinkFile(this.artifactDir, parsed.runId, parsed.phase);
    await writeJsonFile(outputPath, parsed);
    return outputPath;
  }

  public async getConversationLink(
    runId: string,
    phase: PlanningPhase,
  ): Promise<PlanningConversationLink | null> {
    const parsedPhase = PlanningPhaseSchema.parse(phase);
    const outputPath = getPlanningConversationLinkFile(this.artifactDir, runId, parsedPhase);
    const raw = await readJsonFile<PlanningConversationLink>(outputPath);
    return raw ? PlanningConversationLinkSchema.parse(raw) : null;
  }

  public async saveRequestRuntimeState(state: PlanningRuntimeState): Promise<string> {
    const parsed = PlanningRuntimeStateSchema.parse(state);
    const outputPath = getPlanningRequestRuntimeStateFile(
      this.artifactDir,
      parsed.runId,
      parsed.phase,
    );
    await writeJsonFile(outputPath, parsed);
    return outputPath;
  }

  public async getRequestRuntimeState(
    runId: string,
    phase: PlanningPhase,
  ): Promise<PlanningRuntimeState | null> {
    const parsedPhase = PlanningPhaseSchema.parse(phase);
    const outputPath = getPlanningRequestRuntimeStateFile(this.artifactDir, runId, parsedPhase);
    const raw = await readJsonFile<PlanningRuntimeState>(outputPath);
    return raw ? PlanningRuntimeStateSchema.parse(raw) : null;
  }

  public async saveFinalizeRuntimeState(state: PlanningRuntimeState): Promise<string> {
    const parsed = PlanningRuntimeStateSchema.parse(state);
    const outputPath = getPlanningFinalizeRuntimeStateFile(
      this.artifactDir,
      parsed.runId,
      parsed.phase,
    );
    await writeJsonFile(outputPath, parsed);
    return outputPath;
  }

  public async getFinalizeRuntimeState(
    runId: string,
    phase: PlanningPhase,
  ): Promise<PlanningRuntimeState | null> {
    const parsedPhase = PlanningPhaseSchema.parse(phase);
    const outputPath = getPlanningFinalizeRuntimeStateFile(this.artifactDir, runId, parsedPhase);
    const raw = await readJsonFile<PlanningRuntimeState>(outputPath);
    return raw ? PlanningRuntimeStateSchema.parse(raw) : null;
  }

  public async saveMaterializedResult(result: PlanningMaterializedResult): Promise<string> {
    const parsed = PlanningMaterializedResultSchema.parse(result);
    const outputPath = getPlanningMaterializedResultFile(
      this.artifactDir,
      parsed.runId,
      parsed.phase,
    );
    await writeJsonFile(outputPath, parsed);
    return outputPath;
  }

  public async getMaterializedResult(
    runId: string,
    phase: PlanningPhase,
  ): Promise<PlanningMaterializedResult | null> {
    const parsedPhase = PlanningPhaseSchema.parse(phase);
    const outputPath = getPlanningMaterializedResultFile(this.artifactDir, runId, parsedPhase);
    const raw = await readJsonFile<PlanningMaterializedResult>(outputPath);
    return raw ? PlanningMaterializedResultSchema.parse(raw) : null;
  }

  public async saveModelRoutingDecision(decision: PlanningModelRoutingDecision): Promise<string> {
    const parsed = PlanningModelRoutingDecisionSchema.parse(decision);
    const outputPath = getPlanningModelRoutingDecisionFile(
      this.artifactDir,
      parsed.runId,
      parsed.phase,
    );
    await writeJsonFile(outputPath, parsed);
    return outputPath;
  }

  public async getModelRoutingDecision(
    runId: string,
    phase: PlanningPhase,
  ): Promise<PlanningModelRoutingDecision | null> {
    const parsedPhase = PlanningPhaseSchema.parse(phase);
    const outputPath = getPlanningModelRoutingDecisionFile(this.artifactDir, runId, parsedPhase);
    const raw = await readJsonFile<PlanningModelRoutingDecision>(outputPath);
    return raw ? PlanningModelRoutingDecisionSchema.parse(raw) : null;
  }

  public async saveRecoverySummary(summary: PlanningFinalizeSweepSummary): Promise<string> {
    const parsed = PlanningFinalizeSweepSummarySchema.parse(summary);
    const outputPath = getPlanningRecoverySummaryFile(this.artifactDir, parsed.entries[0]?.runId ?? '');
    if (parsed.entries.length === 0) {
      const runScopedOutput = path.join(this.artifactDir, 'runtime', 'planning-recovery-summary.json');
      await writeJsonFile(runScopedOutput, parsed);
      return runScopedOutput;
    }
    await writeJsonFile(outputPath, parsed);
    return outputPath;
  }

  public async getRecoverySummary(runId: string): Promise<PlanningFinalizeSweepSummary | null> {
    const outputPath = getPlanningRecoverySummaryFile(this.artifactDir, runId);
    const raw = await readJsonFile<PlanningFinalizeSweepSummary>(outputPath);
    return raw ? PlanningFinalizeSweepSummarySchema.parse(raw) : null;
  }
}
