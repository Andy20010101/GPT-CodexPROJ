import type { SelectorRequirement } from './selectors';

export const SelectorFallbacks: Record<string, readonly string[]> = {
  'composer.input': ['textarea[data-testid="prompt-textarea"]', 'form textarea'],
  'response.messages': ['main [data-message-author-role]', 'article [data-message-author-role]'],
};

export function applySelectorFallbacks(
  requirements: readonly SelectorRequirement[],
): SelectorRequirement[] {
  return requirements.map((requirement) => ({
    ...requirement,
    candidates: [
      ...new Set([...requirement.candidates, ...(SelectorFallbacks[requirement.name] ?? [])]),
    ],
  }));
}
