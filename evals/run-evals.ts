// Runs the 5 reserved unseen apps through the pipeline and records PRD section 13 pass criteria.
// Needs ANTHROPIC_API_KEY + FIRECRAWL_API_KEY (or MOCK_PIPELINE=1 for a dry run). Costs about $2 live.
import fs from 'node:fs';
if (!process.env.DATABASE_URL) process.env.PGLITE_DIR ??= 'memory://';
const { runPipeline } = await import('../lib/pipeline');
const repo = await import('../lib/repo');
const { Guide } = await import('../lib/schema');

const APPS = ['Zoho CRM', 'Pipedrive', 'Calendly', 'Dropbox', 'Typeform'];
const results = [];
for (const app of APPS) {
  const id = await repo.createJob(app.toLowerCase());
  const t0 = Date.now();
  await runPipeline(id, { query: app, force: true });
  const ms = Date.now() - t0;
  const job = (await repo.getJob(id))!;
  const g = job.guideSlug ? (await repo.getGuide(job.guideSlug))?.guide : undefined;
  if (g) fs.mkdirSync('evals/out', { recursive: true }), fs.writeFileSync(`evals/out/${g.slug}.json`, JSON.stringify(g, null, 2));
  const claims = g?.claims ?? [];
  const evidenced = claims.length ? claims.filter((c) => c.evidence.kind !== 'unverified').length / claims.length : 0;
  const r = {
    app, status: job.status, ms, schemaValid: !!g && Guide.safeParse(g).success,
    evidencedShare: Math.round(evidenced * 100) / 100, officialSources: g?.sources.filter((s) => s.publisher === 'official').length ?? 0,
    difficulty: g?.verdict.difficulty, costUsd: g?.meta.costUsd, warnings: g?.meta.validationWarnings ?? [], error: job.error,
  };
  const pass = r.status === 'done' && ms < 150_000 && r.schemaValid && r.evidencedShare >= 0.85 && r.officialSources >= 1;
  results.push({ ...r, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${app.padEnd(10)} ${(ms / 1000).toFixed(1)}s evidenced=${r.evidencedShare} official=${r.officialSources} cost=$${r.costUsd ?? '-'} ${r.error ?? ''}`);
}
const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
const summary = {
  ranAt: new Date().toISOString(), mock: process.env.MOCK_PIPELINE === '1', passed: results.filter((r) => r.pass).length, of: results.length,
  p50Ms: sorted[Math.floor((sorted.length - 1) / 2)], maxMs: sorted.at(-1), results,
};
fs.writeFileSync('evals/results.json', JSON.stringify(summary, null, 2) + '\n');
console.log(`\n${summary.passed}/${summary.of} passed (need 4). p50 ${(summary.p50Ms! / 1000).toFixed(1)}s. Written to evals/results.json`);
process.exit(summary.passed >= 4 ? 0 : 1);
