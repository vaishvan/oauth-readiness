import { describe, expect, it } from 'vitest';
import { sanitize } from '@/lib/pipeline/extract';
import { loadSeeds } from '@/lib/repo';
import { checkInvariants, recompute } from '@/lib/validate';

const base = () => structuredClone(loadSeeds().find((g) => g.slug === 'google-gmail')!);

describe('invariants', () => {
  it('all seeds pass', () => {
    for (const g of loadSeeds()) expect(checkInvariants(g), g.slug).toEqual([]);
  });
  it('catches a broken claim reference', () => {
    const g = base();
    g.steps[0].claimIds.push('clm_nope');
    expect(checkInvariants(g).join()).toMatch(/missing claim clm_nope/);
  });
  it('catches a broken source reference and a sourced claim without sources', () => {
    const g = base();
    g.claims[0].evidence.sourceIds = ['src_99'];
    g.claims[1].evidence.sourceIds = [];
    const e = checkInvariants(g).join('\n');
    expect(e).toMatch(/missing source src_99/);
    expect(e).toMatch(/sourced but has no sourceIds/);
  });
  it('catches a wrong agentShare, and recompute fixes it', () => {
    const g = base();
    g.verdict.agentShare = 0.99;
    expect(checkInvariants(g).join()).toMatch(/agentShare/);
    expect(checkInvariants(recompute(g))).toEqual([]);
  });
  it('sanitize drops dangling refs and downgrades sourceless claims', () => {
    const g = base();
    g.steps[0].claimIds.push('clm_nope');
    g.claims[0].evidence.sourceIds = ['src_99'];
    const s = recompute(sanitize(g));
    expect(checkInvariants(s)).toEqual([]);
    expect(s.claims[0].evidence.kind).toBe('unverified');
  });
});
