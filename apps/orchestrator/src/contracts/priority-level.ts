import { z } from 'zod';

export const PriorityLevelSchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type PriorityLevel = z.infer<typeof PriorityLevelSchema>;
