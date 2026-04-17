import {
  HealthResponseSchema,
  OpenSessionResponseSchema,
  SelectProjectResponseSchema,
} from '@gpt-codexproj/shared-contracts/chatgpt';

type JsonValue = Record<string, unknown>;

async function request(pathname: string, init?: RequestInit): Promise<JsonValue> {
  const baseUrl = process.env.BRIDGE_BASE_URL ?? 'http://127.0.0.1:3100';
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      'content-type': 'application/json',
    },
    ...init,
  });
  const payload = (await response.json()) as JsonValue;
  if (!response.ok) {
    throw new Error(`Bridge smoke request failed for ${pathname}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function main(): Promise<void> {
  if (process.env.ENABLE_REAL_CHATGPT_TESTS !== 'true') {
    console.log('Skipping real bridge smoke harness. Set ENABLE_REAL_CHATGPT_TESTS=true to run.');
    return;
  }

  const browserUrl = process.env.CHATGPT_BROWSER_URL;
  if (!browserUrl) {
    throw new Error('CHATGPT_BROWSER_URL is required for the real bridge smoke harness.');
  }

  const health = HealthResponseSchema.parse(await request('/health'));
  console.log(`Health check passed: ${health.data.service}`);

  const openSession = OpenSessionResponseSchema.parse(
    await request('/api/sessions/open', {
      method: 'POST',
      body: JSON.stringify({
        browserUrl,
        startupUrl: process.env.CHATGPT_STARTUP_URL,
      }),
    }),
  );
  console.log(`Session opened and preflight completed: ${openSession.data.sessionId}`);

  const projectName = process.env.CHATGPT_PROJECT_NAME;
  if (!projectName) {
    console.log('Skipping project selection smoke check because CHATGPT_PROJECT_NAME is unset.');
    return;
  }

  const selectProject = SelectProjectResponseSchema.parse(
    await request('/api/projects/select', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: openSession.data.sessionId,
        projectName,
        ...(process.env.CHATGPT_MODEL ? { model: process.env.CHATGPT_MODEL } : {}),
      }),
    }),
  );
  console.log(`Project selected: ${selectProject.data.projectName}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
