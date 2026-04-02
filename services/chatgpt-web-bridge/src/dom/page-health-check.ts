import type { BridgeHealthStatus } from '@review-then-codex/shared-contracts/chatgpt';

import type { SelectorRequirement } from './selectors';

export function evaluatePageHealth(input: {
  url: string;
  loggedOutDetected: boolean;
  missingRequirements?: readonly SelectorRequirement[] | undefined;
  projectAvailable?: boolean | undefined;
  conversationAvailable?: boolean | undefined;
}): {
  status: BridgeHealthStatus;
  issues: string[];
} {
  const issues: string[] = [];

  if (input.loggedOutDetected || input.url.includes('/auth/login')) {
    issues.push('Login prompt or auth redirect detected.');
    return {
      status: 'needs_reauth',
      issues,
    };
  }

  if (input.projectAvailable === false) {
    issues.push('Selected ChatGPT project is unavailable.');
    return {
      status: 'project_unavailable',
      issues,
    };
  }

  if (input.conversationAvailable === false) {
    issues.push('Conversation snapshot is unavailable.');
    return {
      status: 'conversation_unavailable',
      issues,
    };
  }

  if ((input.missingRequirements?.length ?? 0) > 0) {
    issues.push(
      `Missing selector requirements: ${input.missingRequirements
        ?.map((entry) => entry.name)
        .join(', ')}`,
    );
    return {
      status: 'dom_drift_detected',
      issues,
    };
  }

  return {
    status: 'ready',
    issues,
  };
}
