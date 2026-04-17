import { z } from 'zod';

export const AnalysisBundleFileKindSchema = z.enum([
  'repo_summary',
  'critical_files',
  'latest_patch',
  'source_zip',
  'other',
]);

export type AnalysisBundleFileKind = z.infer<typeof AnalysisBundleFileKindSchema>;

export const AnalysisBundleFileSchema = z.object({
  kind: AnalysisBundleFileKindSchema,
  path: z.string().min(1),
  relativePath: z.string().min(1),
  optional: z.boolean().default(false),
});

export type AnalysisBundleFile = z.infer<typeof AnalysisBundleFileSchema>;

export const AnalysisBundleManifestSchema = z.object({
  runId: z.string().uuid(),
  bundleDir: z.string().min(1),
  createdAt: z.string().datetime(),
  files: z.array(AnalysisBundleFileSchema).min(1),
});

export type AnalysisBundleManifest = z.infer<typeof AnalysisBundleManifestSchema>;

export const AnalysisBundleAttachmentSchema = AnalysisBundleManifestSchema.extend({
  manifestPath: z.string().min(1),
  inputFiles: z.array(z.string().min(1)).min(1),
});

export type AnalysisBundleAttachment = z.infer<typeof AnalysisBundleAttachmentSchema>;
