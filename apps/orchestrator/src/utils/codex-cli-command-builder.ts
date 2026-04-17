import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CodexExecutionPayload } from '../services/codex-execution-payload-builder';

export type CodexCliCommand = {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
  timeoutMs: number;
  outputPath: string;
  schemaPath: string;
  tempDir: string;
};

const CODEX_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'summary', 'testResults'],
  properties: {
    status: {
      type: 'string',
      enum: ['succeeded', 'failed', 'partial'],
    },
    summary: {
      type: 'string',
    },
    testResults: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['suite', 'status', 'passed', 'failed', 'skipped'],
        properties: {
          suite: { type: 'string' },
          status: {
            type: 'string',
            enum: ['passed', 'failed', 'skipped', 'unknown'],
          },
          passed: { type: 'integer', minimum: 0 },
          failed: { type: 'integer', minimum: 0 },
          skipped: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
} as const;

export class CodexCliCommandBuilder {
  public async build(input: {
    cliBin: string;
    cliArgs?: readonly string[] | undefined;
    timeoutMs: number;
    payload: CodexExecutionPayload;
    modelHint?: string | undefined;
  }): Promise<CodexCliCommand> {
    const workspacePath = String(input.payload.metadata.workspacePath ?? '').trim();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cli-runner-'));
    const outputPath = path.join(tempDir, 'codex-response.json');
    const schemaPath = path.join(tempDir, 'codex-response-schema.json');
    await fs.writeFile(schemaPath, `${JSON.stringify(CODEX_RESPONSE_SCHEMA, null, 2)}\n`, 'utf8');

    const args = [
      'exec',
      '--cd',
      workspacePath,
      '--color',
      'never',
      '--output-schema',
      schemaPath,
      '--output-last-message',
      outputPath,
      '--full-auto',
      ...(input.modelHint ? ['--model', input.modelHint] : []),
      ...(input.cliArgs ?? []),
      '-',
    ];

    return {
      command: input.cliBin,
      args,
      cwd: workspacePath,
      stdin: input.payload.prompt,
      timeoutMs: input.timeoutMs,
      outputPath,
      schemaPath,
      tempDir,
    };
  }
}
