import type { Guide, GuideDraft } from './schema';
import { agentShare, score, timeToS1, timeToS3 } from './score';

/** Invariants 3-5 plus difficulty (section 5): derived fields are computed, never trusted from the model. */
export function recompute<T extends GuideDraft>(g: T): T {
  const sc = score(g);
  return {
    ...g,
    verdict: {
      ...g.verdict,
      difficulty: sc.difficulty,
      label: sc.label,
      agentShare: agentShare(g.steps),
      timeToS1: timeToS1(g.steps),
      timeToS3: timeToS3(g.steps),
    },
  };
}

/** Invariants 1-2 (reference integrity) plus consistency of the derived fields. */
export function checkInvariants(g: GuideDraft | Guide): string[] {
  const errs: string[] = [];
  const claimIds = new Set(g.claims.map((c) => c.id));
  const sourceIds = new Set(g.sources.map((s) => s.id));
  const dup = (ids: string[], what: string) => {
    if (new Set(ids).size !== ids.length) errs.push(`duplicate ${what} ids`);
  };
  dup(g.claims.map((c) => c.id), 'claim');
  dup(g.sources.map((s) => s.id), 'source');
  dup(g.steps.map((s) => s.id), 'step');
  const refs: [string, string[]][] = [
    ...g.steps.map((s): [string, string[]] => [`step ${s.id}`, s.claimIds]),
    ...g.requirements.map((r): [string, string[]] => [`requirement ${r.id}`, r.claimIds]),
    ...g.blockers.map((b): [string, string[]] => [`blocker ${b.id}`, b.claimIds]),
  ];
  for (const [who, ids] of refs) for (const id of ids) if (!claimIds.has(id)) errs.push(`${who} references missing claim ${id}`);
  for (const c of g.claims) {
    for (const id of c.evidence.sourceIds) if (!sourceIds.has(id)) errs.push(`claim ${c.id} references missing source ${id}`);
    if (c.evidence.kind === 'sourced' && c.evidence.sourceIds.length < 1) errs.push(`claim ${c.id} is sourced but has no sourceIds`);
  }
  const want = recompute(g as GuideDraft).verdict;
  if (g.verdict.agentShare !== want.agentShare) errs.push(`agentShare ${g.verdict.agentShare} != ${want.agentShare}`);
  if (g.verdict.timeToS3.hasReview !== want.timeToS3.hasReview) errs.push('timeToS3.hasReview inconsistent with provider steps');
  if (g.verdict.timeToS1.lowMin !== want.timeToS1.lowMin || g.verdict.timeToS1.highMin !== want.timeToS1.highMin)
    errs.push('timeToS1 inconsistent with S0/S1 steps');
  return errs;
}
