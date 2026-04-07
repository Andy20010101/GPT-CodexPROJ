import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const runId = process.env.RUN_ID;
if (!runId) {
  console.error('RUN_ID is required');
  process.exit(2);
}

process.env.ORCHESTRATOR_ARTIFACT_DIR =
  process.env.ORCHESTRATOR_ARTIFACT_DIR ??
  path.join(repoRoot, 'tmp', 'orchestrator-validation-1', 'artifacts');

const { createOrchestratorRuntimeBundle } = await import(
  path.join(repoRoot, 'apps', 'orchestrator', 'src', 'index.ts')
);

const planningDir = path.join(repoRoot, 'tmp', 'orchestrator-validation-1', 'planning');
const requirementFreeze = JSON.parse(
  await fs.readFile(path.join(planningDir, `${runId}.requirement-freeze.normalized.json`), 'utf8'),
);
const architectureFreeze = JSON.parse(
  await fs.readFile(path.join(planningDir, `${runId}.architecture-freeze.normalized.json`), 'utf8'),
);
const taskGraph = JSON.parse(
  await fs.readFile(path.join(planningDir, `${runId}.task-graph.normalized.json`), 'utf8'),
);

const bundle = createOrchestratorRuntimeBundle();
const requirementRun = await bundle.orchestratorService.saveRequirementFreeze(runId, requirementFreeze);
const architectureRun = await bundle.orchestratorService.saveArchitectureFreeze(runId, architectureFreeze);
const taskGraphRun = await bundle.orchestratorService.registerTaskGraph(runId, taskGraph);
const runtimeState = await bundle.workflowRuntimeService.enqueueRunnableTasks(runId);

process.stdout.write(
  `${JSON.stringify(
    {
      runId,
      requirementStage: requirementRun.stage,
      architectureStage: architectureRun.stage,
      taskGraphStage: taskGraphRun.stage,
      runtimeState,
    },
    null,
    2,
  )}\n`,
);
