import { RemediationActionSchema, type RemediationAction } from '../contracts';

export function normalizeRemediationActions(
  actions: readonly RemediationAction[],
): RemediationAction[] {
  const seen = new Set<string>();
  const normalized: RemediationAction[] = [];

  for (const action of actions) {
    const parsed = RemediationActionSchema.parse(action);
    const key = `${parsed.kind}:${parsed.summary}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(parsed);
  }

  return normalized;
}
