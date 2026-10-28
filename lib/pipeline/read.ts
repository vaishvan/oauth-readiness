import { scrape } from '../firecrawl';
import type { Source } from '../schema';
import { publisherOf, type Ranked } from './discover';
import type { Emit } from './util';

export type Doc = { id: string; url: string; title: string; publisher: Source['publisher']; markdown: string; fetchedAt: string };
// Lower both for slow models: CORPUS_CHARS=80000 PAGE_CHARS=15000.
export const PAGE_LIMIT = Number(process.env.PAGE_CHARS ?? 40_000);
export const TOTAL_LIMIT = Number(process.env.CORPUS_CHARS ?? 240_000);
export class NotEnoughDocs extends Error {
  constructor() {
    super('Not enough documentation found. Paste a docs URL to pin it as the first source.');
  }
}

/** Truncate to `limit` chars, keeping headings from the dropped tail so structure survives. */
export function truncate(md: string, limit = PAGE_LIMIT): string {
  if (md.length <= limit) return md;
  const head = md.slice(0, Math.floor(limit * 0.8)).replace(/\n[^\n]*$/, '');
  const tail = md.slice(head.length).split('\n').filter((l) => /^#{1,4}\s/.test(l)).join('\n');
  return `${head}\n\n[truncated; remaining headings:]\n${tail}`.slice(0, limit);
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

export async function read(urls: Ranked[], ctx: { domain: string; devDocsHost?: string }, emit: Emit, pinUrl?: string): Promise<Doc[]> {
  const targets = [...(pinUrl ? [{ url: pinUrl, title: pinUrl } as Ranked] : []), ...urls.filter((u) => u.url !== pinUrl)];
  const results = await pool(targets, 4, async (t) => {
    const r = await scrape(t.url);
    if (!r) await emit({ type: 'warn', message: `Could not read ${t.url}; skipped.` });
    return r && { t, r };
  });
  const docs: Doc[] = [];
  let total = 0;
  for (const x of results) {
    if (!x || !x.r.markdown.trim()) continue;
    const md = truncate(x.r.markdown);
    if (total + md.length > TOTAL_LIMIT) {
      await emit({ type: 'warn', message: `Corpus cap reached; skipped ${x.t.url}.` });
      continue;
    }
    total += md.length;
    const id = `src_${docs.length + 1}`;
    const publisher = publisherOf(x.t.url, ctx);
    docs.push({ id, url: x.t.url, title: (x.r.title || x.t.title).slice(0, 200), publisher, markdown: md, fetchedAt: new Date().toISOString() });
    await emit({ type: 'source', id, url: x.t.url, title: docs[docs.length - 1].title, publisher });
  }
  if (docs.length < 2) throw new NotEnoughDocs();
  return docs;
}
