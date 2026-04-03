import path from 'node:path';

import { planningPhaseToDirectory, type PlanningPhase } from '../contracts/planning-phase';

export function getRunsRoot(artifactDir: string): string {
  return path.join(artifactDir, 'runs');
}

export function getRuntimeRoot(artifactDir: string): string {
  return path.join(artifactDir, 'runtime');
}

export function getRunRoot(artifactDir: string, runId: string): string {
  return path.join(getRunsRoot(artifactDir), runId);
}

export function getRunFile(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'run.json');
}

export function getPlanningRoot(
  artifactDir: string,
  runId: string,
  phase: PlanningPhase,
): string {
  return path.join(getRunRoot(artifactDir, runId), planningPhaseToDirectory(phase));
}

export function getPlanningRequestFile(
  artifactDir: string,
  runId: string,
  phase: PlanningPhase,
): string {
  return path.join(getPlanningRoot(artifactDir, runId, phase), 'request.json');
}

export function getPlanningConversationLinkFile(
  artifactDir: string,
  runId: string,
  phase: PlanningPhase,
): string {
  return path.join(getPlanningRoot(artifactDir, runId, phase), 'conversation-link.json');
}

export function getPlanningRequestRuntimeStateFile(
  artifactDir: string,
  runId: string,
  phase: PlanningPhase,
): string {
  return path.join(getPlanningRoot(artifactDir, runId, phase), 'request-runtime-state.json');
}

export function getPlanningFinalizeRuntimeStateFile(
  artifactDir: string,
  runId: string,
  phase: PlanningPhase,
): string {
  return path.join(getPlanningRoot(artifactDir, runId, phase), 'finalize-runtime-state.json');
}

export function getPlanningMaterializedResultFile(
  artifactDir: string,
  runId: string,
  phase: PlanningPhase,
): string {
  return path.join(getPlanningRoot(artifactDir, runId, phase), 'materialized-result.json');
}

export function getPlanningModelRoutingDecisionFile(
  artifactDir: string,
  runId: string,
  phase: PlanningPhase,
): string {
  return path.join(getPlanningRoot(artifactDir, runId, phase), 'model-routing-decision.json');
}

export function getPlanningSufficiencyDecisionFile(artifactDir: string, runId: string): string {
  return path.join(
    getPlanningRoot(artifactDir, runId, 'task_graph_generation'),
    'planning-sufficiency-decision.json',
  );
}

export function getPlanningRecoverySummaryFile(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'planning-recovery-summary.json');
}

export function getExecutionRoot(artifactDir: string, runId: string, executionId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'executions', executionId);
}

export function getExecutionRequestFile(
  artifactDir: string,
  runId: string,
  executionId: string,
): string {
  return path.join(getExecutionRoot(artifactDir, runId, executionId), 'request.json');
}

export function getExecutionResultFile(
  artifactDir: string,
  runId: string,
  executionId: string,
): string {
  return path.join(getExecutionRoot(artifactDir, runId, executionId), 'result.json');
}

export function getReviewRoot(artifactDir: string, runId: string, reviewId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'reviews', reviewId);
}

export function getReviewRequestFile(artifactDir: string, runId: string, reviewId: string): string {
  return path.join(getReviewRoot(artifactDir, runId, reviewId), 'request.json');
}

export function getReviewResultFile(artifactDir: string, runId: string, reviewId: string): string {
  return path.join(getReviewRoot(artifactDir, runId, reviewId), 'result.json');
}

export function getReviewRuntimeStateFile(
  artifactDir: string,
  runId: string,
  reviewId: string,
): string {
  return path.join(getReviewRoot(artifactDir, runId, reviewId), 'runtime-state.json');
}

export function getWorkspaceRecordFile(
  artifactDir: string,
  runId: string,
  workspaceId: string,
): string {
  return path.join(getRunRoot(artifactDir, runId), 'workspace-runtime', `${workspaceId}.json`);
}

export function getRunWorkspacesRoot(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'workspaces');
}

export function getWorkspaceLifecycleFile(
  artifactDir: string,
  runId: string,
  workspaceId: string,
): string {
  return path.join(getRunWorkspacesRoot(artifactDir, runId), `${workspaceId}.json`);
}

export function getJobsRoot(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'jobs');
}

export function getJobFile(artifactDir: string, runId: string, jobId: string): string {
  return path.join(getJobsRoot(artifactDir, runId), `${jobId}.json`);
}

export function getQueueRoot(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'queue');
}

export function getQueueStateFile(artifactDir: string, runId: string): string {
  return path.join(getQueueRoot(artifactDir, runId), 'queue-state.json');
}

export function getReleaseRoot(
  artifactDir: string,
  runId: string,
  releaseReviewId: string,
): string {
  return path.join(getRunRoot(artifactDir, runId), 'releases', releaseReviewId);
}

export function getReleaseRequestFile(
  artifactDir: string,
  runId: string,
  releaseReviewId: string,
): string {
  return path.join(getReleaseRoot(artifactDir, runId, releaseReviewId), 'request.json');
}

export function getReleaseResultFile(
  artifactDir: string,
  runId: string,
  releaseReviewId: string,
): string {
  return path.join(getReleaseRoot(artifactDir, runId, releaseReviewId), 'result.json');
}

export function getRunAcceptanceFile(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'run-acceptance.json');
}

export function getRunDaemonRoot(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'daemon');
}

export function getRunDaemonStateFile(artifactDir: string, runId: string): string {
  return path.join(getRunDaemonRoot(artifactDir, runId), 'daemon-state.json');
}

export function getRunWorkersRoot(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'workers');
}

export function getRunWorkerFile(artifactDir: string, runId: string, workerId: string): string {
  return path.join(getRunWorkersRoot(artifactDir, runId), `${workerId}.json`);
}

export function getRunHeartbeatsRoot(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'heartbeats');
}

export function getRunHeartbeatFile(
  artifactDir: string,
  runId: string,
  heartbeatId: string,
): string {
  return path.join(getRunHeartbeatsRoot(artifactDir, runId), `${heartbeatId}.json`);
}

export function getRunCancellationsRoot(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'cancellations');
}

export function getRunCancellationFile(
  artifactDir: string,
  runId: string,
  cancellationId: string,
): string {
  return path.join(getRunCancellationsRoot(artifactDir, runId), `${cancellationId}.json`);
}

export function getRuntimeDaemonStateFile(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'daemon-state.json');
}

export function getRuntimeWorkersRoot(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'workers');
}

export function getRuntimeWorkerFile(artifactDir: string, workerId: string): string {
  return path.join(getRuntimeWorkersRoot(artifactDir), `${workerId}.json`);
}

export function getRuntimeLeasesRoot(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'leases');
}

export function getRuntimeLeaseFile(artifactDir: string, jobId: string): string {
  return path.join(getRuntimeLeasesRoot(artifactDir), `${jobId}.json`);
}

export function getRuntimeHeartbeatsRoot(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'heartbeats');
}

export function getRuntimeHeartbeatFile(artifactDir: string, heartbeatId: string): string {
  return path.join(getRuntimeHeartbeatsRoot(artifactDir), `${heartbeatId}.json`);
}

export function getRuntimeMetricsFile(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'metrics-summary.json');
}

export function getRuntimeDrainSummaryFile(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'drain-summary.json');
}

export function getRuntimeSchedulingRoot(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'scheduling');
}

export function getRuntimeSchedulingStateFile(artifactDir: string): string {
  return path.join(getRuntimeSchedulingRoot(artifactDir), 'scheduling-state.json');
}

export function getRuntimeFailuresRoot(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'failures');
}

export function getRuntimeFailureFile(artifactDir: string, failureId: string): string {
  return path.join(getRuntimeFailuresRoot(artifactDir), `${failureId}.json`);
}

export function getRunFailuresRoot(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'failures');
}

export function getRunFailureFile(artifactDir: string, runId: string, failureId: string): string {
  return path.join(getRunFailuresRoot(artifactDir, runId), `${failureId}.json`);
}

export function getRuntimeCleanupRoot(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'cleanup');
}

export function getRuntimeCleanupFile(artifactDir: string, cleanupId: string): string {
  return path.join(getRuntimeCleanupRoot(artifactDir), `${cleanupId}.json`);
}

export function getRuntimeGcRoot(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'gc');
}

export function getRuntimeGcFile(artifactDir: string, gcRunId: string): string {
  return path.join(getRuntimeGcRoot(artifactDir), `${gcRunId}.json`);
}

export function getRuntimeProcessesRoot(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'processes');
}

export function getRuntimeProcessFile(artifactDir: string, processHandleId: string): string {
  return path.join(getRuntimeProcessesRoot(artifactDir), `${processHandleId}.json`);
}

export function getRuntimeRemediationRoot(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'remediation');
}

export function getRuntimeRemediationFile(artifactDir: string, remediationId: string): string {
  return path.join(getRuntimeRemediationRoot(artifactDir), `${remediationId}.json`);
}

export function getRunRemediationRoot(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'remediation');
}

export function getRunRemediationFile(
  artifactDir: string,
  runId: string,
  remediationId: string,
): string {
  return path.join(getRunRemediationRoot(artifactDir, runId), `${remediationId}.json`);
}

export function getRuntimeRollbackRoot(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'rollbacks');
}

export function getRuntimeRollbackFile(artifactDir: string, rollbackId: string): string {
  return path.join(getRuntimeRollbackRoot(artifactDir), `${rollbackId}.json`);
}

export function getRunRollbackRoot(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'rollbacks');
}

export function getRunRollbackFile(artifactDir: string, runId: string, rollbackId: string): string {
  return path.join(getRunRollbackRoot(artifactDir, runId), `${rollbackId}.json`);
}

export function getRuntimeSnapshotsRoot(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'snapshots');
}

export function getRuntimeSnapshotFile(artifactDir: string, snapshotId: string): string {
  return path.join(getRuntimeSnapshotsRoot(artifactDir), `${snapshotId}.json`);
}

export function getRunSnapshotsRoot(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'snapshots');
}

export function getRunSnapshotFile(artifactDir: string, runId: string, snapshotId: string): string {
  return path.join(getRunSnapshotsRoot(artifactDir, runId), `${snapshotId}.json`);
}

export function getRuntimeStabilityRoot(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'stability');
}

export function getRuntimeStabilityReportFile(artifactDir: string): string {
  return path.join(getRuntimeStabilityRoot(artifactDir), 'stability-report.json');
}

export function getRunIncidentsRoot(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'incidents');
}

export function getRunIncidentFile(artifactDir: string, runId: string, incidentId: string): string {
  return path.join(getRunIncidentsRoot(artifactDir, runId), `${incidentId}.json`);
}

export function getRunValidationRoot(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'validation');
}

export function getRunValidationReportFile(artifactDir: string, runId: string): string {
  return path.join(getRunValidationRoot(artifactDir, runId), 'validation-report.json');
}

export function getRunPlanningProofReportFile(artifactDir: string, runId: string): string {
  return path.join(getRunValidationRoot(artifactDir, runId), 'planning-proof-report.json');
}

export function getRuntimeResumeRoot(artifactDir: string): string {
  return path.join(getRuntimeRoot(artifactDir), 'resume');
}

export function getRuntimeResumeFile(artifactDir: string, resumeStateId: string): string {
  return path.join(getRuntimeResumeRoot(artifactDir), `${resumeStateId}.json`);
}
