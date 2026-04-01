import fs from 'node:fs/promises';
import path from 'node:path';

export type ArtifactManifestEntry = {
  readonly timestamp: string;
  readonly sessionId: string;
  readonly conversationId: string;
  readonly projectName: string;
  readonly model?: string | undefined;
  readonly inputFiles: readonly string[];
  readonly exportedArtifactPaths: readonly string[];
};

export class ArtifactManifestWriter {
  public constructor(private readonly artifactDir: string) {}

  public async write(entry: ArtifactManifestEntry): Promise<string> {
    const manifestDir = path.join(this.artifactDir, 'manifests');
    await fs.mkdir(manifestDir, { recursive: true });

    const fileName = `${entry.timestamp.replaceAll(':', '-')}-${entry.conversationId}-manifest.json`;
    const outputPath = path.join(manifestDir, fileName);
    await fs.writeFile(outputPath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');

    return outputPath;
  }
}
