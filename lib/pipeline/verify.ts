import { z } from 'zod';
import { MODEL_EXTRACT, callTool, type Usage } from '../llm';
import { prompt } from '../prompts';
import type { Claim, GuideDraft } from '../schema';
import type { Doc } from './read';
import { defang, type Emit } from './util';

/** Lowercase, drop markdown link targets and punctuation markers, collapse whitespace. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\]\([^)]*\)/g, ' ')
    .replace(/[*_`#>\[\]()|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tokens = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

/** Best token-window Jaccard similarity between the quote and any window of the document. */
export function bestJaccard(quote: string, doc: string): number {
  const q = new Set(tokens(quote));
  const d = tokens(doc);
  const n = tokens(quote).length;
  if (!q.size || !d.length) return 0;
  let best = 0;
  for (let i = 0; i + n <= d.length || i === 0; i++) {
    const w = new Set(d.slice(i, i + n));
    let inter = 0;
    for (const t of q) if (w.has(t)) inter++;
    best = Math.max(best, inter / (q.size + w.size - inter));
    if (best === 1) break;
  }
  return best;
}

/** Stage 7.1: substring = 0.9, Jaccard >= 0.8 = 0.75, else unverified with 0.3. Tested claims keep confidence 1. */
export function quoteCheck(c: Claim, docs: Map<string, Doc>): { kind: Claim['evidence']['kind']; confidence: number } {
  const e = c.evidence;
  if (e.kind === 'tested') return { kind: 'tested', confidence: 1 };
  if (e.kind === 'unverified') return { kind: 'unverified', confidence: Math.min(c.confidence, 0.5) };
  const quote = e.quote?.trim();
  if (!quote) return { kind: 'unverified', confidence: 0.3 };
  const texts = e.sourceIds.map((id) => docs.get(id)?.markdown).filter((t): t is string => !!t);
  if (texts.some((t) => norm(t).includes(norm(quote)))) return { kind: 'sourced', confidence: 0.9 };
  if (texts.some((t) => bestJaccard(quote, t) >= 0.8)) return { kind: 'sourced', confidence: 0.75 };
  return { kind: 'unverified', confidence: 0.3 };
}

const Judge = z.object({ verdicts: z.array(z.object({ claimId: z.string(), verdict: z.enum(['supports', 'partial', 'contradicts']) })) });
const MULT = { supports: 1, partial: 0.7, contradicts: 0.2 } as const;

function context(c: Claim, docs: Map<string, Doc>): string {
  const quote = c.evidence.quote ?? '';
  for (const id of c.evidence.sourceIds) {
    const t = docs.get(id)?.markdown;
    if (!t) continue;
    const i = t.toLowerCase().indexOf(quote.toLowerCase().slice(0, 40));
    if (i >= 0) return t.slice(Math.max(0, i - 500), i + quote.length + 500);
  }
  return docs.get(c.evidence.sourceIds[0])?.markdown.slice(0, 1000) ?? '';
}

export async function verify(draft: GuideDraft, docList: Doc[], usage: Usage, emit: Emit, opts: { entail?: boolean } = {}): Promise<GuideDraft> {
  const docs = new Map(docList.map((d) => [d.id, d]));
  const claims = draft.claims.map((c) => ({ ...c, evidence: { ...c.evidence }, _from: c.evidence.kind as string }));
  for (const c of claims) {
    const r = quoteCheck(c, docs);
    c.confidence = r.confidence;
    if (r.kind !== c.evidence.kind) (c.evidence.kind = r.kind), (c.evidence.sourceIds = r.kind === 'unverified' ? [] : c.evidence.sourceIds);
  }

  if (opts.entail !== false) {
    const todo = claims.filter((c) => c.evidence.kind === 'sourced' && c.confidence >= 0.75);
    const batches: (typeof todo)[] = [];
    for (let i = 0; i < todo.length; i += 15) batches.push(todo.slice(i, i + 15));
    await Promise.all(
      batches.map(async (b) => {
        const user = b.map((c) => `<item id="${c.id}">\nClaim: ${defang(c.text)}\nQuote: ${defang(c.evidence.quote ?? '')}\nContext: ${defang(context(c, docs))}\n</item>`).join('\n');
        const { verdicts } = await callTool({
          model: MODEL_EXTRACT(),
          system: prompt('judge.v1'),
          user,
          tool: { name: 'judge_claims', description: 'Judge whether each quote supports its claim', schema: Judge },
          maxTokens: 1500,
          usage,
        });
        const byId = new Map(verdicts.map((v) => [v.claimId, v.verdict]));
        for (const c of b) {
          c.confidence = Math.round(c.confidence * MULT[byId.get(c.id) ?? 'partial'] * 100) / 100;
          if (c.confidence < 0.5) (c.evidence.kind = 'unverified'), (c.evidence.sourceIds = []);
        }
      }),
    );
  }

  for (const c of claims) {
    if (c._from !== c.evidence.kind || c.evidence.kind === 'sourced')
      await emit({ type: 'claim_checked', claimId: c.id, from: c._from, to: c.evidence.kind, confidence: c.confidence });
  }
  return { ...draft, claims: claims.map(({ _from, ...c }) => c) };
}
