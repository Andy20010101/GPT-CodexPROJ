import { readJsonFile, readJsonFilesInDirectory, writeJsonFile } from '../utils/file-store';
import {
  getRunIncidentFile,
  getRunIncidentsRoot,
  getRunValidationReportFile,
  getRunsRoot,
  getRuntimeResumeFile,
  getRuntimeResumeRoot,
  getRuntimeStabilityReportFile,
} from '../utils/run-paths';
import {
  RunnerResumeStateSchema,
  StabilityIncidentSchema,
  StabilityReportSchema,
  ValidationReportSchema,
  type RunnerResumeState,
  type StabilityIncident,
  type StabilityReport,
  type ValidationReport,
} from '../contracts';

export class FileStabilityRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveIncident(
    incident: StabilityIncident,
  ): Promise<{ runPath?: string; globalPath: string }> {
    const parsed = StabilityIncidentSchema.parse(incident);
    const globalPath = getRunIncidentFile(
      this.artifactDir,
      parsed.runId ?? 'global',
      parsed.incidentId,
    );
    if (parsed.runId) {
      const runPath = getRunIncidentFile(this.artifactDir, parsed.runId, parsed.incidentId);
      await writeJsonFile(runPath, parsed);
      return { globalPath: runPath, runPath };
    }
    await writeJsonFile(globalPath, parsed);
    return { globalPath };
  }

  public async listIncidents(runId?: string | undefined): Promise<StabilityIncident[]> {
    if (runId) {
      const raw = await readJsonFilesInDirectory<StabilityIncident>(
        getRunIncidentsRoot(this.artifactDir, runId),
      );
      return raw.map((entry) => StabilityIncidentSchema.parse(entry));
    }

    const fs = await import('node:fs/promises');
    try {
      const entries = await fs.readdir(getRunsRoot(this.artifactDir), { withFileTypes: true });
      const incidents: StabilityIncident[] = [];
      for (const entry of entries.filter((item) => item.isDirectory())) {
        incidents.push(...(await this.listIncidents(entry.name)));
      }
      return incidents;
    } catch (error) {
      const castError = error as NodeJS.ErrnoException;
      if (castError.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  public async getIncident(
    incidentId: string,
    runId?: string | undefined,
  ): Promise<StabilityIncident | null> {
    if (runId) {
      const raw = await readJsonFile<StabilityIncident>(
        getRunIncidentFile(this.artifactDir, runId, incidentId),
      );
      return raw ? StabilityIncidentSchema.parse(raw) : null;
    }

    const incidents = await this.listIncidents();
    return incidents.find((entry) => entry.incidentId === incidentId) ?? null;
  }

  public async saveStabilityReport(report: StabilityReport): Promise<string> {
    const parsed = StabilityReportSchema.parse(report);
    const outputPath = getRuntimeStabilityReportFile(this.artifactDir);
    await writeJsonFile(outputPath, parsed);
    return outputPath;
  }

  public async getStabilityReport(): Promise<StabilityReport | null> {
    const raw = await readJsonFile<StabilityReport>(
      getRuntimeStabilityReportFile(this.artifactDir),
    );
    return raw ? StabilityReportSchema.parse(raw) : null;
  }

  public async saveRunnerResumeState(state: RunnerResumeState): Promise<string> {
    const parsed = RunnerResumeStateSchema.parse(state);
    const outputPath = getRuntimeResumeFile(this.artifactDir, parsed.resumeStateId);
    await writeJsonFile(outputPath, parsed);
    return outputPath;
  }

  public async listRunnerResumeStates(): Promise<RunnerResumeState[]> {
    const raw = await readJsonFilesInDirectory<RunnerResumeState>(
      getRuntimeResumeRoot(this.artifactDir),
    );
    return raw.map((entry) => RunnerResumeStateSchema.parse(entry));
  }

  public async findLatestResumeState(jobId: string): Promise<RunnerResumeState | null> {
    return (
      (await this.listRunnerResumeStates())
        .filter((entry) => entry.jobId === jobId)
        .sort((left, right) => left.checkedAt.localeCompare(right.checkedAt))
        .at(-1) ?? null
    );
  }

  public async saveValidationReport(report: ValidationReport): Promise<string> {
    const parsed = ValidationReportSchema.parse(report);
    const outputPath = getRunValidationReportFile(this.artifactDir, parsed.runId);
    await writeJsonFile(outputPath, parsed);
    return outputPath;
  }

  public async getValidationReport(runId: string): Promise<ValidationReport | null> {
    const raw = await readJsonFile<ValidationReport>(
      getRunValidationReportFile(this.artifactDir, runId),
    );
    return raw ? ValidationReportSchema.parse(raw) : null;
  }
}
