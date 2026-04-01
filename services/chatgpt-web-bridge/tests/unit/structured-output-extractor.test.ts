import { describe, expect, it } from 'vitest';

import { StructuredOutputExtractor } from '../../src/exporters/structured-output-extractor';
import { AppError } from '../../src/types/error';

describe('StructuredOutputExtractor', () => {
  it('extracts a structured review from a fenced json block', () => {
    const extractor = new StructuredOutputExtractor();
    const payload = extractor.extract(`
Here is the review.

\`\`\`json
{"decision":"approve","issues":[]}
\`\`\`
`);

    expect(payload).toEqual({
      decision: 'approve',
      issues: [],
    });
  });

  it('fails clearly when no structured block exists', () => {
    const extractor = new StructuredOutputExtractor();

    expect(() => extractor.extract('plain text only')).toThrowError(AppError);
    expect(() => extractor.extract('plain text only')).toThrowError(
      /structured review json block/i,
    );
  });
});
