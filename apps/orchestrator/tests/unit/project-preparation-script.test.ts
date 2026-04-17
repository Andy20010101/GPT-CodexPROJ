import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

type PreparationPaths = {
  rootDir: string;
  packetDir: string;
  processDir: string;
  exportsDir: string;
  handoffsDir: string;
  historyDir: string;
  readmePath: string;
};

type ProjectPreparationTestUtils = {
  parseArgs: (argv: string[]) => unknown;
  parseQuestionTable: (
    content: string,
    sectionTitle: 'Open' | 'Deferred' | 'Resolved',
    status: string,
  ) => Array<Record<string, unknown>>;
  parseTradeoffBlocks: (content: string) => Array<Record<string, unknown>>;
  parseDecisionBlocks: (content: string) => Array<Record<string, unknown>>;
  parseOptionBlocks: (content: string) => Array<Record<string, unknown>>;
  buildConvergenceReport: (...args: unknown[]) => string;
  getPreparationPaths: (slug: string) => PreparationPaths;
  runCliForTest: (argv: string[]) => Promise<void>;
  runCliWithCapturedOutput: (argv: string[]) => Promise<string>;
};

const tsxApi: {
  require: (id: string, fromFile: string | URL) => unknown;
} = require('tsx/cjs/api');
const projectPreparationModule = tsxApi.require(
  '../../../../scripts/project-preparation.ts',
  __filename,
) as {
  __testUtils: ProjectPreparationTestUtils;
};
const { __testUtils } = projectPreparationModule;

const tempSlugs = new Set<string>();

afterEach(async () => {
  for (const slug of tempSlugs) {
    const paths = __testUtils.getPreparationPaths(slug);
    await fs.rm(paths.rootDir, { recursive: true, force: true });
  }
  tempSlugs.clear();
});

function createTempSlug(suffix: string): string {
  const slug = `prep-cli-test-${suffix}-${Date.now()}`;
  tempSlugs.add(slug);
  return slug;
}

const readyPacketContents: Record<string, string> = {
  'PROJECT_BRIEF.md': '# Project Brief\n\n## One-Sentence Definition\nA bounded preparation CLI.\n\n## Primary Actor\nPreparation operator.\n\n## Core Problem\nNeed process-first preparation.\n\n## Primary Flow\nFreeze then hand off.\n\n## Why This Matters Now\nTo stabilize project intake.\n',
  'MVP_SCOPE.md': '# MVP Scope\n\n## Core Deliverable\nA complete preparation CLI.\n\n## In Scope\n- process ledgers\n- packet export\n\n## Scope Notes\nKeep it bounded.\n\n## Why This Scope Is Enough\nIt covers the main flow.\n',
  'NON_GOALS.md': '# Non-Goals\n\n## Explicitly Out of Scope\n- distributed runtime\n\n## Not Now\n- cloud execution\n\n## Why These Are Deferred\nThey are outside the bounded CLI scope.\n',
  'SUCCESS_CRITERIA.md': '# Success Criteria\n\n## Success Definition\nPreparation can freeze and export safely.\n\n## Required Evidence\n- packet export\n- handoff snapshot\n\n## Failure Conditions\n- unresolved blockers leak into packet\n\n## Notes\nManual checkpoints remain required.\n',
  'ARCHITECTURE_BOUNDARY.md': '# Architecture Boundary\n\n## Allowed Surfaces\n- preparation docs\n- preparation CLI\n\n## Protected Surfaces\n- runtime orchestration semantics\n\n## Danger Zones\n- acceptance semantics\n\n## Boundary Rationale\nKeep this bounded to preparation.\n',
  'INITIAL_WORKSTREAMS.md': '# Initial Workstreams\n\n## Workstream 1\n- Goal: scaffold preparation\n- Boundary: process side only\n- Dependencies: none\n- Why It Exists: establish the workflow\n\n## Workstream 2\n- Goal: publish exports\n- Boundary: packet side only\n- Dependencies: workstream 1\n- Why It Exists: enable downstream handoff\n',
  'RISKS_AND_ASSUMPTIONS.md': '# Risks And Assumptions\n\n## Risks\n- tests may miss some CLI drift\n\n## Assumptions\n- human checkpoints stay explicit\n\n## Non-Blocking Unknowns\n- richer UX can come later\n',
};

type QuestionStageState = {
  stages: Array<{ stageId: string; blockingQuestionIds: string[] }>;
  readyForPacketExport?: boolean;
};

async function seedReadyPacket(paths: PreparationPaths) {
  for (const [file, content] of Object.entries(readyPacketContents)) {
    await fs.writeFile(path.join(paths.packetDir, file), content, 'utf8');
  }
}

async function approveBaselineFreezePath(slug: string) {
  await __testUtils.runCliForTest([
    'checkpoint',
    'open',
    '--slug',
    slug,
    '--stage',
    'direction_decision',
    '--type',
    'direction',
    '--summary',
    'direction ready',
  ]);
  await __testUtils.runCliForTest(['checkpoint', 'approve', '--slug', slug, '--id', 'c_001']);
  await __testUtils.runCliForTest([
    'checkpoint',
    'open',
    '--slug',
    slug,
    '--stage',
    'scope_freeze',
    '--type',
    'scope',
    '--summary',
    'scope ready',
  ]);
  await __testUtils.runCliForTest(['checkpoint', 'approve', '--slug', slug, '--id', 'c_002']);
  await __testUtils.runCliForTest([
    'checkpoint',
    'open',
    '--slug',
    slug,
    '--stage',
    'boundary_freeze',
    '--type',
    'boundary',
    '--summary',
    'boundary ready',
  ]);
  await __testUtils.runCliForTest(['checkpoint', 'approve', '--slug', slug, '--id', 'c_003']);
  await __testUtils.runCliForTest([
    'checkpoint',
    'open',
    '--slug',
    slug,
    '--stage',
    'success_evidence_freeze',
    '--type',
    'success_evidence',
    '--summary',
    'success ready',
  ]);
  await __testUtils.runCliForTest(['checkpoint', 'approve', '--slug', slug, '--id', 'c_004']);
  await __testUtils.runCliForTest([
    'advance',
    '--slug',
    slug,
    '--stage',
    'workstream_shaping',
    '--status',
    'completed',
  ]);
}

async function approveConvergenceAndExport(slug: string) {
  await __testUtils.runCliForTest(['check', 'convergence', '--slug', slug]);
  await __testUtils.runCliForTest([
    'checkpoint',
    'open',
    '--slug',
    slug,
    '--stage',
    'convergence_gate',
    '--type',
    'convergence',
    '--summary',
    'convergence pass',
  ]);
  await __testUtils.runCliForTest(['checkpoint', 'approve', '--slug', slug, '--id', 'c_005']);
  await __testUtils.runCliForTest([
    'checkpoint',
    'open',
    '--slug',
    slug,
    '--stage',
    'packet_export',
    '--type',
    'packet_export',
    '--summary',
    'export ready',
  ]);
  await __testUtils.runCliForTest(['checkpoint', 'approve', '--slug', slug, '--id', 'c_006']);
}

describe('project-preparation parseArgs', () => {
  it('parses question add commands', () => {
    const parsed = __testUtils.parseArgs([
      'question',
      'add',
      '--slug',
      'demo-project',
      '--stage',
      'clarification',
      '--question',
      'Who is the primary operator?',
      '--category',
      'user',
      '--impact',
      'blocking',
      '--owner',
      'human',
      '--note',
      'Needed before scope freeze.',
    ]);

    expect(parsed).toEqual({
      command: 'question-add',
      slug: 'demo-project',
      stage: 'clarification',
      question: 'Who is the primary operator?',
      category: 'user',
      impact: 'blocking',
      owner: 'human',
      note: 'Needed before scope freeze.',
    });
  });

  it('parses packet refresh commands', () => {
    const parsed = __testUtils.parseArgs([
      'packet',
      'refresh',
      '--slug',
      'demo-project',
      '--note',
      'scope changed after checkpoint correction',
    ]);

    expect(parsed).toEqual({
      command: 'packet-refresh',
      slug: 'demo-project',
      note: 'scope changed after checkpoint correction',
    });
  });

  it('parses handoff subcommands separately from handoff generation', () => {
    const generated = __testUtils.parseArgs(['handoff', '--slug', 'demo-project']);
    const shown = __testUtils.parseArgs(['handoff', 'show', '--slug', 'demo-project']);

    expect(generated).toEqual({
      command: 'handoff',
      slug: 'demo-project',
    });
    expect(shown).toEqual({
      command: 'handoff-show',
      slug: 'demo-project',
    });
  });

  it('requires export id for exported packet diffs', () => {
    expect(() =>
      __testUtils.parseArgs(['diff', 'exported-packet', '--slug', 'demo-project']),
    ).toThrow('diff exported-packet requires --export-id');
  });
});

describe('project-preparation markdown parsers', () => {
  it('parses open questions by status section', () => {
    const content = `# Open Questions

## Open
| ID | Stage | Question | Category | Impact | Owner | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| q_001 | clarification | Who is the operator? | user | blocking | human | unresolved |

## Deferred
| ID | Stage | Question | Why Deferred | Revisit At |
| --- | --- | --- | --- | --- |
| q_002 | brainstorm | Do we need multi-tenant later? | later concern | next release |

## Resolved
| ID | Stage | Question | Resolution Summary | Resolved At |
| --- | --- | --- | --- | --- |
| q_003 | scope_freeze | Is MVP desktop only? | yes | 2026-04-14T00:00:00Z |
`;

    expect(__testUtils.parseQuestionTable(content, 'Open', 'open')).toEqual([
      {
        id: 'q_001',
        stageId: 'clarification',
        question: 'Who is the operator?',
        category: 'user',
        impact: 'blocking',
        owner: 'human',
        notes: 'unresolved',
        status: 'open',
      },
    ]);
    expect(__testUtils.parseQuestionTable(content, 'Deferred', 'deferred')[0]).toMatchObject({
      id: 'q_002',
      stageId: 'brainstorm',
      status: 'deferred',
      revisitAt: 'next release',
    });
    expect(__testUtils.parseQuestionTable(content, 'Resolved', 'resolved')[0]).toMatchObject({
      id: 'q_003',
      stageId: 'scope_freeze',
      resolutionSummary: 'yes',
      status: 'resolved',
    });
  });

  it('parses tradeoff blocks and infers section status', () => {
    const content = `# Tradeoff Ledger

## Active Tradeoffs

### t_001 Core Value
- Stage: brainstorm
- Pressure Question: If we keep only one value, what is it?
- Must Keep:
  - export-bound handoff
- Can Drop:
  - automatic retries
- Not Now:
  - multi-host support
- Boundary Implication:
  - stay in preparation layer
- Failure Implication:
  - downstream chat cannot resume
- Current Leaning:
  - keep handoff discipline
- Still Unresolved:
  - success evidence wording
- Linked Decisions:
  - d_001

## Converged Tradeoffs

### t_002 Scope Pressure
- Stage: brainstorm
- Pressure Question: What gets cut first?
- Status: converged
- Must Keep:
  - single primary flow
- Can Drop:
  - optional reporting
- Not Now:
  - mobile support
- Boundary Implication:
  - keep MVP narrow
- Failure Implication:
  - scope creep
- Current Leaning:
  - cut reporting
- Still Unresolved:
  - none
- Linked Decisions:
  - d_002
`;

    const parsed = __testUtils.parseTradeoffBlocks(content);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      id: 't_001',
      stageId: 'brainstorm',
      status: 'active',
    });
    expect(parsed[1]).toMatchObject({
      id: 't_002',
      status: 'converged',
      linkedDecisionIds: ['d_002'],
    });
  });

  it('parses decision and option blocks', () => {
    const decisions = __testUtils.parseDecisionBlocks(`# Decision Log

## Approved Decisions

### d_001 Direction Decision
- Stage: direction_decision
- Status: approved
- Decision:
  - use process-first preparation
- Rationale:
  - packet is export, not the workflow
- Linked Questions:
  - q_001
- Linked Tradeoffs:
  - t_001
- Affects Packet Files:
  - PROJECT_BRIEF.md
- Approved By: human
- Approved At: 2026-04-14T00:00:00Z
- Rejection Reason: null
- Checkpoint Id: c_001
`);

    const options = __testUtils.parseOptionBlocks(`# Option Set

## Selected Options

### o_001 Single-Flow First
- Stage: brainstorm
- Summary: keep one primary flow
- Advantages:
  - simpler packet
- Tradeoffs:
  - less flexibility
- Risks:
  - later expansion needed
- Fit Summary:
  - best fit for bounded MVP
- Status: selected
- Selection Reason: keeps scope controlled
- Rejection Reason: null
`);

    expect(decisions[0]).toMatchObject({
      id: 'd_001',
      status: 'approved',
      checkpointId: 'c_001',
    });
    expect(options[0]).toMatchObject({
      id: 'o_001',
      status: 'selected',
      selectionReason: 'keeps scope controlled',
    });
  });
});

describe('project-preparation convergence report builder', () => {
  it('renders failed conditions and fallback stage', () => {
    const report = __testUtils.buildConvergenceReport({
      reportId: 'cr_001',
      result: 'fail',
      generatedAt: '2026-04-14T00:00:00.000Z',
      checklist: [
        {
          label: 'Project goal is singular',
          passed: true,
          fallbackStage: 'clarification',
          reason: 'ok',
        },
        {
          label: 'Scope is frozen',
          passed: false,
          fallbackStage: 'scope_freeze',
          reason: 'Scope freeze is incomplete.',
        },
      ],
      blockingQuestions: [
        {
          id: 'q_001',
          stageId: 'scope_freeze',
          question: 'What is explicitly out of scope?',
        },
      ],
      carryableRisks: ['none recorded'],
      fallbackStage: 'scope_freeze',
    });

    expect(report).toContain('- Report ID: cr_001');
    expect(report).toContain('- Result: fail');
    expect(report).toContain('- Scope is frozen: fail');
    expect(report).toContain('- q_001: What is explicitly out of scope?');
    expect(report).toContain('## Fallback Stage');
    expect(report).toContain('- scope_freeze');
  });
});

describe('project-preparation file behavior', () => {
  it('initializes a canonical preparation workspace', async () => {
    const slug = createTempSlug('init');
    const paths = __testUtils.getPreparationPaths(slug);

    await __testUtils.runCliForTest(['init', '--slug', slug]);

    await expect(fs.stat(paths.processDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(fs.stat(paths.packetDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(fs.stat(path.join(paths.processDir, 'PREPARATION_STATE.json'))).resolves.toMatchObject({
      isFile: expect.any(Function),
    });
    await expect(fs.stat(path.join(paths.packetDir, 'PROJECT_BRIEF.md'))).resolves.toMatchObject({
      isFile: expect.any(Function),
    });
  });

  it('writes question ledger updates and resolves blocking state', async () => {
    const slug = createTempSlug('question');
    const paths = __testUtils.getPreparationPaths(slug);

    await __testUtils.runCliForTest(['init', '--slug', slug]);
    await __testUtils.runCliForTest([
      'question',
      'add',
      '--slug',
      slug,
      '--stage',
      'clarification',
      '--question',
      'Who is the primary operator?',
      '--category',
      'user',
      '--impact',
      'blocking',
      '--owner',
      'human',
      '--note',
      'Needed before scope freeze.',
    ]);

    let state = JSON.parse(
      await fs.readFile(path.join(paths.processDir, 'PREPARATION_STATE.json'), 'utf8'),
    ) as QuestionStageState;
    expect(
      state.stages.find((stage) => stage.stageId === 'clarification')?.blockingQuestionIds,
    ).toEqual(['q_001']);
    expect(state.readyForPacketExport).toBe(false);

    const openQuestions = await fs.readFile(path.join(paths.processDir, 'OPEN_QUESTIONS.md'), 'utf8');
    expect(openQuestions).toContain('| q_001 | clarification | Who is the primary operator? |');

    await __testUtils.runCliForTest([
      'question',
      'resolve',
      '--slug',
      slug,
      '--id',
      'q_001',
      '--note',
      'Primary operator is the preparation owner.',
    ]);

    state = JSON.parse(
      await fs.readFile(path.join(paths.processDir, 'PREPARATION_STATE.json'), 'utf8'),
    ) as QuestionStageState;
    expect(
      state.stages.find((stage) => stage.stageId === 'clarification')?.blockingQuestionIds,
    ).toEqual([]);
    const resolvedQuestions = await fs.readFile(
      path.join(paths.processDir, 'OPEN_QUESTIONS.md'),
      'utf8',
    );
    expect(resolvedQuestions).toContain(
      '| q_001 | clarification | Who is the primary operator? | user | blocking | human | Primary operator is the preparation owner. |',
    );
  });

  it('opens, approves, generates, and consumes a handoff snapshot', async () => {
    const slug = createTempSlug('handoff');
    const paths = __testUtils.getPreparationPaths(slug);

    await __testUtils.runCliForTest(['init', '--slug', slug]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'open',
      '--slug',
      slug,
      '--stage',
      'direction_decision',
      '--type',
      'direction',
      '--summary',
      'Freeze the direction around process-first preparation.',
      '--decisions',
      'd_001',
    ]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'approve',
      '--slug',
      slug,
      '--id',
      'c_001',
      '--note',
      'direction approved',
    ]);
    await __testUtils.runCliForTest(['handoff', '--slug', slug]);

    const stateAfterHandoff = JSON.parse(
      await fs.readFile(path.join(paths.processDir, 'PREPARATION_STATE.json'), 'utf8'),
    ) as { latestHandoffId: string | null };
    expect(stateAfterHandoff.latestHandoffId).toBe('handoff-001');
    await expect(fs.stat(path.join(paths.handoffsDir, 'handoff-001.md'))).resolves.toMatchObject({
      isFile: expect.any(Function),
    });
    await expect(fs.stat(path.join(paths.handoffsDir, 'handoff-001.json'))).resolves.toMatchObject({
      isFile: expect.any(Function),
    });

    await __testUtils.runCliForTest([
      'handoff',
      'consume',
      '--slug',
      slug,
      '--note',
      'used by downstream planning',
    ]);

    const handoffMeta = JSON.parse(
      await fs.readFile(path.join(paths.handoffsDir, 'handoff-001.json'), 'utf8'),
    ) as { status: string; consumeNote: string | null };
    expect(handoffMeta.status).toBe('consumed');
    expect(handoffMeta.consumeNote).toBe('used by downstream planning');
  });

  it('publishes versioned packet exports, refreshes them, and reports diffs', async () => {
    const slug = createTempSlug('export');
    const paths = __testUtils.getPreparationPaths(slug);

    await __testUtils.runCliForTest(['init', '--slug', slug]);
    await seedReadyPacket(paths);
    await approveBaselineFreezePath(slug);
    await approveConvergenceAndExport(slug);

    await __testUtils.runCliForTest(['export', 'packet', '--slug', slug, '--note', 'initial export']);

    const exportStatus1 = JSON.parse(
      await fs.readFile(path.join(paths.processDir, 'PACKET_EXPORT_STATUS.json'), 'utf8'),
    ) as { latestExportId: string; status: string };
    expect(exportStatus1.latestExportId).toBe('export-001');
    expect(exportStatus1.status).toBe('exported');
    await expect(fs.stat(path.join(paths.exportsDir, 'export-001', 'PROJECT_BRIEF.md'))).resolves.toMatchObject({
      isFile: expect.any(Function),
    });

    await fs.writeFile(
      path.join(paths.packetDir, 'MVP_SCOPE.md'),
      readyPacketContents['MVP_SCOPE.md']!.replace(
        'A complete preparation CLI.',
        'A refreshed preparation CLI.',
      ),
      'utf8',
    );
    await __testUtils.runCliForTest(['packet', 'refresh', '--slug', slug, '--note', 'scope wording updated']);

    const exportStatus2 = JSON.parse(
      await fs.readFile(path.join(paths.processDir, 'PACKET_EXPORT_STATUS.json'), 'utf8'),
    ) as { latestExportId: string };
    expect(exportStatus2.latestExportId).toBe('export-002');
    await expect(fs.stat(path.join(paths.exportsDir, 'export-002', 'MVP_SCOPE.md'))).resolves.toMatchObject({
      isFile: expect.any(Function),
    });

    const diffOutput = await __testUtils.runCliWithCapturedOutput([
      'diff',
      'exported-packet',
      '--slug',
      slug,
      '--export-id',
      'export-001',
    ]);
    expect(diffOutput).toContain('Diff export: export-001');
    expect(diffOutput).toContain('- MVP_SCOPE.md: changed');
    expect(diffOutput).toContain('- PROJECT_BRIEF.md: same');
  });

  it('rejects checkpoints with rollback and updates stage state/history surfaces', async () => {
    const slug = createTempSlug('rollback');
    const paths = __testUtils.getPreparationPaths(slug);

    await __testUtils.runCliForTest(['init', '--slug', slug]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'open',
      '--slug',
      slug,
      '--stage',
      'scope_freeze',
      '--type',
      'scope',
      '--summary',
      'scope proposal pending',
      '--rollback-target',
      'brainstorm',
    ]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'reject',
      '--slug',
      slug,
      '--id',
      'c_001',
      '--rollback-target',
      'brainstorm',
      '--note',
      'scope is still too broad',
    ]);

    const state = JSON.parse(
      await fs.readFile(path.join(paths.processDir, 'PREPARATION_STATE.json'), 'utf8'),
    ) as {
      currentStageId: string;
      nextStageId: string;
      readyForPacketExport: boolean;
      stages: Array<{ stageId: string; status: string }>;
    };
    expect(state.currentStageId).toBe('brainstorm');
    expect(state.nextStageId).toBe('brainstorm');
    expect(state.readyForPacketExport).toBe(false);
    expect(state.stages.find((stage) => stage.stageId === 'scope_freeze')?.status).toBe('rolled_back');
    expect(state.stages.find((stage) => stage.stageId === 'brainstorm')?.status).toBe('in_progress');

    const checkpoints = await fs.readFile(path.join(paths.processDir, 'CHECKPOINTS.md'), 'utf8');
    expect(checkpoints).toContain('### c_001 scope');
    expect(checkpoints).toContain('- Status: rejected');
    expect(checkpoints).toContain('- Rollback Target: brainstorm');
  });

  it('reopening a blocking question invalidates packet-export readiness after convergence approval', async () => {
    const slug = createTempSlug('reopen');
    const paths = __testUtils.getPreparationPaths(slug);

    await __testUtils.runCliForTest(['init', '--slug', slug]);
    await seedReadyPacket(paths);
    await approveBaselineFreezePath(slug);
    await approveConvergenceAndExport(slug);

    const before = JSON.parse(
      await fs.readFile(path.join(paths.processDir, 'PREPARATION_STATE.json'), 'utf8'),
    ) as { readyForPacketExport: boolean };
    expect(before.readyForPacketExport).toBe(true);

    await __testUtils.runCliForTest([
      'question',
      'add',
      '--slug',
      slug,
      '--stage',
      'scope_freeze',
      '--question',
      'What is explicitly out of scope?',
      '--category',
      'scope',
      '--impact',
      'blocking',
      '--owner',
      'human',
      '--note',
      'Must be answered before export remains valid.',
    ]);
    await __testUtils.runCliForTest([
      'question',
      'resolve',
      '--slug',
      slug,
      '--id',
      'q_001',
      '--note',
      'Out of scope is distributed runtime.',
    ]);
    await __testUtils.runCliForTest([
      'question',
      'reopen',
      '--slug',
      slug,
      '--id',
      'q_001',
      '--note',
      'Non-goals changed after review.',
    ]);

    const after = JSON.parse(
      await fs.readFile(path.join(paths.processDir, 'PREPARATION_STATE.json'), 'utf8'),
    ) as {
      readyForPacketExport: boolean;
      readyForConvergenceGate: boolean;
      stages: Array<{ stageId: string; blockingQuestionIds: string[] }>;
    };
    expect(after.readyForPacketExport).toBe(false);
    expect(after.readyForConvergenceGate).toBe(false);
    expect(
      after.stages.find((stage) => stage.stageId === 'scope_freeze')?.blockingQuestionIds,
    ).toEqual(['q_001']);
  });

  it('refreshing handoff supersedes the prior snapshot and packet refresh stales it', async () => {
    const slug = createTempSlug('handoff-refresh');
    const paths = __testUtils.getPreparationPaths(slug);

    await __testUtils.runCliForTest(['init', '--slug', slug]);
    await seedReadyPacket(paths);
    await approveBaselineFreezePath(slug);
    await approveConvergenceAndExport(slug);
    await __testUtils.runCliForTest(['export', 'packet', '--slug', slug, '--note', 'initial export']);
    await __testUtils.runCliForTest(['handoff', '--slug', slug]);
    await __testUtils.runCliForTest(['handoff', 'refresh', '--slug', slug]);

    const firstHandoff = JSON.parse(
      await fs.readFile(path.join(paths.handoffsDir, 'handoff-001.json'), 'utf8'),
    ) as { status: string; supersededByHandoffId?: string };
    const secondHandoff = JSON.parse(
      await fs.readFile(path.join(paths.handoffsDir, 'handoff-002.json'), 'utf8'),
    ) as { status: string };
    expect(firstHandoff.status).toBe('superseded');
    expect(firstHandoff.supersededByHandoffId).toBe('handoff-002');
    expect(secondHandoff.status).toBe('generated');

    await fs.writeFile(
      path.join(paths.packetDir, 'MVP_SCOPE.md'),
      '# MVP Scope\n\n## Core Deliverable\nA changed export target.\n',
      'utf8',
    );
    await __testUtils.runCliForTest(['packet', 'refresh', '--slug', slug, '--note', 'stale old handoff']);

    const refreshedHandoff = JSON.parse(
      await fs.readFile(path.join(paths.handoffsDir, 'handoff-002.json'), 'utf8'),
    ) as { status: string; staleReason?: string };
    expect(refreshedHandoff.status).toBe('stale');
    expect(refreshedHandoff.staleReason).toContain('packet export export-002');
  });

  it('keeps option selection and decision approval bound to approved checkpoints', async () => {
    const slug = createTempSlug('option-decision');
    const paths = __testUtils.getPreparationPaths(slug);

    await __testUtils.runCliForTest(['init', '--slug', slug]);
    await __testUtils.runCliForTest([
      'option',
      'add',
      '--slug',
      slug,
      '--title',
      'Single-flow first',
      '--stage',
      'brainstorm',
      '--summary',
      'Keep one primary flow',
      '--advantages',
      'simpler packet',
      '--tradeoffs',
      'less flexibility',
      '--risks',
      'future expansion needed',
      '--fit-summary',
      'best fit for bounded workflow',
    ]);
    await __testUtils.runCliForTest([
      'option',
      'select',
      '--slug',
      slug,
      '--id',
      'o_001',
      '--note',
      'best fit for bounded MVP',
    ]);

    await __testUtils.runCliForTest([
      'decision',
      'propose',
      '--slug',
      slug,
      '--stage',
      'direction_decision',
      '--title',
      'Choose single-flow direction',
      '--decision-lines',
      'single-flow first',
      '--rationale-lines',
      'best fit for bounded workflow',
      '--packet-files',
      'PROJECT_BRIEF.md',
    ]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'open',
      '--slug',
      slug,
      '--stage',
      'direction_decision',
      '--type',
      'direction',
      '--summary',
      'approve chosen direction',
      '--decisions',
      'd_001',
    ]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'approve',
      '--slug',
      slug,
      '--id',
      'c_001',
      '--note',
      'direction approved',
    ]);
    await __testUtils.runCliForTest([
      'decision',
      'approve',
      '--slug',
      slug,
      '--id',
      'd_001',
      '--checkpoint-id',
      'c_001',
    ]);

    const optionSet = await fs.readFile(path.join(paths.processDir, 'OPTION_SET.md'), 'utf8');
    const decisionLog = await fs.readFile(path.join(paths.processDir, 'DECISION_LOG.md'), 'utf8');
    expect(optionSet).toContain('### o_001 Single-flow first');
    expect(optionSet).toContain('- Status: selected');
    expect(optionSet).toContain('- Selection Reason: best fit for bounded MVP');
    expect(decisionLog).toContain('### d_001 Choose single-flow direction');
    expect(decisionLog).toContain('- Status: approved');
    expect(decisionLog).toContain('- Checkpoint Id: c_001');
  });

  it('drives a synthetic bounded preparation from init to consumed handoff', async () => {
    const slug = createTempSlug('synthetic-e2e');
    const paths = __testUtils.getPreparationPaths(slug);

    await __testUtils.runCliForTest(['init', '--slug', slug]);
    await seedReadyPacket(paths);
    await __testUtils.runCliForTest([
      'advance',
      '--slug',
      slug,
      '--stage',
      'intake',
      '--status',
      'completed',
      '--note',
      'confirmed this is a standalone preparation candidate',
    ]);
    await __testUtils.runCliForTest([
      'advance',
      '--slug',
      slug,
      '--stage',
      'clarification',
      '--status',
      'in_progress',
      '--note',
      'collecting primary actor and flow facts',
    ]);
    await __testUtils.runCliForTest([
      'question',
      'add',
      '--slug',
      slug,
      '--stage',
      'clarification',
      '--question',
      'Who owns the first downstream handoff?',
      '--category',
      'user',
      '--impact',
      'blocking',
      '--owner',
      'human',
      '--note',
      'Needed to freeze the primary actor.',
    ]);
    await __testUtils.runCliForTest([
      'question',
      'resolve',
      '--slug',
      slug,
      '--id',
      'q_001',
      '--note',
      'The preparation operator owns the first downstream handoff.',
    ]);
    await __testUtils.runCliForTest([
      'advance',
      '--slug',
      slug,
      '--stage',
      'clarification',
      '--status',
      'completed',
      '--note',
      'primary actor and core flow clarified',
    ]);
    await __testUtils.runCliForTest([
      'advance',
      '--slug',
      slug,
      '--stage',
      'brainstorm',
      '--status',
      'in_progress',
      '--note',
      'pressuring priorities and boundaries',
    ]);
    await __testUtils.runCliForTest([
      'tradeoff',
      'add',
      '--slug',
      slug,
      '--title',
      'Protect bounded export quality',
      '--stage',
      'brainstorm',
      '--pressure-question',
      'If the first version keeps only one core value, what must it protect?',
      '--must-keep',
      'export-bound handoff,manual checkpoints',
      '--can-drop',
      'richer UX',
      '--not-now',
      'distributed preparation',
    ]);
    await __testUtils.runCliForTest([
      'tradeoff',
      'converge',
      '--slug',
      slug,
      '--id',
      't_001',
      '--note',
      'bounded export quality is the priority',
    ]);
    await __testUtils.runCliForTest([
      'option',
      'add',
      '--slug',
      slug,
      '--title',
      'Single-flow preparation',
      '--stage',
      'brainstorm',
      '--summary',
      'Keep one bounded operator flow',
      '--advantages',
      'predictable export',
      '--tradeoffs',
      'slower expansion',
      '--risks',
      'future flows need new workstreams',
      '--fit-summary',
      'best fit for the bounded first release',
    ]);
    await __testUtils.runCliForTest([
      'option',
      'select',
      '--slug',
      slug,
      '--id',
      'o_001',
      '--note',
      'best fit for bounded first release',
    ]);
    await __testUtils.runCliForTest([
      'advance',
      '--slug',
      slug,
      '--stage',
      'brainstorm',
      '--status',
      'completed',
      '--note',
      'tradeoffs converged into a bounded first direction',
    ]);

    await __testUtils.runCliForTest([
      'decision',
      'propose',
      '--slug',
      slug,
      '--stage',
      'direction_decision',
      '--title',
      'Choose single bounded preparation flow',
      '--decision-lines',
      'Use a single bounded operator flow,Keep packet export human-approved',
      '--rationale-lines',
      'It protects export quality,It matches the converged tradeoff',
      '--questions',
      'q_001',
      '--tradeoffs',
      't_001',
      '--packet-files',
      'PROJECT_BRIEF.md',
    ]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'open',
      '--slug',
      slug,
      '--stage',
      'direction_decision',
      '--type',
      'direction',
      '--summary',
      'approve bounded single-flow direction',
      '--decisions',
      'd_001',
    ]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'approve',
      '--slug',
      slug,
      '--id',
      'c_001',
      '--note',
      'direction approved',
    ]);
    await __testUtils.runCliForTest([
      'decision',
      'approve',
      '--slug',
      slug,
      '--id',
      'd_001',
      '--checkpoint-id',
      'c_001',
    ]);

    await __testUtils.runCliForTest([
      'decision',
      'propose',
      '--slug',
      slug,
      '--stage',
      'scope_freeze',
      '--title',
      'Freeze bounded MVP scope',
      '--decision-lines',
      'Keep process ledgers,Keep export and handoff publication',
      '--rationale-lines',
      'This covers the first downstream-ready slice',
      '--packet-files',
      'MVP_SCOPE.md,NON_GOALS.md',
    ]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'open',
      '--slug',
      slug,
      '--stage',
      'scope_freeze',
      '--type',
      'scope',
      '--summary',
      'approve bounded MVP scope',
      '--decisions',
      'd_002',
    ]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'approve',
      '--slug',
      slug,
      '--id',
      'c_002',
      '--note',
      'scope approved',
    ]);
    await __testUtils.runCliForTest([
      'decision',
      'approve',
      '--slug',
      slug,
      '--id',
      'd_002',
      '--checkpoint-id',
      'c_002',
    ]);

    await __testUtils.runCliForTest([
      'decision',
      'propose',
      '--slug',
      slug,
      '--stage',
      'boundary_freeze',
      '--title',
      'Freeze preparation boundary',
      '--decision-lines',
      'Allow preparation docs and CLI,Protect runtime orchestration semantics',
      '--rationale-lines',
      'Keep this bounded to preparation',
      '--packet-files',
      'ARCHITECTURE_BOUNDARY.md',
    ]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'open',
      '--slug',
      slug,
      '--stage',
      'boundary_freeze',
      '--type',
      'boundary',
      '--summary',
      'approve preparation boundary',
      '--decisions',
      'd_003',
    ]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'approve',
      '--slug',
      slug,
      '--id',
      'c_003',
      '--note',
      'boundary approved',
    ]);
    await __testUtils.runCliForTest([
      'decision',
      'approve',
      '--slug',
      slug,
      '--id',
      'd_003',
      '--checkpoint-id',
      'c_003',
    ]);

    await __testUtils.runCliForTest([
      'decision',
      'propose',
      '--slug',
      slug,
      '--stage',
      'success_evidence_freeze',
      '--title',
      'Freeze success and evidence',
      '--decision-lines',
      'Require export snapshot,Require handoff snapshot',
      '--rationale-lines',
      'Downstream planning should see export and handoff evidence',
      '--packet-files',
      'SUCCESS_CRITERIA.md,RISKS_AND_ASSUMPTIONS.md',
    ]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'open',
      '--slug',
      slug,
      '--stage',
      'success_evidence_freeze',
      '--type',
      'success_evidence',
      '--summary',
      'approve success and evidence',
      '--decisions',
      'd_004',
    ]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'approve',
      '--slug',
      slug,
      '--id',
      'c_004',
      '--note',
      'success and evidence approved',
    ]);
    await __testUtils.runCliForTest([
      'decision',
      'approve',
      '--slug',
      slug,
      '--id',
      'd_004',
      '--checkpoint-id',
      'c_004',
    ]);

    await __testUtils.runCliForTest([
      'advance',
      '--slug',
      slug,
      '--stage',
      'workstream_shaping',
      '--status',
      'completed',
      '--note',
      'workstreams are shaped for downstream planning',
    ]);
    await __testUtils.runCliForTest(['check', 'convergence', '--slug', slug]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'open',
      '--slug',
      slug,
      '--stage',
      'convergence_gate',
      '--type',
      'convergence',
      '--summary',
      'approve convergence pass',
    ]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'approve',
      '--slug',
      slug,
      '--id',
      'c_005',
      '--note',
      'convergence approved',
    ]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'open',
      '--slug',
      slug,
      '--stage',
      'packet_export',
      '--type',
      'packet_export',
      '--summary',
      'approve packet export publication',
    ]);
    await __testUtils.runCliForTest([
      'checkpoint',
      'approve',
      '--slug',
      slug,
      '--id',
      'c_006',
      '--note',
      'export approved',
    ]);
    await __testUtils.runCliForTest([
      'export',
      'packet',
      '--slug',
      slug,
      '--note',
      'synthetic bounded export',
    ]);
    await __testUtils.runCliForTest(['handoff', '--slug', slug]);

    const auditOutput = await __testUtils.runCliWithCapturedOutput([
      'audit',
      'summary',
      '--slug',
      slug,
    ]);
    expect(auditOutput).toContain('Readiness: ready_for_downstream_handoff');
    expect(auditOutput).toContain('Latest export: export-001 (exported)');
    expect(auditOutput).toContain('Latest handoff: handoff-001');

    const resumeOutput = await __testUtils.runCliWithCapturedOutput([
      'resume',
      'from-state',
      '--slug',
      slug,
    ]);
    expect(resumeOutput).toContain('Latest export: export-001');
    expect(resumeOutput).toContain('Latest handoff: handoff-001');

    await __testUtils.runCliForTest([
      'handoff',
      'consume',
      '--slug',
      slug,
      '--note',
      'consumed by downstream planning',
    ]);

    const state = JSON.parse(
      await fs.readFile(path.join(paths.processDir, 'PREPARATION_STATE.json'), 'utf8'),
    ) as { latestPacketExportId: string | null; latestHandoffId: string | null };
    const handoffMeta = JSON.parse(
      await fs.readFile(path.join(paths.handoffsDir, 'handoff-001.json'), 'utf8'),
    ) as { status: string; consumeNote: string | null; sourceExportId: string };
    const timeline = await fs.readFile(path.join(paths.historyDir, 'timeline.md'), 'utf8');

    expect(state.latestPacketExportId).toBe('export-001');
    expect(state.latestHandoffId).toBe('handoff-001');
    expect(handoffMeta.sourceExportId).toBe('export-001');
    expect(handoffMeta.status).toBe('consumed');
    expect(handoffMeta.consumeNote).toBe('consumed by downstream planning');
    expect(timeline).toContain('published packet export export-001');
    expect(timeline).toContain('generated handoff-001 from export-001');
    expect(timeline).toContain('consumed handoff handoff-001');
  });
});
