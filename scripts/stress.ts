export {};
// Stress + abuse test against a running server (start it with MOCK_PIPELINE=1 for a keyless run).
//   BASE=http://localhost:3000 npx tsx scripts/stress.ts
const BASE = process.env.BASE ?? 'http://localhost:3000';
const N_READ = Number(process.env.N_READ ?? 600);
const N_GEN = Number(process.env.N_GEN ?? 30);
const CONC = Number(process.env.CONC ?? 50);

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '  ok ' : '  FAIL'} ${what}`);
  if (!ok) failures++;
};
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length - 1) * p))];
let ipN = 0;
const ip = () => `10.9.${Math.floor(++ipN / 250)}.${ipN % 250}`;
const post = (path: string, body: unknown, xff = ip()) =>
  fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': xff }, body: typeof body === 'string' ? body : JSON.stringify(body) });

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** Read the SSE stream until done/error; returns the events. */
async function stream(jobId: string, timeoutMs = 120_000) {
  const res = await fetch(`${BASE}/api/jobs/${jobId}/stream`, { signal: AbortSignal.timeout(timeoutMs) });
  const events: any[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let k;
    while ((k = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, k);
      buf = buf.slice(k + 2);
      const data = frame.split('\n').find((l) => l.startsWith('data: '));
      if (data) events.push(JSON.parse(data.slice(6)));
    }
  }
  return events;
}

console.log(`Stress test against ${BASE}`);

// 1. read load
console.log(`\n1. Read load: ${N_READ} requests, concurrency ${CONC}`);
const { guides } = await (await fetch(`${BASE}/api/guides`)).json();
check(guides.length >= 6, `library lists ${guides.length} guides`);
const paths = ['/', '/api/guides', '/api/guides?q=goo&difficulty=3', ...guides.flatMap((g: any) => [`/guide/${g.slug}`, `/api/guides/${g.slug}`, `/api/guides/${g.slug}/md`])];
const lat: number[] = [];
let readErr = 0;
const t0 = Date.now();
await pool(Array.from({ length: N_READ }, (_, i) => paths[i % paths.length]), CONC, async (p) => {
  const s = performance.now();
  const r = await fetch(BASE + p).catch(() => null);
  if (!r || r.status !== 200) readErr++;
  await r?.arrayBuffer();
  lat.push(performance.now() - s);
});
const rps = Math.round(N_READ / ((Date.now() - t0) / 1000));
console.log(`     p50 ${pct(lat, 0.5).toFixed(0)} ms · p95 ${pct(lat, 0.95).toFixed(0)} ms · p99 ${pct(lat, 0.99).toFixed(0)} ms · ${rps} req/s`);
check(readErr === 0, `${readErr} non-200 responses`);

// 2. concurrent live generations
console.log(`\n2. ${N_GEN} concurrent live generations (distinct IPs), each followed over SSE`);
const durations: number[] = [];
let genFail = 0;
const starts = await Promise.all(Array.from({ length: N_GEN }, (_, i) => post('/api/generate', { query: `Stressapp${i}` })));
check(starts.every((r) => r.status === 202), `all ${N_GEN} POSTs returned 202 (${starts.map((r) => r.status).filter((s) => s !== 202).join(',') || 'none other'})`);
const jobIds = await Promise.all(starts.map(async (r) => (await r.json()).jobId as string));
await Promise.all(jobIds.map(async (id) => {
  const s = Date.now();
  const ev = await stream(id).catch(() => []);
  const last = ev.at(-1);
  if (last?.type !== 'done') genFail++;
  else durations.push(last.durationMs);
  if (ev.filter((e) => e.type === 'done' || e.type === 'error').length !== 1) genFail++;
  void s;
}));
console.log(`     pipeline duration p50 ${(pct(durations, 0.5) / 1000).toFixed(1)} s · p95 ${(pct(durations, 0.95) / 1000).toFixed(1)} s`);
check(genFail === 0, `${genFail} jobs failed or emitted the wrong number of terminal events`);
const g0 = await fetch(`${BASE}/api/guides/stressapp0`);
check(g0.status === 200, 'generated guide is served');
const all = (await (await fetch(`${BASE}/api/guides?origin=live`)).json()).guides;
check(all.length >= N_GEN, `${all.length} live guides listed`);

// 3. SSE replay of a finished job
console.log('\n3. Replay');
const replay = await stream(jobIds[0]);
check(replay[0]?.type === 'stage' && replay.at(-1)?.type === 'done', `reconnecting to a finished job replays ${replay.length} events ending in done`);

// 4. cache, dedupe, force
console.log('\n4. Cache and dedupe');
const cached = await (await post('/api/generate', { query: 'GitHub' })).json();
check(cached.cached === 'github', 'known app returns the cached slug without a job');
const [d1, d2] = await Promise.all([post('/api/generate', { query: 'Dedupe Me' }), post('/api/generate', { query: '  dedupe   ME ' })]);
const [j1, j2] = [await d1.json(), await d2.json()];
check(!!j1.jobId && j1.jobId === j2.jobId, 'same normalized query within 5 min shares one job');
await stream(j1.jobId);
const forced = await (await post('/api/generate', { query: 'GitHub', force: true })).json();
check(!!forced.jobId && !forced.cached, 'force=true starts a new job');
await stream(forced.jobId);

// 5. rate limit
console.log('\n5. Rate limit (one IP)');
const codes: number[] = [];
for (let i = 0; i < 7; i++) codes.push((await post('/api/generate', { query: `ratelimited${i}` }, '203.0.113.7')).status);
check(codes.slice(0, 5).every((c) => c === 202) && codes.slice(5).every((c) => c === 429), `statuses ${codes.join(',')} (expect 5x202 then 429)`);

// 6. bad input and hostile input
console.log('\n6. Validation and hostile input');
const expect = async (p: Promise<Response>, code: number, what: string) => check((await p).status === code, `${what} -> ${code}`);
await expect(post('/api/generate', { query: '' }), 400, 'empty query');
await expect(post('/api/generate', { query: 'x'.repeat(201) }), 400, '201-char query');
await expect(post('/api/generate', '{not json'), 400, 'malformed JSON');
await expect(post('/api/generate', { query: 'ok app', pinUrl: 'javascript:alert(1)' }), 400, 'non-URL pinUrl');
await expect(fetch(`${BASE}/api/jobs/nope_nope_nope/stream`), 404, 'unknown job stream');
await expect(fetch(`${BASE}/api/guides/..%2F..%2Fetc`), 404, 'traversal-looking slug');
await expect(fetch(`${BASE}/api/guides/NOT_A_SLUG`), 404, 'invalid slug');
await expect(fetch(`${BASE}/guide/does-not-exist`), 404, 'unknown guide page');
await expect(post(`/api/jobs/${jobIds[0]}/choice`, { candidateIndex: 0 }), 409, 'choice when none is pending');
await expect(post(`/api/jobs/${jobIds[0]}/choice`, { candidateIndex: 7 }), 400, 'out-of-range choice');
const xss = await (await post('/api/generate', { query: '<script>alert(1)</script>' })).json();
const xssEv = await stream(xss.jobId);
const xssSlug = xssEv.at(-1)?.slug;
check(/^[a-z0-9-]+$/.test(xssSlug ?? ''), `script-tag query yields safe slug "${xssSlug}"`);
const page = await (await fetch(`${BASE}/guide/${xssSlug}`)).text();
check(!page.includes('<script>alert(1)</script>'), 'script tag is not rendered raw on the guide page');
await expect(post('/api/generate', { query: 'sql \'; drop table guides; --' }), 202, 'SQL-ish query is accepted as plain text');
check((await fetch(`${BASE}/api/guides/github`)).status === 200, 'guides table still intact');

// 7. ambiguous input
console.log('\n7. Ambiguous input');
const amb = await (await post('/api/generate', { query: 'mercury' })).json();
const ambEvents = stream(amb.jobId);
for (let i = 0; i < 40; i++) {
  const r = await post(`/api/jobs/${amb.jobId}/choice`, { candidateIndex: 1 });
  if (r.status === 200) break;
  await new Promise((r) => setTimeout(r, 250));
}
const ev = await ambEvents;
check(ev.some((e) => e.type === 'needs_choice') && ev.find((e) => e.type === 'resolved')?.appName === 'Mercury Mail', 'needs_choice then the picked candidate is used');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures ? 1 : 0);
