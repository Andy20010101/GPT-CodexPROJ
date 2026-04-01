import { z } from 'zod';

export const ModuleDefinitionSchema = z.object({
  moduleId: z.string().min(1),
  name: z.string().min(1),
  responsibility: z.string().min(1),
  ownedPaths: z.array(z.string().min(1)).min(1),
  publicInterfaces: z.array(z.string().min(1)).default([]),
  allowedDependencies: z.array(z.string().min(1)).default([]),
});

export type ModuleDefinition = z.infer<typeof ModuleDefinitionSchema>;

export const DependencyRuleSchema = z.object({
  fromModuleId: z.string().min(1),
  toModuleId: z.string().min(1),
  rule: z.enum(['allow', 'deny']),
  rationale: z.string().min(1),
});

export type DependencyRule = z.infer<typeof DependencyRuleSchema>;

export const ArchitectureFreezeSchema = z.object({
  runId: z.string().uuid(),
  summary: z.string().min(1),
  moduleDefinitions: z.array(ModuleDefinitionSchema).min(1),
  dependencyRules: z.array(DependencyRuleSchema).min(1),
  invariants: z.array(z.string().min(1)).default([]),
  frozenAt: z.string().datetime(),
  frozenBy: z.string().min(1),
});

export type ArchitectureFreeze = z.infer<typeof ArchitectureFreezeSchema>;
