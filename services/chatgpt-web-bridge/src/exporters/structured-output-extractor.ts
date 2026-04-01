import { AppError } from '../types/error';

const FENCED_BLOCK_PATTERN = /```(?<info>[^\n`]*)\n(?<body>[\s\S]*?)```/g;
const COMMENT_BLOCK_PATTERN =
  /<!--\s*structured-review:start\s*-->([\s\S]*?)<!--\s*structured-review:end\s*-->/i;

function isCandidateFence(info: string): boolean {
  const normalized = info.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized.includes('json') ||
    normalized.includes('structured-review') ||
    normalized.includes('review') ||
    normalized.includes('spec')
  );
}

export class StructuredOutputExtractor {
  public extract(text: string): Record<string, unknown> {
    const commentBlock = COMMENT_BLOCK_PATTERN.exec(text);
    if (commentBlock?.[1]) {
      return this.parseJson(commentBlock[1].trim());
    }

    const matches = text.matchAll(FENCED_BLOCK_PATTERN);
    for (const match of matches) {
      const info = match.groups?.info ?? '';
      const body = match.groups?.body?.trim() ?? '';
      if (!isCandidateFence(info) || body.length === 0) {
        continue;
      }

      try {
        return this.parseJson(body);
      } catch {
        continue;
      }
    }

    throw new AppError(
      'STRUCTURED_OUTPUT_NOT_FOUND',
      'No structured review JSON block was found in the assistant output',
      404,
    );
  }

  private parseJson(value: string): Record<string, unknown> {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Structured output must be a JSON object');
    }

    return parsed as Record<string, unknown>;
  }
}
