import { AppError } from '../types/error';
import { BrowserAttachDiagnosticsService } from '../services/browser-attach-diagnostics-service';
import { BrowserAuthorityService } from '../services/browser-authority-service';

export class BrowserAttachPreflightGuard {
  public constructor(
    private readonly diagnosticsService: BrowserAttachDiagnosticsService,
    private readonly browserAuthorityService: BrowserAuthorityService = new BrowserAuthorityService(),
  ) {}

  public async prepareSessionInput(input: {
    browserUrl?: string | undefined;
    browserEndpoint?: string | undefined;
    startupUrl?: string | undefined;
  }): Promise<{
    browserEndpoint: string;
    startupUrl?: string | undefined;
  }> {
    const authority = await this.browserAuthorityService.resolve(input);
    if (authority.source === 'request_input' && authority.browserEndpoint) {
      return {
        browserEndpoint: authority.browserEndpoint,
        ...(authority.startupUrl ? { startupUrl: authority.startupUrl } : {}),
      };
    }

    const diagnostic = await this.diagnosticsService.runBrowserAttachDiagnostic({
      browserUrl: input.browserUrl,
      browserEndpoint: input.browserEndpoint,
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
      browserEndpoint: diagnostic.selectedCandidate.endpoint,
      ...(diagnostic.effectiveStartupUrl
        ? { startupUrl: diagnostic.effectiveStartupUrl }
        : {}),
    };
  }
}
