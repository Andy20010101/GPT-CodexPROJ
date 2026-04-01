import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ArtifactManifestWriter } from '../../src/guards/artifact-manifest';

describe('ArtifactManifestWriter', () => {
  it('writes a manifest json file under the artifacts directory', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-artifacts-'));
    const writer = new ArtifactManifestWriter(artifactDir);

    const manifestPath = await writer.write({
      timestamp: '2026-04-01T12:00:00.000Z',
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      projectName: 'ReviewSystem',
      model: 'GPT-5',
      inputFiles: ['/tmp/spec.md'],
      exportedArtifactPaths: ['/tmp/export.md'],
    });

    const content = await fs.readFile(manifestPath, 'utf8');
    expect(manifestPath).toContain(
      path.join('manifests', '2026-04-01T12-00-00.000Z-conversation-1-manifest.json'),
    );
    expect(JSON.parse(content)).toMatchObject({
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      projectName: 'ReviewSystem',
      exportedArtifactPaths: ['/tmp/export.md'],
    });
  });
});
