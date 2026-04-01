import { AppError } from '../types/error';

export class SessionLease {
  private readonly leases = new Map<string, string>();

  public acquire(sessionId: string, ownerId: string): void {
    const existingOwner = this.leases.get(sessionId);
    if (existingOwner && existingOwner !== ownerId) {
      throw new AppError('SESSION_LEASE_CONFLICT', 'Session is already leased', 409, {
        sessionId,
        ownerId,
        existingOwner,
      });
    }

    this.leases.set(sessionId, ownerId);
  }

  public release(sessionId: string, ownerId: string): void {
    const existingOwner = this.leases.get(sessionId);
    if (existingOwner === ownerId) {
      this.leases.delete(sessionId);
    }
  }

  public isLeased(sessionId: string): boolean {
    return this.leases.has(sessionId);
  }

  public async withLease<T>(
    sessionId: string,
    ownerId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    this.acquire(sessionId, ownerId);
    try {
      return await action();
    } finally {
      this.release(sessionId, ownerId);
    }
  }
}
