import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const templateRoot = path.join(repoRoot, 'docs', 'project-preparation', 'templates');
const preparationRoot = path.join(repoRoot, 'docs', 'project-preparation');
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const stageIds = [
  'intake',
  'clarification',
  'brainstorm',
  'direction_decision',
  'scope_freeze',
  'boundary_freeze',
  'success_evidence_freeze',
  'workstream_shaping',
  'convergence_gate',
  'packet_export',
  'handoff',
] as const;

const requiredPacketFiles = [
  'PROJECT_BRIEF.md',
  'MVP_SCOPE.md',
  'NON_GOALS.md',
  'SUCCESS_CRITERIA.md',
  'ARCHITECTURE_BOUNDARY.md',
  'INITIAL_WORKSTREAMS.md',
  'RISKS_AND_ASSUMPTIONS.md',
  'NEW_CHAT_HANDOFF_PROMPT.md',
] as const;

const requiredProcessFiles = [
  'PREPARATION_STATE.json',
  'OPEN_QUESTIONS.md',
  'TRADEOFF_LEDGER.md',
  'OPTION_SET.md',
  'DECISION_LOG.md',
  'CHECKPOINTS.md',
  'CONVERGENCE_REPORT.md',
  'PACKET_EXPORT_STATUS.json',
] as const;

const requiredHistoryFiles = ['timeline.md', 'stage-transitions.jsonl'] as const;

const stageStatuses = [
  'not_started',
  'in_progress',
  'human_review_required',
  'completed',
  'rolled_back',
  'blocked',
  'skipped',
] as const;

const preparationStatuses = [
  'active',
  'paused',
  'blocked',
  'converged',
  'exported',
  'superseded',
  'archived',
] as const;

const checkpointTypes = [
  'direction',
  'scope',
  'boundary',
  'success_evidence',
  'convergence',
  'packet_export',
] as const;

const checkpointStatuses = [
  'open',
  'pending_human',
  'approved',
  'rejected',
  'superseded',
  'expired',
] as const;

type StageId = (typeof stageIds)[number];
type PacketFileName = (typeof requiredPacketFiles)[number];
type ProcessFileName = (typeof requiredProcessFiles)[number];
type HistoryFileName = (typeof requiredHistoryFiles)[number];
type StageStatus = (typeof stageStatuses)[number];
type PreparationStatus = (typeof preparationStatuses)[number];
type CheckpointType = (typeof checkpointTypes)[number];
type CheckpointStatus = (typeof checkpointStatuses)[number];
type QuestionImpact = 'blocking' | 'non_blocking';
type QuestionStatus = 'open' | 'deferred' | 'resolved' | 'superseded';
type TradeoffStatus = 'active' | 'converged' | 'superseded';
type DecisionStatus = 'proposed' | 'approved' | 'rejected' | 'superseded';

type Readiness = 'ready_for_downstream_handoff' | 'needs_refinement';
type NextAction = 'handoff_downstream' | 'continue_preparation';
type LayoutKind = 'canonical_packet_dir' | 'legacy_flat_packet' | 'missing';

type StageState = {
  stageId: StageId;
  status: StageStatus;
  enteredAt: string | null;
  completedAt: string | null;
  rolledBackAt?: string | null;
  requiredCheckpointIds: string[];
  blockingQuestionIds: string[];
  producedDecisionIds: string[];
  notes: string;
};

type CheckpointRecord = {
  checkpointId: string;
  stageId: StageId;
  type: CheckpointType;
  status: CheckpointStatus;
  promptSummary: string;
  approvalSummary: string | null;
  correctionSummary: string | null;
  rejectionReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  rollbackTargetStageId: StageId | null;
  linkedDecisionIds: string[];
  createdAt: string;
  updatedAt: string;
};

type PreparationState = {
  preparationId: string;
  projectSlug: string;
  title: string;
  status: PreparationStatus;
  currentStageId: StageId;
  nextStageId: StageId | null;
  readyForConvergenceGate: boolean;
  readyForPacketExport: boolean;
  activeCheckpointIds: string[];
  latestConvergenceReportId: string | null;
  latestPacketExportId: string | null;
  latestHandoffId: string | null;
  createdAt: string;
  updatedAt: string;
  stages: StageState[];
  checkpoints?: CheckpointRecord[];
};

type PacketExportStatus = {
  latestExportId: string | null;
  status: 'not_ready' | 'ready' | 'exported' | 'stale' | 'superseded';
  exported: boolean;
  exportedAt: string | null;
  requiresRefresh: boolean;
  refreshReason: string | null;
  sourceConvergenceReportId: string | null;
  sourceDecisionIds: string[];
  packetFiles: string[];
  supersededByExportId: string | null;
};

type QuestionRecord = {
  id: string;
  stageId: StageId;
  question: string;
  category: string;
  impact: QuestionImpact;
  owner: string;
  notes: string;
  status: QuestionStatus;
  resolutionSummary?: string;
  revisitAt?: string;
};

type TradeoffRecord = {
  id: string;
  title: string;
  stageId: StageId;
  pressureQuestion: string;
  mustKeep: string[];
  canDrop: string[];
  notNow: string[];
  boundaryImplication: string[];
  failureImplication: string[];
  currentLeaning: string[];
  stillUnresolved: string[];
  linkedDecisionIds: string[];
  status: TradeoffStatus;
};

type DecisionRecord = {
  id: string;
  title: string;
  stageId: StageId;
  status: DecisionStatus;
  decision: string[];
  rationale: string[];
  linkedQuestionIds: string[];
  linkedTradeoffIds: string[];
  affectsPacketFiles: string[];
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  checkpointId: string | null;
};

type OptionStatus = 'active' | 'selected' | 'rejected' | 'superseded';

type OptionRecord = {
  id: string;
  title: string;
  stageId: StageId;
  summary: string;
  advantages: string[];
  tradeoffs: string[];
  risks: string[];
  fitSummary: string[];
  status: OptionStatus;
  selectionReason: string | null;
  rejectionReason: string | null;
};

type InitOptions = {
  command: 'init';
  slug: string;
  force: boolean;
};

type StatusOptions = {
  command: 'status';
  slug: string;
};

type CheckOptions = {
  command: 'check';
  slug: string;
};

type AdvanceOptions = {
  command: 'advance';
  slug: string;
  stage: StageId;
  status: StageStatus;
  note: string | null;
};

type CheckConvergenceOptions = {
  command: 'check-convergence';
  slug: string;
};

type CheckpointListOptions = {
  command: 'checkpoint-list';
  slug: string;
};

type CheckpointOpenOptions = {
  command: 'checkpoint-open';
  slug: string;
  stage: StageId;
  type: CheckpointType;
  summary: string;
  rollbackTarget: StageId | null;
  decisionIds: string[];
};

type CheckpointApproveOptions = {
  command: 'checkpoint-approve';
  slug: string;
  checkpointId: string;
  note: string | null;
};

type CheckpointApproveWithCorrectionOptions = {
  command: 'checkpoint-approve-with-correction';
  slug: string;
  checkpointId: string;
  note: string;
};

type CheckpointRejectOptions = {
  command: 'checkpoint-reject';
  slug: string;
  checkpointId: string;
  rollbackTarget: StageId;
  note: string;
};

type ExportPacketOptions = {
  command: 'export-packet';
  slug: string;
  note: string | null;
};

type QuestionAddOptions = {
  command: 'question-add';
  slug: string;
  stage: StageId;
  question: string;
  category: string;
  impact: QuestionImpact;
  owner: string;
  note: string | null;
};

type QuestionListOptions = {
  command: 'question-list';
  slug: string;
};

type QuestionResolveOptions = {
  command: 'question-resolve';
  slug: string;
  id: string;
  note: string;
};

type QuestionDeferOptions = {
  command: 'question-defer';
  slug: string;
  id: string;
  note: string;
  revisitAt: string | null;
};

type QuestionReopenOptions = {
  command: 'question-reopen';
  slug: string;
  id: string;
  note: string | null;
};

type TradeoffAddOptions = {
  command: 'tradeoff-add';
  slug: string;
  title: string;
  stage: StageId;
  pressureQuestion: string;
  mustKeep: string[];
  canDrop: string[];
  notNow: string[];
  boundaryImplication: string[];
  failureImplication: string[];
  currentLeaning: string[];
  unresolved: string[];
  decisionIds: string[];
};

type TradeoffListOptions = {
  command: 'tradeoff-list';
  slug: string;
};

type TradeoffConvergeOptions = {
  command: 'tradeoff-converge';
  slug: string;
  id: string;
  note: string | null;
  decisionIds: string[];
};

type TradeoffSupersedeOptions = {
  command: 'tradeoff-supersede';
  slug: string;
  id: string;
  note: string;
};

type DecisionProposeOptions = {
  command: 'decision-propose';
  slug: string;
  stage: StageId;
  title: string;
  decision: string[];
  rationale: string[];
  questionIds: string[];
  tradeoffIds: string[];
  packetFiles: string[];
};

type DecisionListOptions = {
  command: 'decision-list';
  slug: string;
};

type DecisionApproveOptions = {
  command: 'decision-approve';
  slug: string;
  id: string;
  checkpointId: string;
  note: string | null;
};

type DecisionRejectOptions = {
  command: 'decision-reject';
  slug: string;
  id: string;
  note: string;
};

type DecisionSupersedeOptions = {
  command: 'decision-supersede';
  slug: string;
  id: string;
  note: string;
};

type AuditSummaryOptions = {
  command: 'audit-summary';
  slug: string;
};

type AuditBlockersOptions = {
  command: 'audit-blockers';
  slug: string;
};

type ResumeFromStateOptions = {
  command: 'resume-from-state';
  slug: string;
};

type ResumeFromHandoffOptions = {
  command: 'resume-from-handoff';
  slug: string;
};

type OptionAddOptions = {
  command: 'option-add';
  slug: string;
  title: string;
  stage: StageId;
  summary: string;
  advantages: string[];
  tradeoffs: string[];
  risks: string[];
  fitSummary: string[];
};

type OptionListOptions = {
  command: 'option-list';
  slug: string;
};

type OptionSelectOptions = {
  command: 'option-select';
  slug: string;
  id: string;
  note: string;
};

type OptionRejectOptions = {
  command: 'option-reject';
  slug: string;
  id: string;
  note: string;
};

type PacketStatusOptions = {
  command: 'packet-status';
  slug: string;
};

type PacketRefreshOptions = {
  command: 'packet-refresh';
  slug: string;
  note: string | null;
};

type HandoffRefreshOptions = {
  command: 'handoff-refresh';
  slug: string;
};

type HandoffShowOptions = {
  command: 'handoff-show';
  slug: string;
};

type HandoffConsumeOptions = {
  command: 'handoff-consume';
  slug: string;
  note: string | null;
};

type HistoryOptions = {
  command: 'history';
  slug: string;
};

type TimelineOptions = {
  command: 'timeline';
  slug: string;
};

type DiffExportedPacketOptions = {
  command: 'diff-exported-packet';
  slug: string;
  exportId: string;
};

type HandoffOptions = {
  command: 'handoff';
  slug: string;
};

type CliOptions =
  | InitOptions
  | StatusOptions
  | CheckOptions
  | AdvanceOptions
  | CheckConvergenceOptions
  | CheckpointListOptions
  | CheckpointOpenOptions
  | CheckpointApproveOptions
  | CheckpointApproveWithCorrectionOptions
  | CheckpointRejectOptions
  | ExportPacketOptions
  | QuestionAddOptions
  | QuestionListOptions
  | QuestionResolveOptions
  | QuestionDeferOptions
  | QuestionReopenOptions
  | TradeoffAddOptions
  | TradeoffListOptions
  | TradeoffConvergeOptions
  | TradeoffSupersedeOptions
  | DecisionProposeOptions
  | DecisionListOptions
  | DecisionApproveOptions
  | DecisionRejectOptions
  | DecisionSupersedeOptions
  | AuditSummaryOptions
  | AuditBlockersOptions
  | ResumeFromStateOptions
  | ResumeFromHandoffOptions
  | OptionAddOptions
  | OptionListOptions
  | OptionSelectOptions
  | OptionRejectOptions
  | PacketStatusOptions
  | PacketRefreshOptions
  | HandoffRefreshOptions
  | HandoffShowOptions
  | HandoffConsumeOptions
  | HistoryOptions
  | TimelineOptions
  | DiffExportedPacketOptions
  | HandoffOptions;

type PreparationPaths = {
  rootDir: string;
  packetDir: string;
  processDir: string;
  exportsDir: string;
  handoffsDir: string;
  historyDir: string;
  readmePath: string;
};

type ProblemSeverity = 'error' | 'warning';
type ProblemKind =
  | 'missing_root_dir'
  | 'missing_process_dir'
  | 'missing_packet_dir'
  | 'missing_exports_dir'
  | 'missing_handoffs_dir'
  | 'missing_history_dir'
  | 'missing_readme'
  | 'missing_process_file'
  | 'missing_packet_file'
  | 'missing_history_file'
  | 'empty_packet_file'
  | 'template_placeholder'
  | 'handoff_path'
  | 'handoff_next_objective'
  | 'legacy_layout';

type Problem = {
  severity: ProblemSeverity;
  kind: ProblemKind;
  file: string;
  path: string;
  message: string;
};

type PacketFileReport = {
  file: PacketFileName;
  path: string;
  exists: boolean;
  nonEmpty: boolean;
  placeholderCount: number;
};

type ProcessFileReport = {
  file: ProcessFileName;
  path: string;
  exists: boolean;
};

type HistoryFileReport = {
  file: HistoryFileName;
  path: string;
  exists: boolean;
};

type PreparationAssessment = {
  slug: string;
  paths: PreparationPaths;
  layout: LayoutKind;
  packetDirInUse: string;
  readiness: Readiness;
  nextAction: NextAction;
  problems: Problem[];
  packetReports: PacketFileReport[];
  processReports: ProcessFileReport[];
  historyReports: HistoryFileReport[];
  summary: {
    packetRequired: number;
    packetPresent: number;
    packetNonEmpty: number;
    packetPlaceholderFree: number;
    processRequired: number;
    processPresent: number;
    historyRequired: number;
    historyPresent: number;
  };
};

type AssessOptions = {
  ignoreHandoffIssues?: boolean;
};

type InitResult = {
  path: string;
  action: 'created' | 'overwritten' | 'skipped';
};

function printUsage(): void {
  process.stdout.write(
    [
      'Usage:',
      '  node --import tsx scripts/project-preparation.ts init --slug <project-slug> [--force]',
      '  node --import tsx scripts/project-preparation.ts status --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts check --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts advance --slug <project-slug> --stage <stage-id> [--status <stage-status>] [--note <text>]',
      '  node --import tsx scripts/project-preparation.ts check convergence --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts checkpoint list --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts checkpoint open --slug <project-slug> --stage <stage-id> --type <checkpoint-type> --summary <text> [--rollback-target <stage-id>] [--decisions <id,id,...>]',
      '  node --import tsx scripts/project-preparation.ts checkpoint approve --slug <project-slug> --id <checkpoint-id> [--note <text>]',
      '  node --import tsx scripts/project-preparation.ts checkpoint approve-with-correction --slug <project-slug> --id <checkpoint-id> --note <text>',
      '  node --import tsx scripts/project-preparation.ts checkpoint reject --slug <project-slug> --id <checkpoint-id> --rollback-target <stage-id> --note <text>',
      '  node --import tsx scripts/project-preparation.ts export packet --slug <project-slug> [--note <text>]',
      '  node --import tsx scripts/project-preparation.ts question add --slug <project-slug> --stage <stage-id> --question <text> --category <text> --impact <blocking|non_blocking> --owner <text> [--note <text>]',
      '  node --import tsx scripts/project-preparation.ts question list --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts question resolve --slug <project-slug> --id <question-id> --note <text>',
      '  node --import tsx scripts/project-preparation.ts question defer --slug <project-slug> --id <question-id> --note <text> [--revisit-at <text>]',
      '  node --import tsx scripts/project-preparation.ts question reopen --slug <project-slug> --id <question-id> [--note <text>]',
      '  node --import tsx scripts/project-preparation.ts option add --slug <project-slug> --title <text> --stage <stage-id> --summary <text> [--advantages <a,b>] [--tradeoffs <a,b>] [--risks <a,b>] [--fit-summary <a,b>]',
      '  node --import tsx scripts/project-preparation.ts option list --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts option select --slug <project-slug> --id <option-id> --note <text>',
      '  node --import tsx scripts/project-preparation.ts option reject --slug <project-slug> --id <option-id> --note <text>',
      '  node --import tsx scripts/project-preparation.ts tradeoff add --slug <project-slug> --title <text> --stage <stage-id> --pressure-question <text> [--must-keep <a,b>] [--can-drop <a,b>] [--not-now <a,b>]',
      '  node --import tsx scripts/project-preparation.ts tradeoff list --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts tradeoff converge --slug <project-slug> --id <tradeoff-id> [--note <text>] [--decisions <id,id,...>]',
      '  node --import tsx scripts/project-preparation.ts tradeoff supersede --slug <project-slug> --id <tradeoff-id> --note <text>',
      '  node --import tsx scripts/project-preparation.ts decision propose --slug <project-slug> --stage <stage-id> --title <text> --decision-lines <a,b> --rationale-lines <a,b> [--questions <id,id,...>] [--tradeoffs <id,id,...>] [--packet-files <a,b>]',
      '  node --import tsx scripts/project-preparation.ts decision list --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts decision approve --slug <project-slug> --id <decision-id> --checkpoint-id <checkpoint-id> [--note <text>]',
      '  node --import tsx scripts/project-preparation.ts decision reject --slug <project-slug> --id <decision-id> --note <text>',
      '  node --import tsx scripts/project-preparation.ts decision supersede --slug <project-slug> --id <decision-id> --note <text>',
      '  node --import tsx scripts/project-preparation.ts packet status --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts packet refresh --slug <project-slug> [--note <text>]',
      '  node --import tsx scripts/project-preparation.ts handoff refresh --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts handoff show --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts handoff consume --slug <project-slug> [--note <text>]',
      '  node --import tsx scripts/project-preparation.ts audit summary --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts audit blockers --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts timeline --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts history --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts diff exported-packet --slug <project-slug> --export-id <export-id>',
      '  node --import tsx scripts/project-preparation.ts resume from-state --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts resume from-handoff --slug <project-slug>',
      '  node --import tsx scripts/project-preparation.ts handoff --slug <project-slug>',
      '',
      'Commands:',
      '  init     Create the preparation workspace, packet files, and process ledgers.',
      '  status   Print the current preparation structure and readiness without failing.',
      '  check    Validate readiness and exit non-zero if refinement is still needed.',
      '  advance  Move a stage to a new status and record the transition in state/history.',
      '  check convergence  Run the convergence gate and update readiness/report state.',
      '  checkpoint *       Open, list, approve, or reject formal human checkpoints.',
      '  export packet      Publish a versioned packet snapshot from approved frozen content.',
      '  question *         Maintain OPEN_QUESTIONS on the process side.',
      '  option *           Maintain OPTION_SET when materially distinct directions exist.',
      '  tradeoff *         Maintain TRADEOFF_LEDGER entries.',
      '  decision *         Maintain DECISION_LOG and checkpoint-linked approvals.',
      '  packet *           Inspect or refresh export freshness.',
      '  handoff *          Inspect, refresh, or consume export-bound handoffs.',
      '  audit *            Summarize health and blockers for a preparation.',
      '  timeline/history   Print timeline, audit trail, and packet-vs-export diffs.',
      '  resume *           Print concrete resume entry points from state or handoff.',
      '  handoff  Generate the current canonical handoff prompt and a historical snapshot.',
      '',
      'Notes:',
      '  --force only applies to init and overwrites existing non-empty scaffold files.',
      `  stage ids: ${stageIds.join(', ')}`,
      `  checkpoint types: ${checkpointTypes.join(', ')}`,
    ].join('\n') + '\n',
  );
}

function parseArgs(argv: string[]): CliOptions {
  const first = argv[0];
  if (!first || first === '--help' || first === '-h') {
    printUsage();
    process.exit(0);
  }

  let command:
    | CliOptions['command']
    | null = null;
  let argStart = 1;

  if (first === 'init' || first === 'status' || first === 'check' || first === 'advance') {
    command = first;
  } else if (first === 'handoff') {
    const action = argv[1];
    if (!action || action.startsWith('--')) {
      command = 'handoff';
      argStart = 1;
    } else {
      argStart = 2;
      if (action === 'refresh') {
        command = 'handoff-refresh';
      } else if (action === 'show') {
        command = 'handoff-show';
      } else if (action === 'consume') {
        command = 'handoff-consume';
      } else {
        throw new Error(`Unknown handoff command: ${action}`);
      }
    }
  } else if (first === 'checkpoint') {
    const action = argv[1];
    argStart = 2;
    if (action === 'list') {
      command = 'checkpoint-list';
    } else if (action === 'open') {
      command = 'checkpoint-open';
    } else if (action === 'approve') {
      command = 'checkpoint-approve';
    } else if (action === 'approve-with-correction') {
      command = 'checkpoint-approve-with-correction';
    } else if (action === 'reject') {
      command = 'checkpoint-reject';
    } else {
      throw new Error(`Unknown checkpoint command: ${action ?? '<missing>'}`);
    }
  } else if (first === 'export') {
    const target = argv[1];
    argStart = 2;
    if (target === 'packet') {
      command = 'export-packet';
    } else {
      throw new Error(`Unknown export command: ${target ?? '<missing>'}`);
    }
  } else if (first === 'question') {
    const action = argv[1];
    argStart = 2;
    if (action === 'add') {
      command = 'question-add';
    } else if (action === 'list') {
      command = 'question-list';
    } else if (action === 'resolve') {
      command = 'question-resolve';
    } else if (action === 'defer') {
      command = 'question-defer';
    } else if (action === 'reopen') {
      command = 'question-reopen';
    } else {
      throw new Error(`Unknown question command: ${action ?? '<missing>'}`);
    }
  } else if (first === 'tradeoff') {
    const action = argv[1];
    argStart = 2;
    if (action === 'add') {
      command = 'tradeoff-add';
    } else if (action === 'list') {
      command = 'tradeoff-list';
    } else if (action === 'converge') {
      command = 'tradeoff-converge';
    } else if (action === 'supersede') {
      command = 'tradeoff-supersede';
    } else {
      throw new Error(`Unknown tradeoff command: ${action ?? '<missing>'}`);
    }
  } else if (first === 'option') {
    const action = argv[1];
    argStart = 2;
    if (action === 'add') {
      command = 'option-add';
    } else if (action === 'list') {
      command = 'option-list';
    } else if (action === 'select') {
      command = 'option-select';
    } else if (action === 'reject') {
      command = 'option-reject';
    } else {
      throw new Error(`Unknown option command: ${action ?? '<missing>'}`);
    }
  } else if (first === 'decision') {
    const action = argv[1];
    argStart = 2;
    if (action === 'propose') {
      command = 'decision-propose';
    } else if (action === 'list') {
      command = 'decision-list';
    } else if (action === 'approve') {
      command = 'decision-approve';
    } else if (action === 'reject') {
      command = 'decision-reject';
    } else if (action === 'supersede') {
      command = 'decision-supersede';
    } else {
      throw new Error(`Unknown decision command: ${action ?? '<missing>'}`);
    }
  } else if (first === 'audit') {
    const action = argv[1];
    argStart = 2;
    if (action === 'summary') {
      command = 'audit-summary';
    } else if (action === 'blockers') {
      command = 'audit-blockers';
    } else {
      throw new Error(`Unknown audit command: ${action ?? '<missing>'}`);
    }
  } else if (first === 'resume') {
    const action = argv[1];
    argStart = 2;
    if (action === 'from-state') {
      command = 'resume-from-state';
    } else if (action === 'from-handoff') {
      command = 'resume-from-handoff';
    } else {
      throw new Error(`Unknown resume command: ${action ?? '<missing>'}`);
    }
  } else if (first === 'packet') {
    const action = argv[1];
    argStart = 2;
    if (action === 'status') {
      command = 'packet-status';
    } else if (action === 'refresh') {
      command = 'packet-refresh';
    } else {
      throw new Error(`Unknown packet command: ${action ?? '<missing>'}`);
    }
  } else if (first === 'timeline') {
    command = 'timeline';
  } else if (first === 'history') {
    command = 'history';
  } else if (first === 'diff') {
    const target = argv[1];
    argStart = 2;
    if (target === 'exported-packet') {
      command = 'diff-exported-packet';
    } else {
      throw new Error(`Unknown diff command: ${target ?? '<missing>'}`);
    }
  } else {
    throw new Error(`Unknown command: ${first}`);
  }

  if (command === 'check' && argv[1] === 'convergence') {
    command = 'check-convergence';
    argStart = 2;
  }

  let slug: string | undefined;
  let force = false;
  let stage: StageId | undefined;
  let status: StageStatus | undefined;
  let note: string | undefined;
  let type: CheckpointType | undefined;
  let summary: string | undefined;
  let rollbackTarget: StageId | undefined;
  let checkpointId: string | undefined;
  let decisionIds: string[] = [];
  let question: string | undefined;
  let category: string | undefined;
  let impact: QuestionImpact | undefined;
  let owner: string | undefined;
  let revisitAt: string | undefined;
  let title: string | undefined;
  let pressureQuestion: string | undefined;
  let mustKeep: string[] = [];
  let canDrop: string[] = [];
  let notNow: string[] = [];
  let boundaryImplication: string[] = [];
  let failureImplication: string[] = [];
  let currentLeaning: string[] = [];
  let unresolved: string[] = [];
  let questionIds: string[] = [];
  let tradeoffIds: string[] = [];
  let packetFiles: string[] = [];
  let decisionLines: string[] = [];
  let rationaleLines: string[] = [];
  let recordId: string | undefined;
  let exportId: string | undefined;
  let optionAdvantages: string[] = [];
  let optionTradeoffs: string[] = [];
  let optionRisks: string[] = [];
  let optionFitSummary: string[] = [];

  for (let index = argStart; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    switch (token) {
      case '--slug':
        slug = requireValue(token, next);
        index += 1;
        break;
      case '--force':
        if (command !== 'init') {
          throw new Error('--force is only supported with the init command');
        }
        force = true;
        break;
      case '--stage':
        stage = parseStageId(requireValue(token, next));
        index += 1;
        break;
      case '--status':
        status = parseStageStatus(requireValue(token, next));
        index += 1;
        break;
      case '--note':
        note = requireValue(token, next);
        index += 1;
        break;
      case '--type':
        type = parseCheckpointType(requireValue(token, next));
        index += 1;
        break;
      case '--summary':
        summary = requireValue(token, next);
        index += 1;
        break;
      case '--rollback-target':
        rollbackTarget = parseStageId(requireValue(token, next));
        index += 1;
        break;
      case '--id':
        recordId = requireValue(token, next);
        index += 1;
        break;
      case '--checkpoint-id':
        checkpointId = requireValue(token, next);
        index += 1;
        break;
      case '--export-id':
        exportId = requireValue(token, next);
        index += 1;
        break;
      case '--decisions':
        decisionIds = requireValue(token, next)
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
        index += 1;
        break;
      case '--question':
        question = requireValue(token, next);
        index += 1;
        break;
      case '--category':
        category = requireValue(token, next);
        index += 1;
        break;
      case '--impact':
        impact = parseQuestionImpact(requireValue(token, next));
        index += 1;
        break;
      case '--owner':
        owner = requireValue(token, next);
        index += 1;
        break;
      case '--revisit-at':
        revisitAt = requireValue(token, next);
        index += 1;
        break;
      case '--title':
        title = requireValue(token, next);
        index += 1;
        break;
      case '--pressure-question':
        pressureQuestion = requireValue(token, next);
        index += 1;
        break;
      case '--must-keep':
        mustKeep = parseCsvValues(requireValue(token, next));
        index += 1;
        break;
      case '--can-drop':
        canDrop = parseCsvValues(requireValue(token, next));
        index += 1;
        break;
      case '--not-now':
        notNow = parseCsvValues(requireValue(token, next));
        index += 1;
        break;
      case '--boundary-implication':
        boundaryImplication = parseCsvValues(requireValue(token, next));
        index += 1;
        break;
      case '--failure-implication':
        failureImplication = parseCsvValues(requireValue(token, next));
        index += 1;
        break;
      case '--current-leaning':
        currentLeaning = parseCsvValues(requireValue(token, next));
        index += 1;
        break;
      case '--unresolved':
        unresolved = parseCsvValues(requireValue(token, next));
        index += 1;
        break;
      case '--questions':
        questionIds = parseCsvValues(requireValue(token, next));
        index += 1;
        break;
      case '--tradeoffs':
        if (command === 'option-add') {
          optionTradeoffs = parseCsvValues(requireValue(token, next));
        } else {
          tradeoffIds = parseCsvValues(requireValue(token, next));
        }
        index += 1;
        break;
      case '--advantages':
        optionAdvantages = parseCsvValues(requireValue(token, next));
        index += 1;
        break;
      case '--risks':
        optionRisks = parseCsvValues(requireValue(token, next));
        index += 1;
        break;
      case '--packet-files':
        packetFiles = parseCsvValues(requireValue(token, next));
        index += 1;
        break;
      case '--fit-summary':
        optionFitSummary = parseCsvValues(requireValue(token, next));
        index += 1;
        break;
      case '--decision-lines':
        decisionLines = parseCsvValues(requireValue(token, next));
        index += 1;
        break;
      case '--rationale-lines':
        rationaleLines = parseCsvValues(requireValue(token, next));
        index += 1;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!slug) {
    throw new Error('--slug is required');
  }

  validateSlug(slug);

  if (command === 'init') {
    return { command: 'init', slug, force };
  }
  if (command === 'status') {
    return { command: 'status', slug };
  }
  if (command === 'check') {
    return { command: 'check', slug };
  }
  if (command === 'advance') {
    if (!stage) {
      throw new Error('--stage is required for advance');
    }
    return {
      command: 'advance',
      slug,
      stage,
      status: status ?? 'in_progress',
      note: note ?? null,
    };
  }
  if (command === 'check-convergence') {
    return {
      command: 'check-convergence',
      slug,
    };
  }
  if (command === 'checkpoint-list') {
    return { command: 'checkpoint-list', slug };
  }
  if (command === 'checkpoint-open') {
    if (!stage) {
      throw new Error('--stage is required for checkpoint open');
    }
    if (!type) {
      throw new Error('--type is required for checkpoint open');
    }
    if (!summary) {
      throw new Error('--summary is required for checkpoint open');
    }
    return {
      command: 'checkpoint-open',
      slug,
      stage,
      type,
      summary,
      rollbackTarget: rollbackTarget ?? null,
      decisionIds,
    };
  }
  if (command === 'checkpoint-approve') {
    if (!recordId) {
      throw new Error('--id is required for checkpoint approve');
    }
    return {
      command: 'checkpoint-approve',
      slug,
      checkpointId: recordId,
      note: note ?? null,
    };
  }
  if (command === 'checkpoint-approve-with-correction') {
    if (!recordId) {
      throw new Error('--id is required for checkpoint approve-with-correction');
    }
    if (!note) {
      throw new Error('--note is required for checkpoint approve-with-correction');
    }
    return {
      command: 'checkpoint-approve-with-correction',
      slug,
      checkpointId: recordId,
      note,
    };
  }
  if (command === 'checkpoint-reject') {
    if (!recordId) {
      throw new Error('--id is required for checkpoint reject');
    }
    if (!rollbackTarget) {
      throw new Error('--rollback-target is required for checkpoint reject');
    }
    if (!note) {
      throw new Error('--note is required for checkpoint reject');
    }
    return {
      command: 'checkpoint-reject',
      slug,
      checkpointId: recordId,
      rollbackTarget,
      note,
    };
  }
  if (command === 'export-packet') {
    return {
      command: 'export-packet',
      slug,
      note: note ?? null,
    };
  }
  if (command === 'question-add') {
    if (!stage || !question || !category || !impact || !owner) {
      throw new Error('question add requires --stage, --question, --category, --impact, and --owner');
    }
    return {
      command: 'question-add',
      slug,
      stage,
      question,
      category,
      impact,
      owner,
      note: note ?? null,
    };
  }
  if (command === 'question-list') {
    return { command: 'question-list', slug };
  }
  if (command === 'question-resolve') {
    if (!recordId || !note) {
      throw new Error('question resolve requires --id and --note');
    }
    return { command: 'question-resolve', slug, id: recordId, note };
  }
  if (command === 'question-defer') {
    if (!recordId || !note) {
      throw new Error('question defer requires --id and --note');
    }
    return { command: 'question-defer', slug, id: recordId, note, revisitAt: revisitAt ?? null };
  }
  if (command === 'question-reopen') {
    if (!recordId) {
      throw new Error('question reopen requires --id');
    }
    return { command: 'question-reopen', slug, id: recordId, note: note ?? null };
  }
  if (command === 'tradeoff-add') {
    if (!title || !stage || !pressureQuestion) {
      throw new Error('tradeoff add requires --title, --stage, and --pressure-question');
    }
    return {
      command: 'tradeoff-add',
      slug,
      title,
      stage,
      pressureQuestion,
      mustKeep,
      canDrop,
      notNow,
      boundaryImplication,
      failureImplication,
      currentLeaning,
      unresolved,
      decisionIds,
    };
  }
  if (command === 'tradeoff-list') {
    return { command: 'tradeoff-list', slug };
  }
  if (command === 'option-add') {
    if (!title || !stage || !summary) {
      throw new Error('option add requires --title, --stage, and --summary');
    }
    return {
      command: 'option-add',
      slug,
      title,
      stage,
      summary,
      advantages: optionAdvantages,
      tradeoffs: optionTradeoffs,
      risks: optionRisks,
      fitSummary: optionFitSummary,
    };
  }
  if (command === 'option-list') {
    return { command: 'option-list', slug };
  }
  if (command === 'option-select') {
    if (!recordId || !note) {
      throw new Error('option select requires --id and --note');
    }
    return { command: 'option-select', slug, id: recordId, note };
  }
  if (command === 'option-reject') {
    if (!recordId || !note) {
      throw new Error('option reject requires --id and --note');
    }
    return { command: 'option-reject', slug, id: recordId, note };
  }
  if (command === 'tradeoff-converge') {
    if (!recordId) {
      throw new Error('tradeoff converge requires --id');
    }
    return {
      command: 'tradeoff-converge',
      slug,
      id: recordId,
      note: note ?? null,
      decisionIds,
    };
  }
  if (command === 'tradeoff-supersede') {
    if (!recordId || !note) {
      throw new Error('tradeoff supersede requires --id and --note');
    }
    return { command: 'tradeoff-supersede', slug, id: recordId, note };
  }
  if (command === 'decision-propose') {
    if (!stage || !title || decisionLines.length === 0 || rationaleLines.length === 0) {
      throw new Error(
        'decision propose requires --stage, --title, --decision-lines, and --rationale-lines',
      );
    }
    return {
      command: 'decision-propose',
      slug,
      stage,
      title,
      decision: decisionLines,
      rationale: rationaleLines,
      questionIds,
      tradeoffIds,
      packetFiles,
    };
  }
  if (command === 'decision-list') {
    return { command: 'decision-list', slug };
  }
  if (command === 'decision-approve') {
    if (!recordId || !checkpointId) {
      throw new Error('decision approve requires --id and --checkpoint-id');
    }
    return { command: 'decision-approve', slug, id: recordId, checkpointId, note: note ?? null };
  }
  if (command === 'decision-reject') {
    if (!recordId || !note) {
      throw new Error('decision reject requires --id and --note');
    }
    return { command: 'decision-reject', slug, id: recordId, note };
  }
  if (command === 'decision-supersede') {
    if (!recordId || !note) {
      throw new Error('decision supersede requires --id and --note');
    }
    return { command: 'decision-supersede', slug, id: recordId, note };
  }
  if (command === 'audit-summary') {
    return { command: 'audit-summary', slug };
  }
  if (command === 'audit-blockers') {
    return { command: 'audit-blockers', slug };
  }
  if (command === 'packet-status') {
    return { command: 'packet-status', slug };
  }
  if (command === 'packet-refresh') {
    return { command: 'packet-refresh', slug, note: note ?? null };
  }
  if (command === 'handoff-refresh') {
    return { command: 'handoff-refresh', slug };
  }
  if (command === 'handoff-show') {
    return { command: 'handoff-show', slug };
  }
  if (command === 'handoff-consume') {
    return { command: 'handoff-consume', slug, note: note ?? null };
  }
  if (command === 'timeline') {
    return { command: 'timeline', slug };
  }
  if (command === 'history') {
    return { command: 'history', slug };
  }
  if (command === 'diff-exported-packet') {
    if (!exportId) {
      throw new Error('diff exported-packet requires --export-id');
    }
    return { command: 'diff-exported-packet', slug, exportId };
  }
  if (command === 'resume-from-state') {
    return { command: 'resume-from-state', slug };
  }
  if (command === 'resume-from-handoff') {
    return { command: 'resume-from-handoff', slug };
  }
  return { command: 'handoff', slug };
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function validateSlug(slug: string): void {
  if (!slugPattern.test(slug)) {
    throw new Error(`Invalid slug "${slug}". Use lowercase letters, numbers, and hyphens only.`);
  }
}

function parseStageId(value: string): StageId {
  if ((stageIds as readonly string[]).includes(value)) {
    return value as StageId;
  }
  throw new Error(`Unknown stage id: ${value}`);
}

function parseStageStatus(value: string): StageStatus {
  if ((stageStatuses as readonly string[]).includes(value)) {
    return value as StageStatus;
  }
  throw new Error(`Unknown stage status: ${value}`);
}

function parseCheckpointType(value: string): CheckpointType {
  if ((checkpointTypes as readonly string[]).includes(value)) {
    return value as CheckpointType;
  }
  throw new Error(`Unknown checkpoint type: ${value}`);
}

function parseQuestionImpact(value: string): QuestionImpact {
  if (value === 'blocking' || value === 'non_blocking') {
    return value;
  }
  throw new Error(`Unknown question impact: ${value}`);
}

function parseCsvValues(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export const __testUtils = {
  parseArgs,
  countTemplatePlaceholders,
  parseQuestionTable,
  parseTradeoffBlocks,
  parseDecisionBlocks,
  parseOptionBlocks,
  buildConvergenceReport,
  nextRecordId,
  getPreparationPaths,
  runCliForTest,
  runCliWithCapturedOutput,
};

function getPreparationPaths(slug: string): PreparationPaths {
  const rootDir = path.join(preparationRoot, slug);
  return {
    rootDir,
    packetDir: path.join(rootDir, 'packet'),
    processDir: path.join(rootDir, 'process'),
    exportsDir: path.join(rootDir, 'exports'),
    handoffsDir: path.join(rootDir, 'handoffs'),
    historyDir: path.join(rootDir, 'history'),
    readmePath: path.join(rootDir, 'README.md'),
  };
}

async function initPreparation(options: InitOptions): Promise<void> {
  const paths = getPreparationPaths(options.slug);
  await fs.mkdir(paths.rootDir, { recursive: true });
  await fs.mkdir(paths.processDir, { recursive: true });
  await fs.mkdir(paths.packetDir, { recursive: true });
  await fs.mkdir(paths.exportsDir, { recursive: true });
  await fs.mkdir(paths.handoffsDir, { recursive: true });
  await fs.mkdir(paths.historyDir, { recursive: true });

  const results: InitResult[] = [];
  results.push(
    await writeScaffoldFile(
      paths.readmePath,
      buildPreparationReadme(options.slug),
      options.force,
    ),
  );

  for (const [relativePath, content] of Object.entries(buildProcessScaffold(options.slug))) {
    results.push(
      await writeScaffoldFile(path.join(paths.rootDir, relativePath), content, options.force),
    );
  }

  for (const file of requiredPacketFiles) {
    const sourcePath = path.join(templateRoot, file);
    const destinationPath = path.join(paths.packetDir, file);
    const templateContent = await fs.readFile(sourcePath, 'utf8');
    results.push(await writeScaffoldFile(destinationPath, templateContent, options.force));
  }

  const created = results.filter((result) => result.action === 'created').length;
  const overwritten = results.filter((result) => result.action === 'overwritten').length;
  const skipped = results.filter((result) => result.action === 'skipped').length;

  process.stdout.write(`Preparation root: ${paths.rootDir}\n`);
  process.stdout.write(
    `Init summary: created=${created} overwritten=${overwritten} skipped=${skipped}\n`,
  );
  for (const result of results) {
    process.stdout.write(`- ${result.action}: ${result.path}\n`);
  }
  process.stdout.write(
    `Next: node --import tsx scripts/project-preparation.ts status --slug ${options.slug}\n`,
  );
}

async function writeScaffoldFile(
  filePath: string,
  content: string,
  force: boolean,
): Promise<InitResult> {
  const existingContent = await readFileIfPresent(filePath);
  if (existingContent !== null && existingContent.trim().length > 0 && !force) {
    return {
      path: filePath,
      action: 'skipped',
    };
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return {
    path: filePath,
    action: existingContent === null ? 'created' : 'overwritten',
  };
}

function buildProcessScaffold(slug: string): Record<string, string> {
  const now = new Date().toISOString();
  const state: PreparationState = {
    preparationId: `prep_${slug.replace(/-/g, '_')}`,
    projectSlug: slug,
    title: slug,
    status: 'active',
    currentStageId: 'intake',
    nextStageId: 'clarification',
    readyForConvergenceGate: false,
    readyForPacketExport: false,
    activeCheckpointIds: [],
    latestConvergenceReportId: null,
    latestPacketExportId: null,
    latestHandoffId: null,
    createdAt: now,
    updatedAt: now,
    stages: stageIds.map((stageId) => ({
      stageId,
      status: stageId === 'intake' ? 'in_progress' : 'not_started',
      enteredAt: stageId === 'intake' ? now : null,
      completedAt: null,
      rolledBackAt: null,
      requiredCheckpointIds: [],
      blockingQuestionIds: [],
      producedDecisionIds: [],
      notes: '',
    })),
    checkpoints: [],
  };

  const exportStatus: PacketExportStatus = {
    latestExportId: null,
    status: 'not_ready',
    exported: false,
    exportedAt: null,
    requiresRefresh: false,
    refreshReason: null,
    sourceConvergenceReportId: null,
    sourceDecisionIds: [],
    packetFiles: [...requiredPacketFiles],
    supersededByExportId: null,
  };

  return {
    'process/PREPARATION_STATE.json': `${JSON.stringify(state, null, 2)}\n`,
    'process/OPEN_QUESTIONS.md': [
      '# Open Questions',
      '',
      '## Open',
      '| ID | Stage | Question | Category | Impact | Owner | Notes |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '',
      '## Deferred',
      '| ID | Stage | Question | Why Deferred | Revisit At |',
      '| --- | --- | --- | --- | --- |',
      '',
      '## Resolved',
      '| ID | Stage | Question | Resolution Summary | Resolved At |',
      '| --- | --- | --- | --- | --- |',
      '',
    ].join('\n'),
    'process/TRADEOFF_LEDGER.md': [
      '# Tradeoff Ledger',
      '',
      '## Active Tradeoffs',
      '',
      '### t_001 Example Pressure Question',
      '- Stage: brainstorm',
      '- Pressure Question: `<what pressure question should force a meaningful tradeoff>`',
      '- Must Keep:',
      '  - `<must keep item>`',
      '- Can Drop:',
      '  - `<can drop item>`',
      '- Not Now:',
      '  - `<not now item>`',
      '- Boundary Implication:',
      '  - `<boundary implication>`',
      '- Failure Implication:',
      '  - `<failure implication>`',
      '- Current Leaning:',
      '  - `<current leaning>`',
      '- Still Unresolved:',
      '  - `<remaining uncertainty>`',
      '- Linked Decisions:',
      '  - `<decision id>`',
      '',
    ].join('\n'),
    'process/OPTION_SET.md': [
      '# Option Set',
      '',
      '## Active Options',
      '',
      '### o_001 Example Direction',
      '- Stage: brainstorm',
      '- Summary: `<only use this when materially distinct directions exist>`',
      '- Advantages:',
      '  - `<advantage>`',
      '- Tradeoffs:',
      '  - `<tradeoff>`',
      '- Risks:',
      '  - `<risk>`',
      '- Fit Summary:',
      '  - `<fit summary>`',
      '- Status: active',
      '- Selection Reason:',
      '  - `<selection reason>`',
      '- Rejection Reason:',
      '  - `<rejection reason>`',
      '',
    ].join('\n'),
    'process/DECISION_LOG.md': [
      '# Decision Log',
      '',
      '## Decisions',
      '',
      '### d_001 Example Decision',
      '- Stage: direction_decision',
      '- Status: proposed',
      '- Decision:',
      '  - `<decision text>`',
      '- Rationale:',
      '  - `<rationale>`',
      '- Linked Questions:',
      '  - `<question id>`',
      '- Linked Tradeoffs:',
      '  - `<tradeoff id>`',
      '- Affects Packet Files:',
      '  - `<packet file>`',
      '- Approved By:',
      '  - null',
      '- Approved At:',
      '  - null',
      '',
    ].join('\n'),
    'process/CHECKPOINTS.md': [
      '# Checkpoints',
      '',
      '## Active',
      '',
      '## History',
      '',
    ].join('\n'),
    'process/CONVERGENCE_REPORT.md': [
      '# Convergence Report',
      '',
      '- Report ID: `<report id>`',
      '- Result: fail',
      '- Confirmed By Human: false',
      `- Generated At: ${now}`,
      '',
      '## Checklist',
      '- Project goal is singular: fail',
      '- Primary flow is clear: fail',
      '- Direction is approved: fail',
      '- Scope is frozen: fail',
      '- Boundary is frozen: fail',
      '- Success / evidence is frozen: fail',
      '- Workstreams are shaped: fail',
      '- No blocking open question remains: fail',
      '- Packet export would not mislead: fail',
      '',
      '## Frozen Summary',
      '- Direction: not frozen',
      '- Scope: not frozen',
      '- Boundary: not frozen',
      '- Success / evidence: not frozen',
      '- Workstreams: not frozen',
      '',
      '## Blocking Questions',
      '- `<question id>`',
      '',
      '## Carryable Risks',
      '- none yet',
      '',
      '## Failed Conditions',
      '- preparation has not reached convergence yet',
      '',
      '## Fallback Stage',
      '- intake',
      '',
      '## Next Action',
      '- continue preparation through clarification and brainstorm',
      '',
    ].join('\n'),
    'process/PACKET_EXPORT_STATUS.json': `${JSON.stringify(exportStatus, null, 2)}\n`,
    'history/timeline.md': ['# Preparation Timeline', '', '- initialized preparation scaffold', ''].join(
      '\n',
    ),
    'history/stage-transitions.jsonl': '',
  };
}

function buildPreparationReadme(slug: string): string {
  return [
    '# Preparation README',
    '',
    `- Project slug: \`${slug}\``,
    '- Current state lives under `process/`.',
    '- Current canonical packet lives under `packet/`.',
    '- Historical exports live under `exports/`.',
    '- Historical handoffs live under `handoffs/`.',
    '- Timeline and event history live under `history/`.',
    '',
  ].join('\n');
}

async function runStatus(options: StatusOptions): Promise<void> {
  const assessment = await assessPreparation(options.slug);
  printAssessment(assessment);
}

async function runCheck(options: CheckOptions): Promise<void> {
  const assessment = await assessPreparation(options.slug);
  printAssessment(assessment);
  if (assessment.readiness !== 'ready_for_downstream_handoff') {
    process.exitCode = 1;
  }
}

async function runAdvance(options: AdvanceOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  const stage = requireStageState(state, options.stage);
  const now = new Date().toISOString();

  if (options.status === 'completed' && stageRequiresCheckpoint(options.stage)) {
    const approvedCheckpoint = findLatestCheckpoint(state, {
      stageId: options.stage,
      statuses: ['approved'],
    });
    if (!approvedCheckpoint) {
      throw new Error(
        `Cannot complete ${options.stage} without an approved checkpoint for that stage.`,
      );
    }
  }

  stage.status = options.status;
  stage.notes = options.note ?? stage.notes;
  state.currentStageId = options.stage;
  state.updatedAt = now;

  if ((options.status === 'in_progress' || options.status === 'human_review_required') && !stage.enteredAt) {
    stage.enteredAt = now;
  }
  if (options.status === 'completed') {
    stage.completedAt = now;
    stage.rolledBackAt = null;
    state.nextStageId = getNextStageId(options.stage);
  } else if (options.status === 'rolled_back') {
    stage.rolledBackAt = now;
    stage.completedAt = null;
    state.nextStageId = options.stage;
  } else {
    stage.completedAt = options.status === 'not_started' ? null : stage.completedAt;
    state.nextStageId = options.stage;
  }

  await writePreparationState(paths.processDir, state);
  await appendHistory(paths.historyDir, [
    `- ${now}: stage ${options.stage} -> ${options.status}${options.note ? ` (${options.note})` : ''}`,
  ]);

  process.stdout.write(`Advanced ${options.stage} -> ${options.status}\n`);
  process.stdout.write(`Preparation: ${paths.rootDir}\n`);
}

async function runCheckpointList(options: CheckpointListOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  const checkpoints = state.checkpoints ?? [];
  const active = checkpoints.filter((checkpoint) =>
    checkpoint.status === 'open' || checkpoint.status === 'pending_human',
  );
  const history = checkpoints.filter(
    (checkpoint) => checkpoint.status !== 'open' && checkpoint.status !== 'pending_human',
  );

  process.stdout.write(`Preparation: ${paths.rootDir}\n`);
  process.stdout.write(`Active checkpoints: ${active.length}\n`);
  if (active.length === 0) {
    process.stdout.write('- none\n');
  } else {
    for (const checkpoint of active) {
      process.stdout.write(
        `- ${checkpoint.checkpointId} stage=${checkpoint.stageId} type=${checkpoint.type} status=${checkpoint.status}\n`,
      );
    }
  }

  process.stdout.write(`History checkpoints: ${history.length}\n`);
  if (history.length > 0) {
    for (const checkpoint of history.slice(-10)) {
      process.stdout.write(
        `- ${checkpoint.checkpointId} stage=${checkpoint.stageId} type=${checkpoint.type} status=${checkpoint.status}\n`,
      );
    }
  }
}

async function runCheckpointOpen(options: CheckpointOpenOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  validateCheckpointStagePair(options.type, options.stage);

  const now = new Date().toISOString();
  const checkpoints = state.checkpoints ?? [];
  for (const checkpoint of checkpoints) {
    if (
      checkpoint.stageId === options.stage &&
      checkpoint.type === options.type &&
      (checkpoint.status === 'open' || checkpoint.status === 'pending_human')
    ) {
      checkpoint.status = 'superseded';
      checkpoint.updatedAt = now;
    }
  }

  const checkpointId = nextCheckpointId(checkpoints);
  const rollbackTarget = options.rollbackTarget ?? defaultRollbackTarget(options.stage);
  const record: CheckpointRecord = {
    checkpointId,
    stageId: options.stage,
    type: options.type,
    status: 'pending_human',
    promptSummary: options.summary,
    approvalSummary: null,
    correctionSummary: null,
    rejectionReason: null,
    decidedBy: null,
    decidedAt: null,
    rollbackTargetStageId: rollbackTarget,
    linkedDecisionIds: options.decisionIds,
    createdAt: now,
    updatedAt: now,
  };
  checkpoints.push(record);
  state.checkpoints = checkpoints;
  state.activeCheckpointIds = checkpoints
    .filter((checkpoint) => checkpoint.status === 'open' || checkpoint.status === 'pending_human')
    .map((checkpoint) => checkpoint.checkpointId);
  state.currentStageId = options.stage;
  state.nextStageId = options.stage;
  state.updatedAt = now;

  const stage = requireStageState(state, options.stage);
  stage.status = 'human_review_required';
  stage.enteredAt = stage.enteredAt ?? now;
  stage.requiredCheckpointIds = uniqueValues([...stage.requiredCheckpointIds, checkpointId]);

  await persistCheckpointState(paths, state);
  await appendHistory(paths.historyDir, [
    `- ${now}: opened checkpoint ${checkpointId} for ${options.stage} (${options.type})`,
  ]);

  process.stdout.write(`Opened checkpoint ${checkpointId}\n`);
  process.stdout.write(`Stage: ${options.stage}\n`);
  process.stdout.write(`Type: ${options.type}\n`);
}

async function runCheckpointApprove(
  options: CheckpointApproveOptions | CheckpointApproveWithCorrectionOptions,
): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  const checkpoint = requireCheckpoint(state, options.checkpointId);
  const now = new Date().toISOString();

  checkpoint.status = 'approved';
  checkpoint.approvalSummary = options.note ?? 'approved';
  checkpoint.correctionSummary =
    options.command === 'checkpoint-approve-with-correction' ? options.note : null;
  checkpoint.rejectionReason = null;
  checkpoint.decidedBy = 'human';
  checkpoint.decidedAt = now;
  checkpoint.updatedAt = now;

  state.activeCheckpointIds = (state.checkpoints ?? [])
    .filter(
      (candidate) =>
        candidate.checkpointId !== checkpoint.checkpointId &&
        (candidate.status === 'open' || candidate.status === 'pending_human'),
    )
    .map((candidate) => candidate.checkpointId);
  state.updatedAt = now;

  applyApprovalEffects(state, checkpoint, now);

  await persistCheckpointState(paths, state);
  await appendHistory(paths.historyDir, [
    `- ${now}: approved checkpoint ${checkpoint.checkpointId}${checkpoint.correctionSummary ? ' with correction' : ''}`,
  ]);

  process.stdout.write(`Approved checkpoint ${checkpoint.checkpointId}\n`);
  if (checkpoint.correctionSummary) {
    process.stdout.write(`Correction: ${checkpoint.correctionSummary}\n`);
  }
}

async function runCheckpointReject(options: CheckpointRejectOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  const checkpoint = requireCheckpoint(state, options.checkpointId);
  const now = new Date().toISOString();

  checkpoint.status = 'rejected';
  checkpoint.rejectionReason = options.note;
  checkpoint.rollbackTargetStageId = options.rollbackTarget;
  checkpoint.decidedBy = 'human';
  checkpoint.decidedAt = now;
  checkpoint.updatedAt = now;

  applyRejectionEffects(state, checkpoint, options.rollbackTarget, now);
  state.updatedAt = now;
  state.activeCheckpointIds = (state.checkpoints ?? [])
    .filter(
      (candidate) =>
        candidate.checkpointId !== checkpoint.checkpointId &&
        (candidate.status === 'open' || candidate.status === 'pending_human'),
    )
    .map((candidate) => candidate.checkpointId);

  await persistCheckpointState(paths, state);
  await appendHistory(paths.historyDir, [
    `- ${now}: rejected checkpoint ${checkpoint.checkpointId}; rollback -> ${options.rollbackTarget} (${options.note})`,
  ]);

  process.stdout.write(`Rejected checkpoint ${checkpoint.checkpointId}\n`);
  process.stdout.write(`Rollback target: ${options.rollbackTarget}\n`);
}

async function runConvergenceCheck(options: CheckConvergenceOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  const now = new Date().toISOString();
  const reportId = nextConvergenceReportId(state.latestConvergenceReportId);
  const blockingQuestions = await readBlockingQuestions(paths.processDir);
  const packetChecks = await assessPacketForExport(paths.packetDir);

  const checklist = [
    {
      label: 'Project goal is singular',
      passed: packetChecks.projectBriefHealthy,
      fallbackStage: 'clarification' as StageId,
      reason: 'PROJECT_BRIEF.md is still incomplete or placeholder-heavy.',
    },
    {
      label: 'Primary flow is clear',
      passed: packetChecks.projectBriefHealthy,
      fallbackStage: 'clarification' as StageId,
      reason: 'PROJECT_BRIEF.md does not yet support a stable primary flow.',
    },
    {
      label: 'Direction is approved',
      passed: hasApprovedCheckpointByType(state, 'direction'),
      fallbackStage: 'direction_decision' as StageId,
      reason: 'Direction checkpoint is not yet approved.',
    },
    {
      label: 'Scope is frozen',
      passed:
        hasApprovedCheckpointByType(state, 'scope') &&
        packetChecks.scopeHealthy,
      fallbackStage: 'scope_freeze' as StageId,
      reason: 'Scope freeze is incomplete or scope packet files still contain placeholders.',
    },
    {
      label: 'Boundary is frozen',
      passed:
        hasApprovedCheckpointByType(state, 'boundary') &&
        packetChecks.boundaryHealthy,
      fallbackStage: 'boundary_freeze' as StageId,
      reason: 'Boundary freeze is incomplete or ARCHITECTURE_BOUNDARY.md still needs work.',
    },
    {
      label: 'Success / evidence is frozen',
      passed:
        hasApprovedCheckpointByType(state, 'success_evidence') &&
        packetChecks.successHealthy,
      fallbackStage: 'success_evidence_freeze' as StageId,
      reason: 'Success/evidence freeze is incomplete or SUCCESS_CRITERIA.md still needs work.',
    },
    {
      label: 'Workstreams are shaped',
      passed:
        requireStageState(state, 'workstream_shaping').status === 'completed' &&
        packetChecks.workstreamsHealthy,
      fallbackStage: 'workstream_shaping' as StageId,
      reason: 'Workstream shaping is incomplete or INITIAL_WORKSTREAMS.md still needs work.',
    },
    {
      label: 'No blocking open question remains',
      passed: blockingQuestions.length === 0,
      fallbackStage: deriveFallbackStageFromBlockingQuestions(blockingQuestions),
      reason: 'Blocking open questions still remain in OPEN_QUESTIONS.md.',
    },
    {
      label: 'Packet export would not mislead',
      passed: packetChecks.problems.length === 0,
      fallbackStage: packetChecks.fallbackStage,
      reason: packetChecks.problems[0] ?? 'Packet still contains incomplete frozen content.',
    },
  ];

  const failed = checklist.filter((item) => !item.passed);
  const result = failed.length === 0 ? 'pass' : 'fail';
  const fallbackStage = failed[0]?.fallbackStage ?? 'packet_export';
  const carryableRisks = await readCarryableRisks(paths.packetDir);
  const report = buildConvergenceReport({
    reportId,
    result,
    generatedAt: now,
    checklist,
    blockingQuestions,
    carryableRisks,
    fallbackStage,
  });

  await fs.writeFile(path.join(paths.processDir, 'CONVERGENCE_REPORT.md'), report, 'utf8');

  state.latestConvergenceReportId = reportId;
  state.readyForConvergenceGate = result === 'pass';
  state.readyForPacketExport = false;
  state.updatedAt = now;
  state.currentStageId = 'convergence_gate';
  state.nextStageId = result === 'pass' ? 'packet_export' : fallbackStage;
  const convergenceStage = requireStageState(state, 'convergence_gate');
  convergenceStage.status = 'human_review_required';
  convergenceStage.enteredAt = convergenceStage.enteredAt ?? now;
  convergenceStage.completedAt = null;

  await writePreparationState(paths.processDir, state);
  await appendHistory(paths.historyDir, [
    `- ${now}: convergence gate ${result} (${reportId})${failed.length > 0 ? ` fallback -> ${fallbackStage}` : ''}`,
  ]);

  process.stdout.write(`Convergence report: ${reportId}\n`);
  process.stdout.write(`Result: ${result}\n`);
  if (failed.length > 0) {
    process.stdout.write(`Fallback stage: ${fallbackStage}\n`);
    for (const item of failed) {
      process.stdout.write(`- fail: ${item.label} (${item.reason})\n`);
    }
  }
}

async function runExportPacket(options: ExportPacketOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  const exportStatus = await readFullPacketExportStatus(paths.processDir);
  const convergenceReport = await readFileIfPresent(path.join(paths.processDir, 'CONVERGENCE_REPORT.md'));
  const now = new Date().toISOString();

  if (!state.latestConvergenceReportId || !convergenceReport?.includes('- Result: pass')) {
    throw new Error('Packet export requires a passing convergence report.');
  }
  if (!state.readyForPacketExport) {
    throw new Error('Packet export requires convergence approval before publishing.');
  }
  const approvedPacketExportCheckpoint = findLatestCheckpoint(state, {
    type: 'packet_export',
    statuses: ['approved'],
  });
  if (!approvedPacketExportCheckpoint) {
    throw new Error('Packet export requires an approved packet_export checkpoint.');
  }

  const packetChecks = await assessPacketForExport(paths.packetDir);
  if (packetChecks.problems.length > 0) {
    throw new Error(`Packet export is blocked: ${packetChecks.problems[0]}`);
  }

  const exportId = await nextSnapshotId(paths.exportsDir, 'export-');
  const exportDir = path.join(paths.exportsDir, exportId);
  await fs.mkdir(exportDir, { recursive: true });
  for (const file of requiredPacketFiles) {
    const sourcePath = path.join(paths.packetDir, file);
    const content = (await readFileIfPresent(sourcePath)) ?? '';
    await fs.writeFile(path.join(exportDir, file), content, 'utf8');
  }

  const previousExportId = exportStatus.latestExportId;
  const exportMeta = {
    exportId,
    generatedAt: now,
    sourceConvergenceReportId: state.latestConvergenceReportId,
    sourceCheckpointId: approvedPacketExportCheckpoint.checkpointId,
    sourceDecisionIds: approvedPacketExportCheckpoint.linkedDecisionIds,
    status: 'exported',
    note: options.note,
    supersedes: previousExportId,
  };
  await fs.writeFile(
    path.join(exportDir, 'export-meta.json'),
    `${JSON.stringify(exportMeta, null, 2)}\n`,
    'utf8',
  );

  if (previousExportId) {
    const previousMetaPath = path.join(paths.exportsDir, previousExportId, 'export-meta.json');
    const previousMetaContent = await readFileIfPresent(previousMetaPath);
    if (previousMetaContent) {
      try {
        const parsed = JSON.parse(previousMetaContent) as Record<string, unknown>;
        parsed.status = 'superseded';
        parsed.supersededByExportId = exportId;
        await fs.writeFile(previousMetaPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
      } catch {
        // Leave malformed export metadata untouched.
      }
    }
  }

  const nextExportStatus: PacketExportStatus = {
    latestExportId: exportId,
    status: 'exported',
    exported: true,
    exportedAt: now,
    requiresRefresh: false,
    refreshReason: null,
    sourceConvergenceReportId: state.latestConvergenceReportId,
    sourceDecisionIds: approvedPacketExportCheckpoint.linkedDecisionIds,
    packetFiles: [...requiredPacketFiles],
    supersededByExportId: null,
  };
  await writePacketExportStatus(paths.processDir, nextExportStatus);

  if (state.latestHandoffId) {
    await updateHandoffSnapshotStatus(paths.handoffsDir, state.latestHandoffId, 'stale', {
      staleReason: `packet export ${exportId} superseded export ${previousExportId ?? 'none'}`,
      staleAt: now,
    });
  }

  state.latestPacketExportId = exportId;
  state.status = 'exported';
  state.updatedAt = now;
  state.currentStageId = 'packet_export';
  state.nextStageId = 'handoff';
  const exportStage = requireStageState(state, 'packet_export');
  exportStage.status = 'completed';
  exportStage.enteredAt = exportStage.enteredAt ?? now;
  exportStage.completedAt = now;
  await writePreparationState(paths.processDir, state);

  await appendHistory(paths.historyDir, [
    `- ${now}: published packet export ${exportId}${options.note ? ` (${options.note})` : ''}`,
  ]);

  process.stdout.write(`Packet export published: ${exportId}\n`);
  process.stdout.write(`Export path: ${exportDir}\n`);
}

async function runQuestionAdd(options: QuestionAddOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  const questions = await readOpenQuestions(paths.processDir);
  const now = new Date().toISOString();
  const id = nextRecordId(questions.map((question) => question.id), 'q_');
  const record: QuestionRecord = {
    id,
    stageId: options.stage,
    question: options.question,
    category: options.category,
    impact: options.impact,
    owner: options.owner,
    notes: options.note ?? '',
    status: 'open',
  };
  questions.push(record);
  await writeOpenQuestions(paths.processDir, questions);
  if (options.impact === 'blocking') {
    const stage = requireStageState(state, options.stage);
    stage.blockingQuestionIds = uniqueValues([...stage.blockingQuestionIds, id]);
    state.readyForConvergenceGate = false;
    state.readyForPacketExport = false;
    state.status = 'active';
  }
  state.updatedAt = now;
  await writePreparationState(paths.processDir, state);
  await appendHistory(paths.historyDir, [
    `- ${now}: added question ${id} at ${options.stage} (${options.impact})`,
  ]);
  process.stdout.write(`Added question ${id}\n`);
}

async function runQuestionList(options: QuestionListOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const questions = await readOpenQuestions(paths.processDir);
  const byStatus: QuestionStatus[] = ['open', 'deferred', 'resolved', 'superseded'];
  process.stdout.write(`Preparation: ${paths.rootDir}\n`);
  for (const status of byStatus) {
    const records = questions.filter((question) => question.status === status);
    process.stdout.write(`${status}: ${records.length}\n`);
    for (const record of records) {
      process.stdout.write(
        `- ${record.id} stage=${record.stageId} impact=${record.impact} owner=${record.owner} question=${record.question}\n`,
      );
    }
  }
}

async function runQuestionResolve(options: QuestionResolveOptions): Promise<void> {
  await updateQuestionStatus(options.slug, options.id, 'resolved', options.note, null);
}

async function runQuestionDefer(options: QuestionDeferOptions): Promise<void> {
  await updateQuestionStatus(options.slug, options.id, 'deferred', options.note, options.revisitAt);
}

async function runQuestionReopen(options: QuestionReopenOptions): Promise<void> {
  await updateQuestionStatus(options.slug, options.id, 'open', options.note ?? '', null);
}

async function runTradeoffAdd(options: TradeoffAddOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const tradeoffs = await readTradeoffs(paths.processDir);
  const now = new Date().toISOString();
  const id = nextRecordId(tradeoffs.map((tradeoff) => tradeoff.id), 't_');
  tradeoffs.push({
    id,
    title: options.title,
    stageId: options.stage,
    pressureQuestion: options.pressureQuestion,
    mustKeep: options.mustKeep,
    canDrop: options.canDrop,
    notNow: options.notNow,
    boundaryImplication: options.boundaryImplication,
    failureImplication: options.failureImplication,
    currentLeaning: options.currentLeaning,
    stillUnresolved: options.unresolved,
    linkedDecisionIds: options.decisionIds,
    status: 'active',
  });
  await writeTradeoffs(paths.processDir, tradeoffs);
  await appendHistory(paths.historyDir, [`- ${now}: added tradeoff ${id} (${options.title})`]);
  process.stdout.write(`Added tradeoff ${id}\n`);
}

async function runTradeoffList(options: TradeoffListOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const tradeoffs = await readTradeoffs(paths.processDir);
  const statuses: TradeoffStatus[] = ['active', 'converged', 'superseded'];
  process.stdout.write(`Preparation: ${paths.rootDir}\n`);
  for (const status of statuses) {
    const records = tradeoffs.filter((tradeoff) => tradeoff.status === status);
    process.stdout.write(`${status}: ${records.length}\n`);
    for (const record of records) {
      process.stdout.write(`- ${record.id} stage=${record.stageId} title=${record.title}\n`);
    }
  }
}

async function runTradeoffConverge(options: TradeoffConvergeOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const tradeoffs = await readTradeoffs(paths.processDir);
  const tradeoff = tradeoffs.find((record) => record.id === options.id);
  if (!tradeoff) {
    throw new Error(`Tradeoff ${options.id} does not exist.`);
  }
  tradeoff.status = 'converged';
  tradeoff.linkedDecisionIds = uniqueValues([...tradeoff.linkedDecisionIds, ...options.decisionIds]);
  if (options.note) {
    tradeoff.currentLeaning = uniqueValues([...tradeoff.currentLeaning, options.note]);
  }
  await writeTradeoffs(paths.processDir, tradeoffs);
  await appendHistory(paths.historyDir, [
    `- ${new Date().toISOString()}: converged tradeoff ${options.id}`,
  ]);
  process.stdout.write(`Converged tradeoff ${options.id}\n`);
}

async function runTradeoffSupersede(options: TradeoffSupersedeOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const tradeoffs = await readTradeoffs(paths.processDir);
  const tradeoff = tradeoffs.find((record) => record.id === options.id);
  if (!tradeoff) {
    throw new Error(`Tradeoff ${options.id} does not exist.`);
  }
  tradeoff.status = 'superseded';
  tradeoff.stillUnresolved = uniqueValues([...tradeoff.stillUnresolved, options.note]);
  await writeTradeoffs(paths.processDir, tradeoffs);
  await appendHistory(paths.historyDir, [
    `- ${new Date().toISOString()}: superseded tradeoff ${options.id} (${options.note})`,
  ]);
  process.stdout.write(`Superseded tradeoff ${options.id}\n`);
}

async function runDecisionPropose(options: DecisionProposeOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  const decisions = await readDecisions(paths.processDir);
  const now = new Date().toISOString();
  const id = nextRecordId(decisions.map((decision) => decision.id), 'd_');
  decisions.push({
    id,
    title: options.title,
    stageId: options.stage,
    status: 'proposed',
    decision: options.decision,
    rationale: options.rationale,
    linkedQuestionIds: options.questionIds,
    linkedTradeoffIds: options.tradeoffIds,
    affectsPacketFiles: options.packetFiles,
    approvedBy: null,
    approvedAt: null,
    rejectionReason: null,
    checkpointId: null,
  });
  const stage = requireStageState(state, options.stage);
  stage.producedDecisionIds = uniqueValues([...stage.producedDecisionIds, id]);
  state.updatedAt = now;
  await writeDecisions(paths.processDir, decisions);
  await writePreparationState(paths.processDir, state);
  await appendHistory(paths.historyDir, [`- ${now}: proposed decision ${id} (${options.title})`]);
  process.stdout.write(`Proposed decision ${id}\n`);
}

async function runDecisionList(options: DecisionListOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const decisions = await readDecisions(paths.processDir);
  const statuses: DecisionStatus[] = ['proposed', 'approved', 'rejected', 'superseded'];
  process.stdout.write(`Preparation: ${paths.rootDir}\n`);
  for (const status of statuses) {
    const records = decisions.filter((decision) => decision.status === status);
    process.stdout.write(`${status}: ${records.length}\n`);
    for (const record of records) {
      process.stdout.write(`- ${record.id} stage=${record.stageId} title=${record.title}\n`);
    }
  }
}

async function runDecisionApprove(options: DecisionApproveOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  const checkpoint = requireCheckpoint(state, options.checkpointId);
  if (checkpoint.status !== 'approved') {
    throw new Error(`Checkpoint ${options.checkpointId} is not approved.`);
  }
  const decisions = await readDecisions(paths.processDir);
  const decision = decisions.find((record) => record.id === options.id);
  if (!decision) {
    throw new Error(`Decision ${options.id} does not exist.`);
  }
  if (!checkpoint.linkedDecisionIds.includes(decision.id)) {
    throw new Error(
      `Decision ${decision.id} is not linked to approved checkpoint ${checkpoint.checkpointId}.`,
    );
  }
  decision.status = 'approved';
  decision.approvedBy = 'human';
  decision.approvedAt = new Date().toISOString();
  decision.checkpointId = checkpoint.checkpointId;
  if (options.note) {
    decision.rationale = uniqueValues([...decision.rationale, options.note]);
  }
  await writeDecisions(paths.processDir, decisions);
  await appendHistory(paths.historyDir, [
    `- ${decision.approvedAt}: approved decision ${decision.id} via ${checkpoint.checkpointId}`,
  ]);
  process.stdout.write(`Approved decision ${decision.id}\n`);
}

async function runDecisionReject(options: DecisionRejectOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const decisions = await readDecisions(paths.processDir);
  const decision = decisions.find((record) => record.id === options.id);
  if (!decision) {
    throw new Error(`Decision ${options.id} does not exist.`);
  }
  decision.status = 'rejected';
  decision.rejectionReason = options.note;
  await writeDecisions(paths.processDir, decisions);
  await appendHistory(paths.historyDir, [
    `- ${new Date().toISOString()}: rejected decision ${decision.id} (${options.note})`,
  ]);
  process.stdout.write(`Rejected decision ${decision.id}\n`);
}

async function runDecisionSupersede(options: DecisionSupersedeOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const decisions = await readDecisions(paths.processDir);
  const decision = decisions.find((record) => record.id === options.id);
  if (!decision) {
    throw new Error(`Decision ${options.id} does not exist.`);
  }
  decision.status = 'superseded';
  decision.rejectionReason = options.note;
  await writeDecisions(paths.processDir, decisions);
  await appendHistory(paths.historyDir, [
    `- ${new Date().toISOString()}: superseded decision ${decision.id} (${options.note})`,
  ]);
  process.stdout.write(`Superseded decision ${decision.id}\n`);
}

async function runOptionAdd(options: OptionAddOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const records = await readOptions(paths.processDir);
  const id = nextRecordId(records.map((record) => record.id), 'o_');
  records.push({
    id,
    title: options.title,
    stageId: options.stage,
    summary: options.summary,
    advantages: options.advantages,
    tradeoffs: options.tradeoffs,
    risks: options.risks,
    fitSummary: options.fitSummary,
    status: 'active',
    selectionReason: null,
    rejectionReason: null,
  });
  await writeOptions(paths.processDir, records);
  await appendHistory(paths.historyDir, [
    `- ${new Date().toISOString()}: added option ${id} (${options.title})`,
  ]);
  process.stdout.write(`Added option ${id}\n`);
}

async function runOptionList(options: OptionListOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const records = await readOptions(paths.processDir);
  const statuses: OptionStatus[] = ['active', 'selected', 'rejected', 'superseded'];
  process.stdout.write(`Preparation: ${paths.rootDir}\n`);
  for (const status of statuses) {
    const optionsForStatus = records.filter((record) => record.status === status);
    process.stdout.write(`${status}: ${optionsForStatus.length}\n`);
    for (const record of optionsForStatus) {
      process.stdout.write(`- ${record.id} stage=${record.stageId} title=${record.title}\n`);
    }
  }
}

async function runOptionSelect(options: OptionSelectOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const records = await readOptions(paths.processDir);
  const record = records.find((candidate) => candidate.id === options.id);
  if (!record) {
    throw new Error(`Option ${options.id} does not exist.`);
  }
  for (const candidate of records) {
    if (candidate.stageId === record.stageId && candidate.status === 'selected') {
      candidate.status = 'superseded';
      candidate.rejectionReason = `replaced by ${record.id}`;
    }
  }
  record.status = 'selected';
  record.selectionReason = options.note;
  await writeOptions(paths.processDir, records);
  await appendHistory(paths.historyDir, [
    `- ${new Date().toISOString()}: selected option ${record.id} (${options.note})`,
  ]);
  process.stdout.write(`Selected option ${record.id}\n`);
}

async function runOptionReject(options: OptionRejectOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const records = await readOptions(paths.processDir);
  const record = records.find((candidate) => candidate.id === options.id);
  if (!record) {
    throw new Error(`Option ${options.id} does not exist.`);
  }
  record.status = 'rejected';
  record.rejectionReason = options.note;
  await writeOptions(paths.processDir, records);
  await appendHistory(paths.historyDir, [
    `- ${new Date().toISOString()}: rejected option ${record.id} (${options.note})`,
  ]);
  process.stdout.write(`Rejected option ${record.id}\n`);
}

async function runAuditSummary(options: AuditSummaryOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  const assessment = await assessPreparation(options.slug);
  const questions = await readOpenQuestions(paths.processDir);
  const checkpoints = state.checkpoints ?? [];
  const exportStatus = await readFullPacketExportStatus(paths.processDir);

  process.stdout.write(`Preparation: ${paths.rootDir}\n`);
  process.stdout.write(`Status: ${state.status}\n`);
  process.stdout.write(`Current stage: ${state.currentStageId}\n`);
  process.stdout.write(`Next stage: ${state.nextStageId ?? 'none'}\n`);
  process.stdout.write(`Readiness: ${assessment.readiness}\n`);
  process.stdout.write(`Open questions: ${questions.filter((question) => question.status === 'open').length}\n`);
  process.stdout.write(`Blocking open questions: ${questions.filter((question) => question.status === 'open' && question.impact === 'blocking').length}\n`);
  process.stdout.write(`Active checkpoints: ${checkpoints.filter((checkpoint) => checkpoint.status === 'open' || checkpoint.status === 'pending_human').length}\n`);
  process.stdout.write(`Latest convergence report: ${state.latestConvergenceReportId ?? 'none'}\n`);
  process.stdout.write(`Latest export: ${exportStatus.latestExportId ?? 'none'} (${exportStatus.status})\n`);
  process.stdout.write(`Latest handoff: ${state.latestHandoffId ?? 'none'}\n`);
}

async function runAuditBlockers(options: AuditBlockersOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const assessment = await assessPreparation(options.slug);
  const questions = await readOpenQuestions(paths.processDir);
  const state = await readPreparationState(paths.processDir);
  const activeCheckpoints = (state.checkpoints ?? []).filter(
    (checkpoint) => checkpoint.status === 'open' || checkpoint.status === 'pending_human',
  );

  process.stdout.write(`Preparation: ${paths.rootDir}\n`);
  process.stdout.write('Blockers:\n');
  const blockingQuestions = questions.filter(
    (question) => question.status === 'open' && question.impact === 'blocking',
  );
  for (const question of blockingQuestions) {
    process.stdout.write(`- question ${question.id}: ${question.question}\n`);
  }
  for (const checkpoint of activeCheckpoints) {
    process.stdout.write(
      `- checkpoint ${checkpoint.checkpointId}: ${checkpoint.type} waiting on human review\n`,
    );
  }
  for (const problem of assessment.problems.filter((problem) => problem.severity === 'error')) {
    process.stdout.write(`- ${problem.message}\n`);
  }
  if (
    blockingQuestions.length === 0 &&
    activeCheckpoints.length === 0 &&
    assessment.problems.filter((problem) => problem.severity === 'error').length === 0
  ) {
    process.stdout.write('- none\n');
  }
}

async function runPacketStatus(options: PacketStatusOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  const exportStatus = await readFullPacketExportStatus(paths.processDir);
  process.stdout.write(`Preparation: ${paths.rootDir}\n`);
  process.stdout.write(`Packet path: ${paths.packetDir}\n`);
  process.stdout.write(`Latest export: ${exportStatus.latestExportId ?? 'none'}\n`);
  process.stdout.write(`Export status: ${exportStatus.status}\n`);
  process.stdout.write(`Exported at: ${exportStatus.exportedAt ?? 'null'}\n`);
  process.stdout.write(`Requires refresh: ${exportStatus.requiresRefresh}\n`);
  process.stdout.write(`Source convergence report: ${exportStatus.sourceConvergenceReportId ?? 'none'}\n`);
  process.stdout.write(`State latest handoff: ${state.latestHandoffId ?? 'none'}\n`);
}

async function runPacketRefresh(options: PacketRefreshOptions): Promise<void> {
  await runExportPacket({
    command: 'export-packet',
    slug: options.slug,
    note: options.note ? `refresh: ${options.note}` : 'refresh export',
  });
}

async function runHandoffRefresh(options: HandoffRefreshOptions): Promise<void> {
  await generateHandoff({ command: 'handoff', slug: options.slug });
}

async function runHandoffShow(options: HandoffShowOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  const currentPath = path.join(paths.packetDir, 'NEW_CHAT_HANDOFF_PROMPT.md');
  const currentContent = await readFileIfPresent(currentPath);
  if (!currentContent) {
    throw new Error(`No current handoff exists at ${currentPath}`);
  }
  process.stdout.write(`Preparation: ${paths.rootDir}\n`);
  process.stdout.write(`Current handoff: ${currentPath}\n`);
  process.stdout.write(`Latest handoff id: ${state.latestHandoffId ?? 'none'}\n`);
  process.stdout.write(`${currentContent}\n`);
}

async function runHandoffConsume(options: HandoffConsumeOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  if (!state.latestHandoffId) {
    throw new Error('No latest handoff exists to consume.');
  }
  const metadataPath = path.join(paths.handoffsDir, `${state.latestHandoffId}.json`);
  const metadataContent = await readFileIfPresent(metadataPath);
  if (!metadataContent) {
    throw new Error(`Missing handoff metadata for ${state.latestHandoffId}`);
  }
  const parsed = JSON.parse(metadataContent) as Record<string, unknown>;
  const consumedAt = new Date().toISOString();
  parsed.status = 'consumed';
  parsed.consumedAt = consumedAt;
  parsed.consumeNote = options.note ?? null;
  await fs.writeFile(metadataPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  await appendHistory(paths.historyDir, [
    `- ${consumedAt}: consumed handoff ${state.latestHandoffId}${options.note ? ` (${options.note})` : ''}`,
  ]);
  process.stdout.write(`Consumed handoff ${state.latestHandoffId}\n`);
}

async function runTimeline(options: TimelineOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const content = await readFileIfPresent(path.join(paths.historyDir, 'timeline.md'));
  if (!content) {
    throw new Error(`Missing timeline at ${paths.historyDir}`);
  }
  process.stdout.write(content);
  if (!content.endsWith('\n')) {
    process.stdout.write('\n');
  }
}

async function runHistory(options: HistoryOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const timeline = await readFileIfPresent(path.join(paths.historyDir, 'timeline.md'));
  const transitions = await readFileIfPresent(path.join(paths.historyDir, 'stage-transitions.jsonl'));
  process.stdout.write(`Preparation: ${paths.rootDir}\n`);
  process.stdout.write('Timeline:\n');
  process.stdout.write(`${timeline ?? '# Preparation Timeline\n\n'}\n`);
  process.stdout.write('Stage transitions:\n');
  process.stdout.write(`${transitions ?? ''}`);
  if (transitions && !transitions.endsWith('\n')) {
    process.stdout.write('\n');
  }
}

async function runDiffExportedPacket(options: DiffExportedPacketOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const exportDir = path.join(paths.exportsDir, options.exportId);
  if (!(await isDirectory(exportDir))) {
    throw new Error(`Export snapshot ${options.exportId} does not exist under ${paths.exportsDir}`);
  }
  process.stdout.write(`Preparation: ${paths.rootDir}\n`);
  process.stdout.write(`Diff export: ${options.exportId}\n`);
  for (const file of requiredPacketFiles) {
    const current = await readFileIfPresent(path.join(paths.packetDir, file));
    const historical = await readFileIfPresent(path.join(exportDir, file));
    let status = 'same';
    if (current === null || historical === null) {
      status = 'missing';
    } else if (current !== historical) {
      status = 'changed';
    }
    process.stdout.write(`- ${file}: ${status}\n`);
  }
}

async function runResumeFromState(options: ResumeFromStateOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  const checkpoints = (state.checkpoints ?? []).filter(
    (checkpoint) => checkpoint.status === 'open' || checkpoint.status === 'pending_human',
  );
  process.stdout.write(`Preparation: ${paths.rootDir}\n`);
  process.stdout.write(`Current stage: ${state.currentStageId}\n`);
  process.stdout.write(`Preparation status: ${state.status}\n`);
  process.stdout.write(`Latest convergence report: ${state.latestConvergenceReportId ?? 'none'}\n`);
  process.stdout.write(`Latest export: ${state.latestPacketExportId ?? 'none'}\n`);
  process.stdout.write(`Latest handoff: ${state.latestHandoffId ?? 'none'}\n`);
  if (checkpoints.length > 0) {
    process.stdout.write('Active checkpoints:\n');
    for (const checkpoint of checkpoints) {
      process.stdout.write(`- ${checkpoint.checkpointId} ${checkpoint.type} at ${checkpoint.stageId}\n`);
    }
  } else {
    process.stdout.write('Active checkpoints: none\n');
  }
}

async function runResumeFromHandoff(options: ResumeFromHandoffOptions): Promise<void> {
  const paths = await requireCanonicalPreparation(options.slug);
  const state = await readPreparationState(paths.processDir);
  const currentHandoffPath = path.join(paths.packetDir, 'NEW_CHAT_HANDOFF_PROMPT.md');
  const currentHandoff = await readFileIfPresent(currentHandoffPath);
  if (!currentHandoff) {
    throw new Error(`No current handoff exists at ${currentHandoffPath}`);
  }
  process.stdout.write(`Preparation: ${paths.rootDir}\n`);
  process.stdout.write(`Current handoff path: ${currentHandoffPath}\n`);
  process.stdout.write(`Latest handoff id: ${state.latestHandoffId ?? 'none'}\n`);
  process.stdout.write('Resume source: current canonical handoff prompt\n');
}

async function updateQuestionStatus(
  slug: string,
  questionId: string,
  status: QuestionStatus,
  note: string,
  revisitAt: string | null,
): Promise<void> {
  const paths = await requireCanonicalPreparation(slug);
  const state = await readPreparationState(paths.processDir);
  const questions = await readOpenQuestions(paths.processDir);
  const record = questions.find((question) => question.id === questionId);
  if (!record) {
    throw new Error(`Question ${questionId} does not exist.`);
  }
  record.status = status;
  if (status === 'resolved') {
    record.resolutionSummary = note;
  } else if (status === 'deferred') {
    record.notes = note;
    if (revisitAt) {
      record.revisitAt = revisitAt;
    } else {
      delete record.revisitAt;
    }
  } else if (status === 'open') {
    record.notes = note || record.notes;
  }
  const stage = requireStageState(state, record.stageId);
  if (status === 'open' && record.impact === 'blocking') {
    stage.blockingQuestionIds = uniqueValues([...stage.blockingQuestionIds, record.id]);
    state.readyForConvergenceGate = false;
    state.readyForPacketExport = false;
  } else {
    stage.blockingQuestionIds = stage.blockingQuestionIds.filter((id) => id !== record.id);
  }
  state.updatedAt = new Date().toISOString();
  await writeOpenQuestions(paths.processDir, questions);
  await writePreparationState(paths.processDir, state);
  await appendHistory(paths.historyDir, [
    `- ${state.updatedAt}: question ${questionId} -> ${status}${note ? ` (${note})` : ''}`,
  ]);
  process.stdout.write(`Question ${questionId} -> ${status}\n`);
}

async function assessPreparation(
  slug: string,
  options: AssessOptions = {},
): Promise<PreparationAssessment> {
  const paths = getPreparationPaths(slug);
  const problems: Problem[] = [];
  const rootExists = await isDirectory(paths.rootDir);

  if (!rootExists) {
    problems.push({
      severity: 'error',
      kind: 'missing_root_dir',
      file: '<preparation>',
      path: paths.rootDir,
      message: 'Preparation root does not exist. Run init first.',
    });
  }

  const layout = await detectLayout(paths);
  const packetDirInUse =
    layout === 'canonical_packet_dir'
      ? paths.packetDir
      : layout === 'legacy_flat_packet'
        ? paths.rootDir
        : paths.packetDir;

  if (layout === 'missing') {
    problems.push({
      severity: 'error',
      kind: 'missing_packet_dir',
      file: '<packet>',
      path: paths.packetDir,
      message: 'Canonical packet directory is missing.',
    });
  } else if (layout === 'legacy_flat_packet') {
    problems.push({
      severity: 'warning',
      kind: 'legacy_layout',
      file: '<packet>',
      path: paths.rootDir,
      message:
        'Legacy flat packet layout detected. New preparations should use docs/project-preparation/<slug>/packet/.',
    });
  }

  if (!(await isDirectory(paths.processDir))) {
    problems.push({
      severity: 'error',
      kind: 'missing_process_dir',
      file: '<process>',
      path: paths.processDir,
      message: 'Process directory is missing.',
    });
  }
  if (!(await isDirectory(paths.exportsDir))) {
    problems.push({
      severity: 'error',
      kind: 'missing_exports_dir',
      file: '<exports>',
      path: paths.exportsDir,
      message: 'Exports directory is missing.',
    });
  }
  if (!(await isDirectory(paths.handoffsDir))) {
    problems.push({
      severity: 'error',
      kind: 'missing_handoffs_dir',
      file: '<handoffs>',
      path: paths.handoffsDir,
      message: 'Handoffs directory is missing.',
    });
  }
  if (!(await isDirectory(paths.historyDir))) {
    problems.push({
      severity: 'error',
      kind: 'missing_history_dir',
      file: '<history>',
      path: paths.historyDir,
      message: 'History directory is missing.',
    });
  }
  if ((await readFileIfPresent(paths.readmePath)) === null) {
    problems.push({
      severity: 'warning',
      kind: 'missing_readme',
      file: 'README.md',
      path: paths.readmePath,
      message: 'Preparation README is missing.',
    });
  }

  const processReports: ProcessFileReport[] = [];
  for (const file of requiredProcessFiles) {
    const filePath = path.join(paths.processDir, file);
    const exists = (await readFileIfPresent(filePath)) !== null;
    processReports.push({ file, path: filePath, exists });
    if (!exists) {
      problems.push({
        severity: 'error',
        kind: 'missing_process_file',
        file,
        path: filePath,
        message: `${file} is missing from process/.`,
      });
    }
  }

  const historyReports: HistoryFileReport[] = [];
  for (const file of requiredHistoryFiles) {
    const filePath = path.join(paths.historyDir, file);
    const exists = (await readFileIfPresent(filePath)) !== null;
    historyReports.push({ file, path: filePath, exists });
    if (!exists) {
      problems.push({
        severity: 'error',
        kind: 'missing_history_file',
        file,
        path: filePath,
        message: `${file} is missing from history/.`,
      });
    }
  }

  const packetReports: PacketFileReport[] = [];
  for (const file of requiredPacketFiles) {
    const filePath = path.join(packetDirInUse, file);
    const content = await readFileIfPresent(filePath);
    const exists = content !== null;
    const nonEmpty = content !== null && content.trim().length > 0;
    const placeholderCount = content === null ? 0 : countTemplatePlaceholders(content);
    const ignoreCurrentHandoffFile = file === 'NEW_CHAT_HANDOFF_PROMPT.md' && options.ignoreHandoffIssues;

    packetReports.push({
      file,
      path: filePath,
      exists,
      nonEmpty,
      placeholderCount,
    });

    if (!exists) {
      if (ignoreCurrentHandoffFile) {
        continue;
      }
      problems.push({
        severity: 'error',
        kind: 'missing_packet_file',
        file,
        path: filePath,
        message: `${file} is missing from the packet view.`,
      });
      continue;
    }

    if (!nonEmpty) {
      if (ignoreCurrentHandoffFile) {
        continue;
      }
      problems.push({
        severity: 'error',
        kind: 'empty_packet_file',
        file,
        path: filePath,
        message: `${file} exists but is empty.`,
      });
      continue;
    }

    if (placeholderCount > 0) {
      if (ignoreCurrentHandoffFile) {
        continue;
      }
      problems.push({
        severity: 'error',
        kind: 'template_placeholder',
        file,
        path: filePath,
        message: `${file} still contains ${placeholderCount} template placeholder(s).`,
      });
    }

    if (file === 'NEW_CHAT_HANDOFF_PROMPT.md' && !options.ignoreHandoffIssues) {
      if (!content.includes(packetDirInUse)) {
        problems.push({
          severity: 'error',
          kind: 'handoff_path',
          file,
          path: filePath,
          message: 'NEW_CHAT_HANDOFF_PROMPT.md does not reference the current packet path.',
        });
      }
      if (!content.includes('Next Objective:')) {
        problems.push({
          severity: 'error',
          kind: 'handoff_next_objective',
          file,
          path: filePath,
          message: 'NEW_CHAT_HANDOFF_PROMPT.md does not declare a Next Objective section.',
        });
      }
    }
  }

  const errorCount = problems.filter((problem) => problem.severity === 'error').length;
  const summary = {
    packetRequired: requiredPacketFiles.length,
    packetPresent: packetReports.filter((report) => report.exists).length,
    packetNonEmpty: packetReports.filter((report) => report.nonEmpty).length,
    packetPlaceholderFree: packetReports.filter((report) => report.placeholderCount === 0).length,
    processRequired: requiredProcessFiles.length,
    processPresent: processReports.filter((report) => report.exists).length,
    historyRequired: requiredHistoryFiles.length,
    historyPresent: historyReports.filter((report) => report.exists).length,
  };

  const readiness: Readiness =
    errorCount === 0 ? 'ready_for_downstream_handoff' : 'needs_refinement';

  return {
    slug,
    paths,
    layout,
    packetDirInUse,
    readiness,
    nextAction: readiness === 'ready_for_downstream_handoff' ? 'handoff_downstream' : 'continue_preparation',
    problems,
    packetReports,
    processReports,
    historyReports,
    summary,
  };
}

async function detectLayout(paths: PreparationPaths): Promise<LayoutKind> {
  if (await isDirectory(paths.packetDir)) {
    return 'canonical_packet_dir';
  }

  const legacyCount = await countLegacyPacketFiles(paths.rootDir);
  if (legacyCount > 0) {
    return 'legacy_flat_packet';
  }

  return 'missing';
}

async function countLegacyPacketFiles(rootDir: string): Promise<number> {
  let count = 0;
  for (const file of requiredPacketFiles) {
    if ((await readFileIfPresent(path.join(rootDir, file))) !== null) {
      count += 1;
    }
  }
  return count;
}

function printAssessment(assessment: PreparationAssessment): void {
  process.stdout.write(`Preparation: ${assessment.paths.rootDir}\n`);
  process.stdout.write(`Layout: ${assessment.layout}\n`);
  process.stdout.write(`Packet view: ${assessment.packetDirInUse}\n`);
  process.stdout.write(`Readiness: ${assessment.readiness}\n`);
  process.stdout.write(`Next action: ${assessment.nextAction}\n`);
  process.stdout.write(
    `Packet files: present=${assessment.summary.packetPresent}/${assessment.summary.packetRequired} non-empty=${assessment.summary.packetNonEmpty}/${assessment.summary.packetRequired} placeholder-free=${assessment.summary.packetPlaceholderFree}/${assessment.summary.packetRequired}\n`,
  );
  process.stdout.write(
    `Process files: present=${assessment.summary.processPresent}/${assessment.summary.processRequired}\n`,
  );
  process.stdout.write(
    `History files: present=${assessment.summary.historyPresent}/${assessment.summary.historyRequired}\n`,
  );

  const warnings = assessment.problems.filter((problem) => problem.severity === 'warning');
  const errors = assessment.problems.filter((problem) => problem.severity === 'error');

  if (warnings.length === 0) {
    process.stdout.write('Warnings: none\n');
  } else {
    process.stdout.write('Warnings:\n');
    for (const warning of warnings) {
      process.stdout.write(`- ${warning.message} (${warning.path})\n`);
    }
  }

  if (errors.length === 0) {
    process.stdout.write('Problems: none\n');
  } else {
    process.stdout.write('Problems:\n');
    for (const problem of errors) {
      process.stdout.write(`- ${problem.message} (${problem.path})\n`);
    }
  }
}

async function generateHandoff(options: HandoffOptions): Promise<void> {
  const assessment = await assessPreparation(options.slug, { ignoreHandoffIssues: true });
  if (assessment.layout === 'missing') {
    throw new Error(`Packet view does not exist for ${options.slug}. Run init first.`);
  }

  await fs.mkdir(assessment.paths.handoffsDir, { recursive: true });
  const existingState = await readPreparationState(assessment.paths.processDir);
  const questions = await readOpenQuestions(assessment.paths.processDir);
  let handoffText = buildHandoffText(assessment, questions);
  const handoffPath = path.join(assessment.packetDirInUse, 'NEW_CHAT_HANDOFF_PROMPT.md');
  await fs.writeFile(handoffPath, handoffText, 'utf8');

  const handoffId = await nextSnapshotId(assessment.paths.handoffsDir, 'handoff-');
  const snapshotMdPath = path.join(assessment.paths.handoffsDir, `${handoffId}.md`);
  const snapshotJsonPath = path.join(assessment.paths.handoffsDir, `${handoffId}.json`);
  await fs.writeFile(snapshotMdPath, handoffText, 'utf8');

  const finalAssessment = await assessPreparation(options.slug);
  const finalHandoffText = buildHandoffText(finalAssessment, questions);
  if (finalHandoffText !== handoffText) {
    handoffText = finalHandoffText;
    await fs.writeFile(handoffPath, handoffText, 'utf8');
    await fs.writeFile(snapshotMdPath, handoffText, 'utf8');
  }

  const exportStatus = await readPacketExportStatus(assessment.paths.processDir);
  const metadata = {
    handoffId,
    sourceExportId: exportStatus?.latestExportId ?? null,
    targetPhase:
      finalAssessment.readiness === 'ready_for_downstream_handoff'
        ? 'requirement_freeze'
        : 'continued_preparation',
    generatedAt: new Date().toISOString(),
    status: 'generated',
    readiness: finalAssessment.readiness,
  };
  await fs.writeFile(snapshotJsonPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

  if (existingState.latestHandoffId) {
    await updateHandoffSnapshotStatus(
      assessment.paths.handoffsDir,
      existingState.latestHandoffId,
      'superseded',
      {
        supersededByHandoffId: handoffId,
        supersededAt: metadata.generatedAt,
      },
    );
  }

  await refreshPreparationState(assessment.paths.processDir, {
    latestHandoffId: handoffId,
    updatedAt: metadata.generatedAt,
  });
  await appendHistory(assessment.paths.historyDir, [
    `- ${metadata.generatedAt}: generated ${handoffId} from ${metadata.sourceExportId ?? 'no_export'} for ${metadata.targetPhase}`,
  ]);

  process.stdout.write(`Handoff file: ${handoffPath}\n`);
  process.stdout.write(`Snapshot: ${snapshotMdPath}\n`);
  process.stdout.write(`Readiness: ${finalAssessment.readiness}\n`);
  process.stdout.write(`Next action: ${finalAssessment.nextAction}\n`);
  printAssessment(finalAssessment);
}

function buildHandoffText(
  assessment: PreparationAssessment,
  questions: QuestionRecord[],
): string {
  const packetFiles = requiredPacketFiles
    .map((file) => `- \`${path.join(assessment.packetDirInUse, file)}\``)
    .join('\n');
  const carryForwardQuestions = questions
    .filter((question) => question.status === 'open' || question.status === 'deferred')
    .map((question) => {
      const statusLabel =
        question.status === 'deferred' && question.revisitAt
          ? `${question.status}; revisit ${question.revisitAt}`
          : question.status;
      return `- ${question.id} (${statusLabel}): ${question.question}`;
    })
    .join('\n');
  const notFrozenItems =
    carryForwardQuestions.length > 0
      ? carryForwardQuestions
      : assessment.problems
          .filter((problem) => problem.severity === 'error' && problem.file !== 'NEW_CHAT_HANDOFF_PROMPT.md')
          .map((problem) => `- ${problem.message}`)
          .join('\n');

  const nextObjective =
    assessment.readiness === 'ready_for_downstream_handoff'
      ? '- start downstream planning at requirement_freeze using this packet as canonical input, and carry process-side unresolved items forward as validation work rather than frozen facts'
      : '- continue preparation and resolve the listed packet or process-state gaps before downstream handoff';

  const constraints =
    assessment.readiness === 'ready_for_downstream_handoff'
      ? [
          '- treat packet files as frozen input and keep unresolved process-side items out of packet truth until they are validated',
          '- do not reopen frozen direction, scope, boundary, or success criteria without a material gap',
        ].join('\n')
      : [
          '- keep the packet and process side aligned',
          '- do not export unresolved blocking content as frozen packet truth',
        ].join('\n');

  return [
    '# New Chat Handoff Prompt',
    '',
    `Generated by \`scripts/project-preparation.ts handoff --slug ${assessment.slug}\`.`,
    '',
    '```text',
    'You are working in `/home/administrator/code/review-then-codex-system`.',
    '',
    'Read these preparation docs first:',
    '',
    '- `/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_WORKFLOW.md`',
    '- `/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_TEMPLATES.md`',
    '- `/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_CLI.md`',
    '- `/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_SOP.md`',
    '',
    'Then read the current packet for this preparation:',
    '',
    packetFiles,
    '',
    'Current State:',
    `- preparation path: \`${assessment.paths.rootDir}\``,
    `- packet path: \`${assessment.packetDirInUse}\``,
    `- layout: \`${assessment.layout}\``,
    `- readiness: \`${assessment.readiness}\``,
    `- target phase: \`${assessment.readiness === 'ready_for_downstream_handoff' ? 'requirement_freeze' : 'continued_preparation'}\``,
    '',
    'Frozen Content:',
    `- direction: see \`${path.join(assessment.packetDirInUse, 'PROJECT_BRIEF.md')}\``,
    `- scope: see \`${path.join(assessment.packetDirInUse, 'MVP_SCOPE.md')}\` and \`${path.join(assessment.packetDirInUse, 'NON_GOALS.md')}\``,
    `- boundary: see \`${path.join(assessment.packetDirInUse, 'ARCHITECTURE_BOUNDARY.md')}\``,
    `- success/evidence: see \`${path.join(assessment.packetDirInUse, 'SUCCESS_CRITERIA.md')}\``,
    `- workstreams: see \`${path.join(assessment.packetDirInUse, 'INITIAL_WORKSTREAMS.md')}\``,
    '',
    'Not Frozen:',
    notFrozenItems.length > 0 ? notFrozenItems : '- no blocking unresolved packet gap detected by the current scaffold check',
    '',
    'Next Objective:',
    nextObjective,
    '',
    'Do Not Reopen:',
    '- do not reopen frozen project definition unless a material gap or contradiction is found',
    '- do not expand preparation into runtime semantic changes',
    '',
    'Priority Read Files:',
    `- \`${path.join(assessment.packetDirInUse, 'PROJECT_BRIEF.md')}\``,
    `- \`${path.join(assessment.packetDirInUse, 'MVP_SCOPE.md')}\``,
    `- \`${path.join(assessment.packetDirInUse, 'ARCHITECTURE_BOUNDARY.md')}\``,
    `- \`${path.join(assessment.packetDirInUse, 'SUCCESS_CRITERIA.md')}\``,
    `- \`${path.join(assessment.packetDirInUse, 'INITIAL_WORKSTREAMS.md')}\``,
    '',
    'Constraints:',
    constraints,
    '```',
    '',
  ].join('\n');
}

async function nextSnapshotId(directoryPath: string, prefix: string): Promise<string> {
  let next = 1;
  try {
    const entries = await fs.readdir(directoryPath);
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) {
        continue;
      }
      const stem = entry.replace(/\.[^.]+$/, '');
      if (!stem.startsWith(prefix)) {
        continue;
      }
      const numeric = stem.slice(prefix.length);
      const parsed = Number.parseInt(numeric, 10);
      if (!Number.isNaN(parsed)) {
        next = Math.max(next, parsed + 1);
      }
    }
  } catch (error: unknown) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') {
      throw error;
    }
  }
  return `${prefix}${String(next).padStart(3, '0')}`;
}

async function requireCanonicalPreparation(slug: string): Promise<PreparationPaths> {
  const paths = getPreparationPaths(slug);
  const layout = await detectLayout(paths);
  if (layout === 'missing') {
    throw new Error(`Preparation ${slug} does not have a canonical packet layout. Run init first.`);
  }
  if (layout === 'legacy_flat_packet') {
    throw new Error(
      `Preparation ${slug} still uses the legacy flat packet layout. Migrate it to process/ + packet/ first.`,
    );
  }
  return paths;
}

async function readPreparationState(processDir: string): Promise<PreparationState> {
  const filePath = path.join(processDir, 'PREPARATION_STATE.json');
  const content = await readFileIfPresent(filePath);
  if (content === null) {
    throw new Error(`Missing PREPARATION_STATE.json under ${processDir}`);
  }

  const parsed = JSON.parse(content) as PreparationState;
  parsed.checkpoints = parsed.checkpoints ?? [];
  return parsed;
}

async function writePreparationState(processDir: string, state: PreparationState): Promise<void> {
  const filePath = path.join(processDir, 'PREPARATION_STATE.json');
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function persistCheckpointState(paths: PreparationPaths, state: PreparationState): Promise<void> {
  await writePreparationState(paths.processDir, state);
  await writeCheckpointsMarkdown(paths.processDir, state.checkpoints ?? []);
}

async function writeCheckpointsMarkdown(
  processDir: string,
  checkpoints: CheckpointRecord[],
): Promise<void> {
  const active = checkpoints.filter(
    (checkpoint) => checkpoint.status === 'open' || checkpoint.status === 'pending_human',
  );
  const history = checkpoints.filter(
    (checkpoint) => checkpoint.status !== 'open' && checkpoint.status !== 'pending_human',
  );

  const renderBlock = (checkpoint: CheckpointRecord): string[] => [
    `### ${checkpoint.checkpointId} ${checkpoint.type}`,
    `- Stage: ${checkpoint.stageId}`,
    `- Type: ${checkpoint.type}`,
    `- Status: ${checkpoint.status}`,
    `- What Is Being Decided: ${checkpoint.promptSummary}`,
    `- Approval Summary: ${checkpoint.approvalSummary ?? 'null'}`,
    `- Correction Summary: ${checkpoint.correctionSummary ?? 'null'}`,
    `- Rejection Reason: ${checkpoint.rejectionReason ?? 'null'}`,
    `- Rollback Target: ${checkpoint.rollbackTargetStageId ?? 'null'}`,
    `- Linked Decisions: ${checkpoint.linkedDecisionIds.length > 0 ? checkpoint.linkedDecisionIds.join(', ') : 'none'}`,
    `- Decided By: ${checkpoint.decidedBy ?? 'null'}`,
    `- Decided At: ${checkpoint.decidedAt ?? 'null'}`,
    '',
  ];

  const lines = ['# Checkpoints', '', '## Active', ''];
  if (active.length === 0) {
    lines.push('- none', '');
  } else {
    for (const checkpoint of active) {
      lines.push(...renderBlock(checkpoint));
    }
  }
  lines.push('## History', '');
  if (history.length === 0) {
    lines.push('- none', '');
  } else {
    for (const checkpoint of history) {
      lines.push(...renderBlock(checkpoint));
    }
  }

  await fs.writeFile(path.join(processDir, 'CHECKPOINTS.md'), `${lines.join('\n')}\n`, 'utf8');
}

function requireStageState(state: PreparationState, stageId: StageId): StageState {
  const stage = state.stages.find((candidate) => candidate.stageId === stageId);
  if (!stage) {
    throw new Error(`Stage ${stageId} is missing from PREPARATION_STATE.json`);
  }
  return stage;
}

function stageRequiresCheckpoint(stageId: StageId): boolean {
  return Object.values(checkpointStageMap).includes(stageId);
}

const checkpointStageMap: Record<CheckpointType, StageId> = {
  direction: 'direction_decision',
  scope: 'scope_freeze',
  boundary: 'boundary_freeze',
  success_evidence: 'success_evidence_freeze',
  convergence: 'convergence_gate',
  packet_export: 'packet_export',
};

function validateCheckpointStagePair(type: CheckpointType, stageId: StageId): void {
  const expectedStage = checkpointStageMap[type];
  if (expectedStage !== stageId) {
    throw new Error(`Checkpoint type ${type} must bind to stage ${expectedStage}, not ${stageId}.`);
  }
}

function defaultRollbackTarget(stageId: StageId): StageId {
  switch (stageId) {
    case 'direction_decision':
      return 'brainstorm';
    case 'scope_freeze':
      return 'direction_decision';
    case 'boundary_freeze':
      return 'scope_freeze';
    case 'success_evidence_freeze':
      return 'scope_freeze';
    case 'convergence_gate':
      return 'workstream_shaping';
    case 'packet_export':
      return 'convergence_gate';
    default:
      return stageId;
  }
}

function getNextStageId(stageId: StageId): StageId | null {
  const index = stageIds.indexOf(stageId);
  return index >= 0 && index < stageIds.length - 1 ? (stageIds[index + 1] ?? null) : null;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function nextCheckpointId(checkpoints: CheckpointRecord[]): string {
  const next = checkpoints.reduce((current, checkpoint) => {
    const parsed = Number.parseInt(checkpoint.checkpointId.replace(/^c_/, ''), 10);
    return Number.isNaN(parsed) ? current : Math.max(current, parsed);
  }, 0);
  return `c_${String(next + 1).padStart(3, '0')}`;
}

function nextConvergenceReportId(previousId: string | null): string {
  if (!previousId) {
    return 'cr_001';
  }
  const parsed = Number.parseInt(previousId.replace(/^cr_/, ''), 10);
  if (Number.isNaN(parsed)) {
    return 'cr_001';
  }
  return `cr_${String(parsed + 1).padStart(3, '0')}`;
}

function findLatestCheckpoint(
  state: PreparationState,
  criteria: {
    stageId?: StageId | undefined;
    type?: CheckpointType | undefined;
    statuses?: CheckpointStatus[] | undefined;
  },
): CheckpointRecord | null {
  const checkpoints = state.checkpoints ?? [];
  const filtered = checkpoints.filter((checkpoint) => {
    if (criteria.stageId && checkpoint.stageId !== criteria.stageId) {
      return false;
    }
    if (criteria.type && checkpoint.type !== criteria.type) {
      return false;
    }
    if (criteria.statuses && !criteria.statuses.includes(checkpoint.status)) {
      return false;
    }
    return true;
  });
  return filtered.at(-1) ?? null;
}

function hasApprovedCheckpoint(
  state: PreparationState,
  type: CheckpointType,
  stageId?: StageId | undefined,
): boolean {
  const criteria: {
    type: CheckpointType;
    stageId?: StageId | undefined;
    statuses: CheckpointStatus[];
  } = {
    type,
    statuses: ['approved'],
  };
  if (stageId !== undefined) {
    criteria.stageId = stageId;
  }
  return findLatestCheckpoint(state, criteria) !== null;
}

function hasApprovedCheckpointByType(state: PreparationState, type: CheckpointType): boolean {
  return hasApprovedCheckpoint(state, type, checkpointStageMap[type]);
}

function requireCheckpoint(state: PreparationState, checkpointId: string): CheckpointRecord {
  const checkpoint = (state.checkpoints ?? []).find((candidate) => candidate.checkpointId === checkpointId);
  if (!checkpoint) {
    throw new Error(`Checkpoint ${checkpointId} does not exist.`);
  }
  return checkpoint;
}

function applyApprovalEffects(
  state: PreparationState,
  checkpoint: CheckpointRecord,
  now: string,
): void {
  const stage = requireStageState(state, checkpoint.stageId);
  if (checkpoint.type === 'packet_export') {
    stage.status = 'human_review_required';
    stage.enteredAt = stage.enteredAt ?? now;
    state.currentStageId = checkpoint.stageId;
    state.nextStageId = checkpoint.stageId;
    return;
  }

  stage.status = 'completed';
  stage.enteredAt = stage.enteredAt ?? now;
  stage.completedAt = now;
  stage.rolledBackAt = null;
  state.currentStageId = checkpoint.stageId;
  state.nextStageId = getNextStageId(checkpoint.stageId);

  if (checkpoint.type === 'convergence') {
    state.readyForConvergenceGate = true;
    state.readyForPacketExport = true;
    state.status = 'converged';
  }
}

function applyRejectionEffects(
  state: PreparationState,
  checkpoint: CheckpointRecord,
  rollbackTarget: StageId,
  now: string,
): void {
  const stage = requireStageState(state, checkpoint.stageId);
  stage.status = 'rolled_back';
  stage.rolledBackAt = now;
  stage.completedAt = null;

  const targetStage = requireStageState(state, rollbackTarget);
  targetStage.status = 'in_progress';
  targetStage.enteredAt = targetStage.enteredAt ?? now;
  state.currentStageId = rollbackTarget;
  state.nextStageId = rollbackTarget;
  state.readyForPacketExport = false;
  if (checkpoint.type === 'convergence') {
    state.readyForConvergenceGate = false;
    state.status = 'active';
  }
}

type BlockingQuestion = {
  id: string;
  stageId: StageId;
  question: string;
};

async function readBlockingQuestions(processDir: string): Promise<BlockingQuestion[]> {
  const content = await readFileIfPresent(path.join(processDir, 'OPEN_QUESTIONS.md'));
  if (!content) {
    return [];
  }

  const lines = content.split('\n');
  const rows: BlockingQuestion[] = [];
  let inOpenSection = false;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      inOpenSection = line.trim() === '## Open';
      continue;
    }
    if (!inOpenSection || !line.startsWith('|')) {
      continue;
    }
    if (line.includes('---') || line.includes('ID |')) {
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((value) => value.trim());
    if (cells.length < 7) {
      continue;
    }
    const [id, stageId, question, , impact] = cells;
    if (!id || !stageId || !question || impact !== 'blocking') {
      continue;
    }
    if (!(stageIds as readonly string[]).includes(stageId)) {
      continue;
    }
    rows.push({
      id,
      stageId: stageId as StageId,
      question,
    });
  }

  return rows;
}

function deriveFallbackStageFromBlockingQuestions(questions: BlockingQuestion[]): StageId {
  return questions[0]?.stageId ?? 'clarification';
}

async function readOpenQuestions(processDir: string): Promise<QuestionRecord[]> {
  const content = await readFileIfPresent(path.join(processDir, 'OPEN_QUESTIONS.md'));
  if (!content) {
    return [];
  }
  const records: QuestionRecord[] = [];
  records.push(...parseQuestionTable(content, 'Open', 'open'));
  records.push(...parseQuestionTable(content, 'Deferred', 'deferred'));
  records.push(...parseQuestionTable(content, 'Resolved', 'resolved'));
  return records;
}

function parseQuestionTable(
  content: string,
  sectionTitle: 'Open' | 'Deferred' | 'Resolved',
  status: QuestionStatus,
): QuestionRecord[] {
  const lines = content.split('\n');
  const rows: QuestionRecord[] = [];
  let inSection = false;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      inSection = line.trim() === `## ${sectionTitle}`;
      continue;
    }
    if (!inSection || !line.startsWith('|')) {
      continue;
    }
    if (line.includes('---') || line.includes('ID |')) {
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((value) => value.trim());
    if (sectionTitle === 'Open' && cells.length >= 7 && cells[0]) {
      const [id, stageId, question, category, impact, owner, notes] = cells;
      if (!stageId || !question || !category || !owner || !notes) {
        continue;
      }
      if (!(stageIds as readonly string[]).includes(stageId)) {
        continue;
      }
      rows.push({
        id,
        stageId: stageId as StageId,
        question,
        category,
        impact: impact === 'blocking' ? 'blocking' : 'non_blocking',
        owner,
        notes,
        status,
      });
    } else if (sectionTitle === 'Deferred' && cells.length >= 5 && cells[0]) {
      const expandedFormat = cells.length >= 8;
      const [id, stageId, question, categoryOrNotes, impactOrRevisitAt, ownerOrEmpty, notesOrUndefined, revisitAtOrUndefined] =
        cells;
      if (!stageId || !question || !categoryOrNotes || !impactOrRevisitAt) {
        continue;
      }
      if (!(stageIds as readonly string[]).includes(stageId)) {
        continue;
      }
      const deferredRecord: QuestionRecord = {
        id,
        stageId: stageId as StageId,
        question,
        category: expandedFormat ? categoryOrNotes : 'deferred',
        impact: expandedFormat && impactOrRevisitAt === 'blocking' ? 'blocking' : 'non_blocking',
        owner: expandedFormat ? ownerOrEmpty ?? 'human' : 'human',
        notes: expandedFormat ? notesOrUndefined ?? '' : categoryOrNotes,
        status,
      };
      const revisitAt = expandedFormat ? revisitAtOrUndefined : impactOrRevisitAt;
      if (revisitAt) {
        deferredRecord.revisitAt = revisitAt;
      }
      rows.push(deferredRecord);
    } else if (sectionTitle === 'Resolved' && cells.length >= 5 && cells[0]) {
      const expandedFormat = cells.length >= 8;
      const [id, stageId, question, categoryOrResolution, impactOrUndefined, ownerOrUndefined, resolutionSummaryOrUndefined] =
        cells;
      if (!stageId || !question || !categoryOrResolution) {
        continue;
      }
      if (!(stageIds as readonly string[]).includes(stageId)) {
        continue;
      }
      rows.push({
        id,
        stageId: stageId as StageId,
        question,
        category: expandedFormat ? categoryOrResolution : 'resolved',
        impact: expandedFormat && impactOrUndefined === 'blocking' ? 'blocking' : 'non_blocking',
        owner: expandedFormat ? ownerOrUndefined ?? 'human' : 'human',
        notes: '',
        status,
        resolutionSummary: expandedFormat ? resolutionSummaryOrUndefined ?? '' : categoryOrResolution,
      });
    }
  }
  return rows;
}

async function writeOpenQuestions(processDir: string, questions: QuestionRecord[]): Promise<void> {
  const open = questions.filter((question) => question.status === 'open');
  const deferred = questions.filter((question) => question.status === 'deferred');
  const resolved = questions.filter((question) => question.status === 'resolved');
  const lines = [
    '# Open Questions',
    '',
    '## Open',
    '| ID | Stage | Question | Category | Impact | Owner | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...open.map(
      (question) =>
        `| ${question.id} | ${question.stageId} | ${escapeTable(question.question)} | ${escapeTable(question.category)} | ${question.impact} | ${escapeTable(question.owner)} | ${escapeTable(question.notes)} |`,
    ),
    '',
    '## Deferred',
    '| ID | Stage | Question | Category | Impact | Owner | Why Deferred | Revisit At |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...deferred.map(
      (question) =>
        `| ${question.id} | ${question.stageId} | ${escapeTable(question.question)} | ${escapeTable(question.category)} | ${question.impact} | ${escapeTable(question.owner)} | ${escapeTable(question.notes)} | ${escapeTable(question.revisitAt ?? '')} |`,
    ),
    '',
    '## Resolved',
    '| ID | Stage | Question | Category | Impact | Owner | Resolution Summary | Resolved At |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...resolved.map(
      (question) =>
        `| ${question.id} | ${question.stageId} | ${escapeTable(question.question)} | ${escapeTable(question.category)} | ${question.impact} | ${escapeTable(question.owner)} | ${escapeTable(question.resolutionSummary ?? '')} | ${new Date().toISOString()} |`,
    ),
    '',
  ];
  await fs.writeFile(path.join(processDir, 'OPEN_QUESTIONS.md'), `${lines.join('\n')}\n`, 'utf8');
}

async function readTradeoffs(processDir: string): Promise<TradeoffRecord[]> {
  const content = await readFileIfPresent(path.join(processDir, 'TRADEOFF_LEDGER.md'));
  if (!content || countTemplatePlaceholders(content) > 0) {
    return [];
  }
  return parseTradeoffBlocks(content);
}

function parseTradeoffBlocks(content: string): TradeoffRecord[] {
  const blocks = splitMarkdownBlocks(content, /^###\s+/);
  const records: TradeoffRecord[] = [];
  for (const block of blocks) {
    const header = block[0]?.replace(/^###\s+/, '').trim() ?? '';
    const match = /^(t_\d+)\s+(.*)$/.exec(header);
    if (!match) {
      continue;
    }
    const [, id, title] = match;
    if (!id || !title) {
      continue;
    }
    const stageValue = extractBulletValue(block, 'Stage');
    if (!stageValue || !(stageIds as readonly string[]).includes(stageValue)) {
      continue;
    }
    const statusValue = extractBulletValue(block, 'Status') ?? inferTradeoffStatusFromContext(content, id);
    const status: TradeoffStatus =
      statusValue === 'converged' || statusValue === 'superseded' ? statusValue : 'active';
    records.push({
      id,
      title,
      stageId: stageValue as StageId,
      pressureQuestion: extractBulletValue(block, 'Pressure Question') ?? '',
      mustKeep: extractIndentedList(block, 'Must Keep'),
      canDrop: extractIndentedList(block, 'Can Drop'),
      notNow: extractIndentedList(block, 'Not Now'),
      boundaryImplication: extractIndentedList(block, 'Boundary Implication'),
      failureImplication: extractIndentedList(block, 'Failure Implication'),
      currentLeaning: extractIndentedList(block, 'Current Leaning'),
      stillUnresolved: extractIndentedList(block, 'Still Unresolved'),
      linkedDecisionIds: extractIndentedList(block, 'Linked Decisions'),
      status,
    });
  }
  return records;
}

async function writeTradeoffs(processDir: string, tradeoffs: TradeoffRecord[]): Promise<void> {
  const sections: Array<[string, TradeoffStatus]> = [
    ['## Active Tradeoffs', 'active'],
    ['## Converged Tradeoffs', 'converged'],
    ['## Superseded Tradeoffs', 'superseded'],
  ];
  const lines = ['# Tradeoff Ledger', ''];
  for (const [heading, status] of sections) {
    lines.push(heading, '');
    const records = tradeoffs.filter((tradeoff) => tradeoff.status === status);
    if (records.length === 0) {
      lines.push('- none', '');
      continue;
    }
    for (const tradeoff of records) {
      lines.push(
        `### ${tradeoff.id} ${tradeoff.title}`,
        `- Stage: ${tradeoff.stageId}`,
        `- Status: ${tradeoff.status}`,
        `- Pressure Question: ${tradeoff.pressureQuestion}`,
        '- Must Keep:',
        ...renderIndentedList(tradeoff.mustKeep),
        '- Can Drop:',
        ...renderIndentedList(tradeoff.canDrop),
        '- Not Now:',
        ...renderIndentedList(tradeoff.notNow),
        '- Boundary Implication:',
        ...renderIndentedList(tradeoff.boundaryImplication),
        '- Failure Implication:',
        ...renderIndentedList(tradeoff.failureImplication),
        '- Current Leaning:',
        ...renderIndentedList(tradeoff.currentLeaning),
        '- Still Unresolved:',
        ...renderIndentedList(tradeoff.stillUnresolved),
        '- Linked Decisions:',
        ...renderIndentedList(tradeoff.linkedDecisionIds),
        '',
      );
    }
  }
  await fs.writeFile(path.join(processDir, 'TRADEOFF_LEDGER.md'), `${lines.join('\n')}\n`, 'utf8');
}

async function readDecisions(processDir: string): Promise<DecisionRecord[]> {
  const content = await readFileIfPresent(path.join(processDir, 'DECISION_LOG.md'));
  if (!content || countTemplatePlaceholders(content) > 0) {
    return [];
  }
  return parseDecisionBlocks(content);
}

function parseDecisionBlocks(content: string): DecisionRecord[] {
  const blocks = splitMarkdownBlocks(content, /^###\s+/);
  const records: DecisionRecord[] = [];
  for (const block of blocks) {
    const header = block[0]?.replace(/^###\s+/, '').trim() ?? '';
    const match = /^(d_\d+)\s+(.*)$/.exec(header);
    if (!match) {
      continue;
    }
    const [, id, title] = match;
    if (!id || !title) {
      continue;
    }
    const stageValue = extractBulletValue(block, 'Stage');
    if (!stageValue || !(stageIds as readonly string[]).includes(stageValue)) {
      continue;
    }
    const statusValue = extractBulletValue(block, 'Status');
    const status: DecisionStatus =
      statusValue === 'approved' || statusValue === 'rejected' || statusValue === 'superseded'
        ? statusValue
        : 'proposed';
    records.push({
      id,
      title,
      stageId: stageValue as StageId,
      status,
      decision: extractIndentedList(block, 'Decision'),
      rationale: extractIndentedList(block, 'Rationale'),
      linkedQuestionIds: extractIndentedList(block, 'Linked Questions'),
      linkedTradeoffIds: extractIndentedList(block, 'Linked Tradeoffs'),
      affectsPacketFiles: extractIndentedList(block, 'Affects Packet Files'),
      approvedBy: nullIfString(extractBulletValue(block, 'Approved By')),
      approvedAt: nullIfString(extractBulletValue(block, 'Approved At')),
      rejectionReason: nullIfString(extractBulletValue(block, 'Rejection Reason')),
      checkpointId: nullIfString(extractBulletValue(block, 'Checkpoint Id')),
    });
  }
  return records;
}

async function writeDecisions(processDir: string, decisions: DecisionRecord[]): Promise<void> {
  const sections: Array<[string, DecisionStatus]> = [
    ['## Proposed Decisions', 'proposed'],
    ['## Approved Decisions', 'approved'],
    ['## Rejected Decisions', 'rejected'],
    ['## Superseded Decisions', 'superseded'],
  ];
  const lines = ['# Decision Log', ''];
  for (const [heading, status] of sections) {
    lines.push(heading, '');
    const records = decisions.filter((decision) => decision.status === status);
    if (records.length === 0) {
      lines.push('- none', '');
      continue;
    }
    for (const decision of records) {
      lines.push(
        `### ${decision.id} ${decision.title}`,
        `- Stage: ${decision.stageId}`,
        `- Status: ${decision.status}`,
        '- Decision:',
        ...renderIndentedList(decision.decision),
        '- Rationale:',
        ...renderIndentedList(decision.rationale),
        '- Linked Questions:',
        ...renderIndentedList(decision.linkedQuestionIds),
        '- Linked Tradeoffs:',
        ...renderIndentedList(decision.linkedTradeoffIds),
        '- Affects Packet Files:',
        ...renderIndentedList(decision.affectsPacketFiles),
        `- Approved By: ${decision.approvedBy ?? 'null'}`,
        `- Approved At: ${decision.approvedAt ?? 'null'}`,
        `- Rejection Reason: ${decision.rejectionReason ?? 'null'}`,
        `- Checkpoint Id: ${decision.checkpointId ?? 'null'}`,
        '',
      );
    }
  }
  await fs.writeFile(path.join(processDir, 'DECISION_LOG.md'), `${lines.join('\n')}\n`, 'utf8');
}

async function readOptions(processDir: string): Promise<OptionRecord[]> {
  const content = await readFileIfPresent(path.join(processDir, 'OPTION_SET.md'));
  if (!content || countTemplatePlaceholders(content) > 0) {
    return [];
  }
  return parseOptionBlocks(content);
}

function parseOptionBlocks(content: string): OptionRecord[] {
  const blocks = splitMarkdownBlocks(content, /^###\s+/);
  const records: OptionRecord[] = [];
  for (const block of blocks) {
    const header = block[0]?.replace(/^###\s+/, '').trim() ?? '';
    const match = /^(o_\d+)\s+(.*)$/.exec(header);
    if (!match) {
      continue;
    }
    const [, id, title] = match;
    if (!id || !title) {
      continue;
    }
    const stageValue = extractBulletValue(block, 'Stage');
    if (!stageValue || !(stageIds as readonly string[]).includes(stageValue)) {
      continue;
    }
    const statusValue = extractBulletValue(block, 'Status');
    const status: OptionStatus =
      statusValue === 'selected' || statusValue === 'rejected' || statusValue === 'superseded'
        ? statusValue
        : 'active';
    records.push({
      id,
      title,
      stageId: stageValue as StageId,
      summary: extractBulletValue(block, 'Summary') ?? '',
      advantages: extractIndentedList(block, 'Advantages'),
      tradeoffs: extractIndentedList(block, 'Tradeoffs'),
      risks: extractIndentedList(block, 'Risks'),
      fitSummary: extractIndentedList(block, 'Fit Summary'),
      status,
      selectionReason: nullIfString(extractBulletValue(block, 'Selection Reason')),
      rejectionReason: nullIfString(extractBulletValue(block, 'Rejection Reason')),
    });
  }
  return records;
}

async function writeOptions(processDir: string, options: OptionRecord[]): Promise<void> {
  const sections: Array<[string, OptionStatus]> = [
    ['## Active Options', 'active'],
    ['## Selected Options', 'selected'],
    ['## Rejected Options', 'rejected'],
    ['## Superseded Options', 'superseded'],
  ];
  const lines = ['# Option Set', ''];
  for (const [heading, status] of sections) {
    lines.push(heading, '');
    const records = options.filter((option) => option.status === status);
    if (records.length === 0) {
      lines.push('- none', '');
      continue;
    }
    for (const option of records) {
      lines.push(
        `### ${option.id} ${option.title}`,
        `- Stage: ${option.stageId}`,
        `- Summary: ${option.summary}`,
        '- Advantages:',
        ...renderIndentedList(option.advantages),
        '- Tradeoffs:',
        ...renderIndentedList(option.tradeoffs),
        '- Risks:',
        ...renderIndentedList(option.risks),
        '- Fit Summary:',
        ...renderIndentedList(option.fitSummary),
        `- Status: ${option.status}`,
        `- Selection Reason: ${option.selectionReason ?? 'null'}`,
        `- Rejection Reason: ${option.rejectionReason ?? 'null'}`,
        '',
      );
    }
  }
  await fs.writeFile(path.join(processDir, 'OPTION_SET.md'), `${lines.join('\n')}\n`, 'utf8');
}

function splitMarkdownBlocks(content: string, headingPattern: RegExp): string[][] {
  const lines = content.split('\n');
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (headingPattern.test(line)) {
      if (current.length > 0) {
        blocks.push(current);
      }
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    }
  }
  if (current.length > 0) {
    blocks.push(current);
  }
  return blocks;
}

function extractBulletValue(lines: string[], label: string): string | null {
  const prefix = `- ${label}:`;
  const match = lines.find((line) => line.startsWith(prefix));
  if (!match) {
    return null;
  }
  return match.slice(prefix.length).trim();
}

function extractIndentedList(lines: string[], label: string): string[] {
  const prefix = `- ${label}:`;
  const index = lines.findIndex((line) => line.startsWith(prefix));
  if (index < 0) {
    return [];
  }
  const values: string[] = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line === undefined) {
      continue;
    }
    if (line.startsWith('- ') && !line.startsWith('  - ')) {
      break;
    }
    if (line.startsWith('  - ')) {
      values.push(line.slice('  - '.length).trim());
    }
  }
  return values.filter((value) => value.length > 0 && value !== 'none');
}

function renderIndentedList(values: string[]): string[] {
  if (values.length === 0) {
    return ['  - none'];
  }
  return values.map((value) => `  - ${value}`);
}

function inferTradeoffStatusFromContext(content: string, tradeoffId: string): TradeoffStatus {
  const sectionStart = content.indexOf(tradeoffId);
  if (sectionStart < 0) {
    return 'active';
  }
  const before = content.slice(0, sectionStart);
  const activeIndex = before.lastIndexOf('## Active Tradeoffs');
  const convergedIndex = before.lastIndexOf('## Converged Tradeoffs');
  const supersededIndex = before.lastIndexOf('## Superseded Tradeoffs');
  const maxIndex = Math.max(activeIndex, convergedIndex, supersededIndex);
  if (maxIndex === convergedIndex) {
    return 'converged';
  }
  if (maxIndex === supersededIndex) {
    return 'superseded';
  }
  return 'active';
}

function nextRecordId(ids: string[], prefix: string): string {
  const next = ids.reduce((current, id) => {
    const parsed = Number.parseInt(id.replace(prefix, ''), 10);
    return Number.isNaN(parsed) ? current : Math.max(current, parsed);
  }, 0);
  return `${prefix}${String(next + 1).padStart(3, '0')}`;
}

function nullIfString(value: string | null): string | null {
  return !value || value === 'null' ? null : value;
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, '\\|');
}

async function assessPacketForExport(packetDir: string): Promise<{
  problems: string[];
  fallbackStage: StageId;
  projectBriefHealthy: boolean;
  scopeHealthy: boolean;
  boundaryHealthy: boolean;
  successHealthy: boolean;
  workstreamsHealthy: boolean;
}> {
  const filesToCheck: PacketFileName[] = requiredPacketFiles.filter(
    (file): file is PacketFileName => file !== 'NEW_CHAT_HANDOFF_PROMPT.md',
  );
  const problems: string[] = [];
  const fileHealth: Partial<Record<PacketFileName, boolean>> = {};

  for (const file of filesToCheck) {
    const content = await readFileIfPresent(path.join(packetDir, file));
    const healthy = Boolean(content && content.trim().length > 0 && countTemplatePlaceholders(content) === 0);
    fileHealth[file] = healthy;
    if (!healthy) {
      problems.push(`${file} is incomplete or still contains placeholders.`);
    }
  }

  return {
    problems,
    fallbackStage: fileHealth['PROJECT_BRIEF.md'] ? 'scope_freeze' : 'clarification',
    projectBriefHealthy: fileHealth['PROJECT_BRIEF.md'] ?? false,
    scopeHealthy: Boolean(fileHealth['MVP_SCOPE.md'] && fileHealth['NON_GOALS.md']),
    boundaryHealthy: fileHealth['ARCHITECTURE_BOUNDARY.md'] ?? false,
    successHealthy: fileHealth['SUCCESS_CRITERIA.md'] ?? false,
    workstreamsHealthy: fileHealth['INITIAL_WORKSTREAMS.md'] ?? false,
  };
}

async function readCarryableRisks(packetDir: string): Promise<string[]> {
  const content = await readFileIfPresent(path.join(packetDir, 'RISKS_AND_ASSUMPTIONS.md'));
  if (!content || countTemplatePlaceholders(content) > 0) {
    return ['none recorded'];
  }
  return ['see RISKS_AND_ASSUMPTIONS.md for the currently accepted risk set'];
}

function buildConvergenceReport(input: {
  reportId: string;
  result: 'pass' | 'fail';
  generatedAt: string;
  checklist: Array<{
    label: string;
    passed: boolean;
    fallbackStage: StageId;
    reason: string;
  }>;
  blockingQuestions: BlockingQuestion[];
  carryableRisks: string[];
  fallbackStage: StageId;
}): string {
  const failedConditions = input.checklist.filter((item) => !item.passed);
  return [
    '# Convergence Report',
    '',
    `- Report ID: ${input.reportId}`,
    `- Result: ${input.result}`,
    '- Confirmed By Human: false',
    `- Generated At: ${input.generatedAt}`,
    '',
    '## Checklist',
    ...input.checklist.map((item) => `- ${item.label}: ${item.passed ? 'pass' : 'fail'}`),
    '',
    '## Frozen Summary',
    `- Direction: ${input.checklist.find((item) => item.label === 'Direction is approved')?.passed ? 'approved' : 'not frozen'}`,
    `- Scope: ${input.checklist.find((item) => item.label === 'Scope is frozen')?.passed ? 'frozen' : 'not frozen'}`,
    `- Boundary: ${input.checklist.find((item) => item.label === 'Boundary is frozen')?.passed ? 'frozen' : 'not frozen'}`,
    `- Success / evidence: ${input.checklist.find((item) => item.label === 'Success / evidence is frozen')?.passed ? 'frozen' : 'not frozen'}`,
    `- Workstreams: ${input.checklist.find((item) => item.label === 'Workstreams are shaped')?.passed ? 'shaped' : 'not shaped'}`,
    '',
    '## Blocking Questions',
    ...(input.blockingQuestions.length > 0
      ? input.blockingQuestions.map((question) => `- ${question.id}: ${question.question}`)
      : ['- none']),
    '',
    '## Carryable Risks',
    ...input.carryableRisks.map((risk) => `- ${risk}`),
    '',
    '## Failed Conditions',
    ...(failedConditions.length > 0
      ? failedConditions.map((item) => `- ${item.reason}`)
      : ['- none']),
    '',
    '## Fallback Stage',
    `- ${input.fallbackStage}`,
    '',
    '## Next Action',
    input.result === 'pass'
      ? '- open or approve a convergence checkpoint, then prepare packet export'
      : `- return to ${input.fallbackStage} and resolve the failed conditions before rerunning convergence`,
    '',
  ].join('\n');
}

async function readFullPacketExportStatus(processDir: string): Promise<PacketExportStatus> {
  const filePath = path.join(processDir, 'PACKET_EXPORT_STATUS.json');
  const content = await readFileIfPresent(filePath);
  if (content === null) {
    throw new Error(`Missing PACKET_EXPORT_STATUS.json under ${processDir}`);
  }
  return JSON.parse(content) as PacketExportStatus;
}

async function readPacketExportStatus(processDir: string): Promise<{ latestExportId: string | null } | null> {
  const status = await readFullPacketExportStatus(processDir);
  return {
    latestExportId: status.latestExportId,
  };
}

async function writePacketExportStatus(
  processDir: string,
  status: PacketExportStatus,
): Promise<void> {
  await fs.writeFile(
    path.join(processDir, 'PACKET_EXPORT_STATUS.json'),
    `${JSON.stringify(status, null, 2)}\n`,
    'utf8',
  );
}

async function refreshPreparationState(
  processDir: string,
  patch: { latestHandoffId: string; updatedAt: string },
): Promise<void> {
  const state = await readPreparationState(processDir);
  state.latestHandoffId = patch.latestHandoffId;
  state.updatedAt = patch.updatedAt;
  await writePreparationState(processDir, state);
}

async function updateHandoffSnapshotStatus(
  handoffsDir: string,
  handoffId: string,
  status: 'stale' | 'superseded',
  patch: Record<string, unknown>,
): Promise<void> {
  const metadataPath = path.join(handoffsDir, `${handoffId}.json`);
  const metadataContent = await readFileIfPresent(metadataPath);
  if (!metadataContent) {
    return;
  }
  try {
    const parsed = JSON.parse(metadataContent) as Record<string, unknown>;
    parsed.status = status;
    for (const [key, value] of Object.entries(patch)) {
      parsed[key] = value;
    }
    await fs.writeFile(metadataPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  } catch {
    // Leave malformed metadata untouched.
  }
}

async function appendHistory(historyDir: string, lines: string[]): Promise<void> {
  const timelinePath = path.join(historyDir, 'timeline.md');
  const transitionsPath = path.join(historyDir, 'stage-transitions.jsonl');
  const timeline = (await readFileIfPresent(timelinePath)) ?? '# Preparation Timeline\n\n';
  const timelineAppend = `${lines.join('\n')}\n`;
  await fs.writeFile(timelinePath, `${timeline}${timelineAppend}`, 'utf8');

  const now = new Date().toISOString();
  const records = lines.map((line) => JSON.stringify({ at: now, event: line })).join('\n');
  const existingTransitions = (await readFileIfPresent(transitionsPath)) ?? '';
  await fs.writeFile(
    transitionsPath,
    `${existingTransitions}${existingTransitions.endsWith('\n') || existingTransitions.length === 0 ? '' : '\n'}${records}\n`,
    'utf8',
  );
}

function countTemplatePlaceholders(content: string): number {
  return content.match(/<[^>\n]+>/g)?.length ?? 0;
}

async function readFileIfPresent(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new Error(`${filePath} exists but is not a file`);
    }
    return await fs.readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function isDirectory(directoryPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(directoryPath);
    return stat.isDirectory();
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function runCommand(options: CliOptions): Promise<void> {
  if (options.command === 'init') {
    await initPreparation(options);
    return;
  }
  if (options.command === 'status') {
    await runStatus(options);
    return;
  }
  if (options.command === 'check') {
    await runCheck(options);
    return;
  }
  if (options.command === 'advance') {
    await runAdvance(options);
    return;
  }
  if (options.command === 'check-convergence') {
    await runConvergenceCheck(options);
    return;
  }
  if (options.command === 'checkpoint-list') {
    await runCheckpointList(options);
    return;
  }
  if (options.command === 'checkpoint-open') {
    await runCheckpointOpen(options);
    return;
  }
  if (
    options.command === 'checkpoint-approve' ||
    options.command === 'checkpoint-approve-with-correction'
  ) {
    await runCheckpointApprove(options);
    return;
  }
  if (options.command === 'checkpoint-reject') {
    await runCheckpointReject(options);
    return;
  }
  if (options.command === 'export-packet') {
    await runExportPacket(options);
    return;
  }
  if (options.command === 'question-add') {
    await runQuestionAdd(options);
    return;
  }
  if (options.command === 'question-list') {
    await runQuestionList(options);
    return;
  }
  if (options.command === 'question-resolve') {
    await runQuestionResolve(options);
    return;
  }
  if (options.command === 'question-defer') {
    await runQuestionDefer(options);
    return;
  }
  if (options.command === 'question-reopen') {
    await runQuestionReopen(options);
    return;
  }
  if (options.command === 'tradeoff-add') {
    await runTradeoffAdd(options);
    return;
  }
  if (options.command === 'option-add') {
    await runOptionAdd(options);
    return;
  }
  if (options.command === 'option-list') {
    await runOptionList(options);
    return;
  }
  if (options.command === 'option-select') {
    await runOptionSelect(options);
    return;
  }
  if (options.command === 'option-reject') {
    await runOptionReject(options);
    return;
  }
  if (options.command === 'tradeoff-list') {
    await runTradeoffList(options);
    return;
  }
  if (options.command === 'tradeoff-converge') {
    await runTradeoffConverge(options);
    return;
  }
  if (options.command === 'tradeoff-supersede') {
    await runTradeoffSupersede(options);
    return;
  }
  if (options.command === 'decision-propose') {
    await runDecisionPropose(options);
    return;
  }
  if (options.command === 'decision-list') {
    await runDecisionList(options);
    return;
  }
  if (options.command === 'decision-approve') {
    await runDecisionApprove(options);
    return;
  }
  if (options.command === 'decision-reject') {
    await runDecisionReject(options);
    return;
  }
  if (options.command === 'decision-supersede') {
    await runDecisionSupersede(options);
    return;
  }
  if (options.command === 'audit-summary') {
    await runAuditSummary(options);
    return;
  }
  if (options.command === 'audit-blockers') {
    await runAuditBlockers(options);
    return;
  }
  if (options.command === 'packet-status') {
    await runPacketStatus(options);
    return;
  }
  if (options.command === 'packet-refresh') {
    await runPacketRefresh(options);
    return;
  }
  if (options.command === 'handoff-refresh') {
    await runHandoffRefresh(options);
    return;
  }
  if (options.command === 'handoff-show') {
    await runHandoffShow(options);
    return;
  }
  if (options.command === 'handoff-consume') {
    await runHandoffConsume(options);
    return;
  }
  if (options.command === 'timeline') {
    await runTimeline(options);
    return;
  }
  if (options.command === 'history') {
    await runHistory(options);
    return;
  }
  if (options.command === 'diff-exported-packet') {
    await runDiffExportedPacket(options);
    return;
  }
  if (options.command === 'resume-from-state') {
    await runResumeFromState(options);
    return;
  }
  if (options.command === 'resume-from-handoff') {
    await runResumeFromHandoff(options);
    return;
  }
  await generateHandoff(options);
}

async function runCliForTest(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  await runCommand(options);
}

async function runCliWithCapturedOutput(argv: string[]): Promise<string> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stdout.write;
  try {
    await runCliForTest(argv);
  } finally {
    process.stdout.write = originalWrite;
  }
  return output;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await runCommand(options);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
