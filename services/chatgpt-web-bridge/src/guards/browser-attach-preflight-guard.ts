import { AppError } from '../types/error';
import { BrowserAttachDiagnosticsService } from '../services/browser-attach-diagnostics-service';

export class BrowserAttachPreflightGuard {
  public constructor(
    private readonly diagnosticsService: BrowserAttachDiagnosticsService,
  ) {}

  public async prepareSessionInput(input: {
    browserUrl: string;
    startupUrl?: string | undefined;
  }): Promise<{
    browserUrl: string;
    startupUrl?: string | undefined;
  }> {
    const diagnostic = await this.diagnosticsService.runBrowserAttachDiagnostic({
      browserUrl: input.browserUrl,
      startupUrl: input.startupUrl,
    });
    await this.diagnosticsService.recordBrowserAttachPreflight({
      diagnostic,
      allowOpenSession: diagnostic.attachReady && Boolean(diagnostic.selectedCandidate),
    });
    if (!diagnostic.attachReady || !diagnostic.selectedCandidate) {
      throw new AppError(
        diagnostic.failureCategory ?? 'REMOTE_DEBUGGING_DISABLED_OR_BLOCKED',
        `Browser attach preflight failed: ${
          diagnostic.failureCategory ?? 'No attachable browser endpoint was selected.'
        }`,
        diagnostic.failureCategory === 'BROWSER_ENDPOINT_MISCONFIGURED' ? 400 : 503,
        {
          diagnosticId: diagnostic.diagnosticId,
          latestArtifactPath: diagnostic.latestArtifactPath,
          recommendations: diagnostic.recommendations,
        },
      );
    }

    return {
      browserUrl: diagnostic.selectedCandidate.endpoint,
      ...(diagnostic.effectiveStartupUrl
        ? { startupUrl: diagnostic.effectiveStartupUrl }
        : {}),
    };
  }
}
