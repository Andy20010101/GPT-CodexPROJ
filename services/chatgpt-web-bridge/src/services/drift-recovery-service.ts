import { randomUUID } from 'node:crypto';

import type {
  BridgeDriftIncident,
  BridgeHealthSummary,
} from '@gpt-codexproj/shared-contracts/chatgpt';

import { DriftDetector, type SelectorProbe } from '../dom/drift-detector';
import { evaluatePageHealth } from '../dom/page-health-check';
import { applySelectorFallbacks } from '../dom/selector-fallbacks';
import type { SelectorRequirement } from '../dom/selectors';
import { AppError } from '../types/error';
import { BridgeHealthService } from './bridge-health-service';

export class DriftRecoveryService {
  public constructor(
    private readonly bridgeHealthService: BridgeHealthService,
    private readonly driftDetector = new DriftDetector(),
    private readonly maxRecoveryAttempts = 2,
  ) {}

  public async recover(input: {
    sessionId?: string | undefined;
    conversationId?: string | undefined;
    pageUrl: string;
    probe: SelectorProbe;
    requirements: readonly SelectorRequirement[];
    loggedOutDetected?: boolean | undefined;
    projectAvailable?: boolean | undefined;
    conversationAvailable?: boolean | undefined;
    recoveryAttempts?: readonly {
      label: string;
      attempt: () => Promise<boolean>;
    }[];
  }): Promise<{
    health: BridgeHealthSummary;
    incident?: BridgeDriftIncident | undefined;
  }> {
    const primaryCheck = await this.inspectRequirements(input.probe, input.requirements);
    const primaryHealth = evaluatePageHealth({
      url: input.pageUrl,
      loggedOutDetected: input.loggedOutDetected ?? false,
      missingRequirements: primaryCheck.missing,
      projectAvailable: input.projectAvailable,
      conversationAvailable: input.conversationAvailable,
    });

    if (primaryHealth.status === 'ready') {
      const health = await this.persistHealth({
        status: 'ready',
        issues: [],
        activeSessions: input.sessionId ? 1 : 0,
        activeConversations: input.conversationId ? 1 : 0,
      });
      return { health };
    }

    const attempts: BridgeDriftIncident['attempts'] = [];
    const fallbackRequirements = applySelectorFallbacks(input.requirements);
    if (
      fallbackRequirements.some(
        (entry, index) =>
          entry.candidates.length > (input.requirements[index]?.candidates.length ?? 0),
      )
    ) {
      const fallbackCheck = await this.inspectRequirements(input.probe, fallbackRequirements);
      if (fallbackCheck.missing.length === 0) {
        attempts.push({
          label: 'selector_fallback',
          outcome: 'succeeded',
        });
        const incident = await this.persistIncident({
          category: 'selector_fallback',
          status: 'recovered',
          summary: 'Recovered DOM drift by applying selector fallbacks.',
          attempts,
          input,
        });
        const health = await this.persistHealth({
          status: 'degraded',
          issues: ['Recovered through selector fallback.'],
          activeSessions: input.sessionId ? 1 : 0,
          activeConversations: input.conversationId ? 1 : 0,
          latestIncidentId: incident.incidentId,
        });
        return { health, incident };
      }
    }

    for (const recovery of (input.recoveryAttempts ?? []).slice(0, this.maxRecoveryAttempts)) {
      const ok = await recovery.attempt().catch(() => false);
      attempts.push({
        label: recovery.label,
        outcome: ok ? 'succeeded' : 'failed',
      });
      if (ok) {
        const recheck = await this.inspectRequirements(input.probe, input.requirements);
        if (recheck.missing.length === 0) {
          const incident = await this.persistIncident({
            category: 'page_health',
            status: 'recovered',
            summary: `Recovered bridge health through ${recovery.label}.`,
            attempts,
            input,
          });
          const health = await this.persistHealth({
            status: 'degraded',
            issues: ['Recovered after a bounded recovery attempt.'],
            activeSessions: input.sessionId ? 1 : 0,
            activeConversations: input.conversationId ? 1 : 0,
            latestIncidentId: incident.incidentId,
          });
          return { health, incident };
        }
      }
    }

    const incident = await this.persistIncident({
      category: 'page_health',
      status: 'failed',
      summary: primaryHealth.issues.join(' ') || 'Bridge page health could not be recovered.',
      attempts,
      input,
    });
    const health = await this.persistHealth({
      status: primaryHealth.status,
      issues: primaryHealth.issues,
      activeSessions: input.sessionId ? 1 : 0,
      activeConversations: input.conversationId ? 1 : 0,
      latestIncidentId: incident.incidentId,
    });

    if (primaryHealth.status === 'dom_drift_detected') {
      throw new AppError('DOM_DRIFT_DETECTED', incident.summary, 503, {
        incidentId: incident.incidentId,
      });
    }

    return { health, incident };
  }

  private async inspectRequirements(
    probe: SelectorProbe,
    requirements: readonly SelectorRequirement[],
  ): Promise<{ missing: SelectorRequirement[] }> {
    try {
      await this.driftDetector.assertRequiredSelectors(probe, requirements, 'drift-recovery');
      return { missing: [] };
    } catch (error) {
      if (error instanceof AppError && error.code === 'DOM_DRIFT_DETECTED') {
        const details = error.details as { missing?: SelectorRequirement[] } | undefined;
        return {
          missing: details?.missing ?? [...requirements],
        };
      }
      throw error;
    }
  }

  private async persistHealth(input: {
    status: BridgeHealthSummary['status'];
    issues: readonly string[];
    activeSessions: number;
    activeConversations: number;
    latestIncidentId?: string | undefined;
  }): Promise<BridgeHealthSummary> {
    const summary: BridgeHealthSummary = {
      status: input.status,
      checkedAt: new Date().toISOString(),
      activeSessions: input.activeSessions,
      activeConversations: input.activeConversations,
      issues: [...input.issues],
      ...(input.latestIncidentId ? { latestIncidentId: input.latestIncidentId } : {}),
      metadata: {},
    };
    await this.bridgeHealthService.recordHealth(summary);
    return summary;
  }

  private async persistIncident(input: {
    category: BridgeDriftIncident['category'];
    status: BridgeDriftIncident['status'];
    summary: string;
    attempts: BridgeDriftIncident['attempts'];
    input: {
      sessionId?: string | undefined;
      conversationId?: string | undefined;
      pageUrl: string;
    };
  }): Promise<BridgeDriftIncident> {
    const incident: BridgeDriftIncident = {
      incidentId: randomUUID(),
      ...(input.input.sessionId ? { sessionId: input.input.sessionId } : {}),
      ...(input.input.conversationId ? { conversationId: input.input.conversationId } : {}),
      category: input.category,
      status: input.status,
      summary: input.summary,
      attempts: input.attempts,
      pageUrl: input.input.pageUrl,
      occurredAt: new Date().toISOString(),
      ...(input.status === 'recovered' ? { resolvedAt: new Date().toISOString() } : {}),
      metadata: {},
    };
    await this.bridgeHealthService.recordIncident(incident);
    return incident;
  }
}
