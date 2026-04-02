import { OrchestratorError } from './error';

export function normalizeUnknownError(error: unknown): {
  code: string;
  message: string;
  details?: unknown;
} {
  if (isCodeMessageRecord(error)) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
  }
  if (error instanceof OrchestratorError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
  }
  if (error instanceof Error) {
    return {
      code: 'UNKNOWN_ERROR',
      message: error.message,
    };
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: 'Unknown runtime error',
    details: error,
  };
}

function isCodeMessageRecord(
  value: unknown,
): value is { code: string; message: string; details?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as { code: unknown }).code === 'string' &&
    typeof (value as { message: unknown }).message === 'string'
  );
}
