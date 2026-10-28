import { search, type Hit } from '../firecrawl';
import type { Source } from '../schema';

const AGGREGATORS = ['medium.com', 'dev.to', 'stackoverflow.com'];
const COMMUNITY = [...AGGREGATORS, 'reddit.com', 'community.', 'forum.'];
const VENDORS = ['nango.dev', 'unified.to', 'workos.com', 'ampersand.sh', 'merge.dev', 'composio.dev'];

export type Ranked = Hit & { score: number; publisher: Source['publisher']; official: boolean; review: boolean };
type Ctx = { domain: string; devDocsHost?: string };

export function normalizeUrl(u: string): string {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.hostname.toLowerCase()}${x.pathname.replace(/\/+$/, '')}`;
  } catch {
    return u;
  }
}

const hostMatches = (host: string, d?: string) => !!d && (host === d || host.endsWith('.' + d));
const label = (host: string) => host.split('.').slice(-2)[0];
// ponytail: sister domains by brand prefix (dropbox.com -> dropboxapi.com); a lookalike such as dropbox-fans.com also passes.
const isOfficial = (host: string, { domain, devDocsHost }: Ctx) =>
  hostMatches(host, domain) || hostMatches(host, devDocsHost) || (label(domain).length >= 4 && label(host).startsWith(label(domain)) && !label(host).includes('-'));

export function publisherOf(url: string, { domain, devDocsHost }: Ctx): Source['publisher'] {
  const host = new URL(url).hostname.toLowerCase();
  if (isOfficial(host, { domain, devDocsHost })) return 'official';
  if (COMMUNITY.some((c) => host.includes(c))) return 'community';
  if (VENDORS.some((v) => hostMatches(host, v))) return 'third_party';
  return 'third_party';
}

/** PRD section 7, stage 3 scoring, then top 8 with at least 2 official and 1 review/listing page when available. */
export function rankUrls(hits: Hit[], ctx: Ctx, n = 8): Ranked[] {
  const seen = new Map<string, Ranked>();
  for (const h of hits) {
    let url: URL;
    try {
      url = new URL(h.url);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    const key = normalizeUrl(h.url);
    if (seen.has(key)) continue;
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    const official = isOfficial(host, ctx);
    const review = /review|marketplace|verif|partner|listing|publish/.test(path);
    let score = 0;
    if (official) score += 3;
    if (/oauth|auth|app|scope/.test(path)) score += 2;
    if (review) score += 2;
    if (AGGREGATORS.some((a) => hostMatches(host, a))) score -= 2;
    seen.set(key, { ...h, url: `${url.origin}${url.pathname}${url.search}`, score, official, review, publisher: publisherOf(h.url, ctx) });
  }
  const all = [...seen.values()].sort((a, b) => b.score - a.score);
  let aggregatorKept = false;
  const pool = all.filter((r) => {
    if (r.publisher !== 'community') return true;
    if (aggregatorKept) return false;
    return (aggregatorKept = true);
  });
  const picked = pool.slice(0, n);
  const ensure = (pred: (r: Ranked) => boolean, min: number) => {
    for (const cand of pool) {
      if (picked.filter(pred).length >= min) return;
      if (pred(cand) && !picked.includes(cand)) {
        // swap out the lowest-scoring pick that does not satisfy the predicate
        const idx = [...picked.keys()].reverse().find((i) => !pred(picked[i]) && !(picked[i].official && picked.filter((p) => p.official).length <= 2));
        if (idx === undefined) return;
        picked[idx] = cand;
      }
    }
  };
  ensure((r) => r.official, 2);
  ensure((r) => r.review, 1);
  return picked.sort((a, b) => b.score - a.score);
}

export async function discover(app: { appName: string } & Ctx): Promise<Ranked[]> {
  const a = app.appName;
  const queries = [
    `${a} OAuth 2.0 authorization developer documentation`,
    `${a} create OAuth app register application client ID redirect URI`,
    `${a} app review OR marketplace listing OR verification OR partner program requirements`,
    `${a} OAuth scopes permissions list`,
  ];
  const results = await Promise.allSettled(queries.map((q) => search(q, 5)));
  return rankUrls(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])), app);
}
