export type SelectorRequirement = {
  readonly name: string;
  readonly candidates: readonly string[];
};

export const ChatGPTSelectors = {
  auth: {
    loggedOutMarkers: ['a[href*="/auth/login"]', 'button[data-testid="login-button"]'] as const,
  },
  navigation: {
    sidebarProjectLinks: [
      'nav a[href*="/g/"]',
      'aside a[href*="/g/"]',
      '[data-testid="project-list"] a',
    ] as const,
  },
  composer: {
    input: ['#prompt-textarea', 'textarea[placeholder*="Message"]'] as const,
    sendButton: ['[data-testid="send-button"]', 'button[aria-label="Send prompt"]'] as const,
    stopButton: ['[data-testid="stop-button"]'] as const,
    addFileButton: [
      '[data-testid="composer-plus-btn"]',
      'button[aria-label*="Add files"]',
    ] as const,
    fileInput: ['input[type="file"]'] as const,
  },
  model: {
    trigger: [
      '[data-testid="model-switcher-dropdown-button"]',
      '[data-testid="model-switcher-popover-button"]',
    ] as const,
    options: ['[role="menuitem"]', '[role="option"]', '[cmdk-item]'] as const,
  },
  response: {
    messages: ['[data-message-author-role]'] as const,
    assistantMessages: ['[data-message-author-role="assistant"]'] as const,
    markdownBlocks: ['.markdown'] as const,
  },
} as const;

export const ChatGPTReadyRequirements: readonly SelectorRequirement[] = [
  {
    name: 'composer.input',
    candidates: ChatGPTSelectors.composer.input,
  },
  {
    name: 'response.messages',
    candidates: ChatGPTSelectors.response.messages,
  },
];
