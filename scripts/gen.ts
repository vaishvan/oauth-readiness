export {};
// CLI: npx tsx scripts/gen.ts calendly  -> runs the live pipeline in-process and prints the guide.
// Uses an in-memory DB unless DATABASE_URL is set, so it never fights a running dev server for .data/pg.
if (!process.env.DATABASE_URL) process.env.PGLITE_DIR ||= "memory://";
const { runPipeline } = await import('../lib/pipeline');
const repo = await import('../lib/repo');

const query = process.argv.slice(2).join(' ').trim();
if (query.length < 2) {
  console.error('usage: npx tsx scripts/gen.ts <app name or url>');
  process.exit(2);
}
const id = await repo.createJob(query);
const t0 = Date.now();
const timer = setInterval(async () => {
  const j = await repo.getJob(id);
  process.stderr.write(`\r${Math.round((Date.now() - t0) / 1000)}s  stage=${j?.stage ?? '-'}  events=${j?.events.length ?? 0}   `);
}, 1000);
await runPipeline(id, { query, force: true });
clearInterval(timer);
const job = (await repo.getJob(id))!;
const last = job.events.at(-1);
console.error('\n' + JSON.stringify(last));
if (job.status !== 'done') process.exit(1);
console.log(JSON.stringify((await repo.getGuide(job.guideSlug!))!.guide, null, 2));
process.exit(0);
