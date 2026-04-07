import { AppError } from '../types/error';

const FENCED_BLOCK_PATTERN = /```(?<info>[^\n`]*)\n(?<body>[\s\S]*?)```/g;
const COMMENT_BLOCK_PATTERN =
  /<!--\s*structured-review:start\s*-->([\s\S]*?)<!--\s*structured-review:end\s*-->/i;
const JSON_LABEL_PATTERN = /\bjson\b\s*[:=-]?\s*/gi;

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

function extractBalancedJsonObject(text: string, startAt: number): string | null {
  let depth = 0;
  let inString = false;
  let escaping = false;
  let started = false;
  let startIndex = -1;

  for (let index = startAt; index < text.length; index += 1) {
    const char = text[index];
    if (!started) {
      if (char === '{') {
        started = true;
        startIndex = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && startIndex >= 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
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

    for (const candidate of this.collectLooseJsonCandidates(text)) {
      try {
        return this.parseJson(candidate);
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

  private collectLooseJsonCandidates(text: string): string[] {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const trimmed = text.trim();

    const pushCandidate = (candidate: string | null): void => {
      const normalized = candidate?.trim();
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      candidates.push(normalized);
    };

    if (trimmed.startsWith('{')) {
      pushCandidate(extractBalancedJsonObject(trimmed, 0));
    }

    for (const match of text.matchAll(JSON_LABEL_PATTERN)) {
      pushCandidate(extractBalancedJsonObject(text, match.index + match[0].length));
    }

    let nextSearchIndex = text.indexOf('{');
    while (nextSearchIndex >= 0) {
      pushCandidate(extractBalancedJsonObject(text, nextSearchIndex));
      nextSearchIndex = text.indexOf('{', nextSearchIndex + 1);
    }

    return candidates;
  }

  private parseJson(value: string): Record<string, unknown> {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Structured output must be a JSON object');
    }

    return parsed as Record<string, unknown>;
  }
}
