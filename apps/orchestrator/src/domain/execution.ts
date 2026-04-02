import type { ExecutionResult, TestResult } from '../contracts';
import type { TaskLoopState } from '../contracts/task-loop-state';

export type ExecutionFailureDisposition = 'keep_implementing' | 'reject';

export type ExecutionDisposition = {
  recommendedTaskState: Extract<
    TaskLoopState,
    'tests_green' | 'implementation_in_progress' | 'rejected'
  >;
  testsPassed: boolean;
  shouldSubmitForReview: boolean;
  reason: string;
};

export function didExecutionTestsPass(testResults: readonly TestResult[]): boolean {
  return (
    testResults.length > 0 &&
    testResults.every((result) => result.status === 'passed' && result.failed === 0)
  );
}

export function recommendTaskStateAfterExecution(
  result: ExecutionResult,
  options: {
    onFailure?: ExecutionFailureDisposition | undefined;
  } = {},
): ExecutionDisposition {
  const testsPassed = didExecutionTestsPass(result.testResults);

  if (result.status === 'succeeded' && testsPassed) {
    return {
      recommendedTaskState: 'tests_green',
      testsPassed: true,
      shouldSubmitForReview: true,
      reason: 'Execution succeeded and returned passing test evidence.',
    };
  }

  if (options.onFailure === 'reject' && result.status === 'failed') {
    return {
      recommendedTaskState: 'rejected',
      testsPassed,
      shouldSubmitForReview: false,
      reason: 'Execution failed and the configured disposition is to reject the task.',
    };
  }

  return {
    recommendedTaskState: 'implementation_in_progress',
    testsPassed,
    shouldSubmitForReview: false,
    reason:
      result.status === 'failed'
        ? 'Execution failed; keep the task in implementation until a new attempt is ready.'
        : 'Execution did not return passing test evidence yet.',
  };
}
