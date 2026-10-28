import { describe, expect, it } from 'vitest';
import { loadSeeds } from '@/lib/repo';
import { difficultyFromPoints, fmtS1, fmtS3, score, timeToS3 } from '@/lib/score';

describe('score', () => {
  const seeds = Object.fromEntries(loadSeeds().map((g) => [g.slug, g]));

  it('boundary points map to the PRD table', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 12].map(difficultyFromPoints)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it('seed difficulties match the recorded calibration (README)', () => {
    const got = Object.fromEntries(Object.entries(seeds).map(([k, g]) => [k, score(g).difficulty]));
    expect(got).toEqual({ github: 1, notion: 1, slack: 2, hubspot: 2, 'google-gmail': 3, 'linkedin-community-management': 4 });
  });

  it('seed order never inverts: easy apps never outscore hard ones', () => {
    const order = ['github', 'notion', 'slack', 'hubspot', 'google-gmail', 'linkedin-community-management'];
    const d = order.map((s) => score(seeds[s]).difficulty);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });

  it('stored verdicts equal recomputed ones', () => {
    for (const g of Object.values(seeds)) expect(g.verdict.difficulty).toBe(score(g).difficulty);
  });

  it('time to S3 adds provider waits and dev minutes / 240', () => {
    const steps: any[] = [
      { owner: 'you', estMinutes: { low: 120, high: 240 }, stage: 'S0' },
      { owner: 'provider', estMinutes: { low: 0, high: 0 }, waitDays: { low: 28, high: 56 }, stage: 'S3' },
    ];
    expect(timeToS3(steps)).toEqual({ lowDays: 29, highDays: 57, hasReview: true });
    expect(fmtS3(timeToS3(steps))).toBe('4–8 weeks');
  });

  it('formats short times', () => {
    expect(fmtS3({ lowDays: 0.1, highDays: 0.1, hasReview: false })).toBe('~24 min');
    expect(fmtS3({ lowDays: 2, highDays: 5, hasReview: true })).toBe('2–5 days');
    expect(fmtS1({ lowMin: 10, highMin: 20 })).toBe('~10 min–20 min');
    expect(fmtS1({ lowMin: 90, highMin: 90 })).toBe('~1.5 h');
  });
});
