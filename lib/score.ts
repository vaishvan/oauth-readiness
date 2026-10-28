import type { Guide } from './schema';

type Facts = Pick<Guide, 'requirements' | 'steps' | 'blockers'> & { verdict: Pick<Guide['verdict'], 's2Limit'> };

// Gate weights (PRD section 5). Calibration changes are recorded in README.
export const POINTS = { paid: 1, business: 1, s2cap: 1, review: 1, security: 2, preApproval: 2, reapply: 1 };
export const LABELS = ['Instant', 'Easy', 'Moderate', 'Hard', 'Gated'] as const;

export function gates(g: Facts): { name: string; pts: number }[] {
  const out: { name: string; pts: number }[] = [];
  const add = (cond: boolean, name: string, pts: number) => cond && out.push({ name, pts });
  const { requirements: rq, steps, blockers } = g;
  add(rq.some((r) => r.category === 'cost' && r.requiredAt === 'S0'), 'Paid account to register', POINTS.paid);
  add(
    rq.some((r) => (r.category === 'business' || r.category === 'brand') && (r.requiredAt === 'S0' || r.requiredAt === 'S1')),
    'Business entity or verified domain',
    POINTS.business,
  );
  add(g.verdict.s2Limit != null, 'Cap or warning at S2', POINTS.s2cap);
  add(steps.some((s) => s.owner === 'provider' && s.stage === 'S3'), 'Manual review to reach S3', POINTS.review);
  add(rq.some((r) => r.category === 'security' && (r.costUsd?.high ?? 0) > 0), 'Third-party security assessment', POINTS.security);
  add(steps.some((s) => s.owner === 'provider' && (s.stage === 'S0' || s.stage === 'S1')), 'Approval needed before S1', POINTS.preApproval);
  add(blockers.some((b) => b.cause.includes('reapply_penalty')), 'Costly rejection', POINTS.reapply);
  return out;
}

export const difficultyFromPoints = (p: number) => Math.min(5, 1 + Math.floor(p / 2));

export function score(g: Facts) {
  const gs = gates(g);
  const points = gs.reduce((a, b) => a + b.pts, 0);
  const difficulty = difficultyFromPoints(points);
  return { points, gates: gs, difficulty, label: LABELS[difficulty - 1] };
}

const s1Steps = (steps: Guide['steps']) => steps.filter((s) => s.stage === 'S0' || s.stage === 'S1');

export const timeToS1 = (steps: Guide['steps']) => ({
  lowMin: s1Steps(steps).reduce((a, s) => a + s.estMinutes.low, 0),
  highMin: s1Steps(steps).reduce((a, s) => a + s.estMinutes.high, 0),
});

const roundDays = (d: number) => (d < 3 ? Math.ceil(d * 10) / 10 : Math.ceil(d));

/** Provider waits + dev minutes / 240 (4 focused hours per day), low and high bounds separately. */
export function timeToS3(steps: Guide['steps']): Guide['verdict']['timeToS3'] {
  const sum = (k: 'low' | 'high') => {
    let d = 0;
    for (const s of steps) d += s.owner === 'provider' ? (s.waitDays?.[k] ?? 0) : s.estMinutes[k] / 240;
    return roundDays(d);
  };
  return { lowDays: sum('low'), highDays: sum('high'), hasReview: steps.some((s) => s.owner === 'provider') };
}

export const agentShare = (steps: Guide['steps']) =>
  steps.length ? Math.round((steps.filter((s) => s.owner === 'agent').length / steps.length) * 100) / 100 : 0;

const mins = (m: number) => (m < 60 ? `${Math.max(1, Math.round(m))} min` : `${Math.round((m / 60) * 10) / 10} h`);

export function fmtS1(t: { lowMin: number; highMin: number }) {
  if (t.highMin <= 0) return '~0 min';
  return t.lowMin === t.highMin ? `~${mins(t.highMin)}` : `~${mins(t.lowMin)}–${mins(t.highMin)}`;
}

const range = (a: number, b: number, unit: string) => (a === b ? `${a} ${unit}` : `${a}–${b} ${unit}`);

export function fmtS3(t: Guide['verdict']['timeToS3']) {
  const { lowDays: lo, highDays: hi, hasReview } = t;
  // Without a provider wait the figure is pure dev work, so minutes/hours (4h = 1 day) are meaningful.
  if (!hasReview && hi * 240 < 60) return `~${Math.max(1, Math.round(hi * 240))} min`;
  if (!hasReview && hi < 2) return `~${Math.round(hi * 4 * 10) / 10} hours`;
  if (hi < 14) return range(lo, hi, 'days');
  return range(Math.round(lo / 7), Math.round(hi / 7), 'weeks');
}
