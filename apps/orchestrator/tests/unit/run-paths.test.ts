import { describe, expect, it } from 'vitest';

import {
  getPlanningApplyRemediationInputFile,
  getPlanningApplyRemediationOutputFile,
  getPlanningApplyRetryResultFile,
  getPlanningRequestRuntimeStateFile,
  getRunAnalysisBundleManifestFile,
  getRunFile,
  getRunSelfImprovementGoalFile,
  getRunWatcherLatestJsonFile,
  getRunWatcherLatestMarkdownFile,
  getRunWatcherLogFile,
  getRunWatcherPidFile,
  getRunWatcherRoot,
  getSelfImprovementCampaignStateFile,
  getSelfImprovementEnvLogFile,
  getSelfImprovementEnvStateFile,
} from '../../src/utils/run-paths';

describe('run-path helpers', () => {
  const artifactDir = '/tmp/real-self-improvement/artifacts';
  const runId = 'run-123';

  it('keeps run state, analysis bundle, and watcher outputs under the same run root', () => {
    const runRoot = '/tmp/real-self-improvement/artifacts/runs/run-123';

    expect(getRunFile(artifactDir, runId)).toBe(`${runRoot}/run.json`);
    expect(getPlanningRequestRuntimeStateFile(artifactDir, runId, 'requirement_freeze')).toBe(
      `${runRoot}/requirement/request-runtime-state.json`,
    );
    expect(getPlanningApplyRemediationInputFile(artifactDir, runId, 'architecture_freeze')).toBe(
      `${runRoot}/architecture/apply-remediation-input.json`,
    );
    expect(getPlanningApplyRemediationOutputFile(artifactDir, runId, 'architecture_freeze')).toBe(
      `${runRoot}/architecture/apply-remediation-output.json`,
    );
    expect(getPlanningApplyRetryResultFile(artifactDir, runId, 'architecture_freeze')).toBe(
      `${runRoot}/architecture/apply-retry-result.json`,
    );
    expect(getRunAnalysisBundleManifestFile(artifactDir, runId)).toBe(
      `${runRoot}/analysis-bundle/manifest.json`,
    );
    expect(getRunWatcherRoot(artifactDir, runId)).toBe(`${runRoot}/watcher`);
    expect(getRunWatcherLogFile(artifactDir, runId)).toBe(`${runRoot}/watcher/watcher.log`);
    expect(getRunWatcherLatestJsonFile(artifactDir, runId)).toBe(
      `${runRoot}/watcher/latest.json`,
    );
    expect(getRunWatcherLatestMarkdownFile(artifactDir, runId)).toBe(
      `${runRoot}/watcher/latest.md`,
    );
    expect(getRunWatcherPidFile(artifactDir, runId)).toBe(`${runRoot}/watcher/watcher.pid`);
    expect(getRunSelfImprovementGoalFile(artifactDir, runId)).toBe(
      `${runRoot}/self-improvement-goal.json`,
    );
    expect(getSelfImprovementEnvStateFile(artifactDir)).toBe(
      '/tmp/real-self-improvement/artifacts/runtime/self-improvement-env/env-state.json',
    );
    expect(getSelfImprovementEnvLogFile(artifactDir, 'bridge')).toBe(
      '/tmp/real-self-improvement/artifacts/runtime/self-improvement-env/bridge.log',
    );
    expect(getSelfImprovementCampaignStateFile(artifactDir, 'bounded-campaign')).toBe(
      '/tmp/real-self-improvement/artifacts/runtime/self-improvement-governor/campaigns/bounded-campaign.json',
    );
  });
});
