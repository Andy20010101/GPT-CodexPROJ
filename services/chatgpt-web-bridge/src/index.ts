import pino from 'pino';

import { PuppeteerChatGPTAdapter } from './adapters/chatgpt-adapter';
import { BrowserManager } from './browser/browser-manager';
import { PageFactory } from './browser/page-factory';
import { SessionLease } from './browser/session-lease';
import { loadBridgeConfig } from './config/env';
import { MarkdownExporter } from './exporters/markdown-exporter';
import { StructuredOutputExtractor } from './exporters/structured-output-extractor';
import { ArtifactManifestWriter } from './guards/artifact-manifest';
import { SessionResumeGuard } from './guards/session-resume-guard';
import { buildServer } from './server';
import { BridgeHealthService } from './services/bridge-health-service';
import { ConversationService } from './services/conversation-service';
import { ExportService } from './services/export-service';

export async function startServer(): Promise<void> {
  const config = loadBridgeConfig();
  const logger = pino({ name: 'chatgpt-web-bridge' });
  const adapter = new PuppeteerChatGPTAdapter(new BrowserManager(new PageFactory()));
  const bridgeHealthService = new BridgeHealthService(config.artifactDir);
  const sessionResumeGuard = new SessionResumeGuard(adapter, bridgeHealthService);
  const exportService = new ExportService(
    config.artifactDir,
    new MarkdownExporter(),
    new StructuredOutputExtractor(),
    new ArtifactManifestWriter(config.artifactDir),
  );
  const conversationService = new ConversationService(
    adapter,
    new SessionLease(),
    exportService,
    logger,
    bridgeHealthService,
    sessionResumeGuard,
  );
  const app = buildServer({ conversationService, logger });

  await app.listen({ host: config.host, port: config.port });
}

if (require.main === module) {
  void startServer();
}
