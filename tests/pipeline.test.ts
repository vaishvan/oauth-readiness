// End-to-end pipeline against the mock search/LLM and an in-memory Postgres.
import { beforeAll, describe, expect, it } from 'vitest';

process.env.MOCK_PIPELINE = '1';
process.env.MOCK_DELAY_MS = '0';
process.env.PGLITE_DIR = 'memory://';
process.env.CHOICE_TIMEOUT_MS = '1500';
delete process.env.DATABASE_URL;

const { runPipeline } = await import('@/lib/pipeline');
const repo = await import('@/lib/repo');

async function run(query: string, opts: { force?: boolean } = {}) {
  const id = await repo.createJob(query);
  await runPipeline(id, { query, ...opts });
  return (await repo.getJob(id))!;
}
const types = (j: any) => j.events.map((e: any) => e.type);

describe('pipeline (mock)', () => {
  beforeAll(async () => {
    expect((await repo.listGuides()).length).toBe(6); // seeds auto-loaded
  });

  it('happy path: all stages, verified claims, saved guide', async () => {
    const j = await run('Pipedrive');
    expect(j.status).toBe('done');
    const stages = j.events.filter((e: any) => e.type === 'stage' && e.status === 'done').map((e: any) => e.stage);
    expect(stages).toEqual(['resolve', 'discover', 'read', 'probe', 'extract', 'verify']);
    expect(types(j)).toContain('partial');
    const g = (await repo.getGuide('pipedrive'))!.guide;
    const byId = Object.fromEntries(g.claims.map((c) => [c.id, c]));
    expect(byId.clm_1.evidence.kind).toBe('sourced'); // exact quote
    expect(byId.clm_6.evidence.kind).toBe('unverified'); // paraphrased quote, downgraded
    expect(byId.clm_7.evidence.kind).toBe('unverified'); // contradicted by the judge
    expect(byId.clm_probe_1.evidence.kind).toBe('tested');
    expect(g.pkceSupported).toBe('yes');
    expect(g.sources.filter((s) => s.publisher === 'community').length).toBeLessThanOrEqual(1); // at most one aggregator
    expect(g.verdict.difficulty).toBe(2);
    expect(g.meta.costUsd).toBeGreaterThan(0);
  });

  it('cache: a second run returns the existing guide without regenerating', async () => {
    const j = await run('Pipedrive');
    expect(types(j)).not.toContain('source');
    expect(types(j).at(-1)).toBe('done');
  });

  it('force regenerates', async () => {
    const j = await run('Pipedrive', { force: true });
    expect(types(j)).toContain('source');
  });

  it('repairs invalid references with one extra call', async () => {
    const j = await run('broken');
    expect(j.status).toBe('done');
    expect((await repo.getGuide('broken'))!.guide.meta.validationWarnings).toEqual([]);
  });

  it('publishes with warnings when the repair also fails', async () => {
    const j = await run('stubborn');
    expect(j.status).toBe('done');
    const g = (await repo.getGuide('stubborn'))!.guide;
    expect(g.meta.validationWarnings.join()).toMatch(/clm_999/);
    expect(g.steps.flatMap((s) => s.claimIds)).not.toContain('clm_999');
  });

  it('fails cleanly with too little documentation', async () => {
    const j = await run('thin');
    expect(j.status).toBe('failed');
    expect(j.events.at(-1)).toMatchObject({ type: 'error', retryable: false });
  });

  it('ambiguous input asks for a choice and honours it', async () => {
    const id = await repo.createJob('mercury');
    const p = runPipeline(id, { query: 'mercury' });
    for (let i = 0; i < 50; i++) {
      const job = await repo.getJob(id);
      if (types(job).includes('needs_choice')) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await repo.setChoice(id, 1);
    await p;
    const j = (await repo.getJob(id))!;
    expect(j.events.find((e: any) => e.type === 'resolved')).toMatchObject({ appName: 'Mercury Mail' });
    expect(j.status).toBe('done');
  });

  it('hard cap publishes or fails instead of hanging', async () => {
    process.env.HARD_CAP_MS = '1';
    const j = await run('Calendly', { force: true });
    delete process.env.HARD_CAP_MS;
    expect(['failed', 'done']).toContain(j.status);
    expect(types(j).filter((t: string) => t === 'done' || t === 'error').length).toBe(1);
  });
});
