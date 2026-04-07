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

  it('extracts a structured review from a JSON-prefixed inline object', () => {
    const extractor = new StructuredOutputExtractor();
    const payload = extractor.extract(`
Review result: incomplete.
JSON{"status":"incomplete","summary":"Missing evidence","findings":[],"missingTests":[],"architectureConcerns":[],"recommendedActions":[]}
`);

    expect(payload).toEqual({
      status: 'incomplete',
      summary: 'Missing evidence',
      findings: [],
      missingTests: [],
      architectureConcerns: [],
      recommendedActions: [],
    });
  });

  it('extracts a structured review from a raw json object after prose', () => {
    const extractor = new StructuredOutputExtractor();
    const payload = extractor.extract(`
Review result: approved.
{"status":"approved","summary":"Looks good","findings":[],"missingTests":[],"architectureConcerns":[],"recommendedActions":[]}
`);

    expect(payload).toEqual({
      status: 'approved',
      summary: 'Looks good',
      findings: [],
      missingTests: [],
      architectureConcerns: [],
      recommendedActions: [],
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
