import { ZodError } from 'zod';

import type { BridgeErrorCode } from '@review-then-codex/shared-contracts/chatgpt';

export class AppError extends Error {
  public readonly code: BridgeErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  public constructor(code: BridgeErrorCode, message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof ZodError) {
    return new AppError('VALIDATION_ERROR', 'Request validation failed', 422, error.flatten());
  }

  if (error instanceof Error) {
    return new AppError('INTERNAL_ERROR', error.message, 500);
  }

  return new AppError('INTERNAL_ERROR', 'Unknown bridge failure', 500, error);
}
