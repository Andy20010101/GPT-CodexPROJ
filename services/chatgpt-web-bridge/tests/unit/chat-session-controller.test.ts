import { describe, expect, it, vi } from 'vitest';

import type { SessionSummary } from '@gpt-codexproj/shared-contracts/chatgpt';

import { ChatSessionController } from '../../src/services/chat-session-controller';

describe('ChatSessionController', () => {
  it('skips model switching when the current session model already matches', async () => {
    const page = {
      url: vi.fn(() => 'https://chatgpt.com/c/existing'),
    };
    const controller = new ChatSessionController();
    const switchModel = vi.spyOn(controller, 'switchModel').mockResolvedValue(undefined);
    const detectCurrentModel = vi.spyOn(controller, 'detectCurrentModel').mockResolvedValue(null);

    const session: SessionSummary = {
      sessionId: 'session-1',
      browserUrl: 'http://127.0.0.1:9667',
      pageUrl: 'https://chatgpt.com/c/existing',
      connectedAt: new Date().toISOString(),
      model: 'pro',
    };

    const result = await controller.selectProject({
      page: page as never,
      session,
      projectName: 'Default',
      model: 'pro',
    });

    expect(detectCurrentModel).toHaveBeenCalledWith(page);
    expect(switchModel).not.toHaveBeenCalled();
    expect(result.model).toBe('pro');
    expect(result.projectName).toBe('current-session');
  });

  it('skips model switching when the current page already shows the requested model', async () => {
    const page = {
      url: vi.fn(() => 'https://chatgpt.com/c/existing'),
    };
    const controller = new ChatSessionController();
    const switchModel = vi.spyOn(controller, 'switchModel').mockResolvedValue(undefined);
    vi.spyOn(controller, 'detectCurrentModel').mockResolvedValue('GPT-5 Pro');

    const session: SessionSummary = {
      sessionId: 'session-1',
      browserUrl: 'http://127.0.0.1:9667',
      pageUrl: 'https://chatgpt.com/c/existing',
      connectedAt: new Date().toISOString(),
    };

    const result = await controller.selectProject({
      page: page as never,
      session,
      projectName: 'Default',
      model: 'pro',
    });

    expect(switchModel).not.toHaveBeenCalled();
    expect(result.model).toBe('pro');
    expect(result.projectName).toBe('current-session');
  });

  it('switches model when the current page model does not match', async () => {
    const page = {
      url: vi.fn(() => 'https://chatgpt.com/c/existing'),
    };
    const controller = new ChatSessionController();
    const switchModel = vi.spyOn(controller, 'switchModel').mockResolvedValue(undefined);
    vi.spyOn(controller, 'detectCurrentModel').mockResolvedValue('GPT-4o');

    const session: SessionSummary = {
      sessionId: 'session-1',
      browserUrl: 'http://127.0.0.1:9667',
      pageUrl: 'https://chatgpt.com/c/existing',
      connectedAt: new Date().toISOString(),
    };

    const result = await controller.selectProject({
      page: page as never,
      session,
      projectName: 'Default',
      model: 'pro',
    });

    expect(switchModel).toHaveBeenCalledWith(page, 'pro');
    expect(result.model).toBe('pro');
    expect(result.projectName).toBe('current-session');
  });

  it('skips sidebar project selection when the requested project is already bound to the current page', async () => {
    const page = {
      url: vi.fn(() => 'https://chatgpt.com/g/alpha-project'),
      evaluate: vi.fn(async () => {
        throw new Error('sidebar click should be skipped');
      }),
    };
    const controller = new ChatSessionController();
    const ensureRequestedModel = vi
      .spyOn(controller, 'ensureRequestedModel')
      .mockResolvedValue('pro');

    const session: SessionSummary = {
      sessionId: 'session-1',
      browserUrl: 'http://127.0.0.1:9224',
      pageUrl: 'https://chatgpt.com/g/alpha-project',
      connectedAt: new Date().toISOString(),
      projectName: 'Alpha Project',
      model: 'pro',
    };

    const result = await controller.selectProject({
      page: page as never,
      session,
      projectName: 'Alpha Project',
      model: 'pro',
    });

    expect(ensureRequestedModel).toHaveBeenCalledWith(page, session, 'pro');
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(result.projectName).toBe('Alpha Project');
    expect(result.pageUrl).toBe('https://chatgpt.com/g/alpha-project');
  });

  it('re-selects the project when the session project matches but the current page drifted away', async () => {
    const page = {
      url: vi.fn(() => 'https://chatgpt.com/c/existing'),
      evaluate: vi.fn(async () => true),
      waitForNetworkIdle: vi.fn(async () => undefined),
    };
    const controller = new ChatSessionController();
    const ensureRequestedModel = vi
      .spyOn(controller, 'ensureRequestedModel')
      .mockResolvedValue('pro');

    const session: SessionSummary = {
      sessionId: 'session-1',
      browserUrl: 'http://127.0.0.1:9224',
      pageUrl: 'https://chatgpt.com/g/alpha-project',
      connectedAt: new Date().toISOString(),
      projectName: 'Alpha Project',
      model: 'pro',
    };

    const result = await controller.selectProject({
      page: page as never,
      session,
      projectName: 'Alpha Project',
      model: 'pro',
    });

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.waitForNetworkIdle).toHaveBeenCalledTimes(1);
    expect(ensureRequestedModel).toHaveBeenCalledWith(page, session, 'pro');
    expect(result.projectName).toBe('Alpha Project');
  });
});
