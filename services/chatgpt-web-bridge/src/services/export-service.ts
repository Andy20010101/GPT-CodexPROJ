import fs from 'node:fs/promises';
import path from 'node:path';

import type { ConversationSnapshot } from '@review-then-codex/shared-contracts/chatgpt';

import { MarkdownExporter } from '../exporters/markdown-exporter';
import { StructuredOutputExtractor } from '../exporters/structured-output-extractor';
import { ArtifactManifestWriter } from '../guards/artifact-manifest';

type ExportContext = {
  readonly inputFiles: readonly string[];
  readonly fileName?: string | undefined;
};

export class ExportService {
  public constructor(
    private readonly artifactDir: string,
    private readonly markdownExporter: MarkdownExporter,
    private readonly structuredOutputExtractor: StructuredOutputExtractor,
    private readonly artifactManifestWriter: ArtifactManifestWriter,
  ) {}

  public async exportMarkdown(
    snapshot: ConversationSnapshot,
    context: ExportContext,
  ): Promise<{
    artifactPath: string;
    manifestPath: string;
    markdown: string;
  }> {
    const markdown = this.markdownExporter.render(snapshot);
    const exportsDir = path.join(this.artifactDir, 'markdown');
    await fs.mkdir(exportsDir, { recursive: true });

    const fileName = context.fileName ?? `${snapshot.conversationId}.md`;
    const artifactPath = path.join(exportsDir, fileName);
    await fs.writeFile(artifactPath, markdown, 'utf8');

    const manifestPath = await this.artifactManifestWriter.write({
      timestamp: new Date().toISOString(),
      sessionId: snapshot.sessionId,
      conversationId: snapshot.conversationId,
      projectName: snapshot.projectName,
      model: snapshot.model,
      inputFiles: context.inputFiles,
      exportedArtifactPaths: [artifactPath],
    });

    return { artifactPath, manifestPath, markdown };
  }

  public async extractStructuredReview(
    snapshot: ConversationSnapshot,
    context: ExportContext,
  ): Promise<{
    artifactPath: string;
    manifestPath: string;
    payload: Record<string, unknown>;
  }> {
    const sourceText =
      snapshot.lastAssistantMessage ??
      [...snapshot.messages].reverse().find((message) => message.role === 'assistant')?.text ??
      '';
    const payload = this.structuredOutputExtractor.extract(sourceText);
    const exportsDir = path.join(this.artifactDir, 'structured-review');
    await fs.mkdir(exportsDir, { recursive: true });

    const fileName = context.fileName ?? `${snapshot.conversationId}.json`;
    const artifactPath = path.join(exportsDir, fileName);
    await fs.writeFile(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

    const manifestPath = await this.artifactManifestWriter.write({
      timestamp: new Date().toISOString(),
      sessionId: snapshot.sessionId,
      conversationId: snapshot.conversationId,
      projectName: snapshot.projectName,
      model: snapshot.model,
      inputFiles: context.inputFiles,
      exportedArtifactPaths: [artifactPath],
    });

    return { artifactPath, manifestPath, payload };
  }
}
