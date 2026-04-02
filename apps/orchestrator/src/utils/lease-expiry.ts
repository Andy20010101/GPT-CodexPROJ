export function calculateLeaseExpiry(acquiredAt: string, leaseTtlMs: number): string {
  return new Date(new Date(acquiredAt).getTime() + leaseTtlMs).toISOString();
}

export function isLeaseExpired(expiresAt: string, now: Date = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}
