import { describe, expect, it } from 'vitest';
import { quoteCheck } from '@/lib/pipeline/verify';

const doc = { id: 'src_1', url: 'https://x.com', title: 't', publisher: 'official' as const, fetchedAt: '', markdown:
  '## Limits\n\nApps in **Testing** mode are limited to 100 [test users](https://x.com/u). Tokens for test users expire after 7 days.' };
const docs = new Map([[doc.id, doc]]);
const claim = (quote?: string, sourceIds = ['src_1']) => ({ id: 'c', text: 't', confidence: 0.9, evidence: { kind: 'sourced' as const, sourceIds, quote } });

describe('quote check', () => {
  it('passes an exact quote', () => {
    expect(quoteCheck(claim('Tokens for test users expire after 7 days.'), docs)).toEqual({ kind: 'sourced', confidence: 0.9 });
  });
  it('passes a whitespace- and markdown-mangled quote', () => {
    expect(quoteCheck(claim('apps in   Testing mode are limited to 100 test users'), docs).confidence).toBe(0.9);
  });
  it('accepts a near-verbatim quote at 0.75', () => {
    expect(quoteCheck(claim('Tokens for the test users expire after 7 days'), docs)).toEqual({ kind: 'sourced', confidence: 0.75 });
  });
  it('downgrades a paraphrase', () => {
    expect(quoteCheck(claim('Google limits testing apps to roughly a hundred people'), docs)).toEqual({ kind: 'unverified', confidence: 0.3 });
  });
  it('downgrades a missing quote or unknown source', () => {
    expect(quoteCheck(claim(undefined), docs).kind).toBe('unverified');
    expect(quoteCheck(claim('Tokens for test users expire after 7 days.', ['src_9']), docs).kind).toBe('unverified');
  });
});
