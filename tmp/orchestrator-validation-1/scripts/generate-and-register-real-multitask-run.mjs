import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const planningDir = path.join(repoRoot, 'tmp', 'orchestrator-validation-1', 'planning');

const runId = process.env.RUN_ID;
if (!runId) {
  console.error('RUN_ID is required');
  process.exit(2);
}

const bridgeBaseUrl = process.env.BRIDGE_BASE_URL ?? 'http://127.0.0.1:3100';
const orchestratorBaseUrl = process.env.ORCHESTRATOR_BASE_URL ?? 'http://127.0.0.1:3200';
const browserUrl = process.env.BRIDGE_BROWSER_URL ?? 'http://172.18.144.1:9225';
const projectName = process.env.BRIDGE_PROJECT_NAME ?? 'Default';
const maxWaitMs = Number.parseInt(process.env.BRIDGE_WAIT_MS ?? '420000', 10);
const targetPath = 'tmp/e2e-targets/user-api-validation-1';
const renderScriptPath = path.join(
  repoRoot,
  'tmp',
  'orchestrator-validation-1',
  'scripts',
  'render-user-api-validation.mjs',
);
const skipRegister = process.env.SKIP_REGISTER === 'true';

await fs.mkdir(planningDir, { recursive: true });

const session = await bridgeRequest('/api/sessions/open', {
  method: 'POST',
  body: {
    browserUrl,
    startupUrl: 'https://chatgpt.com/',
  },
});
log(`opened bridge session ${session.sessionId}`);

const requirementPrompt = buildRequirementPrompt(runId);
const requirementStep = await startAndCapture({
  sessionId: session.sessionId,
  projectName,
  prompt: requirementPrompt,
  exportName: `${runId}-requirement-freeze.md`,
  jsonFileName: `${runId}-requirement-freeze.json`,
});

const architectureStep = await sendAndCapture({
  conversationId: requirementStep.conversationId,
  prompt: buildArchitecturePrompt(runId, requirementStep.payload),
  exportName: `${runId}-architecture-freeze.md`,
  jsonFileName: `${runId}-architecture-freeze.json`,
});

const taskGraphStep = await sendAndCapture({
  conversationId: requirementStep.conversationId,
  prompt: buildTaskGraphPrompt(runId, requirementStep.payload, architectureStep.payload, targetPath),
  exportName: `${runId}-task-graph.md`,
  jsonFileName: `${runId}-task-graph.json`,
});

const requirementFreeze = normalizeRequirementFreeze(runId, requirementStep.payload);
const architectureFreeze = normalizeArchitectureFreeze(runId, architectureStep.payload);
const taskGraph = normalizeTaskGraph(runId, taskGraphStep.payload, targetPath, renderScriptPath);

const requirementPath = path.join(planningDir, `${runId}.requirement-freeze.normalized.json`);
const architecturePath = path.join(planningDir, `${runId}.architecture-freeze.normalized.json`);
const taskGraphPath = path.join(planningDir, `${runId}.task-graph.normalized.json`);

await fs.writeFile(requirementPath, `${JSON.stringify(requirementFreeze, null, 2)}\n`, 'utf8');
await fs.writeFile(architecturePath, `${JSON.stringify(architectureFreeze, null, 2)}\n`, 'utf8');
await fs.writeFile(taskGraphPath, `${JSON.stringify(taskGraph, null, 2)}\n`, 'utf8');

let requirementResponse = null;
let architectureResponse = null;
let taskGraphResponse = null;
if (!skipRegister) {
  requirementResponse = await orchestratorRequest(`/api/runs/${runId}/requirement-freeze`, {
    method: 'POST',
    body: requirementFreeze,
  });

  architectureResponse = await orchestratorRequest(`/api/runs/${runId}/architecture-freeze`, {
    method: 'POST',
    body: architectureFreeze,
  });

  taskGraphResponse = await orchestratorRequest(`/api/runs/${runId}/task-graph`, {
    method: 'POST',
    body: taskGraph,
  });
}

process.stdout.write(
  `${JSON.stringify(
    {
      runId,
      sessionId: session.sessionId,
      conversationId: requirementStep.conversationId,
      bridgeArtifacts: {
        requirement: requirementStep.markdownPath,
        architecture: architectureStep.markdownPath,
        taskGraph: taskGraphStep.markdownPath,
      },
      planningArtifacts: {
        requirementPath,
        architecturePath,
        taskGraphPath,
      },
      apiResponses: {
        requirementStage: requirementResponse?.stage ?? null,
        architectureStage: architectureResponse?.stage ?? null,
        taskGraphStage: taskGraphResponse?.stage ?? null,
      },
    },
    null,
    2,
  )}\n`,
);

async function startAndCapture(input) {
  log('starting requirement conversation');
  const snapshot = await bridgeRequest('/api/conversations/start', {
    method: 'POST',
    body: {
      sessionId: input.sessionId,
      projectName: input.projectName,
      prompt: input.prompt,
    },
  });

  return captureConversation({
    conversationId: snapshot.conversationId,
    prompt: input.prompt,
    exportName: input.exportName,
    jsonFileName: input.jsonFileName,
  });
}

async function sendAndCapture(input) {
  log(`sending follow-up prompt to conversation ${input.conversationId}`);
  await bridgeRequest(`/api/conversations/${input.conversationId}/message`, {
    method: 'POST',
    body: {
      message: input.prompt,
    },
  });

  return captureConversation({
    conversationId: input.conversationId,
    prompt: input.prompt,
    exportName: input.exportName,
    jsonFileName: input.jsonFileName,
  });
}

async function captureConversation(input) {
  log(`waiting on conversation ${input.conversationId}`);
  const waited = await bridgeRequest(`/api/conversations/${input.conversationId}/wait`, {
    method: 'POST',
    body: {
      maxWaitMs,
      pollIntervalMs: 2000,
    },
  });

  const exportResult = await bridgeRequest(
    `/api/conversations/${input.conversationId}/export/markdown`,
    {
      method: 'POST',
      body: {
        fileName: input.exportName,
      },
    },
  );
  log(`exported markdown for ${input.conversationId} to ${exportResult.artifactPath}`);

  let payload;
  try {
    payload = parseJsonBlock(waited.lastAssistantMessage ?? exportResult.markdown);
  } catch (error) {
    await bridgeRequest(`/api/conversations/${input.conversationId}/message`, {
      method: 'POST',
      body: {
        message: [
          '上一条回复没有满足结构化 JSON 约束。',
          '请只输出一个 ```json fenced block，内容必须是合法 JSON 对象，不要附加任何其他文字。',
        ].join('\n'),
      },
    });
    const recovered = await bridgeRequest(`/api/conversations/${input.conversationId}/wait`, {
      method: 'POST',
      body: {
        maxWaitMs,
        pollIntervalMs: 2000,
      },
    });
    payload = parseJsonBlock(recovered.lastAssistantMessage ?? exportResult.markdown);
  }

  const outputPath = path.join(planningDir, input.jsonFileName);
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  return {
    conversationId: input.conversationId,
    markdownPath: exportResult.artifactPath,
    markdownManifestPath: exportResult.manifestPath,
    payload,
  };
}

function log(message) {
  process.stderr.write(`[planning] ${message}\n`);
}

function buildRequirementPrompt(runIdValue) {
  return [
    '只输出```json fenced block。返回 Requirement fragment JSON。',
    '字段: title, summary, objectives, nonGoals, constraints, risks, acceptanceCriteria。',
    `runId=${runIdValue}。主题: TypeScript 用户查询 API，内存 mock，TTL 缓存，非法 id/未找到错误，最小日志，测试覆盖成功/未找到/缓存命中。`,
    '内容保持简短。',
  ].join('\n');
}

function buildArchitecturePrompt(runIdValue, requirementFreeze) {
  return [
    '只输出```json fenced block。返回 Architecture fragment JSON。',
    '字段: summary, modules, dependencyRules, invariants。',
    'modules 每项包含 moduleId, name, responsibility, ownedPaths, publicInterfaces, allowedDependencies。',
    'dependencyRules 每项包含 fromModuleId, toModuleId, rule, rationale。',
    `runId=${runIdValue}。只允许 tmp/e2e-targets/user-api-validation-1 下的模块。`,
    '需要覆盖 route, service, repository, cache, logging, tests 的边界。',
    JSON.stringify(requirementFreeze),
  ].join('\n');
}

function buildTaskGraphPrompt(runIdValue, requirementFreeze, architectureFreeze, targetPathValue) {
  return [
    '只输出```json fenced block。返回 TaskGraph fragment JSON。',
    '字段: tasks。',
    'tasks 必须是 4 项，并按顺序使用精确标题：Foundation repository and service / TTL cache layer / HTTP handler and structured errors / Logging and final validation。',
    '每个 task 只需要返回: title, objective, acceptanceCriteria, testPlan, implementationNotes。',
    `所有任务都针对 ${targetPathValue}。`,
    JSON.stringify(requirementFreeze),
    JSON.stringify(architectureFreeze),
  ].join('\n');
}

function normalizeRequirementFreeze(runIdValue, payload) {
  return {
    runId: runIdValue,
    title: typeof payload.title === 'string' ? payload.title : 'Real multi-task validation requirement freeze',
    summary: typeof payload.summary === 'string' ? payload.summary : 'Validate a TypeScript user query API with cache, errors, logging, and tests.',
    objectives: normalizeStringArray(payload.objectives, [
      'Provide GET /user/:id behavior over in-memory mock data.',
      'Add TTL cache behavior with observable cache hits.',
      'Return structured errors for invalid ids and missing users.',
      'Produce real code changes, real patch evidence, and real test results.',
    ]),
    nonGoals: normalizeStringArray(payload.nonGoals, [
      'Do not integrate a real database.',
      'Do not add authentication or unrelated product features.',
    ]),
    constraints: normalizeConstraintArray(payload.constraints),
    risks: normalizeRiskArray(payload.risks),
    acceptanceCriteria: normalizeAcceptanceCriteriaFragment(payload.acceptanceCriteria),
    frozenAt: new Date().toISOString(),
    frozenBy: 'review-plane',
  };
}

function normalizeArchitectureFreeze(runIdValue, payload) {
  return {
    runId: runIdValue,
    summary:
      typeof payload.summary === 'string'
        ? payload.summary
        : 'Architecture fragment for the disposable TypeScript validation target.',
    moduleDefinitions: normalizeModuleDefinitions(payload.modules),
    dependencyRules: normalizeDependencyRuleArray(payload.dependencyRules),
    invariants: normalizeStringArray(payload.invariants, [
      'The in-memory repository remains the source of truth for this validation target.',
      'Caching is implemented outside the repository layer.',
      'HTTP error mapping stays deterministic for invalid and missing ids.',
    ]),
    frozenAt: new Date().toISOString(),
    frozenBy: 'review-plane',
  };
}

function normalizeTaskGraph(runIdValue, payload, targetPathValue, renderScript) {
  const now = new Date().toISOString();
  const rawTasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  const taskCommands = [
    buildTaskCommand(renderScript, 1),
    buildTaskCommand(renderScript, 2),
    buildTaskCommand(renderScript, 3),
    buildTaskCommand(renderScript, 4),
  ];
  const tasks = rawTasks.slice(0, 4).map((task, index) => {
    const taskId = isUuid(task.taskId) ? task.taskId : randomUUID();
    const dependencies = Array.isArray(task.dependencies)
      ? task.dependencies.filter((value) => typeof value === 'string' && isUuid(value))
      : [];

    return {
      ...task,
      taskId,
      runId: runIdValue,
      title: task.title ?? defaultTaskTitle(index),
      objective: task.objective ?? `Execute ${defaultTaskTitle(index)} for the validation target.`,
      executorType: 'command',
      scope: normalizeScope(task.scope, targetPathValue),
      allowedFiles: [normalizeGlob(targetPathValue)],
      disallowedFiles: ['apps/**', 'services/**', 'packages/**'],
      dependencies,
      acceptanceCriteria: normalizeAcceptanceCriteria(task.acceptanceCriteria, index),
      testPlan: normalizeTestPlan(task.testPlan, targetPathValue),
      implementationNotes: Array.isArray(task.implementationNotes)
        ? task.implementationNotes
        : [`Implement ${defaultTaskTitle(index)} inside ${targetPathValue}.`],
      evidenceIds: [],
      metadata: {
        ...(task.metadata && typeof task.metadata === 'object' ? task.metadata : {}),
        command: taskCommands[index],
        validationTarget: targetPathValue,
      },
      status: 'drafted',
      createdAt: task.createdAt ?? now,
      updatedAt: task.updatedAt ?? now,
    };
  });

  const idByIndex = tasks.map((task) => task.taskId);
  for (let index = 1; index < tasks.length; index += 1) {
    if (tasks[index].dependencies.length === 0) {
      tasks[index].dependencies = [idByIndex[index - 1]];
    }
  }

  const edges = tasks.slice(1).map((task, index) => ({
    fromTaskId: tasks[index].taskId,
    toTaskId: task.taskId,
    kind: 'blocks',
  }));

  return {
    runId: runIdValue,
    tasks,
    edges,
    registeredAt: payload.registeredAt ?? now,
  };
}

function buildTaskCommand(renderScript, stageNumber) {
  return {
    command: 'node',
    args: [renderScript, String(stageNumber)],
    shell: false,
    purpose: 'test',
    env: {},
  };
}

function normalizeScope(scope, targetPathValue) {
  return {
    inScope:
      scope && Array.isArray(scope.inScope) && scope.inScope.length > 0
        ? scope.inScope
        : [normalizeGlob(targetPathValue)],
    outOfScope:
      scope && Array.isArray(scope.outOfScope)
        ? scope.outOfScope
        : ['apps/**', 'services/**', 'packages/**'],
  };
}

function normalizeAcceptanceCriteria(criteria, index) {
  if (Array.isArray(criteria) && criteria.length > 0) {
    return criteria.map((item, itemIndex) => ({
      id: typeof item.id === 'string' ? item.id : `task-${index + 1}-ac-${itemIndex + 1}`,
      description:
        typeof item.description === 'string'
          ? item.description
          : `${defaultTaskTitle(index)} must complete with real code and tests.`,
      verificationMethod:
        item.verificationMethod === 'review' ||
        item.verificationMethod === 'manual' ||
        item.verificationMethod === 'artifact'
          ? item.verificationMethod
          : 'automated_test',
      ...(typeof item.measurableOutcome === 'string'
        ? { measurableOutcome: item.measurableOutcome }
        : {}),
      requiredEvidenceKinds: Array.isArray(item.requiredEvidenceKinds)
        ? item.requiredEvidenceKinds
        : ['execution_result', 'review_result'],
    }));
  }

  return [
    {
      id: `task-${index + 1}-ac-1`,
      description: `${defaultTaskTitle(index)} completes with real code changes and passing tests.`,
      verificationMethod: 'automated_test',
      requiredEvidenceKinds: ['execution_result', 'review_result'],
    },
  ];
}

function normalizeAcceptanceCriteriaFragment(value) {
  const criteria = normalizeStringArray(value, [
    'Return user data for a valid existing id.',
    'Return a structured invalid-id error.',
    'Return a structured not-found error.',
    'Show cache hits through real execution evidence and tests.',
  ]);

  return criteria.map((description, index) => ({
    id: `rf-ac-${index + 1}`,
    description,
    verificationMethod: 'automated_test',
    requiredEvidenceKinds: ['execution_result', 'review_result'],
  }));
}

function normalizeConstraintArray(value) {
  return normalizeStringArray(value, [
    'Use TypeScript.',
    'Keep data in memory for this validation target.',
    'Use a TTL cache.',
    'Keep logging minimal and local.',
  ]).map((description, index) => ({
    id: `constraint-${index + 1}`,
    title: `Constraint ${index + 1}`,
    description,
    severity: index < 3 ? 'hard' : 'soft',
  }));
}

function normalizeRiskArray(value) {
  return normalizeStringArray(value, [
    'In-memory cache can become stale.',
    'Mock data may drift from production behavior.',
  ]).map((description, index) => ({
    id: `risk-${index + 1}`,
    title: `Risk ${index + 1}`,
    description,
    severity: index === 0 ? 'medium' : 'low',
  }));
}

function normalizeModuleDefinitions(value) {
  const modules = Array.isArray(value) && value.length > 0 ? value : [];
  if (modules.length > 0 && typeof modules[0] === 'object') {
    return modules.map((module, index) => ({
      moduleId: typeof module.moduleId === 'string' ? module.moduleId : `module-${index + 1}`,
      name: typeof module.name === 'string' ? module.name : `Module ${index + 1}`,
      responsibility:
        typeof module.responsibility === 'string'
          ? module.responsibility
          : `Validation module ${index + 1}`,
      ownedPaths: normalizeStringArray(module.ownedPaths, ['tmp/e2e-targets/user-api-validation-1/src/**']),
      publicInterfaces: normalizeStringArray(module.publicInterfaces, []),
      allowedDependencies: normalizeStringArray(module.allowedDependencies, []),
    }));
  }

  return [
    {
      moduleId: 'http-route',
      name: 'http-route',
      responsibility: 'Map GET /user/:id requests to the user service and HTTP responses.',
      ownedPaths: ['tmp/e2e-targets/user-api-validation-1/src/http.ts', 'tmp/e2e-targets/user-api-validation-1/src/app.ts'],
      publicInterfaces: ['handleGetUserRequest', 'createUserApiApp'],
      allowedDependencies: ['user-service', 'observability'],
    },
    {
      moduleId: 'user-service',
      name: 'user-service',
      responsibility: 'Validate ids, orchestrate repository and cache access, and emit logs.',
      ownedPaths: ['tmp/e2e-targets/user-api-validation-1/src/user-service.ts'],
      publicInterfaces: ['createUserService'],
      allowedDependencies: ['mock-repository', 'ttl-cache', 'observability'],
    },
    {
      moduleId: 'mock-repository',
      name: 'mock-repository',
      responsibility: 'Provide deterministic in-memory user lookup behavior.',
      ownedPaths: ['tmp/e2e-targets/user-api-validation-1/src/user-repository.ts'],
      publicInterfaces: ['createInMemoryUserRepository'],
      allowedDependencies: [],
    },
    {
      moduleId: 'ttl-cache',
      name: 'ttl-cache',
      responsibility: 'Provide a simple in-memory TTL cache for user lookups.',
      ownedPaths: ['tmp/e2e-targets/user-api-validation-1/src/cache.ts'],
      publicInterfaces: ['createUserCache'],
      allowedDependencies: [],
    },
    {
      moduleId: 'observability',
      name: 'observability',
      responsibility: 'Capture minimal structured logs for validation flows.',
      ownedPaths: ['tmp/e2e-targets/user-api-validation-1/src/logger.ts'],
      publicInterfaces: ['MemoryLogger'],
      allowedDependencies: [],
    },
    {
      moduleId: 'tests',
      name: 'tests',
      responsibility: 'Validate repository, cache, handler, and app behavior.',
      ownedPaths: ['tmp/e2e-targets/user-api-validation-1/tests/**'],
      publicInterfaces: [],
      allowedDependencies: ['http-route', 'user-service', 'mock-repository'],
    },
  ];
}

function normalizeDependencyRuleArray(value) {
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
    return value.map((rule) => ({
      fromModuleId: typeof rule.fromModuleId === 'string' ? rule.fromModuleId : 'unknown-from',
      toModuleId: typeof rule.toModuleId === 'string' ? rule.toModuleId : 'unknown-to',
      rule: rule.rule === 'deny' ? 'deny' : 'allow',
      rationale:
        typeof rule.rationale === 'string' ? rule.rationale : 'Normalized architecture dependency rule.',
    }));
  }

  return [
    {
      fromModuleId: 'http-route',
      toModuleId: 'user-service',
      rule: 'allow',
      rationale: 'Route handlers delegate business logic to the service layer.',
    },
    {
      fromModuleId: 'user-service',
      toModuleId: 'mock-repository',
      rule: 'allow',
      rationale: 'The service reads mock data via the repository.',
    },
    {
      fromModuleId: 'user-service',
      toModuleId: 'ttl-cache',
      rule: 'allow',
      rationale: 'The service owns cache reads and cache fills.',
    },
    {
      fromModuleId: 'mock-repository',
      toModuleId: 'ttl-cache',
      rule: 'deny',
      rationale: 'Repository code must stay unaware of caching.',
    },
    {
      fromModuleId: 'tests',
      toModuleId: 'http-route',
      rule: 'allow',
      rationale: 'Tests exercise the route contract.',
    },
  ];
}

function normalizeStringArray(value, fallback) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
  }

  return fallback;
}

function normalizeTestPlan(testPlan, targetPathValue) {
  if (Array.isArray(testPlan) && testPlan.length > 0) {
    return testPlan.map((item, index) => ({
      id: typeof item.id === 'string' ? item.id : `tp-${index + 1}`,
      description:
        typeof item.description === 'string'
          ? item.description
          : 'Run the task validation tests.',
      ...(typeof item.verificationCommand === 'string'
        ? { verificationCommand: item.verificationCommand }
        : {
            verificationCommand: `cd ${targetPathValue} && vitest run`,
          }),
      expectedRedSignal:
        typeof item.expectedRedSignal === 'string' ? item.expectedRedSignal : 'failing test or missing implementation',
      expectedGreenSignal:
        typeof item.expectedGreenSignal === 'string' ? item.expectedGreenSignal : 'all tests pass',
    }));
  }

  return [
    {
      id: 'tp-1',
      description: 'Run the task validation tests.',
      verificationCommand: `cd ${targetPathValue} && vitest run`,
      expectedRedSignal: 'failing test or missing implementation',
      expectedGreenSignal: 'all tests pass',
    },
  ];
}

function defaultTaskTitle(index) {
  return [
    'Foundation repository and service',
    'TTL cache layer',
    'HTTP handler and structured errors',
    'Logging and final validation',
  ][index] ?? `Validation task ${index + 1}`;
}

function normalizeGlob(targetPathValue) {
  return targetPathValue.endsWith('/**') ? targetPathValue : `${targetPathValue}/**`;
}

function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function parseJsonBlock(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Assistant output was empty.');
  }

  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return JSON.parse(objectMatch[0]);
  }

  throw new Error('No JSON block found in assistant output.');
}

async function bridgeRequest(pathname, options) {
  return request(`${bridgeBaseUrl}${pathname}`, options);
}

async function orchestratorRequest(pathname, options) {
  return request(`${orchestratorBaseUrl}${pathname}`, options);
}

async function request(url, options) {
  const target = new URL(url);
  const body = options.body ? JSON.stringify(options.body) : undefined;
  const timeoutMs = resolveTimeoutMs(options.body);

  const payload = await new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request(
      target,
      {
        method: options.method,
        headers: {
          'content-type': 'application/json',
          ...(body ? { 'content-length': Buffer.byteLength(body).toString() } : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({
              ok: (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300,
              status: response.statusCode ?? 500,
              body: raw.length > 0 ? JSON.parse(raw) : null,
            });
          } catch (error) {
            reject(
              new Error(
                `${url} returned invalid JSON: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              ),
            );
          }
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`request timed out after ${timeoutMs}ms`));
    });
    request.on('error', reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });

  if (!payload.ok) {
    throw new Error(`${url} failed: ${JSON.stringify(payload.body)}`);
  }
  return payload.body.data;
}

function resolveTimeoutMs(body) {
  if (body && typeof body === 'object' && 'maxWaitMs' in body) {
    const maxWaitMs = body.maxWaitMs;
    if (typeof maxWaitMs === 'number' && Number.isFinite(maxWaitMs) && maxWaitMs > 0) {
      return maxWaitMs + 30000;
    }
  }

  return 60000;
}
