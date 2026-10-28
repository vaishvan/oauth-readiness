import { GuideDraft } from '../schema';
import { MODEL_EXTRACT, callTool, type Usage } from '../llm';
import { prompt } from '../prompts';
import { checkInvariants, recompute } from '../validate';
import type { Doc } from './read';
import type { Resolved } from './resolve';
import { defang, type Emit } from './util';

export const PROMPT_VERSION = 'extract.v1';

export function buildUser(app: Resolved, docs: Doc[], probe: string, extra = ''): string {
  const d = docs.map((x) => `<doc id="${x.id}" url="${x.url}" publisher="${x.publisher}">\n${defang(x.markdown)}\n</doc>`).join('\n');
  const note = app.oauthLikely ? '' : '\n<note>The resolver found no public OAuth. Say so in the verdict if the docs confirm it.</note>';
  return `<app name="${app.appName}" domain="${app.domain}" slug="${app.slug}"/>${note}\n${d}\n<probe>\n${defang(probe || 'no probe results')}\n</probe>${extra}`;
}

/** Drop dangling references so the UI never dereferences a missing id. */
export function sanitize(g: GuideDraft): GuideDraft {
  const claimIds = new Set(g.claims.map((c) => c.id));
  const sourceIds = new Set(g.sources.map((s) => s.id));
  const keep = (ids: string[]) => ids.filter((i) => claimIds.has(i));
  return {
    ...g,
    claims: g.claims.map((c) => {
      const ids = c.evidence.sourceIds.filter((i) => sourceIds.has(i));
      return c.evidence.kind === 'sourced' && !ids.length
        ? { ...c, confidence: 0.3, evidence: { ...c.evidence, kind: 'unverified' as const, sourceIds: [] } }
        : { ...c, evidence: { ...c.evidence, sourceIds: ids } };
    }),
    steps: g.steps.map((s) => ({ ...s, claimIds: keep(s.claimIds) })),
    requirements: g.requirements.map((r) => ({ ...r, claimIds: keep(r.claimIds) })),
    blockers: g.blockers.map((b) => ({ ...b, claimIds: keep(b.claimIds) })),
  };
}

export async function extractGuide(opts: { app: Resolved; docs: Doc[]; probe: string; usage: Usage; emit: Emit }) {
  const { app, docs, probe, usage, emit } = opts;
  const sources = docs.map((d) => ({ id: d.id, url: d.url, title: d.title, publisher: d.publisher, fetchedAt: d.fetchedAt }));
  const system = prompt('extract.v1', { date: new Date().toISOString().slice(0, 10) });

  // stream partial results as events, serialized so DB appends keep their order
  let chain: Promise<void> = Promise.resolve();
  const push = (e: Parameters<Emit>[0]) => void (chain = chain.then(() => emit(e)).catch(() => {}));
  const sent = { verdict: false, steps: 0, blockers: 0 };
  const flush = (p: any, final: boolean) => {
    if (!p || typeof p !== 'object') return;
    if (p.verdict && (final || p.steps) && !sent.verdict) (sent.verdict = true), push({ type: 'partial', field: 'verdict', value: p.verdict });
    for (const f of ['steps', 'blockers'] as const) {
      const arr = p[f];
      if (!Array.isArray(arr)) continue;
      const upto = final ? arr.length : arr.length - 1; // the last item may still be streaming
      while (sent[f] < upto) push({ type: 'partial', field: f, value: arr[sent[f]++] });
    }
  };

  const call = (extra: string, stream: boolean) =>
    callTool({
      model: MODEL_EXTRACT(),
      system,
      user: buildUser(app, docs, probe, extra),
      tool: { name: 'submit_guide', description: 'Submit the finished OAuth setup guide', schema: GuideDraft },
      maxTokens: 8000,
      usage,
      onPartial: stream ? (p) => flush(p, false) : undefined,
    });
  const finish = (d: GuideDraft): GuideDraft => recompute({ ...d, slug: app.slug, appName: app.appName, sources });

  let draft = finish(await call('', true));
  flush(draft, true);
  let errs = checkInvariants(draft);
  const warnings: string[] = [];
  if (errs.length) {
    // invariant 6: one repair call, then publish with a warning banner
    draft = finish(await call(`\n\nYour previous guide failed invariant checks. Fix them and call the tool again:\n${errs.join('\n')}`, false));
    errs = checkInvariants(draft);
    if (errs.length) {
      warnings.push(...errs.map((e) => `Invariant: ${e}`));
      draft = recompute(sanitize(draft));
    }
  }
  await chain;
  return { draft, warnings };
}
