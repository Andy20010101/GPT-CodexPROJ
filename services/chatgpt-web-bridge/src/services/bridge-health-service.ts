import fs from 'node:fs/promises';
import path from 'node:path';

import {
  BridgeDriftIncidentSchema,
  BridgeHealthSummarySchema,
  type BridgeDriftIncident,
  type BridgeHealthSummary,
} from '@gpt-codexproj/shared-contracts/chatgpt';

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    const cast = error as NodeJS.ErrnoException;
    if (cast.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export class BridgeHealthService {
  public constructor(private readonly artifactDir: string) {}

  public async recordHealth(summary: BridgeHealthSummary): Promise<string> {
    const parsed = BridgeHealthSummarySchema.parse(summary);
    const outputPath = path.join(this.artifactDir, 'health', 'bridge-health.json');
    await writeJson(outputPath, parsed);
    return outputPath;
  }

  public async getLatestHealth(): Promise<BridgeHealthSummary | null> {
    const raw = await readJson<BridgeHealthSummary>(
      path.join(this.artifactDir, 'health', 'bridge-health.json'),
    );
    return raw ? BridgeHealthSummarySchema.parse(raw) : null;
  }

  public async recordIncident(incident: BridgeDriftIncident): Promise<string> {
    const parsed = BridgeDriftIncidentSchema.parse(incident);
    const outputPath = path.join(this.artifactDir, 'drift', `${parsed.incidentId}.json`);
    await writeJson(outputPath, parsed);
    return outputPath;
  }

  public async listIncidents(): Promise<BridgeDriftIncident[]> {
    const directoryPath = path.join(this.artifactDir, 'drift');
    try {
      const entries = await fs.readdir(directoryPath, { withFileTypes: true });
      const incidents: BridgeDriftIncident[] = [];
      for (const entry of entries
        .filter((item) => item.isFile() && item.name.endsWith('.json'))
        .sort((left, right) => left.name.localeCompare(right.name))) {
        const raw = await readJson<BridgeDriftIncident>(path.join(directoryPath, entry.name));
        if (raw) {
          incidents.push(BridgeDriftIncidentSchema.parse(raw));
        }
      }
      return incidents;
    } catch (error) {
      const cast = error as NodeJS.ErrnoException;
      if (cast.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}
