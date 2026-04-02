import { z } from 'zod';

export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
});

export const ApiFailureSchema = z.object({
  ok: z.literal(false),
  error: ApiErrorSchema,
});

export const successEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    ok: z.literal(true),
    data,
  });
