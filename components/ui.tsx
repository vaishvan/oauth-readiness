import type { Guide } from '@/lib/schema';

export const DIFF_COLORS = ['#15803d', '#4d7c0f', '#b45309', '#c2410c', '#b91c1c'];

export function DifficultyPill({ difficulty, label }: { difficulty: number; label: string }) {
  const c = DIFF_COLORS[difficulty - 1] ?? DIFF_COLORS[0];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold" style={{ borderColor: c, color: c }}>
      <span className="font-mono">{difficulty}/5</span> {label}
    </span>
  );
}

export function Meter({ n }: { n: number }) {
  const c = DIFF_COLORS[n - 1] ?? DIFF_COLORS[0];
  return (
    <div role="img" aria-label={`Difficulty ${n} of 5`} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="h-2.5 w-8 rounded-full border border-line" style={i <= n ? { background: c, borderColor: c } : undefined} />
      ))}
    </div>
  );
}

const OWNER = {
  agent: { label: 'Agent', cls: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200' },
  you: { label: 'You', cls: 'bg-stone-200 text-stone-900 dark:bg-stone-800 dark:text-stone-100' },
  provider: { label: 'Provider', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
} as const;

export function OwnerBadge({ owner }: { owner: Guide['steps'][number]['owner'] }) {
  const o = OWNER[owner];
  return <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${o.cls}`}>{o.label}</span>;
}

export function ClaimBadge({ claim, sources }: { claim: Guide['claims'][number]; sources: Guide['sources'] }) {
  const e = claim.evidence;
  const conf = `confidence ${Math.round(claim.confidence * 100)}%`;
  if (e.kind === 'tested')
    return (
      <span title={`${e.note ?? 'Tested'} · ${conf}`} className="inline-flex items-center rounded bg-green-100 px-1.5 text-xs font-medium text-green-900 dark:bg-green-950 dark:text-green-200">
        ✓ Tested
      </span>
    );
  if (e.kind === 'sourced')
    return (
      <>
        {e.sourceIds.map((id) => {
          const n = sources.findIndex((s) => s.id === id) + 1;
          return n > 0 ? (
            <a key={id} href={`#src-${n}`} title={`${e.quote ? `“${e.quote}”` : e.note ?? claim.text} · ${conf}`} className="inline-flex items-center rounded bg-blue-100 px-1.5 text-xs font-medium text-blue-900 hover:underline dark:bg-blue-950 dark:text-blue-200">
              Source {n}
            </a>
          ) : null;
        })}
      </>
    );
  return (
    <span title={`${e.note ?? 'No source or test backs this'} · ${conf}`} className="inline-flex items-center rounded bg-stone-200 px-1.5 text-xs font-medium text-stone-800 dark:bg-stone-800 dark:text-stone-200">
      ? Unverified
    </span>
  );
}

export function Claims({ ids, g }: { ids: string[]; g: Guide }) {
  const cs = ids.map((id) => g.claims.find((c) => c.id === id)).filter((c): c is Guide['claims'][number] => !!c);
  return cs.length ? (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {cs.map((c) => (
        <ClaimBadge key={c.id} claim={c} sources={g.sources} />
      ))}
    </span>
  ) : null;
}
