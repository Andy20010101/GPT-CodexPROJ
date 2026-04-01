import { describe, expect, it } from 'vitest';

import { assertRunStageTransition } from '../../src/domain/stage';
import { assertTaskLoopTransition } from '../../src/domain/task';
import { OrchestratorError } from '../../src/utils/error';

describe('stage transitions', () => {
  it('accepts valid run stage transitions', () => {
    expect(() => assertRunStageTransition('intake', 'requirement_frozen')).not.toThrow();
    expect(() => assertRunStageTransition('release_review', 'accepted')).not.toThrow();
  });

  it('rejects invalid run stage transitions', () => {
    expect(() => assertRunStageTransition('intake', 'architecture_frozen')).toThrowError(
      OrchestratorError,
    );
  });

  it('requires review gate approval before task acceptance', () => {
    expect(() =>
      assertTaskLoopTransition('review_pending', 'accepted', {
        reviewGatePassed: false,
      }),
    ).toThrowError(OrchestratorError);
  });

  it('rejects implementation before tests_red', () => {
    expect(() =>
      assertTaskLoopTransition('tests_planned', 'implementation_in_progress'),
    ).toThrowError(OrchestratorError);
  });
});
