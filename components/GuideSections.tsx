import type { Guide } from '@/lib/schema';
import { fmtS1, fmtS3 } from '@/lib/score';
import { Claims, DifficultyPill, Meter, OwnerBadge } from './ui';

const STAGES = [
  { k: 'S0', name: 'Registered', def: 'Client ID and secret exist' },
  { k: 'S1', name: 'Dev-ready', def: 'Your own account completes the flow' },
  { k: 'S2', name: 'Limited users', def: 'Real users, under a cap or warning' },
  { k: 'S3', name: 'Production', def: 'Any user, no cap, no warning' },
] as const;

export function VerdictCard({ g }: { g: Guide }) {
  const v = g.verdict;
  const agent = g.steps.filter((s) => s.owner === 'agent').length;
  return (
    <section aria-labelledby="verdict" className="rounded-xl border border-line bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="verdict" className="text-3xl font-bold tracking-tight">{g.appName}: {v.label}</h1>
        <Meter n={v.difficulty} />
      </div>
      <p className="mt-2 text-lg text-muted">{v.oneLiner}</p>
      <dl className="mt-5 grid gap-4 sm:grid-cols-3">
        <div><dt className="text-sm text-muted">Time to working (S1)</dt><dd className="text-2xl font-semibold">{fmtS1(v.timeToS1)}</dd></div>
        <div>
          <dt className="text-sm text-muted">Time to any user (S3)</dt>
          <dd className="text-2xl font-semibold">{fmtS3(v.timeToS3)}</dd>
          {v.timeToS3.hasReview && <dd className="text-xs text-muted">includes provider review</dd>}
        </div>
        <div><dt className="text-sm text-muted">Agent can do</dt><dd className="text-2xl font-semibold">{agent} of {g.steps.length} steps</dd></div>
      </dl>
      {v.s2Limit && (
        <p className="mt-4 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-fg"><strong>Until verified:</strong> {v.s2Limit}</p>
      )}
      {g.meta.validationWarnings.length > 0 && (
        <p role="note" className="mt-3 rounded-lg border border-line px-3 py-2 text-sm text-muted">
          <strong>Heads up:</strong> {g.meta.validationWarnings.join(' ')}
        </p>
      )}
    </section>
  );
}

export function StageTimeline({ g }: { g: Guide }) {
  const rows = STAGES.map((s) => {
    const st = g.steps.filter((x) => x.stage === s.k);
    const dev = st.filter((x) => x.owner !== 'provider').reduce((a, x) => a + x.estMinutes.high, 0);
    const wait = st.filter((x) => x.owner === 'provider').reduce((a, x) => a + (x.waitDays?.high ?? 0) * 1440, 0);
    const total = dev + wait;
    return { ...s, dev, wait, total, w: Math.max(Math.log(1 + total), 1.2), hasProvider: st.some((x) => x.owner === 'provider') };
  });
  const sum = rows.reduce((a, r) => a + r.w, 0);
  const label = (r: (typeof rows)[number]) =>
    r.hasProvider && r.wait === 0 ? 'review time unknown' : r.wait > 0 ? `${Math.round(r.wait / 1440)} d wait${r.dev ? ` + ${r.dev} min work` : ''}` : r.total ? `~${r.total} min` : 'no steps';
  return (
    <section aria-labelledby="timeline" className="mt-6">
      <h2 id="timeline" className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Readiness stages</h2>
      <div className="flex gap-1" role="list">
        {rows.map((r) => (
          <div key={r.k} role="listitem" style={{ width: `${(r.w / sum) * 100}%` }} className="min-w-0">
            <div className="flex h-7 overflow-hidden rounded border border-line bg-card" aria-hidden>
              <div className="bg-accent/70" style={{ width: r.total ? `${(r.dev / r.total) * 100}%` : '0%' }} />
              <div className="hatch bg-amber-500/40" style={{ width: r.total ? `${(r.wait / r.total) * 100}%` : r.hasProvider ? '100%' : '0%' }} />
            </div>
            <p className="mt-1 truncate text-xs font-semibold">{r.k} {r.name}</p>
            <p className="truncate text-xs text-muted" title={r.def}>{label(r)}</p>
          </div>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">Width is log-scaled so minutes and weeks both stay visible. Hatched = waiting on the provider.</p>
    </section>
  );
}

export function Requirements({ g }: { g: Guide }) {
  if (!g.requirements.length) return null;
  const cats = [...new Set(g.requirements.map((r) => r.category))];
  return (
    <section aria-labelledby="req" className="mt-8">
      <h2 id="req" className="mb-3 text-xl font-semibold">Requirements</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {cats.map((c) => (
          <div key={c} className="rounded-lg border border-line bg-card p-3">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{c}</h3>
            <ul className="space-y-1.5">
              {g.requirements.filter((r) => r.category === c).map((r) => (
                <li key={r.id} className="text-sm">
                  <span className="mr-1.5 rounded bg-stone-200 px-1 text-xs font-mono dark:bg-stone-800">{r.requiredAt}</span>
                  {r.label}
                  {r.costUsd && <strong className="ml-1">${r.costUsd.low.toLocaleString()}–${r.costUsd.high.toLocaleString()}</strong>} <Claims ids={r.claimIds} g={g} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Steps({ g }: { g: Guide }) {
  let n = 0;
  return (
    <section aria-labelledby="steps" className="mt-8">
      <h2 id="steps" className="mb-3 text-xl font-semibold">Steps</h2>
      {STAGES.map((st) => {
        const list = g.steps.filter((s) => s.stage === st.k);
        if (!list.length) return null;
        return (
          <div key={st.k} className="mb-5">
            <h3 className="mb-2 text-sm font-semibold text-muted">{st.k} · {st.name} <span className="font-normal">— {st.def}</span></h3>
            <ol className="space-y-2">
              {list.map((s) => {
                n++;
                return (
                  <li key={s.id} className="rounded-lg border border-line bg-card">
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5">
                        <span className="font-mono text-sm text-muted">{n}.</span>
                        <span className="font-medium">{s.title}</span>
                        <OwnerBadge owner={s.owner} />
                        <span className="text-xs text-muted">
                          {s.owner === 'provider' ? (s.waitDays ? `waits ${s.waitDays.low}–${s.waitDays.high} days` : 'wait unknown') : `${s.estMinutes.low}–${s.estMinutes.high} min`}
                        </span>
                        <Claims ids={s.claimIds} g={g} />
                      </summary>
                      <div className="space-y-2 border-t border-line px-3 py-3 text-sm">
                        <p className="whitespace-pre-line">{s.detail}</p>
                        {s.agentAction && <p className="text-muted"><strong>Agent:</strong> {s.agentAction}</p>}
                        {s.url && <a className="text-accent underline" href={s.url} target="_blank" rel="noreferrer noopener">Open console page ↗</a>}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </section>
  );
}

export function Blockers({ g }: { g: Guide }) {
  if (!g.blockers.length) return null;
  return (
    <section aria-labelledby="blk" className="mt-8">
      <h2 id="blk" className="mb-3 text-xl font-semibold">Blockers</h2>
      <ul className="space-y-3">
        {g.blockers.map((b) => (
          <li key={b.id} className="rounded-lg border border-line bg-card p-3 text-sm">
            <p><code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono dark:bg-stone-800">{b.symptom}</code> <Claims ids={b.claimIds} g={g} /></p>
            <p className="mt-1.5"><strong>Cause:</strong> {b.cause}</p>
            <p><strong>Fix:</strong> {b.fix}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Unsure({ g }: { g: Guide }) {
  const unv = g.claims.filter((c) => c.evidence.kind === 'unverified');
  if (!g.uncertainties.length && !unv.length) return null;
  return (
    <section aria-labelledby="unsure" className="mt-8">
      <h2 id="unsure" className="mb-3 text-xl font-semibold">What we’re not sure about</h2>
      <ul className="list-disc space-y-1.5 pl-5 text-sm">
        {g.uncertainties.map((u, i) => <li key={`u${i}`}>{u}</li>)}
        {unv.map((c) => <li key={c.id}><span className="text-muted">Unverified:</span> {c.text}</li>)}
      </ul>
    </section>
  );
}

export function Sources({ g }: { g: Guide }) {
  return (
    <section aria-labelledby="src" className="mt-8">
      <h2 id="src" className="mb-3 text-xl font-semibold">Sources</h2>
      <ol className="space-y-1.5 text-sm">
        {g.sources.map((s, i) => (
          <li key={s.id} id={`src-${i + 1}`} className="scroll-mt-20 target:bg-warn-bg">
            <span className="font-mono text-muted">{i + 1}.</span>{' '}
            <a className="text-accent underline" href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a>{' '}
            <span className="text-muted">· {s.publisher.replace('_', ' ')} · fetched {s.fetchedAt.slice(0, 10)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-xs text-muted">
        Generated {g.meta.generatedAt.slice(0, 10)} · {g.meta.model} · {Math.round(g.meta.durationMs / 1000)} s · {g.meta.origin}
        {g.meta.reviewedByHuman ? ' · human reviewed' : ' · not human reviewed'}
      </p>
    </section>
  );
}

export { DifficultyPill };
