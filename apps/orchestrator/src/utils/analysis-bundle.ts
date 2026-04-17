import fs from 'node:fs/promises';

import {
  AnalysisBundleAttachmentSchema,
  AnalysisBundleManifestSchema,
  type AnalysisBundleAttachment,
} from '../contracts';
import { readJsonFile } from './file-store';
import { getRunAnalysisBundleManifestFile } from './run-paths';

export async function resolveRunAnalysisBundle(
  artifactDir: string,
  runId: string,
): Promise<AnalysisBundleAttachment | null> {
  const manifestPath = getRunAnalysisBundleManifestFile(artifactDir, runId);
  const raw = await readJsonFile<AnalysisBundleAttachment>(manifestPath);
  if (!raw) {
    return null;
  }

  const manifest = AnalysisBundleManifestSchema.parse(raw);
  const files = await filterExistingFiles(manifest.files);
  if (files.length === 0) {
    return null;
  }

  return AnalysisBundleAttachmentSchema.parse({
    ...manifest,
    manifestPath,
    files,
    inputFiles: files.map((file) => file.path),
  });
}

export function mergeMetadataWithAnalysisBundle(
  metadata: Record<string, unknown> | undefined,
  bundle: AnalysisBundleAttachment | null,
): Record<string, unknown> {
  if (!bundle) {
    return {
      ...(metadata ?? {}),
    };
  }

  return {
    ...(metadata ?? {}),
    analysisBundle: {
      manifestPath: bundle.manifestPath,
      bundleDir: bundle.bundleDir,
      createdAt: bundle.createdAt,
      inputFiles: bundle.inputFiles,
      files: bundle.files,
    },
  };
}

export function readAnalysisBundleInputFiles(
  metadata: Record<string, unknown> | undefined,
): string[] {
  const bundle = readAnalysisBundleAttachment(metadata);
  return bundle?.inputFiles ?? [];
}

export function buildAnalysisBundlePromptLines(
  metadata: Record<string, unknown> | undefined,
): string[] {
  const bundle = readAnalysisBundleAttachment(metadata);
  if (!bundle) {
    return [];
  }

  return [
    '## Attached Analysis Bundle',
    'Use the attached analysis bundle files as the primary repository context for this request.',
    'Prefer the text bundle first: repo-summary.md and critical-files.md.',
    'Use latest.patch as current diff evidence and source.zip only as supporting context.',
    ...bundle.files.map((file) => `- ${file.relativePath} (${file.kind})`),
  ];
}

function readAnalysisBundleAttachment(
  metadata: Record<string, unknown> | undefined,
): AnalysisBundleAttachment | null {
  const raw = metadata?.analysisBundle;
  const parsed = AnalysisBundleAttachmentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function filterExistingFiles(
  files: readonly AnalysisBundleAttachment['files'][number][],
): Promise<AnalysisBundleAttachment['files']> {
  const resolved = await Promise.all(
    files.map(async (file) => ({
      file,
      exists: await fileExists(file.path),
    })),
  );

  return resolved.filter((entry) => entry.exists).map((entry) => entry.file);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
