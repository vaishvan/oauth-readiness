import type { Guide } from './schema';
import { fmtS1, fmtS3 } from './score';

const badge = (g: Guide, ids: string[]) => {
  const out = ids
    .map((id) => g.claims.find((c) => c.id === id))
    .filter((c): c is Guide['claims'][number] => !!c)
    .map((c) =>
      c.evidence.kind === 'tested'
        ? '[tested]'
        : c.evidence.kind === 'sourced'
          ? c.evidence.sourceIds.map((s) => `[${g.sources.findIndex((x) => x.id === s) + 1}]`).join('')
          : '[unverified]',
    );
  return out.length ? ' ' + out.join('') : '';
};

export function guideToMarkdown(g: Guide): string {
  const v = g.verdict;
  const L: string[] = [];
  L.push(`# ${g.appName} OAuth setup: ${v.label}`, '', `> ${v.oneLiner}`, '');
  L.push(`- **Difficulty:** ${v.difficulty}/5 (${v.label})`);
  L.push(`- **Time to working (S1):** ${fmtS1(v.timeToS1)}`);
  L.push(`- **Time to any user (S3):** ${fmtS3(v.timeToS3)}${v.timeToS3.hasReview ? ' (includes provider review)' : ''}`);
  L.push(`- **Agent does:** ${g.steps.filter((s) => s.owner === 'agent').length} of ${g.steps.length} steps`);
  if (v.s2Limit) L.push(`- **Until verified:** ${v.s2Limit}`);
  L.push('', '## Requirements', '');
  for (const r of g.requirements)
    L.push(`- ${r.label} (${r.category}, needed at ${r.requiredAt})${r.costUsd ? ` — $${r.costUsd.low}–$${r.costUsd.high}` : ''}${badge(g, r.claimIds)}`);
  L.push('', '## Steps', '');
  g.steps.forEach((s, i) => {
    const wait = s.waitDays ? ` · wait ${s.waitDays.low}–${s.waitDays.high} days` : '';
    L.push(`${i + 1}. **${s.title}** — ${s.stage} · ${s.owner} · ${s.estMinutes.low}–${s.estMinutes.high} min${wait}${badge(g, s.claimIds)}`);
    L.push(`   ${s.detail.replace(/\n/g, '\n   ')}`);
    if (s.url) L.push(`   <${s.url}>`);
  });
  if (g.blockers.length) {
    L.push('', '## Blockers', '');
    for (const b of g.blockers) L.push(`- \`${b.symptom}\` — ${b.cause} **Fix:** ${b.fix}${badge(g, b.claimIds)}`);
  }
  const unv = g.claims.filter((c) => c.evidence.kind === 'unverified');
  if (g.uncertainties.length || unv.length) {
    L.push('', "## What we're not sure about", '');
    for (const u of g.uncertainties) L.push(`- ${u}`);
    for (const c of unv) L.push(`- (unverified) ${c.text}`);
  }
  L.push('', '## Sources', '');
  g.sources.forEach((s, i) => L.push(`${i + 1}. [${s.title}](${s.url}) — ${s.publisher}, fetched ${s.fetchedAt.slice(0, 10)}`));
  const m = g.meta;
  L.push('', `_Generated ${m.generatedAt.slice(0, 10)} · ${m.model} · ${(m.durationMs / 1000).toFixed(0)}s · origin: ${m.origin}${m.reviewedByHuman ? '' : ' · not human-reviewed'}_`, '');
  return L.join('\n');
}
