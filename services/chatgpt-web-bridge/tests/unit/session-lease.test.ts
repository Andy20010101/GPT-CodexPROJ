import { describe, expect, it } from 'vitest';

import { SessionLease } from '../../src/browser/session-lease';
import { AppError } from '../../src/types/error';

describe('SessionLease', () => {
  it('acquires and releases a session lease', async () => {
    const lease = new SessionLease();

    await lease.withLease('session-1', 'job-1', () => {
      expect(lease.isLeased('session-1')).toBe(true);
      return Promise.resolve();
    });

    expect(lease.isLeased('session-1')).toBe(false);
  });

  it('rejects a conflicting lease owner', () => {
    const lease = new SessionLease();
    lease.acquire('session-1', 'job-1');

    expect(() => lease.acquire('session-1', 'job-2')).toThrowError(AppError);
    expect(() => lease.acquire('session-1', 'job-2')).toThrowError(/already leased/i);
  });

  it('allows reacquiring the same lease owner', () => {
    const lease = new SessionLease();
    lease.acquire('session-1', 'job-1');

    expect(() => lease.acquire('session-1', 'job-1')).not.toThrow();
  });
});
