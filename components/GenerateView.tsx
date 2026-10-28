'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { PipelineEvent } from '@/lib/schema';

const STAGES = ['resolve', 'discover', 'read', 'probe', 'extract', 'verify'] as const;
const LABEL: Record<(typeof STAGES)[number], string> = {
  resolve: 'Identify the app', discover: 'Find documentation', read: 'Read pages', probe: 'Probe live endpoints', extract: 'Write the guide', verify: 'Check every claim',
};

type View = {
  stages: Record<string, { status: 'start' | 'done'; ms?: number }>;
  sources: Extract<PipelineEvent, { type: 'source' }>[];
  probes: Extract<PipelineEvent, { type: 'probe' }>[];
  verdict?: any; steps: any[]; blockers: any[];
  checks: Extract<PipelineEvent, { type: 'claim_checked' }>[];
  warns: string[]; candidates?: { appName: string; domain: string }[]; resolved?: string;
  error?: { message: string; retryable: boolean }; done?: { slug: string; durationMs: number };
};
const empty: View = { stages: {}, sources: [], probes: [], steps: [], blockers: [], checks: [], warns: [] };

function reduce(v: View, e: PipelineEvent): View {
  switch (e.type) {
    case 'stage': return { ...v, stages: { ...v.stages, [e.stage]: { status: e.status, ms: e.ms } } };
    case 'resolved': return { ...v, resolved: e.appName, candidates: undefined };
    case 'needs_choice': return { ...v, candidates: e.candidates };
    case 'source': return { ...v, sources: [...v.sources, e] };
    case 'probe': return { ...v, probes: [...v.probes, e] };
    case 'partial': return e.field === 'verdict' ? { ...v, verdict: e.value } : e.field === 'steps' ? { ...v, steps: [...v.steps, e.value] } : { ...v, blockers: [...v.blockers, e.value] };
    case 'claim_checked': return { ...v, checks: [...v.checks, e] };
    case 'warn': return { ...v, warns: [...v.warns, e.message] };
    case 'done': return { ...v, done: { slug: e.slug, durationMs: e.durationMs } };
    case 'error': return { ...v, error: { message: e.message, retryable: e.retryable } };
  }
}

export function GenerateView({ jobId, query }: { jobId: string; query: string }) {
  const router = useRouter();
  const [v, setV] = useState<View>(empty);
  const [secs, setSecs] = useState(0);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const last = useRef(-1);
  const finished = !!v.done || !!v.error;

  useEffect(() => {
    const es = new EventSource(`/api/jobs/${jobId}/stream`);
    const types = ['stage', 'resolved', 'needs_choice', 'source', 'probe', 'partial', 'claim_checked', 'warn', 'done', 'error'];
    const on = (m: MessageEvent) => {
      const id = Number(m.lastEventId);
      if (Number.isFinite(id) && id <= last.current) return; // replay after a reconnect
      if (Number.isFinite(id)) last.current = id;
      const ev = JSON.parse(m.data) as PipelineEvent;
      setV((s) => reduce(s, ev));
      if (ev.type === 'done' || ev.type === 'error') es.close();
    };
    types.forEach((t) => es.addEventListener(t, on as EventListener));
    return () => es.close();
  }, [jobId]);

  useEffect(() => {
    if (finished) return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [finished]);

  useEffect(() => {
    if (!v.done) return;
    const t = setTimeout(() => router.push(`/guide/${v.done!.slug}`), 1500);
    return () => clearTimeout(t);
  }, [v.done, router]);

  async function rerun(extra: object) {
    setMsg('');
    const r = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, force: true, ...extra }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.jobId) router.push(`/generate/${j.jobId}`);
    else setMsg(j.error ?? `Request failed (${r.status})`);
  }
  async function choose(i: number) {
    await fetch(`/api/jobs/${jobId}/choice`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateIndex: i }) });
  }

  const downgraded = v.checks.filter((c) => c.from !== 'unverified' && c.to === 'unverified').length;
  const active = STAGES.find((s) => v.stages[s]?.status === 'start');
  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 md:grid-cols-[260px_1fr]">
      <aside>
        <h1 className="text-xl font-bold">Generating a guide</h1>
        <p className="mt-1 text-sm text-muted">for “{v.resolved ?? query}”</p>
        <ol className="mt-4 space-y-2" aria-label="Progress">
          {STAGES.map((s) => {
            const st = v.stages[s];
            const isDone = st?.status === 'done';
            return (
              <li key={s} aria-current={active === s ? 'step' : undefined} className={`flex items-center gap-2 text-sm ${st ? '' : 'text-muted'}`}>
                <span aria-hidden className="w-4 text-center">{isDone ? '✓' : active === s ? <span className="inline-block animate-spin">◌</span> : '○'}</span>
                {LABEL[s]}
                {st?.ms != null && <span className="ml-auto font-mono text-xs text-muted">{(st.ms / 1000).toFixed(1)}s</span>}
              </li>
            );
          })}
        </ol>
        <p className="mt-4 font-mono text-sm" aria-live="off">{finished ? (v.done ? `Done in ${Math.round(v.done.durationMs / 1000)} s` : 'Stopped') : `${secs} s elapsed`}</p>
      </aside>

      <section aria-live="polite" className="space-y-4">
        {v.candidates && (
          <div className="rounded-lg border border-accent p-4">
            <p className="font-medium">Which one did you mean?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {v.candidates.map((c, i) => (
                <button key={i} onClick={() => choose(i)} className="rounded-md border border-line bg-card px-3 py-1.5 text-sm hover:border-accent">{c.appName} <span className="text-muted">{c.domain}</span></button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">The first is picked automatically after 60 seconds.</p>
          </div>
        )}
        {v.sources.length > 0 && (
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Sources found</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {v.sources.map((s) => (
                <li key={s.id} className="truncate rounded-lg border border-line bg-card px-3 py-2 text-sm" title={s.url}>
                  <span className="mr-1.5 rounded bg-stone-200 px-1 text-xs dark:bg-stone-800">{s.publisher.replace('_', ' ')}</span>{s.title}
                </li>
              ))}
            </ul>
          </div>
        )}
        {v.probes.length > 0 && (
          <ul className="space-y-1 font-mono text-sm">
            {v.probes.map((p, i) => <li key={i}><span className={p.ok ? 'text-ok' : 'text-red-700 dark:text-red-400'}>{p.ok ? '✓' : '✗'}</span> {p.detail}</li>)}
          </ul>
        )}
        {(v.verdict || v.steps.length > 0) && (
          <div className="rounded-lg border border-line bg-card p-4">
            {v.verdict && <p className="font-medium">{v.verdict.oneLiner}</p>}
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {v.steps.map((s, i) => <li key={i}>{s.title} <span className="text-muted">({s.owner})</span></li>)}
            </ol>
            {v.blockers.length > 0 && <p className="mt-2 text-sm text-muted">{v.blockers.length} blocker{v.blockers.length > 1 ? 's' : ''} found</p>}
          </div>
        )}
        {v.checks.length > 0 && (
          <div className="rounded-lg border border-line bg-card p-4 text-sm">
            <p className="font-medium">{v.checks.length} claims checked{downgraded ? ` · ${downgraded} downgraded to unverified` : ''}</p>
            <ul className="mt-2 space-y-0.5 font-mono text-xs">
              {v.checks.filter((c) => c.from !== c.to).map((c) => <li key={c.claimId}>{c.claimId}: {c.from} → <strong>{c.to}</strong></li>)}
            </ul>
          </div>
        )}
        {v.warns.map((w, i) => <p key={i} className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-fg">{w}</p>)}
        {v.done && <p role="status" className="rounded-lg border border-ok px-3 py-2 text-ok">Generated in {Math.round(v.done.durationMs / 1000)} s. Opening the guide…</p>}
        {v.error && (
          <div role="alert" className="rounded-lg border border-red-700 p-4">
            <p className="font-medium text-red-700 dark:text-red-400">{v.error.message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => rerun({})} className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-bg">Retry</button>
              <form onSubmit={(e) => { e.preventDefault(); if (pin) rerun({ pinUrl: pin }); }} className="flex min-w-0 flex-1 gap-2">
                <input type="url" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Paste a docs URL" aria-label="Docs URL" className="min-w-0 flex-1 rounded-md border border-line bg-card px-3 py-1.5 text-sm" />
                <button className="rounded-md border border-line bg-card px-3 py-1.5 text-sm">Use this page</button>
              </form>
            </div>
            <p role="status" className="mt-2 text-sm text-red-700 dark:text-red-400">{msg}</p>
          </div>
        )}
      </section>
    </main>
  );
}
