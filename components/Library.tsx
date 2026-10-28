'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { GuideSummary } from '@/lib/schema';
import { fmtS1, fmtS3 } from '@/lib/score';
import { DifficultyPill } from './ui';

export function Library({ guides }: { guides: GuideSummary[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [diff, setDiff] = useState<number | null>(null);
  const [managed, setManaged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return guides
      .filter((g) => (!t || [g.appName, g.slug, g.domain].some((x) => x.toLowerCase().includes(t))) && (diff === null || g.difficulty === diff) && (!managed || g.composioManaged === 'yes'))
      .sort((a, b) => a.difficulty - b.difficulty || a.appName.localeCompare(b.appName));
  }, [guides, q, diff, managed]);
  const noMatch = q.trim().length > 1 && shown.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2 || busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q.trim() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
      router.push(j.cached ? `/guide/${j.cached}` : `/generate/${j.jobId}`);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? 'border-accent bg-accent text-bg' : 'border-line bg-card hover:bg-line/40'}`;
  return (
    <>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="q">App name or website</label>
        <input id="q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} autoComplete="off" placeholder="App name or website, e.g. Pipedrive or pipedrive.com"
          className="min-w-0 flex-1 rounded-lg border border-line bg-card px-4 py-3 text-base" />
        <button disabled={busy || q.trim().length < 2} className="rounded-lg bg-accent px-5 py-3 font-semibold text-bg disabled:opacity-50">
          {busy ? 'Starting…' : noMatch ? 'Generate a new guide' : 'Generate guide'}
        </button>
      </form>
      <p role="alert" className="mt-2 min-h-5 text-sm text-red-700 dark:text-red-400">{err}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Filters">
        {[1, 2, 3, 4, 5].map((d) => (
          <button key={d} type="button" aria-pressed={diff === d} className={chip(diff === d)} onClick={() => setDiff(diff === d ? null : d)}>Difficulty {d}</button>
        ))}
        <button type="button" aria-pressed={managed} className={chip(managed)} onClick={() => setManaged(!managed)}>Composio-managed</button>
      </div>

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((g) => (
          <li key={g.slug}>
            <Link href={`/guide/${g.slug}`} className="block h-full rounded-xl border border-line bg-card p-4 transition hover:border-accent">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`https://www.google.com/s2/favicons?domain=${g.domain}&sz=64`} alt="" width={32} height={32} className="rounded" />
                <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{g.appName}</h2>
                <span className="rounded border border-line px-1.5 text-xs text-muted">{g.origin === 'seed' ? 'Seed' : 'Live'}</span>
              </div>
              <div className="mt-3"><DifficultyPill difficulty={g.difficulty} label={g.label} /></div>
              <p className="mt-3 text-sm">S1 in {fmtS1(g.timeToS1)} · S3 in {fmtS3(g.timeToS3)}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{g.oneLiner}</p>
            </Link>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="mt-6 text-muted">{noMatch ? 'No guide yet. Generate one: it takes about a minute.' : 'No guides match these filters.'}</p>}
    </>
  );
}
